---
title: Runner UI
description: A live terminal, a semantic inspector and a timeline you can scrub — plus a recorder that writes the test for you.
---

`@termwright/ui` is a local server and a browser app: DevTools for a terminal
program. Four views behind a sidebar, which shows the project and the git branch
you are on.

| View | What it is for |
|---|---|
| **Specs** | the project's test files as a tree — what exists, when it last ran, how it has been doing |
| **Runner** | one run: the command log on the left, the terminal and its playback on the right |
| **Runs** | finished runs as cards, each with the commit it ran against |
| **Settings** | the resolved configuration, read-only, with the source of every value |

The sidebar only offers what the source can answer: a standalone
[report file](#sending-someone-a-failure-without-a-server) has no Runs entry,
because a single archive is not a history.

Three ways to arrive:

- **Live** — watches a Vitest run through a reporter.
- **Post-mortem** — opens a `.twtrace` from CI and lets you move through it in
  time.
- **Record** — the server owns the pty: you type in the browser, and it writes
  the test.

```sh
npm install --save-dev @termwright/ui
```

The `termwright` umbrella already depends on it, so if you installed that, the
runner is there too.

## Run it

```sh
npx termwright ui
```

That starts your project's Vitest in watch mode, points it at the runner, prints
the URL and opens it in your browser:

```
termwright ui (live) — http://127.0.0.1:53219/?token=k3n…
```

Open a recording from CI instead of watching a suite:

```sh
npx termwright ui --trace termwright-report/login.twtrace
```

| Flag | Effect |
|---|---|
| `--trace <file>` | post-mortem: open a `.twtrace` archive instead of watching a run |
| `--record -- <command>` | record mode: the server owns the pty and writes the test |
| `--port N` | pin the port. Default: an ephemeral one, printed in the URL |
| `--host H` | bind somewhere other than `127.0.0.1` — a live terminal is a shell, so mind what you expose |
| `--no-watch` | open the runner without starting a suite |
| `--no-open` | print the URL without opening a browser |
| `--json` | print `{url, port, mode}` instead of the human line |

Arguments after `--` go to the runner: `termwright ui -- src/login.test.ts
--reporter=dot`.

### When it does not open a window

Opening is an extra on top of the printed URL, never a substitute, and it is
skipped wherever a window would be wrong: with `--no-open`, with `--json` (a
consumer is parsing that output), when stdout is not a terminal (you piped it),
and when `CI` is set to anything at all. On a build agent a browser is noise at
best and a hung job at worst.

`CI=false` also suppresses it. Nobody sets that variable to say "this is not
CI", and agents only ever set it to `true`, so any value is treated as a signal.

If the opener itself fails — no browser installed, a headless box — you get one
line on stderr and the URL still stands. Nothing about the session depends on a
window having appeared.

:::caution[The token is part of the URL]
It is what authenticates the session, so when you copy the address by hand, copy
the whole thing — the host and port alone will be refused.
:::

In a workspace, prefer a package script (`"ui": "termwright ui"`, then
`npm run ui`) or `pnpm exec termwright ui`. `npx` can resolve a different copy
than the one your project installed.

## Live mode

Live mode needs the reporter in the test process:

```ts
// vitest.config.ts
import TermwrightUiReporter from 'termwright/ui-reporter';

export default defineConfig({
  test: {reporters: ['default', new TermwrightUiReporter()]},
});
```

(`@termwright/ui/reporter` is the same reporter, for projects using the
individual packages rather than the umbrella.)

It publishes to `process.env.TERMWRIGHT_UI_URL` and does nothing at all when
that variable is unset — safe to leave configured in a repository whose runs are
mostly headless.

```ts
import {startUiServer} from '@termwright/ui';

const server = await startUiServer();
console.log(server.url); // http://127.0.0.1:53219/?token=…
```

## Specs: the project, before anything runs

The Specs view is a file explorer for your tests, populated as soon as the
runner opens rather than filling in as results arrive. Directories nest, and
each row carries what history knows about it:

| Column | What it tells you |
|---|---|
| Last updated | when the file changed |
| Latest runs | four dots, newest first — click one to open that run |
| Average duration | how long it usually takes |

Search filters the tree and counts what matched. Hovering a directory offers
**Run N tests**; a test nobody has run yet shows as **not run yet**, and
clicking one runs exactly that test.

Listing happens in live mode only — a replayed archive and a recording already
know what they contain, so a list of the project's tests would mean nothing
there. Re-listing follows watch mode, which is when files change: with
`--no-watch` you get one listing at startup and that is it.

## Runner: the command log beside the terminal

The Runner view is two panels. On the left, the command log for the test being
watched — every action the driver took, with the test's name and its counters
above. On the right, the terminal, a meta bar reading its dimensions and current
semantic revision, and the playback track underneath.

**Hovering a command highlights its target in the terminal, without moving
playback.** That is worth calling out, because it is the thing a semantic tree
makes possible and a DOM inspector cannot match here: the command knows which
*node* it addressed, so the highlight lands on the right cells even after the
screen has been repainted around them. You can read down the command log and
watch each action light up where it happened, with the recording standing still.

The right-hand panel also carries the tabs for the accessibility **tree**, the
**semantic view**, and [application **logs**](../app-logs/). The tree is a real
ARIA tree, navigable by keyboard — see
[Accessibility](../../reference/accessibility/).

A crash panel appears above the panels when the session died on its own, with a
button that seeks to the moment it happened.

## Runs: what happened, and against which commit

Finished runs are written to `.termwright/runs` and the runner reads them back,
so a failure you saw yesterday is still there today. The Runs view shows them as
cards carrying the commit each ran against — hash, message, author, branch —
which is what turns "it broke sometime last week" into a range you can bisect.
A run recorded outside a repository says **no commit recorded** rather than
leaving the space blank.

Open a card and you get its tests with their statuses; clicking a test that
retained an archive opens that recording in the panels.

Two things the list is careful about:

- **Flaky is not passed.** A test that only passed after a retry is counted
  separately, because burying it in the pass count is how it stays broken.
- **"Logs incomplete" sits next to a result, not instead of one.** When a test's
  [application log](../app-logs/) lost records — dropped by the adapter, or
  refused over budget — the row says so while still showing whether the test
  passed or failed. The two facts are independent, and a warning that replaced
  the verdict would hide the more important one.

The manifest format is versioned, and a run written by an older format is
ignored rather than guessed at. If your history looks empty after an upgrade,
that is why — `.termwright/runs` can be deleted safely.

## Settings, and opening a file where you work

The Settings view is **read-only**, and it names the source of every value —
whether a setting came from `termwright.config.ts`, an environment variable or a
default. A configuration screen that let you change things the config file also
sets would be two sources of truth for one number; showing where each value came
from answers the question people actually have, which is "why is it this?".

Where a file path appears, **Open in IDE** offers VS Code, Insiders, Cursor,
WebStorm, Zed, or copying the path. The path goes to the clipboard either way:
a URL scheme cannot report whether anything caught it, so the fallback happens
unconditionally rather than after a handler that may have silently done nothing.

## Post-mortem: time travel

```ts
const viewer = await startUiServer({trace: 'out/login.twtrace'});
```

Scrubbing asks the server for the state at a millisecond, which comes from
`openTrace().stateAt()`: the cast prefix to replay into a fresh terminal, the
viewport after every resize up to that point, and the newest semantic tree at or
before it. Step boundaries and semantic revisions are the markers the jump
buttons snap to — which is what makes "show me the frame where the button went
disabled" a click rather than an archaeology session.

## Sending someone a failure, without a server

```sh
termwright report --trace out/login.twtrace --out-file report.html
```

That writes **one HTML file** you can open from disk: the same viewer, with the
bundle, the stylesheet and the recording inlined. No server, no network
requests, nothing to install — attach it to a CI job, drop it in a ticket, mail
it. A typical archive lands around 400 KiB.

`--json` prints `{path, bytes, cut}` for a script to read.

Because everything is inlined, a very large archive would produce a file no
browser enjoys. There is a budget — 8 MiB by default — and when it bites, the
CLI says exactly what was left out:

```
  the recording is cut: 214 frames left out to fit the budget
  the log is cut: the 1200 oldest records left out to fit the budget
```

The page says the same rather than quietly showing less: a **recording cut**
marker sits by the clock, and the log panel carries its own notice. A truncated
artifact that looks complete is the one thing worse than a large file.

:::note[Not the same as the HTML failure report]
[`@termwright/trace`](../traces/) generates a report *about a failure*: the
visual and semantic diff around the step that broke, for one test.
`termwright report` emits the *whole viewer* over one archive — scrubbing, the
inspector, the log and command panels. Use the first to see what changed, the
second to explore what happened.
:::

## Recorder and codegen

Recording is a flow inside the panel, not a separate mode you have to launch
into. **New spec** asks for the command and the file to write, records in the
same instance — with a REC indicator while it runs — and on stop shows you the
generated test with save, copy or discard.

**Nothing reaches disk before you press Save.** A recorder that wrote as it went
would leave half-finished specs behind every time someone changed their mind,
and the review step is the point at which a recording becomes a test worth
keeping.

`termwright ui --record -- <command>` still works and lands in the same flow, as
a deep link for when you already know what you want to record. So does
`termwright codegen`, and the library entry point:

```ts
const recorder = await startUiServer({
  record: {command: ['node', 'agent.js'], outFile: 'src/recorded.test.ts'},
});
```

Clicking a node generates the **narrowest** selector that still resolves to it:

1. `getByTestId('save')` — an author-supplied id is a promise of stability;
2. `getByRole('button', {name: 'Save'})` when the pair is unique;
3. the same, scoped `.within(getByRole('dialog', {name: 'Permission'}))`;
4. `getByText(...)` for nodes with no role-name identity;
5. `.nth(i)` last, and marked as fragile when there was nothing else to key on.

The recorder uses the same generator, so the selector you copied out of the
inspector is the one the generated test contains. Keystrokes are decoded back
into `press('ArrowDown')` and `type('ls -la')` rather than raw bytes; a bracketed
paste becomes `paste()`; anything unrecognised is kept as
`write(Buffer.from(…, 'base64'))` rather than guessed at. "Assert here" writes
`toMatchSemanticSnapshot()`, which the preset fills in on the first run.

```ts
// Generated by `termwright ui` (recorder). Review before committing: …
import {expect, test} from '@termwright/test';

test('approves the command', async ({terminal}) => {
  const app = await terminal.launch({command: ['node', 'agent.js']});

  await app.waitForText('Permission required');
  await app.getByRole('button', {name: 'Approve'}).click();
  await expect(app).toMatchSemanticSnapshot();
});
```

Codegen is easier in a terminal than in a browser, for once: termwright owns the
whole input stream, so there is nothing to guess about what the user did.

## When a run finishes while you are elsewhere

A toast tells you, and it is a button: pressing it takes you to the result. The
alternative — a silent finish while you are reading Specs — means either
watching the tab or discovering the failure later, and both are worse than one
dismissible notice.

## When the pane cannot match the profile

The browser pane is a real xterm.js, but not the headless build, and it cannot
reproduce every [terminal profile](../terminal-profiles/). When a session or
archive announces one it cannot match, the UI says so rather than rendering
something subtly wrong in silence:

```
profile "iterm2-ambiguous-wide" — this view measures with Unicode 11 widths
```

The semantics, the timeline and the tree remain exact; only that pane's column
arithmetic may differ from what the session saw.

## Security

A live terminal is a shell, and record mode runs a program the user named in the
user's own environment. The server therefore binds to loopback and mints an
unguessable token per launch; the URL it prints carries it, and the token is
required on every request, on the WebSocket upgrade, and — as a
`SameSite=Strict`, `HttpOnly` cookie set on the app page — on the bundle the page
loads for itself.

Frames, request bodies, the replay backlog and the input decoder's buffer are
all bounded, and the hostile-input suite runs under
`node --max-old-space-size=128`.

## What is not there yet

- **A "logs incomplete" warning during a live run.** It shows in run history,
  where the count is recorded; the live `test-end` message does not carry one
  yet.
- **A session switcher.** Multiple sessions in one test are attached and listed,
  but the terminal pane shows the first one that produced output.
- **Screenshots** are not taken by the runner. They live in
  [`@termwright/screenshot`](../traces/), which renders SVG with embedded glyph
  outlines and PNG through resvg — deliberately a separate package, so a native
  renderer stays out of every test run.

## How this is tested

The panes, time travel, the log and crash panels and the live control round trip
are covered by a committed browser suite that runs on every CI build — a real
Chromium against a real server serving a real `.twtrace` archive written by the
trace writer.
