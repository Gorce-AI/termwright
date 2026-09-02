//! Bounded local-socket client for the semantic side-channel.
//!
//! **Dormant rule.** Without `TERMWRIGHT_ENDPOINT` and `TERMWRIGHT_TOKEN` in
//! the environment [`Client::from_env`] returns `None`: the application opens
//! no socket, writes no marker, and renders exactly the bytes it would have
//! rendered anyway.
//!
//! The client is deliberately blocking and single-threaded. A TUI renders on
//! one thread and the marker must follow that render's last byte, so
//! [`Client::publish`] does its socket work inline and hands back the marker
//! to write. Driver requests are picked up by [`Client::poll`], which never
//! blocks.

use std::io::{ErrorKind, Read, Write};
#[cfg(unix)]
use std::os::unix::net::UnixStream;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::Value;

use crate::debug::{describe_endpoint, error_label, join_capabilities, on_off, Category, DebugLog};
use crate::error::Error;
use crate::evidence::{Lease as EvidenceProviderLease, Registry as EvidenceProviderRegistry};
use crate::framing::{encode_frame, FrameDecoder};
use crate::limits::{Limits, DEFAULT_LIMITS};
use crate::logs::{AttrValue, LogLevel, LogRecord, MAX_LOG_ATTRS};
use crate::marker::encode_marker;
use crate::messages::{
    default_capabilities, parse_driver_message, Hello, HelloAck, LogMessage, ProbeInfo,
    ProtocolErrorMessage, RevisionCommit, SemanticFullMessage,
};
use crate::roles::Capability;
use crate::tree::Snapshot;
use crate::validate::validate_snapshot;

#[cfg(unix)]
type TransportStream = UnixStream;

#[cfg(windows)]
use interprocess::{
    os::windows::named_pipe::{pipe_mode, DuplexPipeStream},
    ConnectWaitMode,
};
#[cfg(windows)]
type TransportStream = DuplexPipeStream<pipe_mode::Bytes>;

/// Environment variable naming the driver's socket.
pub const ENV_ENDPOINT: &str = "TERMWRIGHT_ENDPOINT";
/// Environment variable carrying the per-launch session token.
pub const ENV_TOKEN: &str = "TERMWRIGHT_TOKEN";
/// Default handshake budget.
pub const DIAL_TIMEOUT: Duration = Duration::from_secs(5);

/// Default bound on a single frame write.
///
/// This client is blocking by design — a TUI renders on one thread and the
/// marker must follow that render's last byte — so an unbounded `write_all`
/// turns a driver that stopped reading into an application that stopped
/// drawing. A driver that cannot take a frame in a quarter of a second is not
/// keeping up, and the next frame carries newer state anyway.
pub const WRITE_TIMEOUT: Duration = Duration::from_millis(250);

/// How a client identifies itself and what it can provide.
#[derive(Debug, Clone)]
pub struct Options {
    /// Adapter name sent in the handshake.
    pub adapter_name: String,
    /// Adapter version sent in the handshake.
    pub adapter_version: String,
    /// Capabilities announced to the driver.
    pub capabilities: Vec<Capability>,
    /// Limits in force until `hello-ack` replaces them.
    pub limits: Limits,
    /// Bound on a single frame write. `None` disables it, which is only sane
    /// for a caller that publishes off the render path.
    pub write_timeout: Option<Duration>,
    /// What a probe says it can observe. `None` for a hand-written adapter,
    /// which is what the driver assumes by default.
    pub probe: Option<ProbeInfo>,
    /// Adapter-side diagnostic log, or `None` for silence — which is what
    /// [`Options::new`] leaves here unless `TERMWRIGHT_DEBUG_FILE` names a
    /// file. Shared rather than owned so an adapter can log alongside the
    /// client on the same file.
    pub debug: Option<Arc<DebugLog>>,
    /// Application evidence registry frozen before hello.
    pub evidence_registry: Option<EvidenceProviderRegistry>,
}

