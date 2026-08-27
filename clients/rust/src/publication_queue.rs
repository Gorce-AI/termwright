//! Ordered, bounded semantic publication off a framework render thread.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};

use serde_json::Value;

use crate::client::Client;
use crate::error::Error;
use crate::evidence::Lease as EvidenceProviderLease;
use crate::framing::encode_frame;
use crate::limits::Limits;
use crate::marker::encode_marker;
use crate::messages::{RevisionCommit, SnapshotMessage};
use crate::tree::Snapshot;
use crate::validate::validate_snapshot;

struct Publication {
    revision: i64,
    tree_frame: Option<Vec<u8>>,
    commit_frame: Vec<u8>,
}

/// A bounded FIFO whose render-side operation performs no transport I/O.
///
/// A marker is returned only after the complete validated snapshot+commit
/// pair has been encoded and admitted atomically. Full queues consume no
/// revision. A transport failure permanently closes admission.
pub struct PublicationQueue {
    sender: Option<mpsc::SyncSender<Publication>>,
    token: String,
    session_id: String,
    limits: Limits,
    subscribe: String,
    marker_enabled: bool,
    revision: i64,
    evidence_lease: Option<EvidenceProviderLease>,
    failed: Arc<AtomicBool>,
    dropped: AtomicU64,
    fatal: Arc<Mutex<Option<(String, String)>>>,
    worker: Option<std::thread::JoinHandle<()>>,
    #[cfg(test)]
    done: Mutex<mpsc::Receiver<()>>,
}

impl PublicationQueue {
    /// Move a connected client into a dedicated writer thread.
    ///
    /// Construct this only after the handshake; dormant applications never
    /// create a queue or thread. Capacity must be positive.
    pub fn new(client: Client, capacity: usize) -> Result<Self, Error> {
        Self::new_inner(client, capacity, None)
    }

    fn new_inner(
        mut client: Client,
        capacity: usize,
        #[cfg(test)] gate: Option<Arc<TestWorkerGate>>,
        #[cfg(not(test))] _gate: Option<()>,
    ) -> Result<Self, Error> {
        if capacity == 0 || !client.connected() {
            return Err(Error::PublicationWorkerFailed);
        }
        let (token, session_id, limits, subscribe, marker_enabled, revision) = client
            .publication_config()
            .ok_or(Error::PublicationWorkerFailed)?;
        let evidence_lease = client.take_evidence_lease();
        let (sender, receiver) = mpsc::sync_channel::<Publication>(capacity);
        #[cfg(test)]
        let (done_sender, done_receiver) = mpsc::sync_channel(1);
        let failed = Arc::new(AtomicBool::new(false));
        let worker_failed = failed.clone();
        let fatal: Arc<Mutex<Option<(String, String)>>> = Arc::new(Mutex::new(None));
        let worker_fatal = fatal.clone();
        let worker = std::thread::Builder::new()
            .name("termwright-semantic-publication".into())
            .spawn(move || {
                while let Ok(publication) = receiver.recv() {
                    #[cfg(test)]
                    if let Some(gate) = gate.as_ref() {
                        gate.enter();
                    }
                    let result = (|| {
                        if let Some(frame) = publication.tree_frame.as_ref() {
                            client.write_frame(frame)?;
                        }
                        client.write_frame(&publication.commit_frame)?;
                        client.accept_queued_publication(
                            publication.revision,
                            publication.tree_frame.is_some(),
                        );
                        Ok::<(), Error>(())
                    })();
                    if result.is_err() {
                        worker_failed.store(true, Ordering::Release);
                        client.close();
                        #[cfg(test)]
                        let _ = done_sender.send(());
                        return;
                    }
                }
                let fatal = worker_fatal.lock().ok().and_then(|mut value| value.take());
                if let Some((code, message)) = fatal {
                    let _ = client.fail(&code, message);
                } else {
                    client.close();
                }
                #[cfg(test)]
                let _ = done_sender.send(());
            })
            .map_err(Error::Io)?;
        Ok(Self {
            sender: Some(sender),
            token,
            session_id,
            limits,
            subscribe,
            marker_enabled,
            revision,
            evidence_lease,
            failed,
            dropped: AtomicU64::new(0),
            fatal,
            worker: Some(worker),
            #[cfg(test)]
            done: Mutex::new(done_receiver),
        })
    }

