//! Client behaviour: the dormant rule, the handshake, and publishing.

use std::io::{Read, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

use termwright_protocol::{
    encode_frame, verify_marker_payload, Client, FrameDecoder, Node, Options, Rect, Role, Snapshot,
    DEFAULT_LIMITS,
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
                                    "protocol": "termwright/1",
                                    "sessionId": SESSION,
                                    "limits": DEFAULT_LIMITS,
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
    snapshot
        .push(Node::new("root", Role::Dialog, "Permission").with_bounds(Rect::new(0, 0, 40, 2)));
    snapshot.push(
        Node::new("ok", Role::Button, "Approve")
            .with_parent("root")
            .with_bounds(Rect::new(1, 2, 9, 1)),
    );
    snapshot
}

// -- dormant rule ----------------------------------------------------------

#[test]
fn no_client_without_a_complete_environment() {
    let cases: [(Option<&str>, Option<&str>, Option<&str>); 5] = [
        (None, None, None),
        (Some("/tmp/nope.sock"), None, None),
        (None, Some(TOKEN), None),
        (Some("/tmp/nope.sock"), Some(TOKEN), Some("termwright/9")),
        (Some(r"\\.\pipe\termwright"), Some(TOKEN), None),
    ];
    for (endpoint, token, protocol) in cases {
        let client = Client::from_values(
            endpoint,
            token,
            protocol,
            Options::new("rust-test", "0.1.0"),
        );
        assert!(
            client.is_none(),
            "endpoint={endpoint:?} token={token:?} produced a client"
        );
    }

    let client = Client::from_values(
        Some("/tmp/tw.sock"),
        Some(TOKEN),
        Some("termwright/1"),
        Options::new("rust-test", "0.1.0"),
    );
    assert!(
        client.is_some(),
        "a fully instrumented environment produced no client"
    );
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

    // Bounds far outside the viewport on a node that is not hidden.
    let mut broken = Snapshot::new(80, 24);
    broken
        .push(Node::new("root", Role::Dialog, "Permission").with_bounds(Rect::new(900, 900, 5, 1)));

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

#[test]
fn get_tree_is_answered_from_the_retained_snapshots() {
    let path = socket_path();
    let (frames, driver) = start_fake_driver(&path);
    let mut client = Client::new(&path, TOKEN, Options::new("rust-test", "0.1.0"));
    client.connect(Duration::from_secs(2)).expect("handshake");
    next_frame(&frames); // hello

    client.publish(&mut sample_snapshot()).expect("publish");
    next_frame(&frames); // snapshot
    next_frame(&frames); // revision-commit

    driver
        .send(json!({ "type": "get-tree", "requestId": 7, "revision": 1 }))
        .expect("queueing the request");
    wait_for(&mut client, &frames, |frame| {
        frame["type"] == "get-tree-result"
    })
    .map(|answer| {
        assert_eq!(answer["requestId"], 7);
        assert_eq!(answer["snapshot"]["revision"], 1);
    })
    .expect("a retained revision was not answered");

    driver
        .send(json!({ "type": "get-tree", "requestId": 8, "revision": 99 }))
        .expect("queueing the request");
    let answer = wait_for(&mut client, &frames, |frame| {
        frame["type"] == "get-tree-result"
    })
    .expect("an unretained revision was not answered");
    assert!(
        answer["error"].is_string(),
        "expected an error answer, got {answer}"
    );

    let _ = std::fs::remove_file(&path);
}

/// Pump the client until a frame matching `wanted` arrives at the driver.
fn wait_for(
    client: &mut Client,
    frames: &Receiver<Value>,
    wanted: impl Fn(&Value) -> bool,
) -> Option<Value> {
    for _ in 0..200 {
        client.poll().expect("polling");
        if let Ok(frame) = frames.recv_timeout(Duration::from_millis(20)) {
            if wanted(&frame) {
                return Some(frame);
            }
        }
    }
    None
}
