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

### Skipping when there is no PTY

Sandboxed CI, slim containers and installs without the native prebuild cannot
open a pseudo-terminal, and a suite that reports that as a failure is a suite
people switch off. The preset ships the probe so no project has to write it:

```ts
import { describe } from 'vitest';
import { ptyAvailable, test, expect } from '@termwright/test';

const pty = await ptyAvailable();

describe.skipIf(!pty)('the app', () => {
  test('starts', async ({ terminal }) => {
    const app = await terminal.launch({ command: ['node', 'app.js'] });
    await expect(app).toHaveText('ready');
  });
});
```

The result is memoized, and `TERMWRIGHT_SKIP_PTY=1` forces it to `false` when
you want to skip these suites deliberately.

## Options for a file or a suite

The equivalent of Playwright's `test.use()`, on Vitest's own mechanism:

```ts
import { describe } from 'vitest';
import { test, expect } from '@termwright/test';

test.scoped({ termwrightOptions: { columns: 120, trace: 'on' } });

describe('the wide layout', () => {
  test.scoped({ termwrightOptions: { columns: 200 } });
  // …tests here get 200 columns; the rest of the file gets 120.
});
```

Scopeable: `command`, `columns`, `rows`, `env`, `timeouts`, `trace`,
`failOnLogLevel`. They sit between the project configuration and the `launch()`
call:

```
defineTermwrightConfig()  <  test.scoped({ termwrightOptions })  <  terminal.launch({ … })
```

The merge is **key by key**, which matters more than it sounds: `test.scoped`
replaces a fixture's whole value, so scoping only `trace` would drop the
project's viewport and environment if the value were taken as-is. `env` and
`timeouts` merge entry by entry too — scoping one variable or one timeout class
keeps the others. `command` is the exception: an argv is replaced wholly, never
concatenated.

## Files the program starts with

A terminal program's input is mostly files. Declare them on the launch and they
exist in the test's private directory — which is also the program's `cwd` —
before it starts:

```ts
const app = await terminal.launch({
  command: ['node', 'editor.js'],
  files: {
    'config.json': JSON.stringify({ theme: 'dark' }),
    'notes/todo.md': '- write tests\n',
  },
});
```

Directories are created as needed, and a `Uint8Array` is written as bytes. To
start from a whole project, copy a template first — the declared files are
written over it, so a test can take a fixture project and change only the one
file it is about:

```ts
await terminal.launch({ template: 'test/fixtures/project', files: { 'config.json': '{}' } });
```

There is no shared fixtures directory on purpose. Files are declared by the test
that needs them, into a directory only that test can see, so no test can depend
on what another one left behind. A path that would escape that directory is
refused rather than written.

## Matchers

All of them are asynchronous — `await expect(...)` — and the locator ones poll
until the `expect` timeout class runs out.

| Matcher | Subject |
|---|---|
| `toBeVisible()` | locator |
| `toBeFocused()` | locator |
| `toHaveState({ disabled: true })` | locator; asserts only the keys you list |
| `toHaveText('Save' \| /Sav/)` | locator (exact, whitespace-normalized) or terminal (substring of the grid) |
| `toMatchSemanticSnapshot(expected?, { within })` | terminal or `SemanticSnapshot` |
| `toMatchCellSnapshot(expected?)` | terminal or `ScreenSnapshot` |

Retrying is what makes them safe right after a *screen* wait. `waitForText()`
returns when the grid shows the text, but the semantic tree for that frame only
becomes observable once its render-commit marker has been paired — including the
first tree after the handshake, where `semanticTree()` is still `null` while
`capabilities().semanticTree` is already true. Every tree-reading matcher polls
through that gap, and a snapshot being written for the first time waits for a
tree rather than storing the absence of one.

### Two keys in one `press()` arrive together

`press('Tab Space')` encodes both chords into a **single** write, so a program
that batches its input handling sees them in one go — the space reaches the
element Tab was leaving, not the one it moved to. When the program has to
re-render between two keys, send them separately and put the assertion in
between:

```ts
await app.press('Tab');
await expect(app.getByRole('list', { name: 'Todos' })).toHaveState({ focused: true });
await app.press('Space');
```

The assertion is not decoration here: it is the wait that lets the program
handle the first key before the second arrives, and it costs nothing extra
because the matcher polls anyway. Several chords in one `press()` are for
sequences the program consumes as a unit, like `'Control+K Control+F'`.

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

- **Names** are compared after whitespace normalization, may be a `/regex/`, and
  may be omitted to match any name.
- **`[flags]`** assert only what they list. `!focused` asserts the opposite,
  `checked=mixed` and `level=2` compare a value. Volatile states
  (`scrollOffset`, `positionInSet`, …) are left out of written snapshots unless
  you ask for `{ states: 'all' }`.
- `'* "Save"'` matches any role. It has to be quoted — a bare `*` opens a YAML
  alias.
