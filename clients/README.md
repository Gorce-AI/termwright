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

## Application logs

A TUI cannot print diagnostics without corrupting the render, so the usual
advice is a log file. Under the driver they can go somewhere better: announce
the `logs` capability and the records the application already emits become
assertable test state.

Each client bridges its ecosystem's standard logger, so application code does
not change:

| Client | Bridge | Install |
|---|---|---|
| Python | `logging.Handler` | `install_log_handler(client, logger)` |
| Go | `slog.Handler` | `slog.New(protocol.NewSlogHandler(client, nil))` |
| Rust | `tracing` Layer (feature `tracing`) | `registry().with(TermwrightLayer::new(client))` |

Four rules the clients enforce for you:

- **No budget, no logs.** `hello-ack` carries `logs` only when the adapter
  announced the capability, and an absent field means the channel is off. A
  client with no budget sends nothing at all.
- **The rate is enforced at the source.** Each client holds a token bucket
  sized from the budget and drops locally, which is what stops a log storm
  eating the frame budget the semantic tree needs.
- **A drop leaves a gap.** Every attempt consumes a sequence number, delivered
  or not, so a hole in `seq` tells the driver records died in the adapter
  rather than in transit. Renumbering would hide exactly what the counter
  exists to report — which is why the counter advances *before* the budget is
  consulted, not after.
- **The adapter owns `seq`.** The log channel is open to more than one
  publisher, and two of them can pick the same number in good faith, so the
  adapter restamps every record on the way out. Go and Rust accept a
  caller-built record and keep its number as the `origin.seq` attribute — a
  diagnostic, dropped rather than allowed to push the record past the
  attribute ceiling or the byte ceiling. Python takes fields rather than a
  record, so a collision cannot be expressed there at all.
- **`attrs` are flat.** Nested context makes a record's size unbounded and
  depth-dependent, so each bridge flattens to dotted keys (`db.host`) before
  sending — the same spelling in all three languages, so an assertion written
  against one reads the same against another.

### What the application has to import

Nothing. The seam is the logger the application already configures, so its
call sites stay `logging.getLogger(...).error(...)`, `slog.Error(...)` and
`tracing::error!(...)` with no termwright name among them. The one import
lives wherever semantics are enabled, which is a single place that is already
dormant without the driver.

That is the same property `@termwright/ink` gets from `node:diagnostics_channel`
— an application feeding termwright without taking a production dependency on
a test tool — reached through a different seam. The cost of each shows up
elsewhere: an open channel admits several publishers and so needs the
restamping above, while a logging framework as the seam means the record
arrives already formatted by it.

`ts` is Unix epoch milliseconds, not session-relative: an adapter cannot know
when the driver considers the session to have started, so the wall clock is the
only clock both sides agree on without negotiating. The driver rebases it.

## Tree deltas

The clients validate the **shape** of a `tree-delta` (sizes, node shape, unique
ids, a revision that moves forward, no id both upserted and removed) and stop
there, because a delta carries no `columns`/`rows`: whether a parent exists,
whether the tree stays acyclic and within the depth ceiling, and whether bounds
or the cursor fall inside the viewport can only be judged against the base it
applies to. Those are snapshot checks, run on the assembled tree.

All three also **compose** deltas (`apply_tree_delta` / `ApplyTreeDelta`) and
**produce** them: under `subscribe: 'diffs'` a publish sends a patch against
the last tree the driver received. The first publish, a snapshots
subscription, a change touching more than about half the tree, and a cursor
that disappears all fall back to the whole snapshot — the last because a delta
can replace a cursor but never remove one.

Producing and composing are mirrors, so each language tests its producer
against its composer: every emitted delta is applied back onto its base and
must reproduce exactly the tree the client meant to publish. That oracle is
what catches the two rules easiest to get wrong — a node surviving under a
removed parent has to be re-sent even though nothing about it changed, and
`rootIds` has to travel whenever the inherited list is not the one the new
tree wants.

The order of `nodes` in a composed tree is **not** normative: the reference
composes through an insertion-ordered map, a client backed by a hash map
reports another order, and both are correct. Compare them as a set keyed by
id — the vectors say so, and the tests here do it.

## Protocol evolution

Capacity is negotiated and therefore extensible; vocabulary is closed and
therefore fixed. The test: would a reader that ignored the new thing still
behave correctly? If yes, it is additive.

In practice all three clients read **driver traffic tolerantly** — unknown
fields in the envelope and in the driver's nested objects (`limits`, `marker`,
`logs`) are ignored and passed through — and read **adapter traffic strictly**,
because that side crosses an untrusted boundary where an unknown field is a
signal rather than an extension. The same `error` message is therefore read
both ways, depending on who sent it.

Tolerance is not leniency: known fields keep their types, missing known fields
are still errors, and the closed sets (message types, `error.code`,
`subscribe`, roles, actions, state fields) stay closed in both directions.

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

- Windows named pipes in Rust. The crate dials unix sockets only, so a
  `\\.\pipe\…` endpoint fails to connect and the app carries on unpublished.
  Go and Python reach the pipe: Go through `go-winio` behind a build tag,
  Python through the proactor loop's `create_pipe_connection`. Both are
  compiled and reasoned about here but proven by CI, since this machine is not
  Windows.
- A Rust framework adapter. The crate is protocol-only by design; ratatui and
  cursive draw too differently for one adapter to serve both honestly.
- `tview.Grid` children in Go, which tview exposes no accessor for — supply
  them with `WithChildren`.
