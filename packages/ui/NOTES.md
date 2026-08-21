# @termwright/ui — implementation notes

Decisions that are not obvious from the code, and the open threads other package
owners need to know about.

## The socket carries events; HTTP carries state

`/CONTRACTS.md` §UI events is a closed list of server messages and four
client messages, and this package implements exactly that list — no extra
message types, no "while we're here" additions.

Time travel and the recorder need more than events, though: the state at a
millisecond, the session list, the generated source. All of it lives under
`/api/` as plain HTTP:

| Route | Purpose |
|---|---|
| `GET /api/state` | server mode, attached sessions, startup trace, recorder status |
| `POST /api/specs` | file facts for the discovered catalogue and history |
| `POST /api/run` | start all cases or the stable ids selected by this tab |
| `GET /api/runs`, `GET /api/run?id=` | bounded history and one validated manifest |
| `POST /api/trace/open` | validate one archive and return its overview to the requesting tab |
| `GET /api/trace/state?t=&archive=` | `openTrace().stateAt(t)` for the tab's archive |
| `GET /api/trace/commands`, `/frames`, `/logs` | the other windowed/bounded replay data |
| `GET /api/record/events` | recorded events + current generated source |
| `POST /api/record/start`, `/stop`, `/discard` | recorder lifecycle inside the running panel |
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

## The browser app has one React renderer

`src/app` is the only browser application. React owns navigation, catalog,
runner, terminal framing, playback, inspection, history, recorder and settings.
xterm.js owns only its terminal canvas-like DOM inside the React component.
There is no legacy renderer or fallback application.

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

## One test can own more than one live screen

Each test keeps every linked `sessionId`, not just the first terminal that
produced output. The newest launched session is the useful live default. When a
test has more than one, the command-log header renders a **Screen** selector;
changing it calls the same `activateSession` path used by test-row navigation,
so the terminal, semantic inspector and pick mode move together. Starting a new
run clears the old session list instead of offering terminals from the previous
attempt. A trace is still one recorded session, so replay does not invent this
switcher.

## One function from a moment to a place

The scrubber, the markers and every click go through `timeline-scale.ts`. That
is not tidiness: the owner reported the thumb and the markers disagreeing, and
the drift **grew towards the right**, which is the most convincing kind of wrong
— it survives a glance at the start and lies at the end. Two causes, both real:

1. the marker strip was a separate element with its own `margin: 0 44px`, while
   the track was a flex child between buttons whose widths changed every time a
   control was added (play and speed made it worse);
2. a native `<input type=range>` thumb travels `width − thumbWidth`, while a
   marker at `t/duration × 100%` is placed against the full width — that alone
   produces drift that is zero at the left and maximal at the right.

The fix is a custom track: fill, thumb and every marker are children of one
element, positioned by `percentFor` and centred on their point, and a pointer is
read back by `timeAt` against the same box. Losing the native input cost the
free keyboard support, so the track is a real `role="slider"` with
`aria-valuenow`/`aria-valuetext` and arrow keys — and the global arrow shortcuts
now stand aside for it, as they already did for the tree.

Verified in the browser at the left edge, the middle and the right edge: 0.00 px
between the thumb centre and the point asked for, at all three. The e2e lane
pins it.

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

The worker does not need the reporter's IPC channel for terminal traffic.
`@termwright/test` opens `@termwright/ui/live-client` beside each harness; that
bounded, fail-open producer socket applies the same `streamSession` translation
as an in-process `attachSession`. Out-of-process live runs therefore carry the
session announcement, output, semantic revisions, driver actions and
application logs while the program is running. The reporter remains the
coordinator-side producer for run/test lifecycle, assertions and the post-hoc
step batch.

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
- **Attributes track current state.** React omits attributes that no longer
  apply, so a control that becomes enabled does not retain `aria-disabled`.
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

Live runs have **two producer paths** for the same `action` message, and they
cover different things:

- `streamSession`, reached through either in-process `attachSession` or the
  worker-side `connectLiveSession`, translates the driver's own `action` event;
  the recorder and ordinary Vitest workers therefore fill the command log from
  the harness that actually owns the terminal;
- the reporter translates Vitest 3.2 **test annotations** (`onTestCaseAnnotate`),
  which join framework-owned facts such as the test id and assertion outcome.
  Assertions can only come this way, since the driver never sees them.

The driver's event fires *after* the action finished, so the output it caused is
already on the timeline ahead of it. The log marks when an action completed and
never claims the bytes came after it — worth remembering before drawing any
"this action caused that output" arrow. Failed actions are published too, and
are the ones worth watching live: *"the click did not land because the app never
enabled mouse reporting"* beats wondering why nothing happened. Their `error` is
a code (`not-actionable`, `timeout`), not prose, so it groups and filters.