    /// Negotiated snapshot limits used by a framework tree builder.
    pub fn limits(&self) -> &Limits {
        &self.limits
    }

    /// Validate, encode and non-blockingly admit one complete revision.
    pub fn publish(&mut self, snapshot: &mut Snapshot) -> Result<Option<String>, Error> {
        if self.failed.load(Ordering::Acquire) {
            return Err(Error::PublicationWorkerFailed);
        }
        let revision = self.revision + 1;
        snapshot.v = 2;
        snapshot.session_id = self.session_id.clone();
        snapshot.revision = revision;
        if let Some(lease) = self.evidence_lease.as_ref() {
            snapshot.provider_evidence =
                lease.collect(&self.session_id, revision, snapshot.columns, snapshot.rows);
        }
        let body = serde_json::to_string(&snapshot).map_err(|_| {
            Error::Protocol(crate::error::Violation::new(
                "frame-malformed",
                "snapshot is not JSON-serialisable",
            ))
        })?;
        let parsed: Value = serde_json::from_str(&body).expect("just serialised");
        validate_snapshot(&parsed, &self.limits)?;
        let marker = if self.marker_enabled {
            Some(encode_marker(&self.token, &self.session_id, revision)?)
        } else {
            None
        };
        let tree_frame = if self.subscribe != "revisions" {
            Some(encode_frame(
                &SnapshotMessage::new(snapshot),
                self.limits.max_frame_bytes,
            )?)
        } else {
            None
        };
        let commit_frame =
            encode_frame(&RevisionCommit::new(revision), self.limits.max_frame_bytes)?;
        let publication = Publication {
            revision,
            tree_frame,
            commit_frame,
        };
        let Some(sender) = self.sender.as_ref() else {
            self.failed.store(true, Ordering::Release);
            return Err(Error::PublicationWorkerFailed);
        };
        match sender.try_send(publication) {
            Ok(()) => {
                self.revision = revision;
                Ok(marker)
            }
            Err(mpsc::TrySendError::Full(_)) => {
                self.dropped.fetch_add(1, Ordering::Relaxed);
                Err(Error::PublicationQueueFull)
            }
            Err(mpsc::TrySendError::Disconnected(_)) => {
                self.failed.store(true, Ordering::Release);
                Err(Error::PublicationWorkerFailed)
            }
        }
    }

    /// Revisions dropped before admission because the FIFO was full.
    pub fn dropped(&self) -> u64 {
        self.dropped.load(Ordering::Relaxed)
    }

    /// Whether transport failed and no later marker may be issued.
    pub fn failed(&self) -> bool {
        self.failed.load(Ordering::Acquire)
    }

    /// Fail closed without writing from the caller's thread. Already-admitted
    /// revisions drain in order, then the worker sends the typed fatal.
    pub fn fail(&mut self, code: impl Into<String>, message: impl Into<String>) {
        self.failed.store(true, Ordering::Release);
        if let Ok(mut fatal) = self.fatal.lock() {
            *fatal = Some((code.into(), message.into()));
        }
        // Closing admission lets the worker drain everything already accepted,
        // then send the fatal in the same ordered transport thread.
        self.sender.take();
    }

    /// Close admission, drain the ordered worker and wait for its causal
    /// completion. Framework lifecycle code calls this outside render hooks so
    /// a short-lived one-frame process cannot exit ahead of its semantic data.
    /// Returns whether the worker completed without a transport failure.
    pub fn shutdown(mut self) -> bool {
        self.sender.take();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
        !self.failed.load(Ordering::Acquire)
    }
}

#[cfg(test)]
struct TestWorkerGate {
    entered: mpsc::SyncSender<()>,
    release: Mutex<mpsc::Receiver<()>>,
}

