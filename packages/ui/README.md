# @termwright/ui

The interactive runner for [termwright](https://github.com/gorce-ai/termwright): a
local server and a browser app with a live terminal, a semantic inspector and a
timeline you can scrub — DevTools for a terminal program, and a recorder that
turns what you do in it into a test.

Three panes, two data sources:

| Pane | What it shows |
|---|---|
| Terminal | xterm.js fed by `output` messages, with semantic bounds drawn on top |
| Inspector | the accessibility tree, hover to highlight, click to generate a selector |
| Timeline | tests and steps live; a scrubber with marker jumps in post-mortem |

**Live** mode watches a Vitest run through a reporter. **Post-mortem** mode opens
a `.twtrace` archive from CI and lets you move through it in time. **Record**
mode owns the PTY itself: you type in the browser, and the server writes the
test.

## Install

```sh
pnpm add -D @termwright/ui
```

Requires Node >= 22. ESM only.

## Run it

The CLI in the `termwright` umbrella is how you open this:

```sh
pnpm exec termwright ui                                  # watch a run
pnpm exec termwright ui --trace out/login.twtrace        # open a recording
```

It prints the URL and waits — nothing opens a browser for you, and the token in
that URL is what authenticates the session, so copy the whole thing:

```
termwright ui (live) — http://127.0.0.1:53219/?token=k3n…
```

`--port` pins the port (the default is ephemeral), `--host` binds elsewhere,
`--no-watch` opens the runner without starting a suite, and `--json` prints
`{url, port, mode}` instead of that line.

## Usage as a library

```ts
import { startUiServer } from '@termwright/ui';

// Watch a run. Point the reporter at the printed URL.
const server = await startUiServer();
console.log(server.url); // http://127.0.0.1:53219/?token=…

// Open an archive from CI and scrub through it.
const viewer = await startUiServer({ trace: 'out/login.twtrace' });

// Record: the server launches the program, the browser is its terminal.
const recorder = await startUiServer({
  record: { command: ['node', 'agent.js'], outFile: 'src/recorded.test.ts' },
});
```

The live mode needs the reporter in the test process:

```ts
// vitest.config.ts
import TermwrightUiReporter from '@termwright/ui/reporter';

export default defineConfig({
  test: { reporters: ['default', new TermwrightUiReporter()] },
});
```

It publishes to `process.env.TERMWRIGHT_UI_URL`, which `termwright ui` sets, and
does nothing at all when that variable is unset — safe to leave configured in a
repository whose runs are mostly headless.

The protocol has exactly one producer generation: every field `§UI events`
lists is required unless the contract marks it optional, and a message missing
one is rejected rather than patched up. Anything speaking this protocol has to
send complete messages.

## The protocol

The socket speaks `§UI events` from [`/CONTRACTS.md`](../../CONTRACTS.md), and
only that: `run-start`, `test-start`, `step`, `output`, `semantic`, `test-end`,
`run-end` from the server; `rerun`, `stop`, `pick`, `input` from the browser.
Everything that is state rather than an event — the session list, a moment on a
trace's timeline, the recorder's generated source — is an HTTP call under
`/api/`, so the normative protocol stays exactly the size the contract says it
is. The browser app never imports Vitest and never reads a `.twtrace` itself.

## Accessibility

The semantic tree is an ARIA-aligned model, so the UI renders it as ARIA rather
than as a picture of it. The inspector is a real `role="tree"`: rows are
`treeitem`s with `aria-level`, `aria-expanded` and `aria-selected`, a roving
`tabindex`, and the arrow keys of the ARIA tree pattern — Up/Down walk visible
rows, Right opens a node and steps in, Left closes it and steps out, Enter hands
focus back to the terminal.

The **Semantic view** tab goes further: it renders the *application's* tree as
accessible HTML. A terminal `button` becomes a `<button>`, a modal `dialog`
becomes `role="dialog" aria-modal="true"`, a `list` becomes `<ul role="list">`,
and state becomes the matching attributes — `aria-disabled`, `aria-checked`
(including `mixed`), `aria-expanded`, `aria-level`, `aria-posinset`. A screen
reader walking that view is reading what the application published, which is
something a terminal emulator cannot offer at all.

One rule keeps it honest: an attribute is emitted only where ARIA gives it
meaning. `aria-selected` on a `listitem` would be ignored, so a selected list
item gets `aria-current` instead. Nothing in this view acts on the application —
activating an element selects its node, exactly like clicking it in the tree.

## Run history

Every run writes a small manifest under `.termwright/runs/<timestamp>/` — its
counters, its tests, and the path of the archive each test left behind. The
**Runs** tab lists them newest first; opening one shows its tests, and clicking
a test replays its archive in place, with the same terminal, command log,
inspector and timeline as `--trace` gives you.

Manifests hold paths, not archives: the traces are already where the fixtures
wrote them, and copying them would double the size of a CI artifact for nothing.
A test whose archive was not retained says so rather than offering a replay that
would fail.

## Watching a replay

A recording plays like a video: **Play/Pause** (or the space bar) runs it at the
recording's own pace, with 0.5×/1×/2×/4× on the speed button. Frames carry their
real timestamps, so a test that waited on a spinner plays back exactly as long
as it actually waited — minus the idle the writer trimmed at record time. The
terminal, the command log, the inspector and the log panel all follow the clock;
the scrubber is still there for jumping.

The **Commands** tab is the command log: every step, driver action and assertion
the test made, nested under its step, with the selector it used and whether it
passed. The row currently playing is highlighted and scrolled into view;
clicking a row moves the replay to that moment, and — when the recorded action
carried a resolved `ref` — lights up the node it targeted. The arrow keys walk
action by action.

## The test list

Opening the runner shows **every test the project has**, not only the ones a run
has reached: the server asks Vitest (`vitest list --json`) at startup and again
when files change, and the tests it finds appear as *not run yet*. Clicking one
runs it. When a run reaches a discovered test, the row becomes that test rather
than a second copy of it — discovery names tests by file and title, the run by
its own id, and the two are reconciled on the first.


The bottom pane is the run: every reported test, grouped by file, with its
status, how long it took, and a `flaky` badge for the ones that only passed on a
retry. A running test shows the time it has been running — the number you watch
when a suite hangs. The toolbar carries a substring filter over titles and
paths, the pass/fail/flaky/skipped counters, and Rerun all / Stop.

Clicking a test focuses it: its steps and its failure message open underneath,
and — when the producer reported which session the test drives — the terminal
switches to that session. Each row has its own rerun button, which sends
`rerun { testIds: [id] }` and leaves the rest of the suite alone.

## What the program said

A TUI cannot print diagnostics to its own screen without corrupting the render,
so the useful half of what a terminal program has to say never appears in the
terminal. The **Logs** tab shows it: lines from files the session follows
(`launch({ logs: [...] })`) and structured records from an instrumented adapter,
with a level filter and a Follow toggle that switches itself off the moment you
scroll up.

The panel holds a window of the log rather than all of it: scrolling to the top
pulls in the entries before it, and moving the replay refetches around the new
moment. A recording with a hundred thousand log lines costs the same as one with
two hundred.

Warn, error and fatal records also mark the timeline. Clicking a mark jumps
there — in a replay it moves the terminal, the inspector and the log panel to
that moment; the strip always shows the whole recording, because "jump to the
error" is what you want *before* you have scrubbed near it.

A followed file line carries **no level**: severity is never inferred from the
text of a line, so a log that happens to contain the word `ERROR` produces no
false mark. Unleveled lines are always shown, whatever the filter is set to.

## When the program died on its own

If the archive carries a crash section (`meta.crash`, written by
`@termwright/trace` when the recorded program dies on a signal or an unasked-for
non-zero exit), the timeline gets a red marker at that moment and a panel with
the cause, the screen the terminal ended on, the last inputs and the session
diagnostics — the same content, in the same order, as the crash section of the
HTML report. Clicking the marker (or the panel's jump button) moves the terminal
and the inspector to that instant.

The screen tail is shown behind the same warning the report uses: **it is not
redacted**. It is what the terminal displayed, secrets included. Treat an
archive — and this view of it — like a screenshot.

The section is validated as external data: an archive whose crash block is
malformed loses the panel and the marker, not the rest of the recording.

## Time travel

Scrubbing asks the server for the state at a millisecond, which comes from
`openTrace().stateAt()` in `@termwright/trace`: the cast prefix to replay into a
fresh terminal, the viewport after every resize up to that point, and the newest
semantic tree at or before it. Step boundaries and semantic revisions are the
markers the jump buttons snap to.

## Selectors and codegen

Clicking a node generates the **narrowest** selector that still resolves to it:

1. `getByTestId('save')` — an author-supplied id is a promise of stability;
2. `getByRole('button', { name: 'Save' })` when the pair is unique;
3. the same, scoped `.within(getByRole('dialog', { name: 'Permission' }))`;
4. `getByText(...)` for nodes with no role-name identity;
5. `.nth(i)` last, and marked as fragile when there was nothing else to key on.

The recorder uses the same generator, so the selector you copied is the one the
generated test contains. Keystrokes are decoded back into `press('ArrowDown')`
and `type('ls -la')` rather than raw bytes; a bracketed paste becomes `paste()`;
anything unrecognised is kept as `write(Buffer.from(…, 'base64'))` rather than
guessed at. "Assert here" writes `toMatchSemanticSnapshot()`, which the test
preset fills in on the first run.

```ts
// Generated by `termwright ui` (recorder). Review before committing: …
import { expect, test } from '@termwright/test';

test('approves the command', async ({ terminal }) => {
  const app = await terminal.launch({ command: ['node', 'agent.js'] });

  await app.waitForText('Permission required');
  await app.getByRole('button', { name: 'Approve' }).click();
  await expect(app).toMatchSemanticSnapshot();
});
```

## Getting around

The panel is two panes over a terminal, with draggable splits that stay where
you left them — drag them, or focus one and use the arrow keys. `?` lists the
keyboard shortcuts: space plays and pauses a replay, the arrows walk actions or
the semantic tree, and `Enter` hands focus from the tree back to the terminal.

The theme button cycles system → dark → light; the terminal itself stays on the
colours the recorded program used, because those are the program's, not the
panel's. Status is never carried by colour alone: every result has a glyph
(`✓ ✕ ◍ ○`) beside it.

## Security

The server binds to loopback and mints an unguessable token per launch; the URL
it prints carries it. A live terminal is a shell, so the token is required on
every request, on the WebSocket upgrade, and (as a `SameSite=Strict`, `HttpOnly`
cookie set on the app page) on the bundle the page loads for itself. Frames,
request bodies, the replay backlog and the input decoder's buffer are all
bounded; the hostile-input suite runs under `node --max-old-space-size=128`.

## Development

```sh
pnpm build && pnpm typecheck && pnpm test
```

`pnpm build` compiles the server with tsup and the browser app with Vite into
`dist/app`, which the server serves. The bundle is self-contained: no CDN, no
network requests at runtime.

Implementation decisions and open threads: [`NOTES.md`](./NOTES.md).
