---
title: Configure Termwright
description: Set application, viewport, timeout, trace, snapshot, and terminal profile defaults.
---

Most projects can start without a Termwright config. Add one when several tests
share the same command or need different viewport, timeout, trace, or environment
defaults.

## Load a configuration

Create `termwright.config.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { defineTermwrightConfig } from 'termwright/test';

const cli = fileURLToPath(new URL('./dist/cli.js', import.meta.url));

export default defineTermwrightConfig({
  command: [process.execPath, cli],
  columns: 100,
  rows: 30,
  trace: 'retain-on-failure',
});
```

Create `termwright.setup.ts`:

```ts
import { configureTermwright } from 'termwright/test';
import config from './termwright.config.js';

configureTermwright(config);
```

Then load the setup file from `vitest.config.ts`, which is read by Termwright's
embedded test engine:

```ts
export default {
  test: {
    setupFiles: ['./termwright.setup.ts'],
  },
};
```

Termwright does not discover `termwright.config.ts` automatically. Projects
that already have a test config can add the setup file to it.

## Configuration precedence

The closest setting wins:

1. project configuration;
2. `test.override({ termwrightOptions })` for a file or suite;
3. options passed to `terminal.launch()`.

Nested `env` and `timeouts` values merge by key. A `command` array is replaced
as a whole.

## Project options

| Option | Default | Purpose |
| --- | --- | --- |
| `command` | none | Command used by `terminal.launch()` when no command is passed |
| `columns` | `100` | Initial terminal width in cells |
| `rows` | `30` | Initial terminal height in cells |
| `env` | `{}` | Environment variables added to launched applications |
| `timeouts` | see below | Action, text, idle, ready, exit, and assertion timeouts |
| `trace` | `retain-on-failure` | Which test attempts keep a trace |
| `outputDir` | `termwright-report` | Directory for retained traces |
| `snapshotDir` | `__snapshots__` | Snapshot directory relative to each test file |
| `terminalProfile` | default profile | Character width and terminal behavior profile |
| `palette` | terminal defaults | Fixed 16-color palette used by color assertions and snapshots |
| `failOnLogLevel` | `error` | Lowest structured log level that fails a passing test; use `false` to disable |
| `requiredCapabilities` | `[]` | Semantic capabilities that must be available when a session launches |
| `profiles` | `{}` | Named groups of overrides |

Session-specific options such as `cwd`, `envMode`, semantic setup, and artifact
security belong on `terminal.launch()`.

## Set timeouts

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

Set the timeout for the operation that can legitimately take longer. Individual
assertions also accept `{ timeout }`. Do not increase a global timeout to hide a
locator or synchronization error.

## Choose a trace policy

| Value | Behavior |
| --- | --- |
| `retain-on-failure` | Keep failed attempts and remove passing traces |
| `on-first-retry` | Record the first retry attempt |
| `on` | Keep every trace |
| `off` | Do not record traces |

See [Open traces and reports](../../tools/traces-reports/) for replay and artifact
handling.

## Configure a terminal matrix

Named profiles let the same test run with different terminal settings:

```ts
// termwright.config.ts
export default defineTermwrightConfig({
  profiles: {
    compact: { columns: 80, rows: 24 },
    wide: { columns: 140, rows: 40, terminalProfile: 'cjk-wide' },
  },
});
```

Add the profiles as test projects:

```ts
// vitest.config.ts
import { termwrightProjects } from 'termwright/test';
import termwright from './termwright.config.js';

export default {
  test: {
    setupFiles: ['./termwright.setup.ts'],
    projects: termwrightProjects(termwright),
  },
};
```

Run all configured projects with `npx termwright test`, or select one:

```sh
npx termwright test -- --project compact
```

Use a CI operating-system matrix for platform coverage. A terminal profile does
not emulate Windows, macOS, or Linux process behavior.

## Select a resource profile

The CLI resource profile selects a scheduling policy. Termwright then derives
the effective worker and terminal limits from the host's available CPUs,
memory, temporary disk space, and Linux cgroup limits. A profile name is not a
fixed concurrency number.

<!-- BEGIN GENERATED RESOURCE PROFILES -->
<!-- Generated from TERMWRIGHT_RESOURCE_PROFILES; do not edit this block by hand. -->
| Profile | Intended use | Effective limits |
| --- | --- | --- |
| `local` | Normal development | Host-derived |
| `ci` | Linux and macOS CI | Host-derived |
| `windows-ci` | Windows CI | Host-derived |
| `stress` | Intentional high-fanout capacity tests | Host-derived |
<!-- END GENERATED RESOURCE PROFILES -->

Run `npx termwright doctor --json` in the project directory to inspect the
effective limits and the reason each limit was chosen. Use `local` for normal
development, `ci` on Linux and macOS CI, and `windows-ci` on Windows CI. The
`stress` policy deliberately permits more parallel work and is intended for
capacity testing, not ordinary test runs.

A test that needs several terminals at the same time must declare them before
the test starts:

```ts
test.resources({ terminals: 2 })('connects two peers', async ({ terminal }) => {
  const [client, server] = await Promise.all([
    terminal.launch(clientOptions),
    terminal.launch(serverOptions),
  ]);
});
```

Termwright waits for the declared group to fit instead of starting a test with
only part of its required capacity.

## Configure retries

Use retries only for diagnostics. A fail-then-pass result remains flaky and
returns a non-zero exit code.

```ts
// vitest.config.ts
import { termwrightRetry } from 'termwright/test';

export default {
  test: {
    retry: termwrightRetry({ ci: 0, local: 0 }),
  },
};
```

`TERMWRIGHT_RETRIES` overrides the number of additional attempts and accepts an
integer from 0 through 100.

## Environment variables

| Variable | Meaning |
| --- | --- |
| `TERMWRIGHT_RETRIES` | Number of additional attempts |
| `TERMWRIGHT_DEBUG` | `1` for driver debug output; `all` also includes raw PTY traffic |
| `TERMWRIGHT_PROFILE` | Named Termwright profile to apply |
| `TERMWRIGHT_UPDATE_SNAPSHOTS` | `all`, `changed`, `missing`, or `none` |

Internal endpoint and token variables are set by Termwright. Applications and
test configuration should not set them.