#[cfg(test)]
impl TestWorkerGate {
    fn enter(&self) {
        let _ = self.entered.send(());
        let _ = self.release.lock().expect("gate lock").recv();
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::io::Read;
    use std::os::unix::net::UnixStream;

    use crate::FrameDecoder;
    use crate::{Node, Role};

    fn snapshot() -> Snapshot {
        let mut snapshot = Snapshot::new(80, 24);
        snapshot.push(Node::new("root", Role::Application, "fixture"));
        snapshot
    }

    fn gated_queue(
        capacity: usize,
    ) -> (
        PublicationQueue,
        UnixStream,
        mpsc::Receiver<()>,
        mpsc::SyncSender<()>,
    ) {
        let (client_stream, server_stream) = UnixStream::pair().expect("socket pair");
        let client = Client::test_connected(client_stream);
        let (entered_tx, entered_rx) = mpsc::sync_channel(1);
        let (release_tx, release_rx) = mpsc::sync_channel(1);
        let gate = Arc::new(TestWorkerGate {
            entered: entered_tx,
            release: Mutex::new(release_rx),
        });
        let queue = PublicationQueue::new_inner(client, capacity, Some(gate)).expect("queue");
        (queue, server_stream, entered_rx, release_tx)
    }

    #[test]
    fn full_queue_drops_without_revision_gap_or_marker() {
        let (mut queue, mut server, entered, release) = gated_queue(1);
        assert!(queue.publish(&mut snapshot()).unwrap().is_some());
        entered.recv().expect("worker entered first job");
        assert!(queue.publish(&mut snapshot()).unwrap().is_some());
        assert!(matches!(
            queue.publish(&mut snapshot()),
            Err(Error::PublicationQueueFull)
        ));
        assert_eq!(queue.revision, 2);
        assert_eq!(queue.dropped(), 1);
        release.send(()).unwrap();
        entered.recv().expect("worker entered second job");
        release.send(()).unwrap();
        queue.fail("test-complete", "close");
        queue.done.lock().unwrap().recv().expect("worker stopped");
        let mut bytes = Vec::new();
        let _ = server.read_to_end(&mut bytes);
        let mut decoder = FrameDecoder::new(
            crate::DEFAULT_LIMITS.max_frame_bytes,
            crate::DEFAULT_LIMITS.max_depth,
        );
        let frames = decoder.push(&bytes).expect("ordered frames decode");
        let names: Vec<_> = frames
            .iter()
            .take(4)
            .map(|frame| frame.value["type"].as_str())
            .collect();
        assert_eq!(
            names,
            [
                Some("snapshot"),
                Some("revision-commit"),
                Some("snapshot"),
                Some("revision-commit")
            ]
        );
    }

    #[test]
    fn worker_failure_permanently_refuses_later_markers() {
        let (mut queue, server, entered, release) = gated_queue(1);
        assert!(queue.publish(&mut snapshot()).unwrap().is_some());
        entered.recv().expect("worker entered");
        drop(server);
        release.send(()).unwrap();
        // The disconnected sender is the causal failure signal; no polling or
        // quiet window participates in correctness.
        queue.done.lock().unwrap().recv().expect("worker stopped");
        assert!(matches!(
            queue.publish(&mut snapshot()),
            Err(Error::PublicationWorkerFailed)
        ));
    }

    #[test]
    fn shutdown_drains_an_admitted_one_frame_process_before_returning() {
        let (client_stream, mut server) = UnixStream::pair().expect("socket pair");
        let client = Client::test_connected(client_stream);
        let mut queue = PublicationQueue::new(client, 1).expect("queue");
        assert!(queue.publish(&mut snapshot()).unwrap().is_some());

        assert!(queue.shutdown(), "clean drain reported worker failure");

        let mut bytes = Vec::new();
        server
            .read_to_end(&mut bytes)
            .expect("worker closed socket");
        let mut decoder = FrameDecoder::new(
            crate::DEFAULT_LIMITS.max_frame_bytes,
            crate::DEFAULT_LIMITS.max_depth,
        );
        let frames = decoder.push(&bytes).expect("ordered frames decode");
        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0].value["type"], "snapshot");
        assert_eq!(frames[1].value["type"], "revision-commit");
    }
}