- A name containing `#` is written quoted, so the file stays valid YAML.

### Two comparison modes, by source

| Source | How it is compared |
|---|---|
| **inline pattern** — the argument you write in the test | partial: omitted children are don't-care, unlisted siblings are allowed, flags assert only what they list. Listed children keep their relative order. |
| **stored file** — written into `__snapshots__` | strict: the full serialized tree, exact flags. A node or state the app *grew* fails, which is the whole point of checking in a snapshot. |

So an inline pattern is an assertion about the part you care about, and a file
snapshot is a fence around the whole tree. Reach for a pattern in a test about
one behaviour, and for a file when you want to be told about any change at all.

### Patterns start at the root — scope with `within`

Matching is anchored at the tree's roots, and Ink, Textual and OpenTUI apps are
rooted at `application`. A pattern that starts at your dialog therefore does not
match:

```yaml
# Does not match an Ink app: the root is `application`, not `dialog`.
- dialog "Permission" [modal]:
    - button "Approve" [focused]
```

Either spell out the path from the root:

```yaml
- application:
    - dialog "Permission" [modal]:
        - button "Approve" [focused]
```

…or, usually better, scope to the container and assert what is inside it:

```ts
await expect(app).toMatchSemanticSnapshot(
  `
    - button "Approve" [focused]
    - button /^Rej/
  `,
  { within: app.getByRole('dialog') },
);
```

`within` takes a locator, excludes the node itself from the pattern, and is
re-resolved on every attempt — a re-render that mints new node ids does not
invalidate the scope. Use `{ rootId }` instead when you want the node itself to
be the top level of the snapshot.

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
| `TERMWRIGHT_UPDATE_SNAPSHOTS=none`, `--update=none`, or **CI** | never write; a missing snapshot fails |

### Snapshots nobody claims any more

Rename or delete a test and its stored snapshot stays behind. On the first test
of each file the preset compares the file's keys against the tests that file
*declares*, and:

- in `changed` / `all` it removes the orphans;
- in any other mode it leaves them alone and the reporter names them in the
  summary. It never fails the run — an orphaned snapshot is housekeeping, and a
  red run would only teach people to stop renaming tests.

"Declares" is the important word: a test skipped by `describe.skipIf(!pty)` is
still declared, so its snapshots survive on a machine that skips it. Pruning
against the tests that merely *ran* would delete your E2E baselines the first
time CI ran without a pseudo-terminal.

`config.updateSnapshots` overrides all of it. Because a stored snapshot is
compared strictly, `changed` rewrites it on any textual difference — review the
diff the way you would review the code that caused it.

**On CI a missing snapshot fails.** Vitest turns updating off when `CI` is set,
and this preset follows: a baseline that appears during the run would make CI
green by writing the very thing it was supposed to check. Commit snapshots from
a local run instead. A test whose *subject* is writing a snapshot should pin
`updateSnapshots` in its own configuration rather than inherit the environment's.

## Application logs

A program's own log is evidence the screen does not show. Point the session at
a log file, or let an instrumented adapter publish structured records, and the
test can query both the same way:

```ts
test('saves the file', async ({ terminal }) => {
  const app = await terminal.launch({
    command: ['node', 'editor.js'],
    logs: [{ path: 'var/editor.log', label: 'editor' }],
  });

  await app.getByRole('button', { name: 'Save' }).activate();

  await expect(terminal).toHaveLogged({ level: 'info', message: /saved in \d+ms/ });
  expect(terminal.logs.filter({ minLevel: 'warn' })).toEqual([]);
});
```

`terminal.logs` answers `all()`, `filter(query)`, `text(query)` and `clear()`.
A query narrows by `level` (one or several), `minLevel`, `source`
(`'file' | 'adapter'`), `label`, `logger`, `message` (substring or pattern) and
`sessionId`. `text()` renders entries without timestamps, sequence numbers or
revisions, so it is stable enough to put in a snapshot:

```
info starting up
warn storage: disk almost full free=12
[editor] plain line from the file
```

`toHaveLogged` polls like the other matchers, so asserting right after an
action is safe, and it prints the last entries when nothing matched — usually
enough to see why.

A structured record is counted once per session, keyed by its `seq`. The driver
refuses a repeated sequence before it becomes an event, so a duplicate can only
come from this side — `collectLogs` on a harness the fixtures already subscribed
pools the same event twice — and one error reported as two would be a bug in the
counting, not in the program under test. File lines carry no sequence and are
never deduplicated: two identical lines in a log file are two lines.

### An error nobody asserted on fails the test

By default a test that passes while the program logged an `error` fails
anyway. This is the assertion nobody writes: clicking through a flow while the
program logs `error: failed to save` is not a passing test, it is a test that
did not look.

```
The test passed, but the program logged 1 record at level error or above:
  error db: save failed

Assert on them with expect(terminal).toHaveLogged({ level: ... }), or turn the check off:
  for one test:   terminal.failOnLogLevel(false)
  for the suite:  defineTermwrightConfig({ failOnLogLevel: false })
```

