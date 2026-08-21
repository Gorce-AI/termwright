//! Client behaviour: the dormant rule, the handshake, and publishing.

use std::io::{Read, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

use termwright_protocol::{
    encode_frame, verify_marker_payload, Client, Error, FrameDecoder, Node, Options, Role,
    Snapshot, DEFAULT_LIMITS,
};

/// What a VT parser would hand an OSC handler. Only the introducer is
/// stripped: `verify_marker_payload` tolerates the trailing terminator, and
/// leaving it on exercises that tolerance.
fn payload_of(marker: &str) -> &str {
    let introducer = format!("\x1b]{};", termwright_protocol::MARKER_OSC_CODE);
    marker
        .strip_prefix(introducer.as_str())
        .unwrap_or_else(|| panic!("marker {marker:?} does not open with {introducer:?}"))
}

const TOKEN: &str = "test-token";
const SESSION: &str = "s-42";

/// A socket path short enough for the 104-byte `sockaddr_un` limit, which the
/// usual temp directories on macOS blow straight through.
fn socket_path() -> String {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    format!("/tmp/tw-{stamp}-{:?}.sock", thread::current().id())
}

/// The driver end: completes the handshake, reports what the adapter sent, and
/// forwards anything pushed into the returned sender back down the socket.
fn start_fake_driver(path: &str) -> (Receiver<Value>, Sender<Value>) {
    start_fake_driver_with_limits(path, DEFAULT_LIMITS)
}

fn start_fake_driver_with_limits(
    path: &str,
    limits: termwright_protocol::Limits,
) -> (Receiver<Value>, Sender<Value>) {
    let listener = UnixListener::bind(path).expect("binding the driver socket");
    let (sender, receiver) = channel();
    let (outbound, to_send) = channel::<Value>();

    thread::spawn(move || {
        let (mut stream, _) = match listener.accept() {
            Ok(accepted) => accepted,
            Err(_) => return,
        };
        let mut decoder =
            FrameDecoder::new(DEFAULT_LIMITS.max_frame_bytes, DEFAULT_LIMITS.max_depth);
        stream
            .set_read_timeout(Some(Duration::from_millis(20)))
            .expect("read timeout");
        let mut buffer = [0u8; 8192];
        loop {
            for message in to_send.try_iter() {
                send(&mut stream, &message);
            }
            match stream.read(&mut buffer) {
                Ok(0) => return,
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) =>
                {
                    continue
                }
                Err(_) => return,
                Ok(count) => {
                    let frames = match decoder.push(&buffer[..count]) {
                        Ok(frames) => frames,
                        Err(_) => return,
                    };
                    for frame in frames {
                        if frame.value.get("type").and_then(Value::as_str) == Some("hello") {
                            send(
                                &mut stream,
                                &json!({
                                    "type": "hello-ack",
                                    "protocol": "termwright/2",
                                    "sessionId": SESSION,
                                    "limits": limits,
                                    "subscribe": "snapshots",
                                    "marker": { "enabled": true },
                                }),
                            );
                        }
                        if sender.send(frame.value).is_err() {
                            return;
                        }
                    }
                }
            }
        }
    });

    (receiver, outbound)
}

fn send(stream: &mut UnixStream, message: &Value) {
    let frame = encode_frame(message, DEFAULT_LIMITS.max_frame_bytes).expect("encoding");
    let _ = stream.write_all(&frame);
}

fn next_frame(receiver: &Receiver<Value>) -> Value {
    receiver
        .recv_timeout(Duration::from_secs(2))
        .expect("no frame arrived")
}

fn sample_snapshot() -> Snapshot {
    let mut snapshot = Snapshot::new(80, 24);
    snapshot.push(Node::new("root", Role::Dialog, "Permission"));
    snapshot.push(Node::new("ok", Role::Button, "Approve").with_parent("root"));
    snapshot
}

// -- dormant rule ----------------------------------------------------------

#[test]
fn no_client_without_a_complete_environment() {
    let cases: [(Option<&str>, Option<&str>); 4] = [
        (None, None),
        (Some("/tmp/nope.sock"), None),
        (None, Some(TOKEN)),
        (Some(r"\\.\pipe\termwright"), Some(TOKEN)),
    ];
    for (endpoint, token) in cases {
        let client = Client::from_values(endpoint, token, Options::new("rust-test", "0.1.0"));
        assert!(
            client.is_none(),
            "endpoint={endpoint:?} token={token:?} produced a client"
        );
    }

    Client::from_values(
        Some("/tmp/tw.sock"),
        Some(TOKEN),
        Options::new("rust-test", "0.1.0"),
    )
    .expect("current client");
}

