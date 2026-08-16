# @termwright/trace — implementation notes

Decisions that are not obvious from the code, and the open threads that other
package owners need to know about.

## Dependency choices

### `fflate` for the zip container (not `node:zlib`)

`node:zlib` only produces raw deflate/gzip *streams*. A `.twtrace` archive that
transports as a single file has to be a real **zip container** — local file
headers, a central directory, an end-of-central-directory record — so that CI
artifacts, the runner UI's file picker and `unzip` on any machine can all open
it. Hand-rolling that on top of `zlib` is ~300 lines of byte layout for no gain.

`fflate` is 8 kB, dependency-free, ESM, and offers both the synchronous API used
here and a streaming one if archives ever outgrow memory. `openTrace()` reads a
zip entirely into memory, guarded by a 512 MB ceiling
(`archive.ts: MAX_ZIP_BYTES`) that raises `TraceError('capacity')`.

Alternatives rejected: `adm-zip` (CJS, no ESM build, larger), `yazl`/`yauzl`
(two packages, callback API), `jszip` (heavy).

### `@xterm/headless` as a runtime dependency, not a dev dependency

The HTML report renders recorded ANSI back into styled markup, and report
generation happens in the user's test run — so the emulator has to ship. It is
the same emulator the driver uses, which is what makes the report's screens
match what the session actually rendered.

`@xterm/addon-serialize` was **not** used, despite the design doc naming
`serializeAsHTML`. That addon serializes a whole buffer in one call; a visual
diff needs per-row output so changed rows can be highlighted and aligned. So
`render.ts` drives the headless terminal and walks the buffer cell by cell,
producing one HTML fragment per row plus the plain text of that row.

Note for whoever touches `render.ts`: `@xterm/headless` 6.0 publishes a CommonJS
`main` with an ESM-shaped `.d.ts`. `import { Terminal } from '@xterm/headless'`
type-checks and then throws at runtime ("Terminal is not a constructor"). The
file uses `createRequire(import.meta.url)` for that reason.

### `asciinema-player` bundled inline

`asciinema-player@3.17` ships a self-contained `dist/bundle/asciinema-player.min.js`
(184 kB) and `.css` (20 kB) — no worker file, no external fetches. The report
inlines both at generation time and mounts one player per test with
`AsciinemaPlayer.create({ data: <cast text> }, el)`. Verified in a real browser:
the page issues exactly one network request (itself), and the cast's `m` events
show up as labelled markers on the player's progress bar.

Recordings above `maxEmbeddedCastBytes` (4 MB default) are omitted with a note
rather than producing a 100 MB HTML file.

### `@termwright/protocol` declared as a dependency

`/CONTRACTS.md` says trace depends on driver *types* only. It still declares
`@termwright/protocol`, because the trace format stores `SemanticSnapshot`
verbatim and that type lives in protocol — the driver's `api.ts` imports it
without re-exporting it, so `.d.ts` consumers cannot resolve it transitively
under pnpm's strict layout. Every import is `import type`; nothing from protocol
survives into `dist/index.js`.

If the driver ever re-exports the protocol types it uses, this dependency can be
dropped without touching any other line.

## `TraceError` does not extend `TermwrightError`

The engineering baseline wants cross-package errors to be `TermwrightError`
subclasses. `@termwright/driver` currently publishes `TermwrightError` as
`declare class` — a type with no runtime value — and extending it would require
a *runtime* dependency on the driver, which the dependency rules forbid.

`TraceError` is therefore structurally identical: same `code` domain
(`TermwrightErrorCode`), same `diagnostics` shape (`ErrorDiagnostics`).
**TODO (needs driver):** once `@termwright/driver` exports a real
`TermwrightError` class, decide with the driver owner whether trace may take a
runtime dependency on it; if yes, `TraceError extends TermwrightError` is a
one-line change and no call site moves.

## The two timelines