impl Options {
    /// Options for an adapter that also forwards application logs.
    ///
    /// Announcing `logs` is what makes the driver grant a budget; without it
    /// the driver sends none and the adapter must stay silent.
    pub fn with_logs(adapter_name: impl Into<String>, adapter_version: impl Into<String>) -> Self {
        let mut options = Self::new(adapter_name, adapter_version);
        options.capabilities.push(Capability::Logs);
        options
    }

    /// Options for an adapter with the default capability set.
    pub fn new(adapter_name: impl Into<String>, adapter_version: impl Into<String>) -> Self {
        Self {
            adapter_name: adapter_name.into(),
            adapter_version: adapter_version.into(),
            capabilities: default_capabilities(),
            limits: DEFAULT_LIMITS,
            write_timeout: Some(WRITE_TIMEOUT),
            probe: None,
            // Left silent on purpose: opening a file is a side effect, and a
            // constructor is the wrong place for one. `Client::from_env` is
            // where the environment is read, here and in the other clients.
            debug: None,
            evidence_registry: None,
        }
    }
}

/// Wall-clock milliseconds, the only clock both sides agree on without
/// negotiating: an adapter cannot know when the driver opened the session.
fn epoch_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.as_millis() as i64)
        .unwrap_or(0)
}

/// Rate limiter for the log channel: `burst` capacity on top of the sustained
/// rate, refilled continuously.
///
/// The adapter enforces its own budget and drops locally, which is what keeps
/// a log storm from eating the frame budget the semantic tree needs.
#[derive(Debug)]
struct TokenBucket {
    per_second: f64,
    capacity: f64,
    tokens: f64,
    updated: Instant,
}

impl TokenBucket {
    fn new(per_second: i64, burst: i64, now: Instant) -> Self {
        let rate = per_second.max(0) as f64;
        let capacity = rate + burst.max(0) as f64;
        Self {
            per_second: rate,
            capacity,
            tokens: capacity,
            updated: now,
        }
    }

    /// Consume one token, refilling first. `false` means "over budget".
    fn take(&mut self, now: Instant) -> bool {
        if self.per_second <= 0.0 {
            return false;
        }
        let elapsed = now.saturating_duration_since(self.updated).as_secs_f64();
        self.updated = now;
        self.tokens = (self.tokens + elapsed * self.per_second).min(self.capacity);
        if self.tokens < 1.0 {
            return false;
        }
        self.tokens -= 1.0;
        true
    }
}

/// One semantic session: handshake, snapshot publishing, render markers.
///
/// The client owns the revision counter; an adapter never picks its own.
#[derive(Debug)]
pub struct Client {
    endpoint: String,
    token: String,
    options: Options,
    stream: Option<TransportStream>,
    decoder: FrameDecoder,
    limits: Limits,
    session_id: Option<String>,
    revision: i64,
    marker_enabled: bool,
    log_budget: Option<crate::messages::LogBudget>,
    snapshots_sent: u64,
    log_seq: i64,
    log_bucket: Option<TokenBucket>,
    logs_dropped: u64,
    subscribe: String,
    evidence_lease: Option<EvidenceProviderLease>,
}

impl Client {
    /// Build a client for an explicit endpoint and token.
    pub fn new(endpoint: impl Into<String>, token: impl Into<String>, options: Options) -> Self {
        let limits = options.limits;
        Self {
            endpoint: endpoint.into(),
            token: token.into(),
            options,
            stream: None,
            decoder: FrameDecoder::new(limits.max_frame_bytes, limits.max_depth),
            limits,
            session_id: None,
            revision: 0,
            marker_enabled: false,
            log_budget: None,
            snapshots_sent: 0,
            log_seq: 0,
            log_bucket: None,
            logs_dropped: 0,
            subscribe: "semantic".to_owned(),
            evidence_lease: None,
        }
    }

    /// Build a client from `TERMWRIGHT_*`, or `None` when not instrumented.
    ///
    /// This is the dormant rule in one function: no endpoint or no token means
    /// no client, and the caller must then open nothing and emit nothing.
    pub fn from_env(mut options: Options) -> Option<Self> {
        if options.debug.is_none() {
            options.debug = DebugLog::from_env(&options.adapter_name).map(Arc::new);
        }
        Self::from_values(
            std::env::var(ENV_ENDPOINT).ok().as_deref(),
            std::env::var(ENV_TOKEN).ok().as_deref(),
            options,
        )
    }

