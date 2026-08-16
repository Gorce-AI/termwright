# @termwright/conformance

The suites that decide whether an implementation of termwright is actually one:
runnable fixtures, the driver conformance matrix from the origin spec (§20), and
an **adapter contract suite you can run against any adapter, in any language**.

Nothing depends on this package; it is allowed to depend on everything.

## Install

```sh
pnpm add -D @termwright/conformance
```

`vitest` is an optional peer dependency, needed only to run the exported suite.

## Certifying an adapter

The only thing an adapter author writes is the binding between their app and the
suite. It drives the adapter as a subprocess and looks at bytes and frames, so a
Python, Go or Rust adapter certifies exactly like the TypeScript one.

```ts
// my-adapter.conformance.test.ts
import { runAdapterConformance } from '@termwright/conformance';

await runAdapterConformance({
  name: 'termwright-py',
  spawn: () => ({ command: ['python', 'examples/demo_app.py'] }),
  // Optional: the same UI with the adapter compiled out. When given, the
  // dormant run is compared against it byte for byte.
  baseline: () => ({ command: ['python', 'examples/demo_app.py'], env: { PLAIN: '1' } }),
  ready: 'Ready',
  interaction: { input: '\t', expect: '[Save]' },
  quit: { input: '', exitCode: 0 },
  columns: 80,
  rows: 24,
  expectAbsoluteBounds: true,
});
```

The byte-for-byte comparison covers the **startup** stream, with nothing
written to the child: a pseudo-terminal echoes the suite's own keystrokes, so a
stream containing our input compares the tty's timing rather than the adapter's
output (measured on the Ink fixture: 3 mismatches in 30 pairs with input —
always a stray `0x09`, the tab the suite itself sent — and 0 in 40 without).

Two requirements the registration has to respect, because the suite exercises
the app rather than mocking it: `interaction.input` is sent **more than once**,
so pick something whose repetition is harmless; and `quit.input` must work from
**any** state that repetition can reach — a key that quits only while one widget
has focus is not a quit input.

Pass `requires` to declare the toolchain the adapter needs. When the probe
fails, the whole registration skips and the reason appears in the block's name,
exactly as a missing pseudo-terminal does:

```ts
requires: {
  probe: ['python3', '-c', 'import termwright, textual'],
  label: 'python3 with termwright and textual installed',
},
```

An adapter that announces the `logs` capability declares how to exercise it,
and the obligations above are then asserted rather than skipped:

```ts
logs: { input: 'l', expect: 'conformance log record' },
```

`input` is optional: omit it for an app that logs on its own, as the tview
example does at startup, and the obligation waits for the record instead of
provoking one.

It checks the five obligations an adapter has:

| Obligation | What is asserted |
|---|---|
| Dormant rule | Without `TERMWRIGHT_ENDPOINT` it opens no channel and writes no marker; with `baseline`, byte-for-byte identical startup output |
| Tree before input | Once the handshake completes and *before any input*, the tree is non-empty and has at least one node a locator could address. Opt out with `treeBeforeInput: {required: false, reason}` |
| Handshake | `hello` first and once, correct protocol id, non-empty adapter identity, capabilities from the closed set |
| Snapshot validity | Every snapshot passes `validateSnapshot`, carries this session's id, has resolvable parents and monotonic revisions |
| Revision ordering | For each revision: snapshot → `revision-commit` → a marker that verifies against the session token, markers strictly increasing |
| Channel loss | Cutting the socket leaves the application rendering and alive, and the adapter does not reconnect |
| Logs | An adapter that did not announce `logs` sends none. One that declares them in the registration must deliver a record whose `seq` is unique and increasing and whose message never appears on the terminal |
| Deltas (when announced) | With `subscribe: 'diffs'`, the deltas an adapter emits compose — through the protocol's own `applyTreeDelta` — to the same tree it reports when asked with `get-tree` |

`await` it at the top level: `vitest` is imported dynamically so the package can
also be used from a plain script.

## Fixtures

`CONFORMANCE_FIXTURES` returns absolute paths to programs you can launch with
`node <path>`:

| Fixture | Purpose | Dependencies |
|---|---|---|
| `generic()` | Uninstrumented app: menu, colours, mouse/paste/focus modes, Unicode, alternate screen, scrollback (§20.1) | none |
| `prompt()` | Shell-shaped app emitting OSC 133 marks; `--marks=off` suppresses them, `--work=<ms>` sets the command duration | none |
| `adversarialPeer()` | Raw wire peer; takes a scenario name as `argv[2]` (§20.3) | none |
| `semanticInk()` | Full semantic matrix on `@termwright/ink` (§20.2) | `ink`, `react` |
| `component()` | Component-harness matrix in process mode (§20.2a) | `ink`, `react` |
| `componentModule()` | The component itself, for an in-process harness to import | `ink`, `react` |

The first three import nothing at all — the adversarial peer re-derives the
framing and the marker MAC from the specification rather than importing
`@termwright/protocol`, so a drift between spec and implementation shows up
instead of cancelling out.

```ts
import { CONFORMANCE_FIXTURES } from '@termwright/conformance';
import { launchTerminal } from '@termwright/driver';

const terminal = await launchTerminal({ command: ['node', CONFORMANCE_FIXTURES.generic()] });
```

## Running the matrix

The MCP suite drives `@termwright/mcp` over real HTTP with several concurrent
sessions, and checks close ownership against real pids rather than against the
registry's bookkeeping — a registry can forget a session while its terminals
keep running, and only a pid probed afterwards tells the two apart.

```sh
pnpm --filter @termwright/conformance conformance     # every suite, one matrix
pnpm --filter @termwright/conformance test            # plain vitest
pnpm --filter @termwright/conformance test:hostile    # adversarial suite, 128 MB heap cap
```

```
area                        spec     result         tests    time
generic fallback            §20.1    pass           10/10    2.0s
semantic matrix             §20.2    pass           12/12    4.5s
component harness           §20.2a   pass           9/9      3.1s
hostile peer                §20.3    pass           25/25    14.5s
interaction                 §20.4    pass           12/12    2.6s
readiness + env             §5.3     pass           10/10    2.2s
adapter contract (ink)      §7       pass           7/7      1.3s
adapter contract (py/go)    §7       pass, 8 skip   6/14     0.6s
hostile peer @ 128 MB heap  §10      pass           25/25    14.4s
```

A partly-skipped area is reported as such rather than as a clean pass: the
language adapters skip their whole registration when the toolchain is absent,
and a matrix that hid it would claim coverage the machine never produced.

Sessions launch with the driver's secret-safe `envMode: 'replace'` default, so
a fixture only sees the documented allowlist plus what a suite declares.

Every suite needs a pseudo-terminal and skips itself where none can be opened;
`TERMWRIGHT_SKIP_PTY=1` skips them explicitly. A run where everything skipped
says so rather than reporting success.

## Why a second, smaller driver

`AdapterProbe` speaks the protocol itself — endpoint, handshake, framing, marker
verification — instead of using `@termwright/driver`. The driver deliberately
hides frame ordering behind a settled tree, which is the right API for testing
applications and the wrong one for testing adapters. The probe is exported for
checks the suite does not cover; it never renders, locates or acts.
