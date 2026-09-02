# termwright-protocol (Rust)

Semantic side-channel client for the [termwright](https://github.com/gorce-ai/termwright)
terminal test driver.

An instrumented TUI publishes its widget tree over a unix socket and commits
each render with a signed OSC marker, so tests assert on _roles and names_
instead of screen-scraping cells. This crate is the protocol side of that
contract — framing, the marker, message and snapshot validation, and a blocking
socket client. It ships **no framework adapter**: wire it into whatever draws
your screen (ratatui, cursive, a hand-rolled renderer).

The client speaks `termwright/3`. Every published semantic revision is a
complete v3 snapshot with evidence-qualified geometry and pointer
observations.

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

Framework probes must not perform socket I/O under a framework render lock.
After the handshake they move `Client` into `PublicationQueue`: the render
boundary validates and encodes a complete snapshot+commit pair, then admits it
to a bounded FIFO without waiting for transport. The returned marker proves
queue admission, not socket completion; the driver independently pairs marker
and semantic frames. Queue pressure returns `PublicationQueueFull` without a
revision gap or marker, and a worker failure closes later admission.

Framework lifecycle code must call `PublicationQueue::shutdown()` outside the
render hook. It closes admission, drains the FIFO and joins the writer, which
prevents a short-lived one-frame process from exiting ahead of semantic data
that it already admitted.

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

## Diagnostics

When the adapter does not attach, nothing anywhere says why: the dormant rule
means a process with no endpoint behaves exactly like a process that never
heard of termwright. Point `TERMWRIGHT_DEBUG_FILE` at a file and the adapter
writes down what it decided.

```
TERMWRIGHT_DEBUG_FILE=/tmp/adapter.log
```

```text
  tw:diag [p41207]   0.000s open adapter=my-tui pid=41207 platform=linux/x86_64 argv0=my-tui
  tw:diag [p41207]   0.001s dormant: TERMWRIGHT_TOKEN not set
```

or, on a session that came up:

```text
  tw:sem  [p41207]   0.002s dial unix:/tmp/tw-8f21/s timeout=5000ms
  tw:sem  [p41207]   0.003s hello sent adapter=my-tui/1.0.0 caps=tree,intended-geometry,…
  tw:sem  [3f9c1a04]  0.011s hello-ack session=3f9c1a04… marker=on subscribe=semantic logs=off
  tw:io   [3f9c1a04]  0.048s r1 snapshot nodes=17
```

Three properties are worth knowing before you rely on it:

- **It never writes to stderr.** The application owns the terminal, and a
  diagnostic line in the middle of a render corrupts the screen the driver is
  asserting on. There is no stderr mode to turn on by mistake.
- **It never fails the application.** An unwritable path, a full disk or a
  closed file turns the log off and changes nothing else.
- **The token never appears in it.** The endpoint does, because the endpoint
  is how you tell one session's socket from another's.

`TERMWRIGHT_DEBUG=<path>` works too, for symmetry with the driver's own
switch. `TERMWRIGHT_DEBUG=1` does **not**: that value means "log to stderr" to
the driver, it reaches this process as well, and stderr is the one destination
an adapter cannot use. Set the value to a path or the adapter stays silent.

The line format is the driver's, so `TERMWRIGHT_DEBUG=1` on the driver and
`TERMWRIGHT_DEBUG_FILE=…` on the app produce two halves of one story that a
single reader can take.

## Deviations

Rules 1–5 of the adapter semantics conventions do not apply here: they govern
how a widget tree becomes semantic nodes, and this crate builds no tree. It
ships no framework adapter at all — roles, names, test ids, states and values
are decided by whatever code calls `Client::publish`, which is where those
rules land instead.

What the crate does carry is the protocol side that has no adapter in it:
framing, the marker, full-snapshot validation and publication, and the
`tracing` bridge. Those follow the wire contract exactly and are checked
against the shared vectors, so there is nothing here to declare an exception
for.

## Application evidence providers

The `evidence` module exposes closed pointer, focus, scroll, paint, input-mode,
and action-strategy families. `FocusProvider::observe` returns
`Some(recipient)` or authoritative
`None`; wire encoding preserves that distinction as `focused | none`.
Registration is frozen before the session and recipes remain data executed by
Termwright's PTY devices, never application callbacks.

`InputModeProvider::observe` reports the application's production parser
configuration. It can prove modes hidden by ConPTY, while input still crosses
the real named-pipe/PTY path and conflicting observable VT state fails closed.

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

Unix uses a Unix domain socket. Windows uses the exact-certified
`interprocess` 2.4.2 byte-mode named-pipe transport at the driver's
`\\.\pipe\…` endpoint. Both preserve the same length-prefixed protocol.
Windows I/O is nonblocking: polling never stalls the render thread, and a
whole-frame monotonic deadline bounds writes when the driver stops reading.
CI executes a real Windows named-pipe handshake and snapshot publication; a
cross-target build alone is not treated as functional proof.