    /// Build a client from explicit endpoint and token values,
    /// applying the same dormant rule as [`Client::from_env`].
    ///
    /// Use this when the process manages its own environment, or in tests.
    /// A missing or empty endpoint or token yields `None`.
    pub fn from_values(
        endpoint: Option<&str>,
        token: Option<&str>,
        options: Options,
    ) -> Option<Self> {
        let endpoint = endpoint.filter(|value| !value.is_empty());
        let token = token.filter(|value| !value.is_empty());
        let (Some(endpoint), Some(token)) = (endpoint, token) else {
            if let Some(log) = options.debug.as_ref() {
                let mut missing = Vec::new();
                if endpoint.is_none() {
                    missing.push(ENV_ENDPOINT);
                }
                if token.is_none() {
                    missing.push(ENV_TOKEN);
                }
                log.line(
                    Category::Diag,
                    &format!("dormant: {} not set", missing.join(" and ")),
                );
            }
            return None;
        };
        if !endpoint_supported(endpoint) {
            if let Some(log) = options.debug.as_ref() {
                log.line(
                    Category::Diag,
                    &format!(
                        "dormant: {} is not a local endpoint for this platform",
                        describe_endpoint(endpoint)
                    ),
                );
            }
            return None;
        }
        Some(Self::new(endpoint, token, options))
    }

    /// Connect, send `hello`, and wait for `hello-ack`.
    ///
    /// # Errors
    /// Returns [`Error::Io`] when the endpoint is unreachable and
    /// [`Error::HandshakeTimeout`] when the driver does not answer. A failed
    /// side-channel must not take the application down: callers are expected
    /// to carry on rendering.
    pub fn connect(&mut self, timeout: Duration) -> Result<(), Error> {
        if let Some(probe) = self.options.probe.as_ref() {
            probe.validate()?;
        }
        self.debug_line(
            Category::Sem,
            &format!(
                "dial {} timeout={}ms",
                describe_endpoint(&self.endpoint),
                timeout.as_millis()
            ),
        );
        let stream = match connect_transport(&self.endpoint, timeout, self.options.write_timeout) {
            Ok(stream) => stream,
            Err(error) => {
                self.debug_line(
                    Category::Diag,
                    &format!("dial failed, staying dormant: {}", error_label(&error)),
                );
                return Err(error.into());
            }
        };
        self.stream = Some(stream);

        let mut hello = Hello::new(
            &self.token,
            &self.options.adapter_name,
            &self.options.adapter_version,
            self.options.capabilities.clone(),
        );
        if let Some(probe) = self.options.probe.clone() {
            hello = hello.with_probe(probe);
        }
        if let Some(registry) = self.options.evidence_registry.as_ref() {
            let lease = registry.freeze();
            hello = hello.with_providers(lease.registrations());
            self.evidence_lease = Some(lease);
        }
        self.send(&hello)?;
        self.debug_line(
            Category::Sem,
            &format!(
                "hello sent adapter={}/{} caps={}",
                self.options.adapter_name,
                self.options.adapter_version,
                join_capabilities(&self.options.capabilities)
            ),
        );

        let deadline = Instant::now() + timeout;
        while self.session_id.is_none() {
            if Instant::now() >= deadline {
                self.debug_line(
                    Category::Diag,
                    &format!(
                        "no hello-ack within {}ms, staying dormant",
                        timeout.as_millis()
                    ),
                );
                self.close();
                return Err(Error::HandshakeTimeout);
            }
            self.poll()?;
            std::thread::yield_now();
        }
        Ok(())
    }

    /// Write one diagnostic line, when diagnostics are on.
    ///
    /// Named apart from [`Client::log`], which is the application's own log
    /// channel to the driver: these two go to different places for different
    /// readers, and confusing them would put application text in a CI artifact
    /// or diagnostics on the wire.
    fn debug_line(&self, category: Category, message: &str) {
        if let Some(log) = self.options.debug.as_ref() {
            log.line(category, message);
        }
    }

    /// Whether the handshake completed and the link is still up.
    pub fn connected(&self) -> bool {
        self.session_id.is_some() && self.stream.is_some()
    }