Clicking a row can highlight the node an action targeted, but only when the
recorded event carries a `ref` (`n8@42`, node plus the revision it resolved at).
The archives our matchers write today carry `selector` and no `ref`, so that
highlight stays dark on them. The UI side is done and tested; filling in `ref`
is a change in whoever calls `recordAction`/`recordAssert`.

## One viewer, two sources — and one row for a test

The panel is a single application with one state. Live and post-mortem are not
two views: they are the same views over two sources. `TerminalPane`,
`command-log`, `log-panel`, `inspector`, `semantic-view`, `test-list`,
`crash-panel` and the timeline each exist once and are rendered by `main.ts`
regardless of mode; what changes is where the data came from (WebSocket
messages, or the archive readers behind `/api/`) and that a replay has a
scrubber and speeds while a live run follows.

Run history is navigation inside that same application — runs → run → test →
the test in archive mode. `--trace` remains a deep link into the viewer, but an
archive chosen later belongs to the requesting browser tab: it is loaded over
contextual HTTP reads and is never republished as a synthetic run on the shared
hub. Two tabs can inspect two recordings while the live catalogue keeps
receiving its real run.

The one place this had already gone wrong was the test row: the run history had
grown its own, next to the live list's. They are one component now
(`test-row.ts`), with the two things that legitimately differ — what a click
does, and the trailing affordance — as parameters. **If a second rendering of a
test, a command or a log line ever appears, that is the bug**, not a style
choice.

## The panel is a design system, not a pile of CSS

Colours, spacing and type sizes are tokens on `:root`, and the light theme
redefines the same tokens rather than adding rules — so nothing downstream
branches on the theme and the two cannot drift apart. Three decisions worth
keeping:

- **Status is never colour alone.** A red dot and a green dot are the same dot
  to a colourblind reader, and this panel is full of them, so every status also
  carries a glyph (`statusGlyph`, pinned by a test asserting they are distinct).
- **The terminal keeps its own colours in both themes.** The surface around it
  is the panel's; what is inside it belongs to the recorded program, and
  repainting that would be showing something the program never drew.
- **Splits are draggable *and* focusable.** A splitter that only answers to a
  mouse is a control some people do not have; arrows move it, and where it was
  left is remembered per split.

