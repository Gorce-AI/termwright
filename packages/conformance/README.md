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

Conventions the fixture has to opt into — an annotated test id, an empty
textbox, a container with no label — are declared under `conventions`; the rest
run for every adapter:

```ts
conventions: {
  emptyTextboxTestId: 'reason',
  readmePath: 'clients/go/README.md',
},
```

Deviations are **not** declared here. They are read from the adapter's own
`## Deviations` section, which is where rule 6 puts them and where a user reads
them; repeating them in a registration would give two copies of one fact that
eventually disagree. That gives three outcomes rather than two: compliant, a
failure the README declares (a documented limitation, not an error), and a
failure it does not (an error).

Every run writes a per-adapter roll-up of those declarations, which
`pnpm conformance` prints under the matrix. It is generated rather than
maintained: a hand-written table of per-adapter gaps went stale within a round
of being written, and a stale overview in a document people trust is worse than
none.

Rules 1, 2 and 4 cannot be judged in full from outside a subprocess, so the
README check is advisory: a missing `## Deviations` heading writes a warning to
stderr rather than failing the run.

It checks the five obligations an adapter has:

| Obligation        | What is asserted                                                                                                                                                                                                                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dormant rule      | Without `TERMWRIGHT_ENDPOINT` it opens no channel and writes no marker; with `baseline`, byte-for-byte identical startup output                                                                                                                                                                                       |
| Tree before input | Once the handshake completes and _before any input_, the tree is non-empty and has at least one node a locator could address. Opt out with `treeBeforeInput: {required: false, reason}`                                                                                                                               |
| Handshake         | `hello` first and once, correct protocol id, non-empty adapter identity, capabilities from the closed set                                                                                                                                                                                                             |
| Snapshot validity | Every publication is a complete v2 snapshot that passes `validateSnapshot`, carries this session's id, has resolvable parents and monotonic revisions                                                                                                                                                                 |
| Revision ordering | For each revision: snapshot → `revision-commit` → a marker that verifies against the session token, markers strictly increasing                                                                                                                                                                                       |
| Channel loss      | Cutting the socket leaves the application rendering and alive, and the adapter does not reconnect                                                                                                                                                                                                                     |
| Logs              | An adapter that did not announce `logs` sends none. One that declares them in the registration must deliver a record whose `seq` is unique and increasing and whose message never appears on the terminal                                                                                                             |
| Conventions       | The machine-checkable half of the protocol README's "Adapter semantics conventions": containers are not named from their content (rule 2), an annotated test id reaches the wire (rule 3), an empty textbox publishes `value: ''` and no value is derived outside `{textbox, progressbar}` or from a boolean (rule 5) |

`await` it at the top level: `vitest` is imported dynamically so the package can
also be used from a plain script.

## Fixtures

`CONFORMANCE_FIXTURES` returns absolute paths to programs you can launch with
`node <path>`:

| Fixture             | Purpose                                                                                                         | Dependencies                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `generic()`         | Uninstrumented app: menu, colours, mouse/paste/focus modes, Unicode, alternate screen, scrollback (§20.1)       | none                                    |
| `prompt()`          | Shell-shaped app emitting OSC 133 marks; `--marks=off` suppresses them, `--work=<ms>` sets the command duration | none                                    |
| `adversarialPeer()` | Raw wire peer; takes a scenario name as `argv[2]` (§20.3)                                                       | none                                    |
| `inkProbe()`        | Ordinary `ink.render` app launched through the zero-config Ink probe                                            | `ink`, `react`, `@termwright/probe-ink` |

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
pnpm --filter @termwright/conformance conformance --require-declared-skips
pnpm --filter @termwright/conformance conformance --require-no-skipped-areas
pnpm --filter @termwright/conformance test            # plain vitest
pnpm --filter @termwright/conformance test:hostile    # adversarial suite, 128 MB heap cap
```

The conformance orchestrator builds the probed and plain tview fixtures
asynchronously before the native test host is opened. Each run gets a private
temporary directory and a platform/architecture contract containing both
binary digests. Collection only verifies that contract and never launches a
compiler; the orchestrator removes the directory after the host closes.

The table reports each area as pass, fail, or pass with an explicit skip count;
the exact test counts intentionally are not documentation because suites grow.
Test identities use `file::fullName`, so declarations cannot accidentally
match a same-named test elsewhere.

Certifying the py/go rows needs their toolchains on the runner
(`pip install -e clients/python[dev]` and a Go toolchain); without them those
rows skip honestly, with the probe's failure on stderr.

A partly-skipped area is reported as such rather than as a clean pass. Platform
deviations live in the reviewed registry and must match the exact test identity.
`--require-declared-skips` requires the observed skip identities to equal the
reviewed applicability and platform-deviation registries exactly.
`--require-no-skipped-areas` is stricter: it permits only the fixed
applicability skips and rejects every registered platform deviation. Vitest
implements applicability with `skipIf`/`runIf`, so those cases do appear in the
matrix as expected skips even though they are not missing platform coverage.
Local runs may honestly skip a missing optional toolchain, while certification
installs its prerequisites and requires exact declared skips so missing
coverage cannot look green.

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
