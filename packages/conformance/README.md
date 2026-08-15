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

It checks the five obligations an adapter has:

| Obligation | What is asserted |
|---|---|
| Dormant rule | Without `TERMWRIGHT_ENDPOINT` it opens no channel and writes no marker; with `baseline`, byte-for-byte identical output |
| Handshake | `hello` first and once, correct protocol id, non-empty adapter identity, capabilities from the closed set |
| Snapshot validity | Every snapshot passes `validateSnapshot`, carries this session's id, has resolvable parents and monotonic revisions |
| Revision ordering | For each revision: snapshot → `revision-commit` → a marker that verifies against the session token, markers strictly increasing |
| Channel loss | Cutting the socket leaves the application rendering and alive, and the adapter does not reconnect |

`await` it at the top level: `vitest` is imported dynamically so the package can
also be used from a plain script.

## Fixtures

`CONFORMANCE_FIXTURES` returns absolute paths to programs you can launch with
`node <path>`:

| Fixture | Purpose | Dependencies |
|---|---|---|
| `generic()` | Uninstrumented app: menu, colours, mouse/paste/focus modes, Unicode, alternate screen, scrollback (§20.1) | none |
| `adversarialPeer()` | Raw wire peer; takes a scenario name as `argv[2]` (§20.3) | none |
| `semanticInk()` | Full semantic matrix on `@termwright/ink` (§20.2) | `ink`, `react` |
| `component()` | Component-harness matrix in process mode (§20.2a) | `ink`, `react` |
| `componentModule()` | The component itself, for an in-process harness to import | `ink`, `react` |

The first two import nothing at all — the adversarial peer re-derives the
framing and the marker MAC from the specification rather than importing
`@termwright/protocol`, so a drift between spec and implementation shows up
instead of cancelling out.

```ts
import { CONFORMANCE_FIXTURES } from '@termwright/conformance';
import { launchTerminal } from '@termwright/driver';

const terminal = await launchTerminal({ command: ['node', CONFORMANCE_FIXTURES.generic()] });
```

## Running the matrix

```sh
pnpm --filter @termwright/conformance conformance     # every suite, one matrix
pnpm --filter @termwright/conformance test            # plain vitest
pnpm --filter @termwright/conformance test:hostile    # adversarial suite, 128 MB heap cap
```

```
area                        spec     result      tests    time
generic fallback            §20.1    pass        10/10    2.1s
semantic matrix             §20.2    pass        11/11    4.3s
component harness           §20.2a   pass        9/9      3.0s
hostile peer                §20.3    pass        24/24    14.5s
interaction                 §20.4    pass        12/12    2.5s
adapter contract            §7       pass        7/7      1.2s
hostile peer @ 128 MB heap  §10      pass        24/24    14.6s
```

Every suite needs a pseudo-terminal and skips itself where none can be opened;
`TERMWRIGHT_SKIP_PTY=1` skips them explicitly. A run where everything skipped
says so rather than reporting success.

## Why a second, smaller driver

`AdapterProbe` speaks the protocol itself — endpoint, handshake, framing, marker
verification — instead of using `@termwright/driver`. The driver deliberately
hides frame ordering behind a settled tree, which is the right API for testing
applications and the wrong one for testing adapters. The probe is exported for
checks the suite does not cover; it never renders, locates or acts.
