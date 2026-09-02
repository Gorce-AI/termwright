// Each integration-test crate imports this shared module independently and
// uses a different subset of it. What looks dead in one crate is exercised by
// another, so all-target clippy must judge the helpers as a shared fixture.
#![allow(dead_code)]

//! A stand-in driver for integration tests: completes the handshake, records
//! what the adapter sent, and can grant a log budget.

use std::io::{Read, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::sync::mpsc::{channel, Receiver};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

use termwright_protocol::{encode_frame, FrameDecoder, DEFAULT_LIMITS};

pub const TOKEN: &str = "test-token";
pub const SESSION: &str = "s-42";

/// The receiving end of everything the adapter sent.
pub struct Driver {
    pub frames: Receiver<Value>,
}

/// A socket path short enough for the 104-byte `sockaddr_un` limit, which the
/// usual temp directories on macOS blow straight through.
pub fn socket_path() -> String {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    format!("/tmp/tw-{stamp}-{:?}.sock", thread::current().id())
}

/// A fresh directory under `/tmp`, short enough to hold a bindable socket
/// path, for tests that need somewhere to write.
pub fn temp_dir() -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let path = PathBuf::from(format!("/tmp/tw-{stamp}-{:?}", thread::current().id()));
    std::fs::create_dir_all(&path).expect("creating the temporary directory");
    path
}

/// Load one shared vector file.
pub fn vectors(name: &str) -> Value {
    let path: PathBuf = [
        env!("CARGO_MANIFEST_DIR"),
        "..",
        "test-vectors",
        &format!("{name}.json"),
    ]
    .iter()
    .collect();
    let body = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("reading {}: {error}", path.display()));
    serde_json::from_str(&body).expect("vector file is valid JSON")
}

/// Start a driver on `path`. A `None` budget means the ack carries no `logs`
/// field at all, which is what tells an adapter that logs are disabled.
pub fn start_fake_driver(path: &str, logs: Option<Value>) -> Driver {
    let listener = UnixListener::bind(path).expect("binding the driver socket");
    let (sender, frames) = channel();

    thread::spawn(move || {
        let Ok((mut stream, _)) = listener.accept() else {
            return;
        };
        let mut decoder =
            FrameDecoder::new(DEFAULT_LIMITS.max_frame_bytes, DEFAULT_LIMITS.max_depth);
        let mut buffer = [0u8; 8192];
        loop {
            match stream.read(&mut buffer) {
                Ok(0) | Err(_) => return,
                Ok(count) => {
                    let Ok(decoded) = decoder.push(&buffer[..count]) else {
                        return;
                    };
                    for frame in decoded {
                        if frame.value.get("type").and_then(Value::as_str) == Some("hello") {
                            let mut ack = json!({
                                "type": "hello-ack",
                                "protocol": "termwright/3",
                                "sessionId": SESSION,
                                "limits": DEFAULT_LIMITS,
                                "subscribe": "semantic",
                                "marker": { "enabled": true },
                            });
                            if let Some(budget) = logs.clone() {
                                ack["logs"] = budget;
                            }
                            send(&mut stream, &ack);
                        }
                        if sender.send(frame.value).is_err() {
                            return;
                        }
                    }
                }
            }
        }
    });

    Driver { frames }
}

fn send(stream: &mut UnixStream, message: &Value) {
    let frame = encode_frame(message, DEFAULT_LIMITS.max_frame_bytes).expect("encoding");
    let _ = stream.write_all(&frame);
}

/// Collect `count` log records, ignoring the handshake and any other traffic.
pub fn records_from(driver: &Driver, count: usize) -> Vec<Value> {
    let deadline = Instant::now() + Duration::from_secs(3);
    let mut records = Vec::new();
    while records.len() < count && Instant::now() < deadline {
        match driver.frames.recv_timeout(Duration::from_millis(100)) {
            Ok(frame) => {
                if frame.get("type").and_then(Value::as_str) == Some("log") {
                    records.push(frame["record"].clone());
                }
            }
            Err(_) => continue,
        }
    }
    assert_eq!(
        records.len(),
        count,
        "expected {count} log records, got {}",
        records.len()
    );
    records
}
