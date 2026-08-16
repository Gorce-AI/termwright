# @termwright/ui — implementation notes

Decisions that are not obvious from the code, and the open threads other package
owners need to know about.

## The socket carries events; HTTP carries state

`/CONTRACTS.md` §UI events is a closed list of seven server messages and four
client messages, and this package implements exactly that list — no extra
message types, no "while we're here" additions.

Time travel and the recorder need more than events, though: the state at a
millisecond, the session list, the generated source. All of it lives under
`/api/` as plain HTTP:

| Route | Purpose |
|---|---|
| `GET /api/state` | mode, attached sessions, opened trace, recorder status |
| `GET /api/trace/state?t=` | `openTrace().stateAt(t)`, base64-encoded |
| `GET /api/record/events` | recorded events + current generated source |
| `POST /api/record/action` | record a click / visibility assertion on a node |
| `POST /api/record/assert` | `toMatchSemanticSnapshot()`, `toHaveText`, `waitForText` |
| `POST /api/record/step` | open a `test.step()` grouping |
| `POST /api/record/save` | write the generated test to disk |

Reads are pulls rather than pushes on purpose: a scrub fires on every pixel of
slider movement, and streaming the whole recording into the browser so it can
seek locally would mean shipping the archive twice and reimplementing `stateAt`
in the page.

**If the UI protocol ever needs to grow** (a `seek` message for a shared
scrubbing session, say), it grows in CONTRACTS.md first, and these routes are
where the shape has already been proven.

## What the browser app is, and why it is not React

Vanilla TypeScript with lit-html for the two rendered panes; xterm.js keeps its
own DOM because it owns a canvas-ish render loop. lit-html is ~3 kB gzipped and
is a template function, not a framework: no build-time transform, no component
model to learn, no reconciler between us and a pane that redraws on every
`output` message. The whole bundle is ~82 kB gzipped, most of it xterm.

State lives in one object in `app/main.ts` and every message schedules one
`requestAnimationFrame` render, so the panes cannot disagree about the run.

## Cell metrics without reaching into xterm

Overlay boxes need the pixel size of a cell. xterm exposes it only through
`_core._renderService.dimensions`, which is private and has changed shape across
versions. `app/terminal-pane.ts` measures the rendered `.xterm-screen` element
instead: `clientWidth / cols` is exact for a monospaced grid and survives
renderer and version changes.

## Steps on the timeline come from the trace, not from Vitest

Vitest's reporter API reports *tests*; `test.step()` boundaries exist inside the
worker and never reach a reporter. So the bridge emits `step` messages when a
test finishes, by reading the steps out of the `.twtrace` the fixtures wrote
(`task.meta.termwright.traces`). Steps therefore arrive as a batch at the end of
each test rather than as it runs.

The same reason explains why `output` and `semantic` are missing from
out-of-process live runs: a worker cannot reach the server's hub, and pushing
every PTY byte through the reporter's IPC channel would slow down the run the UI
exists to observe. In-process runs (a future `termwright ui` driving Vitest
through its Node API) call `attachSession(hub, harness)` and get the full stream;
out-of-process runs get the timeline, and the trace is one click away.

**If Vitest grows a step-reporting hook**, `#publishSteps` in `reporter.ts` is
the one place that changes.

## No dependency on `@termwright/test`

The task sketch allowed extending that package's reporter. It would have meant a
runtime dependency the contract's dependency rules do not grant `ui` (`ui`
depends on `trace` + `driver`), so this reporter is standalone and reads the
reported task objects structurally — the same `task.meta.termwright.traces`
shape, no import. The two reporters are independent and compose: run both.

`protocol` is a **type-only** dev dependency (`SemanticSnapshot` passes through
this package verbatim), mirroring the relaxation `trace` already has; noted in
`CHANGELOG-contracts.md`.

## Recorder: bytes in, actions out

The browser sends raw bytes (`input`), because that is what a terminal produces.
`input-decode.ts` is the inverse of the driver's `encodeKeys`: it turns them back
into `press('ArrowDown')`, `type('ls -la')` and `paste(...)`. It is round-trip
tested against `encodeKeys` itself, so the two stay in step.

Three deliberate limits:

- unrecognised sequences (mouse reports, exotic CSI) become `raw` and are
  generated as `write(Buffer.from(…, 'base64'))` — never dropped, never guessed;
- the pending buffer is capped at 64 KiB, so a sequence that never terminates
  cannot grow without bound;
- decoding assumes `applicationCursorKeys: false` for `SS3`-vs-`CSI` cursor keys.
  Both forms decode to the same key name, which is what codegen needs, so the
  ambiguity is harmless here.

Pick mode suppresses input forwarding: pointing at the screen to identify a node
is a UI gesture, and neither the child nor the recording should see it.

## `toMatchSemanticSnapshot()` without an argument

"Assert here" generates the matcher with no inline expectation. The preset writes
the YAML snapshot file on the first run, which is the artefact a reviewer reads —
and it keeps this package from having to implement the YAML serializer that
`@termwright/test` already owns.

## The test list, and what the protocol had to grow

`§UI events` carried enough to *list* tests but not enough to make the list
useful, so three optional fields were added (all backwards compatible; an older
producer simply omits them):

- `test-start.startedAt` — Unix epoch ms. Without it, a tab that connects
  mid-run and replays the backlog would show every running test as having just
  begun. `test-start.sessionId` is optional in the same way: when a producer
  knows which session a test drives, focusing the test focuses its terminal.
