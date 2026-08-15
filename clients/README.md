# termwright language clients

Non-JavaScript implementations of the termwright semantic side-channel, plus
the shared vectors that keep them honest.

| Directory | Package | What it covers |
|---|---|---|
| [`python/`](python) | `termwright` 0.1.0 (PyPI) | protocol client + Textual adapter |
| [`go/`](go) | `github.com/gorce-ai/termwright/clients/go` v0.1.0 | protocol client + tview adapter |
| [`rust/`](rust) | `termwright-protocol` 0.1.0 (crates.io) | protocol client only |
| [`test-vectors/`](test-vectors) | — | cross-language conformance fixtures |

The normative implementation is the TypeScript package `@termwright/protocol`
in `packages/protocol`. These clients are ports, not forks: where they differ
from it, they are wrong.

## The dormant rule

Every client obeys the same rule, and it is the one thing not to break:
**without `TERMWRIGHT_ENDPOINT` and `TERMWRIGHT_TOKEN` in the environment, an
instrumented app opens no socket, writes no marker, and renders exactly the
bytes it would have rendered anyway.** Each client expresses it as a
constructor that returns nothing — `client_from_env() -> None`,
`protocol.FromEnv() == nil`, `Client::from_env() -> None`,
`termwright.Attach() -> (nil, nil)` — so the calling app needs no feature flag
and shipping the adapter in production costs one import.

## Test vectors

`test-vectors/*.json` are generated from the built TypeScript package, and the
generator re-runs every expectation through the reference implementation before
writing it, so a stale or hand-edited vector fails at generation time:

```sh
pnpm --filter @termwright/protocol build
node clients/test-vectors/generate.mjs
```

| File | Asserts |
|---|---|
| `constants.json` | protocol id, framing/marker sizes, closed role, action and capability sets, both limit sets, env var names |
| `framing.json` | exact frame bytes per message, multi-frame and byte-at-a-time decoding, seven hostile frames with their violation codes |
| `marker.json` | seven marker sequences byte for byte (including a non-ASCII token), ten forgeries that must not verify |
| `snapshots.json` | five valid trees, 24 invalid ones with their validation codes |
| `messages.json` | both directions, accept and reject, with the wire error taxonomy |

Cases marked `"optional": true` depend on a JSON parser that preserves lone
surrogates. Python detects them; Go and Rust replace them with U+FFFD before
the client sees anything, so those two skip the case and say so in their tests.

## Adapter conformance

Vectors prove the protocol layer; the adapter contract is proven by
`runAdapterConformance` from `@termwright/conformance`, which drives the app as
a subprocess and observes only bytes and frames. Each adapter ships an example
app built for it:

| Adapter | Example | Ready text | Interaction | Quit |
|---|---|---|---|---|
| Textual | `python/examples/permission_app.py` | `Permission required` | `\t` → `focus: reject` | `\x11` (Ctrl+Q), exit 0 |
| tview | `go/examples/permission/` | `Permission required` | `\t` → `focus: reject` | `\x03` (Ctrl+C), exit 0 |

The quit keys differ per framework, and neither is `q`: both examples carry a
text field, and once it holds the focus a printable key is typed into it rather
than acted on. There is no shared control key either — Textual 8 binds Ctrl+C
to copy and quits on Ctrl+Q, while tview quits on Ctrl+C and ignores Ctrl+Q.
Both were measured under a PTY from every focus position.

```ts
await runAdapterConformance({
  name: 'termwright (Textual)',
  spawn: () => ({ command: ['python', 'clients/python/examples/permission_app.py'] }),
  ready: 'Permission required',
  interaction: { input: '\t', expect: 'focus: reject' },
  quit: { input: 'q', exitCode: 0 },
  expectAbsoluteBounds: true,
});
```

Both examples were verified end to end here against a stand-in driver: the
handshake completes, every published snapshot validates, and each revision's
marker verifies against the session token. Running them through the real
`runAdapterConformance` suite belongs to whoever owns that package's test
matrix.

## Running the suites

```sh
cd clients/python && pip install -e ".[dev]" && pytest      # 132 tests
cd clients/go     && go test ./...                          # 97 tests
cd clients/rust   && cargo test                             # 19 tests + 1 doctest
```

## What is not here

- Windows named pipes. Every client stays dormant on a `\\.\pipe\…` endpoint
  rather than half-working.
- A Rust framework adapter. The crate is protocol-only by design; ratatui and
  cursive draw too differently for one adapter to serve both honestly.
- `tview.Grid` children in Go, which tview exposes no accessor for — supply
  them with `WithChildren`.