#[test]
fn an_unreachable_endpoint_fails_soft() {
    let mut client = Client::new(
        "/tmp/termwright-does-not-exist.sock",
        TOKEN,
        Options::new("rust-test", "0.1.0"),
    );
    assert!(client.connect(Duration::from_millis(500)).is_err());
    assert!(!client.connected());
    assert_eq!(
        client
            .publish(&mut sample_snapshot())
            .expect("publish without a session"),
        None
    );
}

// -- handshake and publishing ---------------------------------------------

#[test]
fn handshake_and_publish() {
    let path = socket_path();
    let (frames, _driver) = start_fake_driver(&path);
    let mut client = Client::new(&path, TOKEN, Options::new("rust-test", "0.1.0"));

    client.connect(Duration::from_secs(2)).expect("handshake");
    assert_eq!(client.session_id(), Some(SESSION));

    let hello = next_frame(&frames);
    assert_eq!(hello["type"], "hello");
    assert_eq!(hello["token"], TOKEN);
    assert_eq!(hello["adapter"]["name"], "rust-test");

    let marker = client
        .publish(&mut sample_snapshot())
        .expect("publish")
        .expect("marker");

    let snapshot_frame = next_frame(&frames);
    assert_eq!(snapshot_frame["type"], "snapshot");
    assert_eq!(snapshot_frame["snapshot"]["sessionId"], SESSION);
    assert_eq!(snapshot_frame["snapshot"]["revision"], 1);

    let commit = next_frame(&frames);
    assert_eq!(commit["type"], "revision-commit");
    assert_eq!(commit["revision"], 1);

    let payload = payload_of(&marker);
    let verified = verify_marker_payload(payload, TOKEN, SESSION).expect("marker verifies");
    assert_eq!(verified.revision, 1);

    let _ = std::fs::remove_file(&path);
}

#[test]
fn revisions_increase_by_one_per_publish() {
    let path = socket_path();
    let (frames, _driver) = start_fake_driver(&path);
    let mut client = Client::new(&path, TOKEN, Options::new("rust-test", "0.1.0"));
    client.connect(Duration::from_secs(2)).expect("handshake");
    next_frame(&frames); // hello

    for expected in 1..=3 {
        let marker = client
            .publish(&mut sample_snapshot())
            .expect("publish")
            .expect("marker");
        let verified =
            verify_marker_payload(payload_of(&marker), TOKEN, SESSION).expect("marker verifies");
        assert_eq!(verified.revision, expected);
        assert_eq!(next_frame(&frames)["type"], "snapshot");
        assert_eq!(next_frame(&frames)["revision"], expected);
    }
    assert_eq!(client.revision(), 3);

    let _ = std::fs::remove_file(&path);
}

#[test]
fn publish_refuses_an_invalid_snapshot() {
    let path = socket_path();
    let (frames, _driver) = start_fake_driver(&path);
    let mut client = Client::new(&path, TOKEN, Options::new("rust-test", "0.1.0"));
    client.connect(Duration::from_secs(2)).expect("handshake");
    next_frame(&frames); // hello

    let mut broken = Snapshot::new(80, 24);
    broken.push(Node::new("root", Role::Generic, "unnamed framework type"));

    let error = client
        .publish(&mut broken)
        .expect_err("invalid snapshot published");
    assert!(
        matches!(error, termwright_protocol::Error::Validation(_)),
        "{error}"
    );
    assert_eq!(
        client.revision(),
        0,
        "a rejected publish consumed a revision"
    );

    let _ = std::fs::remove_file(&path);
}

// -- a driver that stops reading -------------------------------------------

/// Accepts one connection, answers the handshake, then reads nothing. The
/// kernel's socket buffer absorbs a few frames; after that a write blocks,
/// which is the state a probe publishing from a render thread must survive.
fn start_stalled_driver(path: &str) -> std::sync::mpsc::Sender<()> {
    let listener = UnixListener::bind(path).expect("binding the driver socket");
    let (release, released) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let Ok((mut stream, _)) = listener.accept() else {
            return;
        };
        let mut buffer = [0u8; 8192];
        if stream.read(&mut buffer).is_err() {
            return;
        }
        let ack = serde_json::json!({
            "type": "hello-ack",
            "protocol": "termwright/2",
            "sessionId": SESSION,
            "limits": DEFAULT_LIMITS,
            "subscribe": "snapshots",
            "marker": { "enabled": true },
        });
        let frame = encode_frame(&ack, DEFAULT_LIMITS.max_frame_bytes).expect("encoding");
        let _ = stream.write_all(&frame);
        // Hold the connection open and read nothing until released, so the
        // socket buffer fills and stays full.
        let _ = released.recv();
    });
    release
}

