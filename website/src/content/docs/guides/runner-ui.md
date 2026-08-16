---
title: Runner UI
description: A live terminal, a semantic inspector and a timeline you can scrub — plus a recorder that writes the test for you.
---

`@termwright/ui` is a local server and a browser app: DevTools for a terminal
program. Three panes, three modes.

| Pane | What it shows |
|---|---|
| Terminal | xterm.js fed by the session's output, with semantic bounds drawn on top |
| Inspector | the accessibility tree — hover to highlight, click to generate a selector. Also carries the **Logs** and **Commands** tabs |
| Timeline | tests and steps live; a scrubber with marker jumps in post-mortem |

The inspector pane is a real ARIA tree, navigable by keyboard — see
[Accessibility](../../reference/accessibility/). The **Logs** tab shows
[application logs](../app-logs/) on the same timeline as everything else, with
notable levels marked on the scrubber; **Commands** lists the actions the
session ran, from the trace's event log.

A crash panel appears above the panes when the session died on its own, with a
button that seeks to the moment it happened.

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

## Recorder and codegen

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