- `test-end.durationMs` and `test-end.flaky` — Vitest knows both
  (`diagnostic().duration`, `retryCount`/`flaky`), and without them the list
  cannot show a duration or tell a retry from a clean pass.
- `run-end.summary.flaky` — counted separately from `passed`, for the reason
  `@termwright/test`'s reporter states: burying a flaky test in the pass count
  is how it stays broken.

The UI falls back where a producer is silent: a missing `durationMs` is measured
from `test-start` to `test-end` in the page, and a missing `run-end.flaky` is
counted from the rows. `test-model.ts` holds all of that logic, free of the DOM
and therefore tested directly.

**The elapsed clock ticks only while something is running** — `retick()` starts
a 500 ms interval on the first running test and clears it when the last one
ends. A runner UI that repaints forever is a runner UI that keeps a laptop
awake.

**Clicking a row focuses; the row's own button reruns.** The earlier version
reran on a row click, which is the wrong default: the thing you do constantly is
look at a test, and the thing you do occasionally is run it again.

## Logs: one row shape, and no invented severity

The driver's `app-log` event carries two different payloads — a followed file
yields `line`, an instrumented adapter yields a structured `record` — and the
archive's `logs.jsonl` carries the already-flattened form. `app-log.ts` parses
all three into one `AppLogView`, so the panel, the timeline marks and the
message validator share one shape.

The one distinction kept is that **a file line has `level: null`**. No regex
over the text, no heuristics: an unleveled line is shown in the panel (always,
whatever the filter) and never produces a warn/error mark. A mark that might be
wrong is worse than no mark, and a filter that hides lines it failed to classify
is worse than one that shows them.

`UI_LOG_LEVELS` duplicates the protocol's `LOG_LEVELS` because this module is
bundled into the browser and `@termwright/protocol` is Node-only (it imports
`node:crypto`). `app-log.test.ts` asserts the two arrays are identical, so the
fork cannot drift — the assertion runs in Node, where importing the protocol is
free. That test is the reason no dependency-rule relaxation was needed.

The panel's header counts come from `meta.logs.levels`, which the writer
computed over the whole recording — so "2 errors" stays true while the list is
filtered, clipped to the scrub position, or short of entries the writer evicted.
A live run has no such summary and counts what arrived.

Archive logs arrive over HTTP (`/api/trace/logs`), not on the socket: they are
state, like the trace overview, and the panel clips them to the scrub position.
The clip uses the *requested* moment rather than the one `stateAt` clamped to,
so jumping to a log mark shows the line you jumped to instead of stopping just
short of it. Live logs, being events, ride the socket as `app-log` messages, and
`run-start` clears them only for live and recording runs — a post-mortem's logs
come from the archive and a late socket backlog must not wipe them.

## The crash section is external data

`meta.crash` reaches the viewer from an archive somebody else recorded — a CI
job, an older writer, a file that was edited. `crash.ts` therefore validates it
into a `CrashView` rather than trusting the type: two fields are required
(`castOffset`, because there is nowhere to put the marker without it, and a
usable `exit`, because a crash with no cause is not a report), everything else
degrades to an empty list, and a section that fails validation yields `null`.
The UI then shows no panel and no marker — the archive around it is still what
the user came to look at.

Everything that survives is bounded: 500 rows of screen tail (the *last* 500 —
the end is where the panic is), 4 096 characters per row, 100 inputs, 200
diagnostics.

`CRASH_TAIL_WARNING` duplicates the sentence from the HTML report in
`@termwright/trace` rather than importing it, because it is not exported there;
`crash.test.ts` pins its content. **If that report's wording changes**, this is
the string to change with it — one artefact should read the same way wherever it
is shown.

Note that the panel puts an unredacted screen tail into `/api/state`, i.e. into
the browser. That is inherent to the feature and identical to what the HTML
report does with the same bytes; the token and the loopback bind are what keep
it from going further.

## Security posture

Loopback bind, 24 random bytes of token per launch, constant-time comparison,
token accepted from the query string, an `x-termwright-token` header, or the
`SameSite=Strict; HttpOnly` cookie the app page is given (a page cannot put the
query token on its own `<script src>`). Bounds: 8 MiB WebSocket frames, 1 MiB
request bodies, a 4 MiB / 4096-message replay backlog that drops output before
lifecycle messages, and the decoder cap above. `src/hostile.test.ts` runs under
`node --max-old-space-size=128`.

Record mode runs a program the user named, in the user's shell environment. That
is the point of the feature, and it is the reason the token is not optional.

## Verified in a real browser

The three panes, selector generation, pick-mode hit testing and time travel were
exercised through Playwright against a running server on a fixture archive:
scrubbing to the second marker replayed the recording into a fresh terminal and
switched the inspector to the matching revision, and pick mode produced an
overlay box positioned from cell metrics. There is no automated browser suite in
this package yet — a Playwright project would be the next step, and belongs with
the CI lane rather than in `vitest run`.

## Open threads

- **`termwright ui` binary** (task #10, the umbrella CLI) wires the flags:
  `--trace <file>`, `--record -- <command>`, `--port`, and spawning Vitest in
  watch mode with `TERMWRIGHT_UI_URL` set. `startUiServer` is the whole surface it
  needs; `onRerun` / `onStop` are the hooks for the watch controls.
- **Multiple sessions in one test** are attached and listed, but the terminal
  pane shows the first one that produced output. A session switcher is a small
  addition to `app/main.ts` when a test that runs two programs at once shows up.
- **SVG screenshots** (design §8.3) are not here; they were scoped as a separate
  optional package.
