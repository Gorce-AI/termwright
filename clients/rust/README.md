# termwright-protocol (Rust)

Semantic side-channel client for the [termwright](https://github.com/gorce-ai/termwright)
terminal test driver.

An instrumented TUI publishes its widget tree over a unix socket and commits
each render with a signed OSC marker, so tests assert on *roles and names*
instead of screen-scraping cells. This crate is the protocol side of that
contract — framing, the marker, message and snapshot validation, and a blocking
socket client. It ships **no framework adapter**: wire it into whatever draws
your screen (ratatui, cursive, a hand-rolled renderer).

**Dormant rule.** Without `TERMWRIGHT_ENDPOINT` and `TERMWRIGHT_TOKEN` in the
environment, `Client::from_env` returns `None` and nothing happens at all: no
socket, no marker, no change to what the terminal receives.

## Install

```toml
[dependencies]
termwright-protocol = "0.1"
```

Rust 1.74+, `#![forbid(unsafe_code)]`, five dependencies (serde, serde_json,
sha2, hmac, base64, subtle).

## Usage

```rust
use termwright_protocol::{Client, Node, Options, Rect, Role, Snapshot, DIAL_TIMEOUT};

let Some(mut client) = Client::from_env(Options::new("my-tui", "1.0.0")) else {
    return; // not instrumented: render normally and stop here
};
client.connect(DIAL_TIMEOUT)?;

// Once per committed frame:
let mut snapshot = Snapshot::new(80, 24);          // session id and revision
snapshot.push(Node::new("root", Role::Dialog, "Permission"));  // are filled in
snapshot.push(
    Node::new("ok", Role::Button, "Approve")
        .with_parent("root")
        .with_bounds(Rect::new(1, 2, 9, 1)),
);

client.poll()?;                                     // answer driver requests
if let Some(marker) = client.publish(&mut snapshot)? {
    print!("{marker}");                             // AFTER the render's last byte
    std::io::Write::flush(&mut std::io::stdout())?;
}
```

Three rules the client enforces for you:

- **The client owns revisions.** `publish` allocates the next one and
  overwrites the snapshot's `session_id`/`revision`; an adapter never picks its
  own numbers.
- **The marker commits what precedes it.** Write it after the frame's last
  byte, never before — emitting it early lets the driver act on a paint that
  has not landed.
- **Invalid trees never reach the wire.** `publish` validates against the
  negotiated limits and returns `Error::Validation` without consuming a
  revision.

The client is blocking and single-threaded on purpose: a TUI renders on one
thread, and the marker has to follow that render. `poll()` picks up driver
requests without blocking — call it on each tick.

## Application logs

```toml
termwright-protocol = { version = "0.1", features = ["tracing"] }
```

```rust
let layer = TermwrightLayer::new(Arc::new(Mutex::new(client)));
tracing_subscriber::registry().with(layer).init();

tracing::error!(path = "/etc/app/policy.json", "policy missing");  // never painted
```

The `tracing` feature is off by default: the crate stays dependency-light for
adapters that do not want a logging framework. Without it, `Client::log` takes
a `LogRecord` directly. Either way the client owns the sequence numbers and the
budget, and a dropped record leaves a gap in `seq` rather than being renumbered.

## Deviations

Rules 1–5 of the adapter semantics conventions do not apply here: they govern
how a widget tree becomes semantic nodes, and this crate builds no tree. It
ships no framework adapter at all — roles, names, test ids, states and values
are decided by whatever code calls `Client::publish`, which is where those
rules land instead.

What the crate does carry is the protocol side that has no adapter in it:
framing, the marker, validation, delta composition and production, and the
`tracing` bridge. Those follow the wire contract exactly and are checked
against the shared vectors, so there is nothing here to declare an exception
for.

## Conformance

`tests/vectors.rs` runs against `clients/test-vectors/`, generated from the
normative TypeScript implementation in `packages/protocol`. Framing bytes,
marker MACs, message parsing and snapshot validation are asserted against the
same vectors in Rust, Python and Go.

```sh
cargo test
```

One vector group is skipped: `serde_json` replaces unpaired surrogates with
U+FFFD before this crate can see them, so a frame carrying a lone surrogate is
not detectable here. Those cases are marked `"optional": true` in
`framing.json`.

## Platform support

Unix domain sockets only. On Windows the driver hands out a named pipe, which
needs a different transport; `from_env` returns `None` for a `\\.\pipe\…`
endpoint rather than half-working.
