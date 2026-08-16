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

## The pane must measure characters the way the driver does

xterm.js defaults to Unicode 6 width tables; the driver measures with Unicode 11.
Left alone, the same frame can land a column apart between this pane and what
the test saw — and nothing throws, so the hunt starts in the application, where
the bug is not. The pane therefore loads `@xterm/addon-unicode11` **and switches
`unicode.activeVersion` to it**: registering a provider without activating it
was the second half of the same trap.

That covers the `default` and `kitty` profiles. `iterm2-ambiguous-wide` counts
East Asian Ambiguous characters as two columns, which the stock browser addon
cannot do — `@termwright/vt` has the provider that can, but its entry point
imports `@xterm/headless` and would drag Node into the bundle. Until a
headless-free export exists, a recording made with that profile shows a notice
saying this view measures with Unicode 11 widths, because measuring against a
silent mismatch is exactly the failure this section is about.

Where the profile comes from differs by mode, and both are deliberate:

- **live** — the `session` message, published by `attachSession` before any
  output. The profile describes the *session*, not a test: a Vitest reporter
  often does not know which session a test drives, and the browser needs the
  profile before the first byte regardless. The message also carries the
  viewport, and once a session declares one the grid is **pinned** to it —
  `refit()` stops resizing the terminal and only moves the overlay, because a
  pane that reflows to the browser window is showing a layout the program never
  produced. (The browser check caught this: the grid came up one row taller than
  the session's, because the resize observer refit right after the resize.)
- **post-mortem** — `meta.terminalProfile`. Not the cast header: asciicast is
  somebody else's format and termwright does not litter it with its own fields.

`null` in a replay means the recording predates profiles.

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

## ARIA is a translation here, not an interpretation

The protocol's roles were chosen ARIA-aligned, which is what makes `aria.ts` a
lookup table rather than a heuristic. Three decisions are worth knowing:

- **Attributes go only where ARIA defines them.** `aria-selected` means
  something on `tab` and `row` and nothing on `listitem`; a selected list item
  therefore gets `aria-current`. Emitting an ignored attribute would look right
  in a DOM dump and say nothing to a screen reader.
- **ARIA is applied after render, not in the template.** lit-html cannot bind a
  variable set of attribute names, and a template per combination would be
  unreadable, so `applyAriaAttributes` walks the rendered nodes. It also
  *removes* attributes that no longer apply — a stale `aria-disabled` on a
  button the app has since enabled is the expensive kind of lie.
- **Decorative text is a hidden span, not CSS generated content.** `::before`
  content is announced by screen readers, so the role/name caption each element
  shows visually is a real `<span aria-hidden="true">`.

The children group sits *inside* its `treeitem`, as the tree pattern requires; a
group that is a sibling belongs to nothing. Navigation lives in `tree-nav.ts`
as a pure function over visible rows, so the arrow-key semantics are tested
without a DOM.

**Verified** through Playwright's accessibility snapshot: the inspector exposes
`tree → treeitem[level, expanded] → group → treeitem`, focus and selection move
together under the arrow keys, and the Semantic view exposes
`dialog "Permission" → button "Approve"`. A real screen reader (VoiceOver, NVDA)
was **not** run — there is none in this environment — so what is proven is the
accessibility tree Chromium computes, not the announcement a user would hear.

## Playback plays locally; scrubbing used to be a round trip

`/api/trace/frames` hands the page the whole recording once (bounded at 8 MiB),
and the browser plays it against `requestAnimationFrame`. A round trip per frame
was never going to hold 4× playback, and once the frames are local, seeking is
the same operation as playing — `applyFrames` writes forward from the cursor and
resets the emulator only when moving backwards, because a terminal cannot
un-write. The server's `stateAt` path remains for archives too large to send.

Two consequences worth knowing. The semantic tree is *not* local: playback
fetches a snapshot when it crosses a revision boundary and never blocks the
terminal on it, so the tree can lag a frame at 4× and catch up. And playing to
the very end of an Ink recording lands on an empty screen — the app leaves the
alternate buffer as it exits, which is what the archive says happened.

## The command log, and the one thing missing upstream

`events()` now throws on a line without `castOffset` — the archive contract has
one producer generation, so an incompatible recording is an error rather than a
degraded read. The command log catches that throw, keeps the rows it managed to
read, and says so in the panel: *"this recording's event log could not be read
to the end"*. A blank list would imply the test did nothing; a partial list with
a warning is the truth. The rest of the archive (cast, semantics, logs) opens
normally, because `castOffset` was required there from the start.


Rows come from `events.jsonl`, which already holds steps, actions and
assertions; nothing is recorded twice.

Live runs have **two** producers for the same `action` message, and they cover
different things:

- `attachSession` translates the driver's own `action` event, so anything that
  drives a session in-process — the recorder, a future in-process runner — fills
  the command log without the test framework being involved at all;
- the reporter translates Vitest 3.2 **test annotations** (`onTestAnnotate`),
  which is the only channel a worker process has to a reporter. Assertions can
  only come this way, since the driver never sees them.

The driver's event fires *after* the action finished, so the output it caused is
already on the timeline ahead of it. The log marks when an action completed and
never claims the bytes came after it — worth remembering before drawing any
"this action caused that output" arrow. Failed actions are published too, and
are the ones worth watching live: *"the click did not land because the app never
enabled mouse reporting"* beats wondering why nothing happened. Their `error` is
a code (`unsupported-action`, `timeout`), not prose, so it groups and filters.

Clicking a row can highlight the node an action targeted, but only when the
recorded event carries a `ref` (`n8@42`, node plus the revision it resolved at).
The archives our matchers write today carry `selector` and no `ref`, so that
highlight stays dark on them. The UI side is done and tested; filling in `ref`
is a change in whoever calls `recordAction`/`recordAssert`.

## Discovery: what the project has, before it runs

`vitest list --json` prints `{name, file}` and **no id**, so discovered tests get
`<file>::<name>`. That shape is not arbitrary: it is stable between runs, it
reconciles with a running test by file and title, and a runner receiving it in
`rerun { testIds }` can turn it straight back into `vitest run <file> -t
"<name>"` with no lookup table on either side.

Two consequences the code makes explicit. A discovered row is *adopted* by the
run that reaches it (`testFor` matches file+title and takes the run's id), so a
test never appears twice. And clicking a row that has never run means "run this
one" rather than "show me its steps", because there are no steps to show — the
same thing clicking it in Cypress does.

Discovery is a convenience and never a blocker: the listing runs in the
background after the server is already serving, a failure yields an empty list
rather than an error page, and the watcher that re-lists on file changes is
best-effort (a platform without recursive watch loses the refresh, not the
server).

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

**There are no receiver-side fallbacks.** The contract settled on exactly one
producer generation before 1.0, so these fields are required and the validator
*rejects* a message that omits one instead of repairing it. The page no longer
measures durations itself or recounts flaky from the rows; whatever the producer
says is what the list shows, and a producer that lies gets a visible error rather
than a plausible-looking number. Three fields stay optional for reasons that are
about facts, not versions: `sessionId` (a Vitest reporter genuinely cannot know a
worker's sessions), `traceRef` (no archive was retained) and `error` (the test
passed).

`test-model.ts` holds the list logic, free of the DOM and therefore tested
directly.

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

**The panel holds a window, not the log.** A recording of a chatty program can
carry far more lines than a browser should: `/api/trace/logs` takes `before`,
`after` and `limit`, the page keeps ~200 rows, pulls the previous window when
you scroll to the top, and refetches around the scrub position when the replay
moves outside what it holds. Without that last part the panel keeps showing the
window loaded at open and quietly misreports what had been logged by then —
which is exactly how it behaved until the browser check caught it.

The reader streams the archive per request rather than indexing it up front: the
file is local, and an index of a file you may never scroll through costs more
than it saves. A window also cannot sort what it never holds, so entries are
returned in file order — which the writer guarantees is chronological.

The panel's header counts come from `meta.logs.levels`, which the writer
computed over the whole recording — so "2 errors" stays true while the list is
filtered, clipped to the scrub position, or short of entries the writer evicted.
A live run has no such summary and counts what arrived.

The same rule applies to the archive readers: `meta.logs.sources` is read only
in its `{label, path}` form, and a log entry is positioned by its `castOffset`
alone. Validation stays — an archive is still a file that could be malformed —
but there is no branch for "an older writer wrote it differently".

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
