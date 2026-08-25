---
title: Configuration
description: Termwright test defaults, launch overrides, retries, traces, timeouts, and environment variables.
---

Most projects need no Termwright configuration. Import a config explicitly from
`vitest.config.ts` when you want to change defaults; Termwright does not search
for `termwright.config.ts` automatically.

The certified host runs on the Node.js 22 and 24 LTS lines. This is an exact
support policy, not shorthand for `>=22`: another major is unsupported until
the native host, PTY lifecycle, framework adapters, and Windows lanes certify
it.

```ts
// termwright.config.ts
import {defineTermwrightConfig} from 'termwright/test';

export default defineTermwrightConfig({
  columns: 100,
  rows: 30,
  trace: 'retain-on-failure',
});
```

```ts
// termwright.setup.ts
import {configureTermwright} from 'termwright/test';
import termwright from './termwright.config.js';

configureTermwright(termwright);
```

```ts
// vitest.config.ts
import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {setupFiles: ['./termwright.setup.ts']},
});
```

## Configuration precedence

Values are resolved in this order, with later values winning:

1. configured project defaults;
2. scoped test options;
3. `terminal.launch()` options.

## Project options

| Option | Purpose |
| --- | --- |
| `columns`, `rows` | Initial PTY dimensions. Defaults: 100 × 30. |
| `command` | Default command for `terminal.launch()`. |
| `env` | Environment additions for launched applications. |
| `terminalProfile` | Emulator width/behavior profile. |
| `timeouts` | Action, text, idle, ready, exit, and assertion budgets. |
| `trace` | Trace retention policy. |
| `outputDir` | Trace and HTML report directory. Default: `termwright-report`. |
| `snapshotDir` | Snapshot directory relative to the test file. Default: `__snapshots__`. |
| `palette` | Deterministic 16-color terminal palette. |
| `failOnLogLevel` | Lowest application log level that fails a passing test. Default: `error`. |
| `profiles` | Named overrides selected by `TERMWRIGHT_PROFILE`. |

Each fixture uses a private temporary working directory and a controlled
environment. Set `cwd`, `envMode`, or semantic integration options
on an individual `terminal.launch()` call because they are session-specific.
See [Test files and isolation](../../guides/test-files/) before opting into a
shared working directory.

## Test matrices

Use named profiles with Vitest projects to run the same test once per terminal
configuration:

```ts
// termwright.config.ts
import {defineTermwrightConfig} from 'termwright/test';

export default defineTermwrightConfig({
  profiles: {
    compact: {columns: 80, rows: 24, terminalProfile: 'default'},
    wide: {columns: 140, rows: 40, terminalProfile: 'kitty'},
  },
});
```

```ts
// vitest.config.ts
import {defineConfig} from 'vitest/config';
import {termwrightProjects} from 'termwright/test';
import termwright from './termwright.config.js';

export default defineConfig({
  test: {
    setupFiles: ['./termwright.setup.ts'],
    projects: termwrightProjects(termwright),
  },
});
```

Vitest schedules and filters the projects. Their names appear with test results,
and each profile gets its own default snapshot directory under
`__snapshots__/<profile>`. Select one with `--project compact`. Use the CI
operating-system matrix for macOS, Linux, and Windows; an OS is not an emulator
setting.

## Assertion and wait timeouts

Termwright separates action, text, idle, ready, exit, and assertion timeout
classes.
Set the narrowest relevant timeout rather than adding sleeps to tests.

```ts
export default defineTermwrightConfig({
  timeouts: {
    action: 5_000,
    text: 5_000,
    idle: 2_000,
    ready: 10_000,
    exit: 10_000,
    expect: 5_000,
  },
});
```

Every public operation creates one monotonic deadline and passes its remaining
time through resolution, capability negotiation, input, postcondition, trace,
and cleanup phases. A phase never receives a fresh copy of the original
timeout. The Native Host also owns a total run deadline and reserves its final
portion for diagnostic capture, journal flush, trace finalization, and verified
resource teardown. Run manifests record both resolved values.

Use `termwright doctor` to inspect the exact host timeout and resource profile
that will be certified. These host values are Termwright-owned infrastructure
configuration; arbitrary Vitest defaults cannot silently weaken them.

### Resource profiles

The profile fixes both Vitest's worker ceiling and the independent capacities
enforced by Termwright's resource broker. `fileParallelism` is enabled for every
profile; admission still cannot exceed any capacity in the table.