    /// The id the driver assigned, or `None` before the handshake.
    pub fn session_id(&self) -> Option<&str> {
        self.session_id.as_deref()
    }

    /// The last revision this client published.
    pub fn revision(&self) -> i64 {
        self.revision
    }

    /// The log-channel allowance the driver granted, or `None` when logs are
    /// disabled — which is the case unless the adapter announced `logs`.
    pub fn log_budget(&self) -> Option<crate::messages::LogBudget> {
        self.log_budget
    }

    /// The ceilings in force, as negotiated by `hello-ack`.
    pub fn limits(&self) -> &Limits {
        &self.limits
    }

    /// Drop the session. The application keeps running.
    pub fn close(&mut self) {
        if let Some(stream) = self.stream.take() {
            self.debug_line(
                Category::Sem,
                &format!(
                    "close r{} snapshots={} logs_dropped={}",
                    self.revision, self.snapshots_sent, self.logs_dropped
                ),
            );
            close_transport(stream);
        }
        self.session_id = None;
        if let Some(mut lease) = self.evidence_lease.take() {
            lease.close();
        }
    }

    /// Send a typed fatal producer-contract error and close the channel.
    pub fn fail(&mut self, code: &str, message: impl Into<String>) -> Result<(), Error> {
        let result = self.send(&ProtocolErrorMessage::new(code, message));
        self.close();
        result
    }

    /// Publish a snapshot for the next revision and return its marker.
    ///
    /// Write the marker to stdout **after** the render's last byte: it commits
    /// the bytes that precede it. `session_id` and `revision` on the snapshot
    /// are overwritten with the session's own.
    ///
    /// Returns `Ok(None)` when there is no live session or the driver did not
    /// ask for markers, so a dormant app takes no branch.
    ///
    /// # Errors
    /// Returns [`Error::Validation`] if the snapshot is invalid — that is an
    /// adapter bug, so it is loud rather than silent — or [`Error::Io`] if the
    /// channel broke.
    pub fn publish(&mut self, snapshot: &mut Snapshot) -> Result<Option<String>, Error> {
        self.publish_inner(snapshot)
    }

    fn publish_inner(&mut self, snapshot: &mut Snapshot) -> Result<Option<String>, Error> {
        let Some(session_id) = self.session_id.clone() else {
            return Ok(None);
        };
        if self.stream.is_none() {
            return Ok(None);
        }

        let revision = self.revision + 1;
        snapshot.v = 3;
        snapshot.session_id = session_id.clone();
        snapshot.revision = revision;
        if let Some(lease) = self.evidence_lease.as_ref() {
            snapshot.provider_evidence =
                lease.collect(&session_id, revision, snapshot.columns, snapshot.rows);
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
            Some(encode_marker(&self.token, &session_id, revision)?)
        } else {
            None
        };

        // Encode every frame before writing the first byte. A local ceiling
        // failure is recoverable; sending the tree and only then discovering
        // that its commit cannot be encoded would leave the wire half-applied.
        let tree_frame = Some(encode_frame(
            &SemanticFullMessage::new(snapshot),
            self.limits.max_frame_bytes,
        )?);
        let commit_frame =
            encode_frame(&RevisionCommit::new(revision), self.limits.max_frame_bytes)?;

        if let Some(frame) = &tree_frame {
            self.write_frame(frame)?;
        }
        self.write_frame(&commit_frame)?;

        // Only bytes that are fully on the wire become the published revision.
        self.revision = revision;
        if tree_frame.is_some() {
            self.snapshots_sent += 1;
        }

        Ok(marker)
    }

    /// Whole trees this client has published.
    pub fn snapshots_sent(&self) -> u64 {
        self.snapshots_sent
    }

    /// Records this adapter dropped locally, for being over budget or over a
    /// limit. Each one left a gap in the sequence.
    pub fn logs_dropped(&self) -> u64 {
        self.logs_dropped
    }

