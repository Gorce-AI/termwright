# @termwright/ui

The interactive runner for [termwright](https://github.com/gorce-ai/termwright): a
local server and a browser app with a live terminal, a semantic inspector and a
timeline you can scrub — DevTools for a terminal program, and a recorder that
turns what you do in it into a test.

One app, four views and three data sources:

| View | What it shows |
|---|---|
| Specs | the project tree, history dots, duration, filtering and Run/Stop controls |
| Runner | one execution rail on the left; terminal, inspector, semantic view, logs and timeline on the right |
| Runs | retained run manifests and per-test trace replay |
| Settings | local workspace, replay, motion and source-editor preferences plus sanitized diagnostics |

**Live** mode combines Vitest lifecycle from a reporter with terminal events
from the worker-side live bridge. **Post-mortem** mode opens a `.twtrace`
archive from CI and lets you move through it in time. **Record** mode owns the
PTY itself: you type in the browser, and the server writes the test.

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

It opens the page in your browser and waits. The token in that URL is what
authenticates the session, so if nothing opens — a machine with no browser, or
`--no-open` — copy the whole line, token included:

```
termwright ui (live) — http://127.0.0.1:53219/?token=k3n…
```

`--port` pins the port (the default is ephemeral), `--host` binds elsewhere,
`--no-watch` opens the runner without starting a suite, `--no-open` prints the
URL without opening anything, and `--json` prints `{url, port, mode}` instead of
that line. `--json`, a piped stdout and `CI` in the environment each suppress
opening on their own: a browser window is for a person at a terminal.

## A report you can attach to a build

```ts
import { writeInlineReport } from '@termwright/ui';

const { bytes, cut } = await writeInlineReport('out/login.twtrace', 'report.html');
```

The result is one HTML file — the same viewer, the same panes, the archive and
imported assets such as the SVG Termwright mark inlined — that opens over
`file://` with nothing to fetch. The SVG stays a reusable source asset; Vite
only converts it to inline data in the built viewer. The report replays, scrubs,
shows the command log and the application log, and hides what it cannot do: no
run history, no rerun, no live terminal. A fixture recording emits at roughly
400 KiB.

`budgetBytes` (default 8 MiB) bounds the embedded archive. Frames are cut from
the end of the recording and log records from the oldest end; the page says so
in both cases, and `cut` tells the caller how much went.

## Usage as a library

```ts
import { startUiServer } from '@termwright/ui';

// Watch a run. Point a producer at the tokenised URL printed below.
const server = await startUiServer();
console.log(server.url); // http://127.0.0.1:53219/?token=…

// Open an archive from CI and scrub through it.
const viewer = await startUiServer({ trace: 'out/login.twtrace' });

// Record: the server launches the program, the browser is its terminal.
const recorder = await startUiServer({
  record: { command: ['node', 'agent.js'], outFile: 'src/recorded.test.ts' },
});
```

`termwright ui` injects the UI reporter into the Vitest process it starts, so
the CLI path needs no `vitest.config.ts` change. A server started directly as a
library has no process launcher; pass `server.url` to the test process as
`TERMWRIGHT_UI_URL` and point a reporter at it yourself:

```ts
// vitest.config.ts
import TermwrightUiReporter from '@termwright/ui/reporter';

export default defineConfig({
  test: { reporters: ['default', new TermwrightUiReporter()] },
});
```

It publishes to `process.env.TERMWRIGHT_UI_URL`, which `termwright ui` sets, and
does nothing at all when that variable is unset — safe to leave configured in a
repository whose runs are mostly headless. Vitest's `--reporter` option replaces
configured reporters, so the CLI supplies both `default` and the UI reporter;
pass any additional reporter explicitly after `--` when the UI-driven run also
needs it.

`@termwright/test` automatically opens the second producer connection for each
fixture session. It streams the real PTY output, semantic revisions, actions and
application logs, then closes the bridge before fixture teardown. A custom
session owner can use that public Node-only boundary directly:

```ts
import {connectLiveSession} from '@termwright/ui/live-client';

const live = connectLiveSession(harness, {testId});
try {
  // Drive the TerminalHarness normally.
} finally {
  await live.close();
}
```

No URL means no socket and no listeners. Invalid URLs, connection failure and
teardown failure are fail-open: losing an observer never changes the test
result. Events held during the handshake use a bounded queue.

The protocol has exactly one producer generation: every field `§UI events`
lists is required unless the contract marks it optional, and a message missing
one is rejected rather than patched up. Anything speaking this protocol has to
send complete messages.

## The protocol

The socket speaks `§UI events` from [`/CONTRACTS.md`](../../CONTRACTS.md), and
only that: `tests-discovered`, `run-start`, `session`, `test-start`, `step`,
`output`, `semantic`, `app-log`, `action-start`, `action`, `test-end`, `run-end`,
`run-cancelled`, `run-cancel-failed`, `actionability-inspection` from the
server; `rerun`, `stop`, `pick`, `input`, `inspect-actionability` from the
browser. Actionability inspection is a request-scoped live RPC: the session
owner evaluates click/hover/focus/type with the same production ActionPlanner
and committed checkpoint used by real actions. The browser never infers an
answer from geometry, semantic fields, or an earlier trace event.
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

That replay is pinned to the run and test you chose. A watcher can begin another
run while you inspect it; the live catalogue keeps updating in the background,
but the historical title, result, scrubber and terminal stay on that archive
until you navigate back to live work. Replays are contextual to a browser tab,
so two tabs can inspect different archives without retargeting each other.

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

The **Commands** tab is the command log. A foldable **Test body** root keeps the
shape explicit: authored steps nest underneath it and can be folded in turn;
driver actions and assertions remain in execution order, under their step when
one owns them. The row currently playing is highlighted and scrolled into view
until you use the wheel to inspect another part of the evidence. Clicking a row
moves the replay to that moment and — when the recorded action carried a
resolved `ref` — lights up the node it targeted. The command pane scrolls on
both axes, so a long selector or failure is available in full instead of being
clipped. The arrow keys walk action by action.

During a live run, a driver action appears when it starts, with an active
progress line, rather than only after its timeout or result. Its correlated
completion settles that same row with the resolved target or error; it never
creates a second command that merely looks like a duplicate.

## The test list

The **Specs** view shows every test the project has, not only the ones a run has
reached, provided it belongs to a Termwright test provider. The CLI collects
Vitest's public test model at startup and again when files change, then keeps
only cases carrying the versioned declaration marker written by
`@termwright/test`. The UI-owned runner independently skips unmarked cases, so
a plain Vitest sibling in the same physical file is neither catalogued nor
executed by Run all, directory, file or case actions. Ordinary Vitest commands
remain unchanged. Even a foreign `test.only` cannot suppress marked cases in
the UI-owned process; outside the UI, Vitest keeps its normal `.only` behavior.
The marker is an extension point for future providers; it is not a claim that
another provider ships today. Directories nest, search filters titles and
paths, and a row that has not run yet says so. Directories and files
start collapsed; result updates never unfold or refold a branch the user chose.
Every directory and file shows the same compact passed, failed, running and
not-run breakdown. Run all and Stop live in the same toolbar.

The **Runner** view uses one execution rail on the left. Its fixed toolbar stays
above the current run's cases, and the selected case expands its **Test body**,
steps and commands inline in the same scroll. Status, elapsed time, failures and
per-test rerun stay with the case; a context bar below keeps the selected source
and session controls available. The right side holds the terminal and its
fixed-size cell grid, a `Fit · N%` badge for the uniform visual scale, playback,
tree, semantic view and logs. Dragging the horizontal split changes how much
room the terminal gets; it scales the whole grid rather than resizing the
application.

The primary navigation and this execution rail are the first greenfield React
slices, styled with Tailwind and using Lucide icons. That migration is in
progress, not a completed renderer rewrite: terminal, playback, inspection and
the remaining views continue through the established renderer while the new
slices are validated against the same browser fixtures.

Clicking a test focuses the session it owns. If one current attempt launched
more than one terminal, a **Screen** selector appears in the command header with
descriptive framework and grid-size labels. A single session has no redundant
selector. Starting the next run drops old test-bound sessions and selects the
new attempt's session automatically; generic/manual sessions remain attached.

While the selected case is running, the playback strip says **LIVE** and shows
the current screen. If that case finishes with a retained recording while it is
still selected in Runner, the same panel immediately becomes the replay player
— title, test row and context stay put; the scrubber replaces the dead live
surface without waiting for the rest of the suite. A completed case that was
not selected still offers **Open recording** when you choose it.

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

Runner has two resizable columns and a horizontal split between the terminal
surface and inspector. Compact viewports stack the columns and let the whole
terminal/inspector pane scroll instead of hiding its lower controls. Both
splitters work with a pointer or, while focused, the arrow keys, and remember
where you left them. `?` lists the keyboard shortcuts: space plays and pauses a
replay, the arrows walk actions or the semantic tree, and `Enter` hands focus
from the tree back to the terminal.

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