/// A valid tree big enough that a few of them overflow a socket buffer, which
/// is what makes a stalled reader observable.
///
/// Node ids do NOT vary with the seed: only one name does. A tree whose every
/// node is new is legitimately published whole, so a fixture that changed all
/// the ids would produce snapshots throughout and quietly prove the opposite
/// of what the obligation test claims.
fn padded_snapshot(seed: i64) -> Snapshot {
    let mut snapshot = Snapshot::new(80, 24);
    let padding = "x".repeat(4000);
    snapshot.push(Node::new("root", Role::Dialog, "Permission"));
    for index in 0..60 {
        let name = if index == 0 {
            format!("{padding}-{seed}")
        } else {
            padding.clone()
        };
        snapshot.push(Node::new(format!("n{index}"), Role::Text, name).with_parent("root"));
    }
    snapshot
}

/// The render thread must not be held by a driver that stopped reading.
/// Without the write deadline this blocks for as long as the driver stays
/// away, which for a probe means the application stops drawing.
#[test]
fn a_write_to_a_stalled_driver_is_bounded() {
    let path = socket_path();
    let release = start_stalled_driver(&path);

    let mut options = Options::new("test", "0.1.0");
    options.write_timeout = Some(Duration::from_millis(100));
    let mut client = Client::new(&path, TOKEN, options);
    client.connect(Duration::from_secs(2)).expect("handshake");

    let started = Instant::now();
    let mut failure = None;
    for seed in 0..400 {
        if let Err(error) = client.publish(&mut padded_snapshot(seed)) {
            failure = Some(error);
            break;
        }
    }
    let elapsed = started.elapsed();
    let _ = release.send(());

    // 400 trees of a quarter-megabyte each: a socket buffer that swallowed all
    // of them would mean the driver was reading, and this test would be
    // asserting nothing at all.
    let failure = failure.expect("nothing ever blocked, so the stall was never reproduced");
    assert!(
        matches!(failure, Error::WriteTimeout),
        "expected a recognisable write timeout, got {failure:?}"
    );
    assert!(
        elapsed < Duration::from_secs(30),
        "publishing took {elapsed:?}; the write was not bounded"
    );
    // A half-written frame cannot be resynchronised, so the session is over.
    assert!(!client.connected(), "the session survived a stalled driver");
}

/// "Driver not keeping up" and "snapshot refused" need different handling.
#[test]
fn an_invalid_snapshot_is_not_a_write_timeout() {
    let path = socket_path();
    let _driver = start_fake_driver(&path);
    let mut client = Client::new(&path, TOKEN, Options::new("test", "0.1.0"));
    client.connect(Duration::from_secs(2)).expect("handshake");

    let mut broken = padded_snapshot(0);
    broken.nodes[1].role = Role::Generic; // generic without a frameworkType
    let error = client.publish(&mut broken).expect_err("expected a refusal");
    assert!(
        !matches!(error, Error::WriteTimeout),
        "a refused snapshot was reported as a slow driver: {error:?}"
    );
    assert!(matches!(error, Error::Validation(_)), "{error:?}");
}

#[test]
fn a_locally_oversized_frame_keeps_the_revision_and_recovers_with_a_full_tree() {
    let path = socket_path();
    let mut limits = DEFAULT_LIMITS;
    limits.max_frame_bytes = 1_200;
    let (frames, _driver) = start_fake_driver_with_limits(&path, limits);
    let mut options = Options::new("test", "0.1.0");
    options.limits = limits;
    let mut client = Client::new(&path, TOKEN, options);
    client.connect(Duration::from_secs(2)).expect("handshake");
    assert_eq!(next_frame(&frames)["type"], "hello");

    let first_marker = client
        .publish(&mut sample_snapshot())
        .expect("first snapshot")
        .expect("first marker");
    assert_eq!(next_frame(&frames)["type"], "snapshot");
    assert_eq!(next_frame(&frames)["type"], "revision-commit");
    assert_eq!(client.revision(), 1);

    let mut oversized = Snapshot::new(80, 24);
    oversized.push(Node::new("root", Role::Text, "x".repeat(1_000)));
    let error = client
        .publish(&mut oversized)
        .expect_err("the local frame ceiling should refuse this tree");
    assert!(
        matches!(&error, Error::Protocol(violation) if violation.code == "frame-oversized"),
        "unexpected error: {error:?}"
    );
    assert!(
        client.connected(),
        "a local refusal closed a healthy socket"
    );
    assert_eq!(client.revision(), 1, "a rejected frame consumed a revision");
    assert!(frames.recv_timeout(Duration::from_millis(100)).is_err());

    let recovery_marker = client
        .publish(&mut sample_snapshot())
        .expect("recovery snapshot")
        .expect("recovery marker");
    let recovery = next_frame(&frames);
    assert_eq!(recovery["type"], "snapshot");
    assert_eq!(recovery["snapshot"]["revision"], 2);
    assert_eq!(next_frame(&frames)["revision"], 2);
    assert_eq!(client.revision(), 2);
    assert_ne!(first_marker, recovery_marker);
}