Every artefact carries two times, and mixing them up is the easiest bug to write
here:

- `t` — wall-clock milliseconds since recording started.
- `castOffset` — position on the **cast timeline**, i.e. `t` after hidden
  windows were removed and idle gaps compressed.

`hide()`/`show()` windows drop `o`/`i` cast events entirely. Markers, semantic
snapshots and step events are *kept* — they are not screen data, and losing them
would break the step list — but they collapse onto the window's start.

Idle trimming is applied at `finalize()`, not while recording, so the same
session can be exported with different limits. `timeline.ts` computes cast times
for the retained events and interpolates everything else between those knots, so
a snapshot recorded in the middle of a 20 s gap trimmed to 1 s lands at 500 ms
rather than past the end of the gap.

`events.jsonl` stores `castOffset` on **every** line, and §Trace requires it.
There is no reader fallback to `t`: a line without it is rejected as corrupt.

That is deliberate, not strictness for its own sake. `t` and `castOffset` are
equal only in a recording that was neither hidden nor idle-trimmed, so the
fallback would place events correctly in the easy case and silently wrong in
exactly the recordings where the timeline matters. The writer cannot know the
offset until `finalize()` applies the transforms, which is why the buffered
event type omits the field (`PendingTraceEvent`) and `writeArchive` is the one
place that completes an event — the type system now enforces what the format
requires.

## Clock coupling with the driver — needs confirmation

`SessionEventMap` timestamps events with `timeMs`, and `/CONTRACTS.md` does not
say what epoch that is. The writer does not assume: it anchors on the first
driver event it receives, recording *its own* clock reading at that moment, then
follows the driver's deltas from there. So a session-relative driver clock and a
`Date.now()` driver clock both produce correct traces.

**TODO (needs driver):** confirm `timeMs` is monotonic and never resets
mid-session. If the driver restarts the counter (on reconnect, say), the writer
would need an explicit epoch marker in the event payload.

## Bounds

- Buffered output is capped at `maxOutputBytes` (32 MB default). On overflow the
  writer stops recording output and sets `meta.truncated`; steps, semantics and
  events keep recording. Losing the tail of a recording beats an OOM in CI.
- Consecutive output chunks with the same millisecond are coalesced up to 64 kB.
- The reader streams `session.cast`, `events.jsonl` and `semantics.jsonl` line by
  line and caches only a small index of semantic records (time, revision, cast
  offset) — never the snapshots themselves. `semanticAt()` re-streams to fetch
  the one snapshot it needs.

## Crash reports

The driver emits `crash` just before `exit`, and `exit` only after the emulator
has drained — so by the time the archive closes, the screen tail in the report
is the screen the recording ends on. Both events are timestamped on the same
clock as everything else, so the crash gets a `castOffset` through the ordinary
wall→cast mapping and a player can seek to it.

Two things are stored differently from the driver's `CrashReport`:

- **`castOffset` is added.** The report is a moment on the timeline, and the
  timeline the UI scrubs is the trimmed one.
- **The semantic tree is replaced by its revision.** `semantics.jsonl` already
  holds every tree; copying one into `meta.json` would duplicate an unbounded
  payload in the one file every consumer parses eagerly.
  `TraceReader.crashSemantic()` resolves it.

`events.jsonl` gets a `crash` line carrying only the exit, the screen-tail row
count and the revision — enough to see *that* it happened while scanning the
log, without putting a screen tail on a line in a file meant to be streamed.

### `screenTail` is not redacted, and the report says so

The driver's TSDoc is explicit that the tail is verbatim terminal output,
secrets included. That warning has to survive the trip into the artifact,
because the artifact is the thing that gets uploaded to CI and linked in a bug
report — so the same caveat is repeated in `TraceCrash`'s TSDoc, in the
package README, and as a visible banner above the `<pre>` in the HTML report.
Pasted input is the one thing that is never included: `CrashInput` reports a
paste's size and omits its preview, and the report renders that as
"not recorded" rather than silently showing an empty cell.

