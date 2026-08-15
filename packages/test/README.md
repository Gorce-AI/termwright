# @termwright/test

The Vitest preset for [termwright](https://github.com/gorce-ai/termwright): a
`terminal` fixture that launches and tears down real PTY sessions, matchers that
retry until the screen catches up, and **semantic YAML snapshots** — the
accessibility tree of a terminal app, in a form a reviewer can read.

The driver works fine from `node:test` or Jest. This package is the thin layer
that makes Vitest feel like Playwright.

## Install

```sh
pnpm add -D @termwright/test vitest
```

Requires Node >= 22 and Vitest >= 3.2. ESM only.

## Usage

```ts
import { test, expect } from '@termwright/test';

test('asks before running a command', async ({ terminal, step }) => {
  const app = await terminal.launch({ command: ['node', 'agent.js'] });
  await app.waitForText('Permission required');

  // The whole tree, matched partially: children you omit are don't-care.
  await expect(app).toMatchSemanticSnapshot(`
    - dialog "Permission" [modal]:
        - button "Approve" [focused]
        - button /^Rej/
  `);

  await step('approve', async () => {
    await app.getByRole('button', { name: 'Approve' }).activate();
  });

  // No sleeps: the matcher re-probes until the adapter publishes a new tree.
  await expect(app.getByRole('dialog')).not.toBeVisible();
  await expect(app).toHaveText('running: ls -la');
});
```

The session closes itself, its working directory is removed, and — when the test
fails — its `.twtrace` archive is kept for the report.

## Fixtures

| Fixture | What it gives you |
|---|---|
| `terminal` | `launch(options)` for as many sessions as the test needs, all closed on teardown; `sessions`; `tmpdir` |
| `step` | `step(title, body)` — a marker in the recording, a step in the trace and a section in the report |
| `termwright` | the resolved config, the test's private `tmpdir`, the traces kept for it |

Each test gets a fresh temporary directory (the default `cwd`) and a minimal
environment: only `PATH`, `HOME` and friends are inherited, so a stray variable
on a laptop cannot change what CI sees. `test.step()` works too; the `step`
fixture is the form to prefer under `test.concurrent`, since it is bound to its
own test rather than to the most recently started one.

## Matchers

All of them are asynchronous — `await expect(...)` — and the locator ones poll
until the `expect` timeout class runs out.

| Matcher | Subject |
|---|---|
| `toBeVisible()` | locator |
| `toBeFocused()` | locator |
| `toHaveState({ disabled: true })` | locator; asserts only the keys you list |
| `toHaveText('Save' \| /Sav/)` | locator (exact, whitespace-normalized) or terminal (substring of the grid) |
| `toMatchSemanticSnapshot(expected?)` | terminal or `SemanticSnapshot` |
| `toMatchCellSnapshot(expected?)` | terminal or `ScreenSnapshot` |

A failure reads like the driver's own errors: what was expected, what was
observed, the timeout that elapsed, the candidate nodes and an excerpt of the
screen.

```
expect(getByRole('button', { name: 'Approve' })).toBeVisible()

Expected: visible
Received: hidden
Timeout:  5000ms

suggestion: narrow the locator with within(), a name option, or select one with first()/nth()
candidates:
  - button "Reject" ref=n4@7
screen:
  Permission required
     Approve    [Reject]
```

## Semantic YAML snapshots

The format is normative in [`/CONTRACTS.md`](../../CONTRACTS.md) §YAML snapshots:

```yaml
- dialog "Permission" [modal]:
    - text "Allow bash to run?"
    - button "Approve" [focused]
    - button /Rej.*/
```

- **Partial by default.** Omitted children are don't-care, and unlisted siblings
  are allowed. Listed children must keep their relative order.
- **Names** are compared after whitespace normalization, may be a `/regex/`, and
  may be omitted to match any name.
- **`[flags]`** assert only what they list. `!focused` asserts the opposite,
  `checked=mixed` and `level=2` compare a value. Volatile states
  (`scrollOffset`, `positionInSet`, …) are left out of written snapshots unless
  you ask for `{ states: 'all' }`.
- `'* "Save"'` matches any role. It has to be quoted — a bare `*` opens a YAML
  alias.
- A name containing `#` is written quoted, so the file stays valid YAML.

Semantic and cell snapshots are separate oracles on purpose: a semantic snapshot
can pass on a blank screen, because the adapter publishes a tree nobody painted.
An important end-to-end test asserts both.

```
┌─ 60×3 ─────────────────────────────────────────────────────┐
│Permission required                                         │
│   Approve    [Reject]                                      │
│last: ACTIVATED reject                                      │
└────────────────────────────────────────────────────────────┘
```

### Where snapshots live, and how they are updated

Called without an argument, both snapshot matchers store the value in
`__snapshots__/<test file>.tw-semantic.yaml` (or `.tw-cells.yaml`), one literal
block per assertion, keyed by test name.

Vitest's `--update` has two states; the contract asks for three. The mode is
resolved as:

| Source | Mode |
|---|---|
| `TERMWRIGHT_UPDATE_SNAPSHOTS=all` | rewrite every snapshot, even matching ones |
| `TERMWRIGHT_UPDATE_SNAPSHOTS=changed`, or `vitest -u` | write missing, overwrite mismatching |
| `TERMWRIGHT_UPDATE_SNAPSHOTS=missing`, or a plain run | write missing; a mismatch fails |
| `TERMWRIGHT_UPDATE_SNAPSHOTS=none`, or `--update=none` | never write; a missing snapshot fails |

`config.updateSnapshots` overrides all of it. Note that updating a *semantic*
snapshot replaces the stored pattern with the full serialized tree — any regex
or partial matching you hand-wrote is rewritten, so review the diff.

## Configuration

```ts
// termwright.config.ts
import { defineTermwrightConfig, XTERM_PALETTE } from '@termwright/test';

export default defineTermwrightConfig({
  columns: 100,
  rows: 30,
  command: ['node', 'app.js'],
  trace: 'retain-on-failure',            // 'on' | 'retain-on-failure' | 'off'
  outputDir: 'termwright-report',
  timeouts: { expect: 5_000, action: 5_000 },
  profiles: {
    ci: { trace: 'on', palette: XTERM_PALETTE },
  },
});
```

```ts
// vitest.setup.ts
import { configureTermwright } from '@termwright/test';
import config from './termwright.config.js';

configureTermwright(config);
```

`TERMWRIGHT_PROFILE=ci` selects a profile. A profile's palette pins the 16 ANSI
colors and the `TERM`/`COLORTERM` a launched program sees, which is what makes
color assertions and cell snapshots stable between a laptop and CI.

## Reporter

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import TermwrightReporter from '@termwright/test/reporter';

export default defineConfig({
  test: {
    setupFiles: ['./vitest.setup.ts'],
    retry: 2,
    reporters: ['default', new TermwrightReporter()],
  },
});
```

After the run it writes `<outputDir>/index.html` — the self-contained report
from `@termwright/trace`, with the visual diff, the semantic diff and the
embedded recording of every failure. Tests that only passed after a retry are
listed separately as **flaky**: a flaky test is a different problem from a
broken one, and hiding it in the pass count is how it stays broken.

Import the reporter from `@termwright/test/reporter`, never from the package
root: `vitest.config.ts` is loaded before the test runner exists, and the root
module registers matchers on `expect` as a side effect.

## Development

```sh
pnpm build && pnpm typecheck && pnpm test
```

The end-to-end suite drives the driver's semantic fixture over a real PTY and is
skipped automatically where no pseudo-terminal can be opened
(`TERMWRIGHT_SKIP_PTY=1` skips it explicitly).