The visual bar is not from memory: current screenshots of the Cypress App were
pulled from `docs.cypress.io` and kept in the scratchpad as a design bar. What
came from them is density and hierarchy, never branding — a number gutter in the
command log, `--` instead of `0` in the counters (nothing failed and "zero
failures" are the same fact but not the same sentence), uppercase group labels
for steps, a left accent bar for the selected row instead of an outline, a
duration pill in the header, and an `assert` chip so an assertion reads as a
different kind of thing from a command at a glance.

`prefers-reduced-motion` disables every transition, and the storage helpers
tolerate a browser that refuses to remember anything (private mode) by falling
back to session-only behaviour rather than failing.

## Run history is a manifest, not a database

`.termwright/runs/<id>/manifest.json` holds the run's counters, its tests, and
**paths** to the archives — never copies of them. The reporter writes it at the
end of a run because that is where every piece already is; a failure to write is
swallowed, since a run whose results are already reported must not be failed by
an unwritable directory.

Opening a run's test goes through `POST /api/trace/open`, which validates the
archive and returns its overview only to the requesting tab. Commands, frames,
logs and seeks then name that same contextual archive on their HTTP reads. It
does not change the server's live mode, replace a shared reader or publish a
post-mortem pseudo-run into the hub. Startup `--trace` still owns one baseline
reader because every tab connected to that server intentionally opens the same
artifact.

Reading a manifest validates it like any other file on disk, and the id that
names a run directory is checked for separators and `..` before it is used as a
path — a run id arrives from an HTTP query, and treating it as a trusted path
component is how directory traversal happens.

## Discovery: what the project has, before it runs

A run resets **results, not the project**. `run-start` used to clear the whole
list, so starting a run made every not-yet-run test disappear until it ended —
found by the browser lane, not by a unit test. The page now keeps the discovered
rows and puts them back to `not-run`, and the hub keeps the newest
`tests-discovered` across its backlog reset for the same reason: a tab that
connects mid-run should still see what else the project holds.

The id helpers live in `test-model.ts`, not next to the listing code, because the
browser needs them and `discovery.ts` spawns a child process — importing it into
the bundle drags Node in. (It did, once. The build says so immediately, which is
the second time that particular guard has paid for itself.)


`vitest list --json` prints `{name, file}` and **no id**, so discovered tests get
`<file>::<name>`. That shape is not arbitrary: it is stable between runs, it
reconciles with a running test by file and title, and a runner receiving it in
`rerun { testIds }` can turn it straight back into `vitest run <file> -t
"<name>"` with no lookup table on either side.

Two consequences the code makes explicit. A discovered row is *adopted* by the
run that reaches it (`testFor` matches file+title), but keeps that stable id;
the current Vitest id lives separately as `runtimeId` for wire joins, so a test
never appears twice and selection does not change identity between runs. And
clicking a row that has never run means "run this one" rather than "show me its
steps", because there are no steps to show — the same thing clicking it in
Cypress does.

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

`src/browser.e2e.ts` drives Chromium through Playwright against running servers
and real archives. It covers the Specs/Runner/Runs/Settings navigation, selector
generation, pick-mode hit testing, live controls and session streaming,
time-travel playback, contextual replay isolation across tabs, the log/crash
panels, the inline report and compact-window layout. The separate
`test:browser` script is required by the dedicated `ui-browser` CI lane; keeping
it outside ordinary `vitest run` avoids requiring Chromium for unit tests.

## Opening a browser

`shouldOpenBrowser` is a pure function of flags, TTY and `CI`, and the spawn is
separate from it, because the decision is the part with rules worth pinning and
the spawn is one line per platform. The rules: `--no-open`, `--json`, a stdout
that is not a terminal, and `CI` set to anything each suppress opening on their
own. `CI=false` suppresses too — nobody sets it to mean "not CI", and CI agents
only ever set it to true.

The printed URL is not conditional on any of this. Opening is an addition, and a
failed launch is not an error: a machine with no browser can do nothing about it
except copy the line already on screen. The whole tokenised URL is what gets
opened — a tokenless address renders an unauthorised page and reads as a bug.

## A lossy log is a warning, not a verdict

`@termwright/test` counts the application log records it could not keep, and the
run manifest carries that count per test. The row says "logs incomplete" beside
the status and never instead of it: a test that passed while its log dropped
records still passed, and colouring the row would make people rerun a green test
looking for a failure that is not there.

The count is required in a manifest rather than optional, because "nothing was
dropped" and "nobody counted" are different facts and only one of them is
reassuring — which is why the format went to v2 instead of quietly reading a
v1 entry as zero. Live runs carry it too: `test-end` gained a required `lostLogRecords` once the
contract was updated, so the badge means the same thing in a live run, in a
replayed archive and in the history — one row, one rule.

## One viewer, two sources

`DataSource` is the seam between the viewer and where its data comes from. A
server answers over HTTP; a report answers from a payload baked into the page.
Nothing else differs — same bundle, same components, same state — which is the
whole point: a second rendering of the command log or the test row would drift
within a week.

What a source cannot do is declared, not discovered. `features` says whether
there is a live run, a run history and another archive to open, and the panel
hides those affordances instead of offering buttons that fail. The inline source
throws on them rather than returning empty results, because reaching one means
the gating above is wrong and an empty list would hide that.

The emitted report is one file: bundle, stylesheet and archive inlined, opened
over `file://` with nothing left to fetch (a browser lane asserts exactly that,
including zero failed requests). Two traps are worth remembering. `String.replace`
treats `$&` and friends in the *replacement* as patterns, and a JS bundle is full
of them — the function form is mandatory, and getting it wrong produces a page
that parses as HTML and not as a program. And a payload sits inside a `<script>`
element, so `<`, `>` and the line separators U+2028/U+2029 are escaped: a program
that logged `</script>` would otherwise truncate the page.

The budget cuts frames from the end and logs from the start. Frames rebuild the
screen by replaying in order, so only a cut at the end leaves a working replay;
a log is read to find out how something ended, so the newest lines are the ones
worth keeping. Both cuts are stated on the page — the log panel already said so,
and the scrubber now says "recording cut", which it did not before this round
even when the 8 MiB frame ceiling had already trimmed a recording.

`@termwright/trace` cannot host this: `ui` depends on `trace`, never the other
way round, so the viewer's bundle cannot be reached from there. The trace
package keeps its own HTML report, which is a different artifact — a failure
report with visual and semantic diffs, not a viewer.

## Current boundaries

Execution attempts have a distinct identity from catalog cases. UI screenshot
generation lives in `scripts/capture-docs-screenshots.mjs`; trace-to-image
rendering remains owned by `@termwright/screenshot`.