## Application logs

`logs.jsonl` collapses the driver's two payloads into one line shape. The
driver's `AppLogEvent` carries either `line` (followed file) or `record`
(instrumented adapter), never both; the archive stores `message` for both and
keeps `source` for consumers that care. Every consumer — the report, the runner
UI, an agent reading a replay — wants to print the entry first and inspect its
provenance second, and mutually exclusive fields make the common case the
awkward one.

A followed file line has **no level**, and none is guessed. Parsing `ERROR` out
of a line's text would colour the report by substring match, which is wrong
often enough to be worse than no colour: file lines show up in the log section
and stay out of the timeline's notable set.

### Eviction is counted at the end, not on the next event

The driver's team flagged a bug pattern worth checking for: a counter that is
accumulated during rate limiting and reported *when the next event arrives*
loses the last window whenever a flood ends the session — which is exactly when
the number matters.

The log ring buffer keeps the newest `maxLogEntries` and increments
`droppedLogs`, which is read once in `buildLogSummary()` at `finalize()`. There
is a test that floods past the ceiling and then ends the session with no further
event of any kind; the count is still right.

Auditing the rest of the writer for the same shape: `truncated` (output byte
ceiling) is a flag read at finalize, hidden windows are closed at finalize, and
open steps are closed at finalize. None of them defer work to a next event, so
the log buffer was the only place the pattern could have appeared.

### Known gap: log sources have labels, not paths

`meta.logs.sources` lists labels, because a label is all the archive can know:
`AppLogSource.path` is a `launchTerminal` option and the driver's `app-log`
event carries only `label`. A consumer that wants to show *which file on disk*
an entry came from needs `path` added to the event (or to capabilities) on the
driver side first — there is nothing trace can do about it locally.

Raised while agreeing the format with the runner UI, which wanted
`sources: {label?, path}[]`. Not blocking: labels are enough to group and
filter, and the UI shipped on labels.

### `sources` carries paths now

The driver started sending `path` on `app-log` (c73b090), so `meta.logs.sources`
is `{label?, path?}[]` rather than a list of labels, and each file entry repeats
its `path`.

Repeating it per entry rather than indexing into `meta.logs.sources` is
deliberate. The driver's own wording is that "a label can be short and shared
between sources", so a label cannot attribute a line to the file it came from —
two nodes both logging under `app` are a normal setup, and there is a test for
exactly that. An index into another file's array would avoid the repetition but
is a worse thing to read in a JSONL stream, and it couples two files' orderings
together. The cost is a repeated string on file lines; adapter records have no
path and pay nothing.

### The replay measures characters exactly like the session

`vt.ts` used to build its own `new Terminal(...)` without the Unicode 11 addon
while the driver built one with it, so a session counted `🚀` as two columns and
its own replay counted it as one. Nothing threw; the reconstructed frame just
sat a column away from the screen the test asserted against, and the screenshot
disagreed with the assertion for no visible reason.

Terminal construction now goes through `createTerminal` in `@termwright/vt`,
which registers *and activates* the profile's Unicode provider — activation was
the second half of the trap, since registering a provider without setting
`activeVersion` changes nothing.

The profile travels with the recording as `meta.terminalProfile`, so a replay
uses the tables the session used rather than whatever this build defaults to.
An archive that names a profile this build does not know raises
`protocol-violation` instead of falling back: replaying with the wrong width
tables produces a frame that looks right and is not, which is the failure mode
the whole exercise exists to remove.

`meta.json` rather than the asciicast header is deliberate. The profile
describes the session, like `columns` and `platform` beside it, and `meta.json`
is our file — putting a termwright field inside a foreign format's `term`
object risks colliding with whatever asciicast puts there later, for the sake
of a `session.cast` extracted on its own, which asciinema would ignore anyway.