<!-- BEGIN GENERATED RESOURCE PROFILES -->
<!-- Generated from TERMWRIGHT_RESOURCE_PROFILES; do not edit this block by hand. -->
| Profile | Workers | PTY sessions | External processes | Semantic endpoints | Trace writers | Per terminal |
| --- | --- | --- | --- | --- | --- | --- |
| `local` | 2 | 4 | 4 | 4 | 4 | `semanticEndpoint` × 1 |
| `ci` | 2 | 4 | 4 | 4 | 4 | `semanticEndpoint` × 1 |
| `windows-ci` | 2 | 4 | 4 | 4 | 4 | `semanticEndpoint` × 1 |
| `stress` | 16 | 16 | 16 | 16 | 16 | `semanticEndpoint` × 1 |
<!-- END GENERATED RESOURCE PROFILES -->

The profile's PTY count is independent of Vitest's worker count. Every live
terminal consumes one PTY, external-process, and semantic-endpoint unit at the
driver allocation boundary; trace writers hold their own units until durable
finalization. Several terminals launched by one test count separately. Select
the `stress` profile for a deliberately large fan-out. For a test which needs
several terminals simultaneously, declare the group before collection:

```ts
test.resources({ terminals: 2 })('two peers', async ({ terminal }) => {
  const [left, right] = await Promise.all([terminal.launch(leftOptions), terminal.launch(rightOptions)]);
});
```

The exact runner requests that vector atomically in `onBeforeTryTask`, before
fixtures and before starting Termwright's Attempt budget. By default every
declared terminal also reserves a trace writer; a trace-off test can set
`traceWriters: 0`. Launching beyond the declared vector fails closed instead of
falling into a second scheduler queue. The certified `local`, `ci`, and
`windows-ci` worker envelopes remain deliberately conservative until the
current Windows pressure matrix is certified, but scheduling and terminal
capacity are now separate controls rather than package serialization. The
broker never discounts resources merely because the leases share an AttemptId. A request
that cannot fit remains in the visible FIFO queue and consumes the same attempt
deadline instead of overcommitting the machine.

`windows-ci` is an explicit, production scheduler contract, not a retry or a
flakiness workaround. It currently has the same limits as `ci`: two test workers
may run files in parallel while as many as four terminals can be admitted for a
single atomic multi-terminal reservation. `stress` deliberately raises both
ceilings to exercise high fan-out. Changing any value in the implementation
requires regenerating this table; the generated-docs check fails on drift.

## Traces

| Value | Behavior |
| --- | --- |
| `off` | Do not retain traces. |
| `on` | Retain every trace. |
| `retain-on-failure` | Retain failed and flaky evidence. |
| `on-first-retry` | Record only the first retry attempt. |

See [Traces and reports](../../tools/traces-reports/) for reporter and artifact
configuration.

## Test retries

Vitest owns scheduling. Configure retries with the public helper:

```ts
import {termwrightRetry} from 'termwright/test';

export default defineConfig({
  test: {retry: termwrightRetry({ci: 0, local: 0})},
});
```

`TERMWRIGHT_RETRIES` overrides the number of additional attempts and accepts an
integer from 0 through 100. Reports retain each earlier failure reason and the
identity of the attempt on which the test passed or finally failed. Use a
non-zero value only as a diagnostic experiment: a fail-then-pass run is flaky,
exits non-zero, and is not certifying evidence.

## Snapshot updates

Use Vitest's snapshot update flag for normal updates. Termwright's resolved
configuration also controls semantic and cell snapshot update behavior where a
project needs a fixed policy.

## Environment variables

| Variable | Meaning |
| --- | --- |
| `TERMWRIGHT_RETRIES` | Additional Vitest attempts. |
| `TERMWRIGHT_DEBUG` | `1` for debug logs; `all` also includes raw PTY traffic. |
| `TERMWRIGHT_PROFILE` | Name of a configured profile to apply. |
| `TERMWRIGHT_UPDATE_SNAPSHOTS` | Snapshot update policy when set by tooling. |
| `TERMWRIGHT_UI_URL` | Internal live terminal-session projection endpoint. |
| `TERMWRIGHT_ENDPOINT` | Internal semantic probe transport endpoint. |
| `TERMWRIGHT_TOKEN` | Internal session authentication token. |

Applications and normal test configuration should not set the internal
transport variables. The fixture and Runner own them.

## Runner preferences

Runner layout, density, replay speed, source editor, reduced motion, and panel
state are local UI preferences, not test configuration. Change them in Runner
Settings. They do not change test behavior or CI output.