    /// Forward one application log record, if the driver asked for logs.
    ///
    /// Returns whether the record went out. A record is dropped when the
    /// session is not live, when the driver granted no budget, when this
    /// adapter is over its rate, or when the record breaks a limit.
    ///
    /// Every attempt consumes a sequence number, dropped or not: the gap left
    /// in `seq` is precisely how the driver learns records were lost here
    /// rather than in transit.
    ///
    /// `seq` is assigned here whatever the caller set, because the adapter is
    /// the only authority on it: the channel is open to several publishers,
    /// and two of them can pick the same number in good faith. A caller's own
    /// number is kept as the `origin.seq` attribute, which is a diagnostic
    /// rather than a promise — it is dropped rather than allowed to push the
    /// record over a limit.
    pub fn log(&mut self, mut record: LogRecord) -> bool {
        if self.session_id.is_none() || self.stream.is_none() || self.log_bucket.is_none() {
            return false;
        }

        let origin = record.seq;
        self.log_seq += 1;
        record.seq = self.log_seq;
        if record.ts == 0 {
            record.ts = epoch_millis();
        }
        if record.revision.is_none() && self.revision > 0 {
            record.revision = Some(self.revision);
        }

        let now = Instant::now();
        let allowed = self
            .log_bucket
            .as_mut()
            .is_some_and(|bucket| bucket.take(now));
        if !allowed {
            self.logs_dropped += 1;
            return false;
        }
        if origin > 0 && record.attrs.len() < MAX_LOG_ATTRS {
            // A hint is never worth turning a log line into a rejected frame,
            // so it is backed out if it costs the record its validity.
            record
                .attrs
                .insert("origin.seq".to_owned(), AttrValue::Int(origin));
            if record.validate(&self.limits).is_err() {
                record.attrs.remove("origin.seq");
            }
        }
        if record.validate(&self.limits).is_err() {
            // An oversized or malformed record is dropped locally rather than
            // taking the channel down; the gap in seq reports it.
            self.logs_dropped += 1;
            return false;
        }
        self.send(&LogMessage::new(&record)).is_ok()
    }

    /// Convenience for the common call: a level and a message.
    pub fn log_message(&mut self, level: LogLevel, message: impl Into<String>) -> bool {
        self.log(LogRecord::new(level, message))
    }

    /// Read and answer whatever the driver has sent, without blocking.
    ///
    /// Call it on every render tick, or whenever convenient, to process
    /// driver control messages without blocking.
    ///
    /// # Errors
    /// Returns [`Error::Io`] if the channel broke, or [`Error::Parse`] if the
    /// driver sent something the contract forbids.
    pub fn poll(&mut self) -> Result<(), Error> {
        let mut buffer = [0u8; 8192];
        loop {
            let read = match self.stream.as_mut() {
                None => return Ok(()),
                Some(stream) => read_transport(stream, &mut buffer),
            };
            match read {
                Ok(Incoming::Closed) => {
                    self.close();
                    return Ok(());
                }
                Ok(Incoming::Data(count)) => {
                    let frames = self.decoder.push(&buffer[..count])?;
                    for frame in frames {
                        self.handle(&frame.value)?;
                    }
                }
                Ok(Incoming::Idle) => return Ok(()),
                Err(error) if error.kind() == ErrorKind::Interrupted => continue,
                Err(error) => {
                    self.close();
                    return Err(Error::Io(error));
                }
            }
        }
    }

    fn handle(&mut self, value: &Value) -> Result<(), Error> {
        if let Err(error) = parse_driver_message(value, &self.limits) {
            self.debug_line(
                Category::Diag,
                &format!("rejected a driver message: {error}"),
            );
            let _ = self.send(&ProtocolErrorMessage::new("malformed", error.to_string()));
            self.close();
            return Err(Error::Parse(error));
        }

        match value.get("type").and_then(Value::as_str) {
            Some("hello-ack") => {
                let ack: HelloAck = serde_json::from_value(value.clone()).expect("validated above");
                self.session_id = Some(ack.session_id);
                self.limits = ack.limits;
                self.marker_enabled = ack.marker.enabled;
                self.log_budget = ack.logs;
                self.log_bucket = match ack.logs {
                    Some(budget) if budget.enabled => Some(TokenBucket::new(
                        budget.max_records_per_second,
                        budget.burst,
                        Instant::now(),
                    )),
                    _ => None,
                };
                self.subscribe = ack.subscribe;
                if let Some(log) = self.options.debug.as_ref() {
                    let session = self.session_id.clone().unwrap_or_default();
                    log.set_label(&session);
                    log.line(
                        Category::Sem,
                        &format!(
                            "hello-ack session={session} marker={} subscribe={} logs={}",
                            on_off(self.marker_enabled),
                            self.subscribe,
                            on_off(self.log_bucket.is_some())
                        ),
                    );
                }
            }
            Some("error") => {
                self.debug_line(
                    Category::Diag,
                    &format!(
                        "driver ended the session: {}",
                        value.get("code").and_then(Value::as_str).unwrap_or("?")
                    ),
                );
                self.close();
            }
            _ => {}
        }
        Ok(())
    }

