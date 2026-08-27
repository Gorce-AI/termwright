# @termwright/test

The authoring API used by Termwright's native test host: a `terminal` fixture
that owns real PTY sessions, event-driven matchers, and **semantic YAML
snapshots** — the accessibility tree of a terminal app in a reviewable form.
Vitest supplies the DSL, transforms, mocks and assertions inside that host;
direct Vitest/Jest/node:test execution is not a Termwright product mode.

`termwright test`, `termwright watch` and `termwright ui` all use the same exact
runner and persistent host. Native collected IDs, not file/title strings,
identify `.each`, duplicate-title, repeat and retry attempts. Each real try has
an AttemptContext, total budget, journal producer and host resource leases.

Tests which need more than one terminal declare the complete group on the test
itself. The Native Host atomically admits that group before fixtures run and
before the Attempt budget starts, so two-terminal tests cannot deadlock after
holding only their first lease:

```ts
test.resources({ terminals: 2 })('client and server interoperate', async ({ terminal }) => {
  const [client, server] = await Promise.all([
    terminal.launch({ command: ['node', 'client.js'] }),
    terminal.launch({ command: ['node', 'server.js'] }),
  ]);
  // ...
});
```

Each declared terminal reserves one PTY, external process, semantic endpoint,
one native-host pressure unit, and—unless `traceWriters` is explicitly set—one trace writer. Exceeding the
declared group fails instead of silently falling back to another queue. Because
that condition is detected exactly, the error reports the declared, currently
allocated and newly requested counts and shows the minimum
`test.resources({ terminals: N })` declaration needed for intentional
concurrent ownership.

Native transport certification may reserve `nativeHost: 'exclusive'`, the full
host-pressure envelope, while still declaring its actual terminal count. This
keeps high-volume output and process-tree tests exclusive without pretending
that they own terminals they never create.

Host-intensive tests which do not launch a terminal, such as compiler or
toolchain integration tests, reserve the same envelope directly:

```ts
test.resources({ hostPressure: 'exclusive' })('builds through the real toolchain', async () => {
  // ...
});
```

`hostPressure` composes with a real `terminals` count when both the toolchain
and PTY are part of one test. It is intentionally exclusive-only; use
`nativeHost` for native transport certification.

## Install

```sh
pnpm add -D termwright @termwright/test vitest@4.1.11
```

Requires a certified Node LTS line and exact Vitest 4.1.11. ESM only. Run with
`termwright test`; the exact pin is an engine certification surface, not a broad
peer-compatibility promise.

## Usage

```ts
import { fileURLToPath } from 'node:url';
import { test, expect } from '@termwright/test';

const agent = fileURLToPath(new URL('../agent.js', import.meta.url));

test('asks before running a command', async ({ terminal, step }) => {
  const app = await terminal.launch({ command: [process.execPath, agent] });
  await app.waitForText('Permission required');

  await step('approve', async () => {
    await app.press('Enter');
  });

  await expect(app).toHaveText('running: ls -la');
});
```

This generic path works without a semantic integration. Use semantic locators
and visibility matchers only when the selected framework integration publishes
the required evidence.

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
import { fileURLToPath } from 'node:url';
import { describe } from 'vitest';
import { ptyAvailable, test, expect } from '@termwright/test';

const pty = await ptyAvailable();
const appPath = fileURLToPath(new URL('../app.js', import.meta.url));

