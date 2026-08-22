#![cfg(windows)]

use std::io::{Read, Write};
use std::path::Path;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use interprocess::os::windows::named_pipe::{pipe_mode, PipeListenerOptions};
use serde_json::{json, Value};
use termwright_protocol::{
    encode_frame, Client, FrameDecoder, Node, Options, Role, Snapshot, DEFAULT_LIMITS,
};

#[test]
fn named_pipe_handshake_and_snapshot_use_the_real_windows_transport() {
    let endpoint = format!(
        r"\\.\pipe\termwright-rust-e2e-{}-{:?}",
        std::process::id(),
        thread::current().id()
    );
    let listener = PipeListenerOptions::new()
        .path(Path::new(&endpoint))
        .create_duplex::<pipe_mode::Bytes>()
        .expect("create named pipe");
    let (sent, received) = mpsc::channel::<Value>();

    let server = thread::spawn(move || {
        let mut stream = listener
            .incoming()
            .next()
            .expect("incoming client")
            .expect("accept named-pipe client");
        let mut decoder =
            FrameDecoder::new(DEFAULT_LIMITS.max_frame_bytes, DEFAULT_LIMITS.max_depth);
        let mut bytes = [0_u8; 8192];
        loop {
            let count = stream.read(&mut bytes).expect("read named pipe");
            assert_ne!(count, 0, "client closed before snapshot");
            for frame in decoder.push(&bytes[..count]).expect("decode client frame") {
                if frame.value["type"] == "hello" {
                    let ack = json!({
                        "type": "hello-ack",
                        "protocol": "termwright/2",
                        "sessionId": "s-windows-rust",
                        "limits": DEFAULT_LIMITS,
                        "subscribe": "snapshots",
                        "marker": { "enabled": true }
                    });
                    stream
                        .write_all(
                            &encode_frame(&ack, DEFAULT_LIMITS.max_frame_bytes)
                                .expect("encode hello-ack"),
                        )
                        .expect("write hello-ack");
                }
                let is_snapshot = frame.value["type"] == "snapshot";
                sent.send(frame.value).expect("forward frame");
                if is_snapshot {
                    return;
                }
            }
        }
    });

    let mut client = Client::new(&endpoint, "windows-token", Options::new("ratatui", "0.2.0"));
    client
        .connect(Duration::from_secs(2))
        .expect("named-pipe handshake");
    assert_eq!(client.session_id(), Some("s-windows-rust"));

    let mut snapshot = Snapshot::new(80, 24);
    snapshot.push(Node::new("deploy", Role::Button, "Deploy"));
    let marker = client
        .publish(&mut snapshot)
        .expect("publish through named pipe");
    assert!(marker.is_some());

    let frames: Vec<_> = std::iter::from_fn(|| received.recv_timeout(Duration::from_secs(2)).ok())
        .take(2)
        .collect();
    assert_eq!(frames[0]["type"], "hello");
    assert_eq!(frames[1]["type"], "snapshot");
    assert_eq!(frames[1]["snapshot"]["sessionId"], "s-windows-rust");
    client.close();
    server.join().expect("server thread");
}