    fn send<T: serde::Serialize>(&mut self, message: &T) -> Result<(), Error> {
        let frame = encode_frame(message, self.limits.max_frame_bytes)?;
        self.write_frame(&frame)
    }

    pub(crate) fn write_frame(&mut self, frame: &[u8]) -> Result<(), Error> {
        let Some(stream) = self.stream.as_mut() else {
            return Ok(());
        };
        match write_transport_frame(stream, frame, self.options.write_timeout) {
            Ok(()) => Ok(()),
            Err(error) => {
                let timed_out = matches!(
                    error.kind(),
                    ErrorKind::WouldBlock | ErrorKind::TimedOut | ErrorKind::Interrupted
                );
                self.close();
                if timed_out {
                    // `write_all` may have delivered part of a length-prefixed
                    // frame, and there is no resynchronisation point in the
                    // stream, so the session is unrecoverable rather than slow.
                    self.debug_line(
                        Category::Diag,
                        "write deadline exceeded; session is unrecoverable",
                    );
                    return Err(Error::WriteTimeout);
                }
                Err(Error::Io(error))
            }
        }
    }

    pub(crate) fn accept_queued_publication(&mut self, revision: i64, snapshot_sent: bool) {
        self.revision = revision;
        if snapshot_sent {
            self.snapshots_sent += 1;
        }
    }

    pub(crate) fn take_evidence_lease(&mut self) -> Option<EvidenceProviderLease> {
        self.evidence_lease.take()
    }

    pub(crate) fn publication_config(&self) -> Option<(String, String, Limits, bool, i64)> {
        Some((
            self.token.clone(),
            self.session_id.clone()?,
            self.limits,
            self.marker_enabled,
            self.revision,
        ))
    }

    #[cfg(all(test, unix))]
    pub(crate) fn test_connected(stream: TransportStream) -> Self {
        let mut client = Self::new("unused", "test-token", Options::new("queue-test", "1"));
        client.stream = Some(stream);
        client.session_id = Some("test-session".into());
        client.marker_enabled = true;
        client
    }
}