When log records never reached the test — dropped by the adapter, or refused
over budget — the failure says how many, because the list it prints is only
what arrived and calling that the whole story would misrepresent the evidence.
`terminal.logs.lostRecords()` exposes the same number. A record the driver
refused as a duplicate is not a loss and is not counted: the record it repeated
did arrive.

Two things this deliberately does not do. It never fails on a **file line**:
a followed file yields text, not levels, and guessing severity from the word
"error" would fail tests over a URL. And it never fires on a test that already
failed — the assertion that failed is the story.

Raise or lower the bar with `failOnLogLevel: 'warn' | 'fatal' | false` in the
config, or per test with `terminal.failOnLogLevel(...)`.

### Logs from a mounted component

For a harness the fixtures did not launch — a `mountInk` component, say —
subscribe yourself and the matcher finds the collection from the harness:

```ts
const app = await mountInk(<App />, { logs: [{ path: 'var/app.log' }] });
collectLogs(app);
await expect(app).toHaveLogged({ source: 'file', message: 'saved' });
```

**A mount does not capture `console.*` by default**, and that default is right:
a mounted component shares the runner's process, so its `console` is literally
Vitest's — capturing it would file the runner's output, and other tests' output,
as the component's log. Follow a file instead, pass
`mountInk(el, { captureConsole: true })` when you accept that attribution, or
use `launchInkFixture`, where the console genuinely belongs to the application.

## When the program dies

A crashed program does not fail a test in any useful way: the assertion that
notices it reports a timeout, and the panic that explains it scrolls past. When
a session the test launched died unexpectedly, the preset appends what the
driver remembers to the failure message:

```
expect(getByRole('dialog')).toBeVisible()

Expected: visible
Received: hidden
Timeout:  5000ms

Process crashed
  exited with code 1 after 812ms
  screen tail (last 15 of 31 lines):
    Error: ENOENT: no such file or directory, open 'config.toml'
        at Object.readFileSync (node:fs:1234:20)
  last input: key "c" at 640ms
  full trace: termwright-report/traces/opens-the-dialog-4-0.twtrace
```

A clean exit is not a crash, and neither is a session the test closed or
signalled — that judgement lives in the driver, so the preset shows a section
only when there is something to explain. The same data reaches the HTML report,
where `@termwright/trace` renders it with the recording.

Treat a crash section like a screenshot: it is the terminal's output verbatim,
so whatever the program printed on its way out — secrets included — is in it.

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

## Building your own fixtures

`test` is Vitest's own `test.extend`, so the way to make a suite terse is to
compose on top of it rather than wait for an option:

```ts
import { test as base, expect } from '@termwright/test';
import type { TerminalHarness } from '@termwright/driver';

const test = base.extend<{ app: TerminalHarness }>({
  app: async ({ terminal }, use) => {
    const app = await terminal.launch({ files: { 'config.json': '{}' } });
    await app.waitForText('ready');
    await use(app);
    // Still inside the terminal fixture: the session is alive here, so a
    // fixture that logs out or asserts a final state can still do it.
  },
});

test('saves on ctrl-s', async ({ app }) => {
  await app.press('Control+s');
  await expect(app).toHaveText('saved');
});
```

The preset's fixtures stay injectable next to yours (`{ app, terminal, step }`),
teardown runs inside-out, and the types flow through — this package pins all
three in `composition.test.ts`.

### Coming from Cypress

| Cypress | Here |
|---|---|
| `cy.fixture('user.json')` and the shared `fixtures/` directory | `launch({ files })` / `launch({ template })`, declared per test into its own directory |
| custom commands (`Cypress.Commands.add`) | a fixture composed with `test.extend`, as above |
| `beforeEach` that logs in | the same, but as a fixture: it also tears down, and only the tests that ask for it pay for it |

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

A test appears in the report when it failed, when it was flaky, or when it kept
a trace — so under `trace: 'on'` every test is there, with its recording, its
logs and its steps, collapsed until you open it. Under `retain-on-failure`
(the default) only the failures kept a trace, so only they appear.

The reporter runs in Vitest's main process, while `configureTermwright` usually
runs in a `setupFiles` module, which is a worker. It therefore does not see
your `outputDir`: pass `outFile` to the reporter, or call `configureTermwright`
from `vitest.config.ts` as well.

Import the reporter from `@termwright/test/reporter`, never from the package
root: `vitest.config.ts` is loaded before the test runner exists, and the root
module registers matchers on `expect` as a side effect.

## Development

```sh
pnpm build && pnpm typecheck && pnpm test
```

The end-to-end suite drives the driver's semantic fixture over a real PTY and
guards itself with the same `ptyAvailable()` this package exports
(`TERMWRIGHT_SKIP_PTY=1` skips it explicitly).