describe.skipIf(!pty)('the app', () => {
  test('starts', async ({ terminal }) => {
    const app = await terminal.launch({ command: [process.execPath, appPath] });
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

test.override({ termwrightOptions: { columns: 120, trace: 'on' } });

describe('the wide layout', () => {
  test.override({ termwrightOptions: { columns: 200 } });
  // …tests here get 200 columns; the rest of the file gets 120.
});
```

Scopeable: `command`, `columns`, `rows`, `env`, `timeouts`, `trace`,
`failOnLogLevel`. They sit between the project configuration and the `launch()`
call:

```
defineTermwrightConfig()  <  test.override({ termwrightOptions })  <  terminal.launch({ … })
```

The merge is **key by key**, which matters more than it sounds: `test.override`
replaces a fixture's whole value, so overriding only `trace` would drop the
project's viewport and environment if the value were taken as-is. `env` and
`timeouts` merge entry by entry too — overriding one variable or one timeout class
keeps the others. `command` is the exception: an argv is replaced wholly, never
concatenated.

## Files the program starts with

Declare files the application needs on the launch. They exist in the test's
private directory — which is also the program's `cwd` — before it starts:

```ts
import { fileURLToPath } from 'node:url';

const editorPath = fileURLToPath(new URL('../editor.js', import.meta.url));

const app = await terminal.launch({
  command: [process.execPath, editorPath],
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
| `toHaveExtendedState({ deploymentStatus: 'ready' })` | locator; recursively compares only the top-level domain keys you list |
| `toHaveText('Save' \| /Sav/)` | locator (exact, whitespace-normalized) or terminal (substring of the grid) |
| `toMatchSemanticSnapshot(expected?, { within })` | terminal or `SemanticSnapshot` |
| `toMatchCellSnapshot(expected?)` | terminal or `ScreenSnapshot` |

Retrying is what makes them safe right after a *screen* wait. `waitForText()`
returns when the grid shows the text, but the semantic tree for that frame only
becomes observable once its render-commit marker has been paired — including the
first tree after the handshake, where `semanticTree()` is still `null` while
the contract negotiation is pending. Every tree-reading matcher waits
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

Portable widget state and application state are deliberately different
assertions:

```ts
await expect(app.getByTestId('deploy-row')).toHaveExtendedState({
  deploymentStatus: 'rolling-out',
  rollout: { regions: ['eu', 'us'], progress: 0.5 },
});
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
- in any other mode it leaves them alone and the host records them in the run
  diagnostics. It never fails the run — an orphaned snapshot is housekeeping, and a
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
import { fileURLToPath } from 'node:url';

const editorPath = fileURLToPath(new URL('../editor.js', import.meta.url));

test('saves the file', async ({ terminal }) => {
  const app = await terminal.launch({
    command: [process.execPath, editorPath],
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
as the component's log. Follow a file instead, or use `launchInkFixture` when
process-owned console behavior is genuinely part of the application under test.

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
import { fileURLToPath } from 'node:url';
import { defineTermwrightConfig, XTERM_PALETTE } from '@termwright/test';

const appPath = fileURLToPath(new URL('./app.js', import.meta.url));

export default defineTermwrightConfig({
  columns: 100,
  rows: 30,
  command: [process.execPath, appPath],
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

## Diagnostic retries and reports

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { termwrightRetry } from '@termwright/test/config';

export default defineConfig({
  test: {
    setupFiles: ['./vitest.setup.ts'],
    retry: termwrightRetry({ ci: 0, local: 0 }),
  },
});
```

`termwrightRetry` returns the retry value consumed by Termwright's embedded
Vitest engine; it does not rerun the whole suite. `TERMWRIGHT_RETRIES` means
additional diagnostic attempts (`2` means at most three total attempts).
Keep the checked-in certifying configuration at zero; enable a non-zero value
only for an explicit diagnostic run.
Product execution always goes through `termwright test`. If `-- --retry=2` is
used as a diagnostic experiment, attempts retain their distinct identities,
journals and resources; fail-then-pass is classified `flaky` and remains a
non-zero certification result.

`termwright test`, `termwright watch` and `termwright ui` load the project’s
Vitest/Vite configuration inside the certified native host. Optional human or
HTML reporters configured there are composed with Termwright’s structured
projection; they never own RunId, attempt identity or canonical persistence.
The host transaction persists attempts and retained traces. Use `termwright
report --trace …` for an explicit standalone HTML projection.

## Development

```sh
pnpm build && pnpm typecheck && pnpm test
```

The end-to-end suite drives the driver's semantic fixture over a real PTY and
guards itself with the same `ptyAvailable()` this package exports
(`TERMWRIGHT_SKIP_PTY=1` skips it explicitly).