#[cfg(unix)]
fn endpoint_supported(endpoint: &str) -> bool {
    !endpoint.starts_with(r"\\.\pipe\") && !endpoint.starts_with(r"\\?\pipe\")
}

#[cfg(windows)]
fn endpoint_supported(endpoint: &str) -> bool {
    endpoint.starts_with(r"\\.\pipe\") || endpoint.starts_with(r"\\?\pipe\")
}

#[cfg(unix)]
fn connect_transport(
    endpoint: &str,
    _dial_timeout: Duration,
    write_timeout: Option<Duration>,
) -> std::io::Result<TransportStream> {
    let stream = UnixStream::connect(endpoint)?;
    stream.set_read_timeout(Some(Duration::from_millis(50)))?;
    stream.set_write_timeout(write_timeout)?;
    Ok(stream)
}

#[cfg(windows)]
fn connect_transport(
    endpoint: &str,
    dial_timeout: Duration,
    _write_timeout: Option<Duration>,
) -> std::io::Result<TransportStream> {
    let stream = TransportStream::connect_by_path_with_wait_mode(
        endpoint,
        ConnectWaitMode::Timeout(dial_timeout),
    )?;
    // Windows named pipes have no reliable socket-style timeout option in the
    // exact transport. Nonblocking mode lets poll return immediately and lets
    // write_transport_frame enforce one monotonic whole-frame deadline.
    stream.set_nonblocking(true)?;
    Ok(stream)
}

/// What one non-blocking read of the side channel found.
enum Incoming {
    Data(usize),
    /// Nothing buffered right now; the channel is still open.
    Idle,
    /// The driver closed its end.
    Closed,
}

#[cfg(unix)]
fn read_transport(stream: &mut TransportStream, buffer: &mut [u8]) -> std::io::Result<Incoming> {
    match stream.read(buffer) {
        Ok(0) => Ok(Incoming::Closed),
        Ok(count) => Ok(Incoming::Data(count)),
        Err(error) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {
            Ok(Incoming::Idle)
        }
        Err(error) => Err(error),
    }
}

/// Windows: `ERROR_NO_DATA`, returned by a `PIPE_NOWAIT` read of an empty pipe.
#[cfg(windows)]
const ERROR_NO_DATA: i32 = 232;
/// Windows: `ERROR_BROKEN_PIPE`, the peer actually closed its end.
#[cfg(windows)]
const ERROR_BROKEN_PIPE: i32 = 109;

/// Reads the named pipe, where an empty read does not mean end of stream.
///
/// `set_nonblocking(true)` puts the handle in `PIPE_NOWAIT`, and a read of an
/// empty pipe in that mode succeeds with zero bytes — or fails with
/// `ERROR_NO_DATA` — rather than reporting `WouldBlock`. Both mean "nothing
/// yet". Treating either as end of stream closed the channel in the gap
/// between sending `hello` and the driver's `hello-ack`, which the driver then
/// saw as a vanished peer. Only `ERROR_BROKEN_PIPE` reports a real close; note
/// that Rust maps both 109 and 232 to `ErrorKind::BrokenPipe`, so the raw code
/// is the only thing that separates them.
#[cfg(windows)]
fn read_transport(stream: &mut TransportStream, buffer: &mut [u8]) -> std::io::Result<Incoming> {
    match stream.read(buffer) {
        Ok(0) => Ok(Incoming::Idle),
        Ok(count) => Ok(Incoming::Data(count)),
        Err(error) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {
            Ok(Incoming::Idle)
        }
        Err(error) if error.raw_os_error() == Some(ERROR_NO_DATA) => Ok(Incoming::Idle),
        Err(error) if error.raw_os_error() == Some(ERROR_BROKEN_PIPE) => Ok(Incoming::Closed),
        Err(error) => Err(error),
    }
}

#[cfg(unix)]
fn close_transport(stream: TransportStream) {
    let _ = stream.shutdown(std::net::Shutdown::Both);
}

#[cfg(windows)]
fn close_transport(_stream: TransportStream) {
    // Named pipes do not support half-shutdown. Dropping the unique handle is
    // the authoritative close operation.
}

#[cfg(unix)]
fn write_transport_frame(
    stream: &mut TransportStream,
    frame: &[u8],
    _timeout: Option<Duration>,
) -> std::io::Result<()> {
    stream.write_all(frame).and_then(|()| stream.flush())
}

#[cfg(windows)]
fn write_transport_frame(
    stream: &mut TransportStream,
    frame: &[u8],
    timeout: Option<Duration>,
) -> std::io::Result<()> {
    let deadline = timeout.map(|duration| Instant::now() + duration);
    let mut offset = 0;
    while offset < frame.len() {
        match stream.write(&frame[offset..]) {
            Ok(0) => return Err(std::io::Error::from(ErrorKind::WriteZero)),
            Ok(written) => offset += written,
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(error) if error.kind() == ErrorKind::WouldBlock => {
                if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
                    return Err(std::io::Error::from(ErrorKind::TimedOut));
                }
                std::thread::yield_now();
            }
            Err(error) => return Err(error),
        }
    }
    loop {
        match stream.flush() {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(error) if error.kind() == ErrorKind::WouldBlock => {
                if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
                    return Err(std::io::Error::from(ErrorKind::TimedOut));
                }
                std::thread::yield_now();
            }
            Err(error) => return Err(error),
        }
    }
}
