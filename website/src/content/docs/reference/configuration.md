---
title: Configuration
description: termwright.config.ts, launch options, timeout classes, profiles and the environment variables that override them.
---

## `termwright.config.ts`

```ts
import {defineTermwrightConfig, XTERM_PALETTE} from '@termwright/test';

export default defineTermwrightConfig({
  columns: 100,
  rows: 30,
  command: ['node', 'app.js'],
  trace: 'retain-on-failure',            // 'on' | 'retain-on-failure' | 'off'
  outputDir: 'termwright-report',
  timeouts: {expect: 5_000, action: 5_000},
  profiles: {
    ci: {trace: 'on', palette: XTERM_PALETTE},
  },
});
```

```ts
// vitest.setup.ts
import {configureTermwright} from '@termwright/test';
import config from './termwright.config.js';

configureTermwright(config);
```

```ts
// vitest.config.ts
import {defineConfig} from 'vitest/config';
import TermwrightReporter from '@termwright/test/reporter';

export default defineConfig({
  test: {
    setupFiles: ['./vitest.setup.ts'],
    retry: 2,
    reporters: ['default', new TermwrightReporter()],
  },
});
```

Import the reporter from `@termwright/test/reporter`, never from the package
root: `vitest.config.ts` is loaded before the test runner exists, and the root
module registers matchers on `expect` as a side effect.

## Profiles and deterministic colour

`TERMWRIGHT_PROFILE=ci` selects a profile. A profile's palette pins the 16 ANSI
colours and the `TERM` / `COLORTERM` a launched program sees, which is what makes
colour assertions and cell snapshots stable between a laptop and CI. If a cell
snapshot passes locally and fails in CI, this is the first thing to set.

## Launch options

```ts
const app = await terminal.launch({
  command: ['node', 'app.js'],
  cwd: '/tmp/fixture',
  env: {NO_COLOR: '1'},
  envMode: 'replace',          // default
  columns: 100,                // default
  rows: 30,                    // default
  semanticNegotiationMs: 250,  // default
  scrollbackLines: 2_000,      // default
  timeouts: {action: 15_000},
  recording: {enabled: true, idleTimeLimit: 2},
});
```

### `envMode`

`'replace'` is the default and it is a real isolation guarantee: the child gets
`PATH`, `HOME`, `LANG`, `LC_ALL`, `SHELL`, `TMPDIR`, `USER`, `TERM`, whatever you
pass in `env`, and the termwright handshake variables — nothing else. The tokens
and cloud credentials in a test runner's environment are not the application
under test's business.

`'inherit'` gives the child the parent's full environment plus `env`. Reach for
it when the program genuinely needs more, and know what you are handing it.

Two consequences that surprise people:

- **`NODE_OPTIONS` does not reach the child.** If a TypeScript loader was
  configured that way, pass it explicitly — for Ink fixtures that is
  `nodeArgs: ['--import', 'tsx']`.
- **`envMode` cannot isolate an in-process mount**, which reads the runner's own
  `process.env`. See [Component testing](../../guides/component-testing/).

## Timeout classes

| Class | Default | Covers | Environment override |
|---|---|---|---|
| `action` | 5 s | resolving a locator and acting on it | `TERMWRIGHT_TIMEOUT_ACTION` |
| `text` | 5 s | `waitForText`, `toHaveText` | `TERMWRIGHT_TIMEOUT_TEXT` |
| `idle` | 2 s | `waitForIdle`, `waitForStable` | `TERMWRIGHT_TIMEOUT_IDLE` |
| `ready` | 10 s | `waitForReady` | `TERMWRIGHT_TIMEOUT_READY` |
| `exit` | 10 s | `waitForExit` | `TERMWRIGHT_TIMEOUT_EXIT` |

Each is overridable per call, per launch and per environment variable, in that
order of specificity.

## Environment variables

| Variable | Effect |
|---|---|
| `TERMWRIGHT_PROFILE` | selects a config profile |
| `TERMWRIGHT_UPDATE_SNAPSHOTS` | `all` / `changed` / `missing` / `none` — see [snapshots](../../guides/assertions/) |
| `TERMWRIGHT_TIMEOUT_*` | the five timeout classes above |
| `TERMWRIGHT_SKIP_PTY` | skip suites that need a pseudo-terminal |
| `TERMWRIGHT_UI_URL` | where the UI reporter publishes; unset means it does nothing |
| `TERMWRIGHT_ENDPOINT`, `TERMWRIGHT_TOKEN`, `TERMWRIGHT_PROTOCOL` | injected by the driver into the child; never set these yourself |

## Waiting for a shell prompt

`waitForReady()` prefers OSC 133 shell-integration marks (`A` prompt start,
`B` input start, `C` command start, `D` finished) — the same marks VS Code,
iTerm2, WezTerm and fish already emit. When a program emits none it falls back
to "the screen settled", which is a heuristic and is reported as one **by code,
not by prose**: a diagnostic of `ready-shell-integration` means the program said
it was at a prompt, `ready-settled-screen` means the driver guessed from silence.

:::caution[The race worth knowing]
Between `press('Enter')` and the shell's `OSC 133 C`, the last mark still says
"prompt waiting", so a `waitForReady()` issued immediately after a keystroke
resolves against the *previous* prompt. Wait for the command to be observably
running first.
:::

## Diagnostics

`terminal.diagnostics()` returns the bounded, oldest-first log of what the
session decided on its own — negotiation timeouts, superseded or expired
revisions, unverified markers, protocol violations, which readiness strategy was
used. The same entries arrive live as `diagnostic` session events, so a test can
assert on a failure mode directly instead of inferring it from prose.
