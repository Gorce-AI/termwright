# @termwright/trace — implementation notes

Decisions that are not obvious from the code, and the threads other package
owners need to know about. Open items are first; everything after them is
settled, and the last section records things that used to be open so nobody
reopens them from scratch.

## Open

### `TraceError` does not extend `TermwrightError`

The engineering baseline wants cross-package errors to be `TermwrightError`
subclasses. `@termwright/driver` does now export a real runtime class
(`errors.ts`), so the original blocker — it was `declare class`, a type with no
runtime value — is gone. What remains is the dependency rule: §Dependency rules
says trace depends on driver **types** only, and extending the class needs a
runtime import.

`TraceError` is structurally identical in the meantime: same `code` domain
(`TermwrightErrorCode`), same `diagnostics` shape (`ErrorDiagnostics`). Closing
this is a decision for the contract owner, not a code change — if trace may take
a runtime dependency on the driver, `TraceError extends TermwrightError` is one
line and no call site moves.

### Naming the wrong thing is not the same as a broken archive

`openTrace` used to report a missing file as `protocol-violation`, which is
false — nothing violates a format that is not there — and it cost the CLI a
correct exit code: a mistyped path came out as "termwright broke" instead of
"you typed the wrong path". `TermwrightErrorCode` gained `not-found` for it.

The line is _"is this a `.twtrace` at all?"_ versus _"it is one, and it lies"_:

- `not-found` — the path holds nothing, holds something that is not an archive,
  or `packTrace` was pointed at a directory without `meta.json`.
- `protocol-violation` — malformed `meta.json`, unsupported version, missing zip
  member, corrupt `session.cast`, invalid monotonic `t`, unknown terminal
  profile.

The interesting case is a file that exists but does not unzip, which stays a
protocol violation. It could be a mistyped path _or_ a truncated CI artifact,
and the costs are asymmetric: telling someone to check their path when they are
holding a damaged artifact sends them to the wrong place entirely, while the
reverse mistake only makes them look twice at a path they can already see.

## The archive format

### Canonical time and lazy presentation time

Trace v4 persists one canonical time and derives presentation time:

- `t` — wall-clock milliseconds since recording started.
- `castOffset` — position on the **cast timeline**: `t` after hidden windows
  were removed and idle gaps compressed.

`hide()`/`show()` windows drop `o`/`i` cast events entirely. Markers, semantic
revisions and step events are kept. `timeline.jsonl` stores cast anchors and
hidden windows independently of those domain streams.

Idle policy is fixed when the writer is created so append-only cast intervals
can be emitted immediately. `timeline.ts` computes reader projections and
interpolates everything else between the anchors, so
a snapshot recorded in the middle of a 20 s gap trimmed to 1 s lands at 500 ms
rather than past the end of the gap.

`castOffset` is forbidden on v4 disk records. Repeating it on every record made
the previous writer retain and rewrite the complete run at `finalize()`.
Readers derive it from canonical `t` and the separate timeline, preserving the
public seek-oriented facade without making persistence finalize-heavy.

### The replay measures characters like the session

Terminal construction goes through `createTerminal` in `@termwright/vt`, never
`new Terminal(...)` here, and the profile travels with the recording as
`meta.terminalProfile`.

This is load-bearing. The two used to be built separately, and replay lacked
the Unicode provider the driver activated: a session counted `🚀` as two columns
and its own replay counted it as one. Nothing threw — the reconstructed frame
just sat a column away from the screen the test asserted against. Activation was
the second half of the trap, since registering a Unicode provider without
setting `activeVersion` changes nothing.

An archive naming a profile this build does not know raises
`protocol-violation` rather than degrading to the default: wrong width tables
produce a frame that looks right and is not, which is the failure this exists to
remove. The lookup uses `resolveProfileId`, which answers `undefined` instead of
throwing and checks own properties only — the profile is a string read off disk,
and a prototype-walking lookup would resolve `__proto__` to `Object.prototype`
and hand it on as a profile. There are tests here for the hostile keys, because
this is the package that reads them from a file.

### Crash reports

The driver emits `crash` just before `exit`, and `exit` only after the emulator
has drained — so the screen tail stored is the screen the recording ends on.
Both are timestamped on the same clock as everything else, so the crash gets a
`castOffset` through the ordinary wall→cast mapping and a player can seek to it.

Two things are stored differently from the driver's `CrashReport`:

- **`castOffset` is added.** The report is a moment on the timeline, and the
  timeline the UI scrubs is the trimmed one.
- **The semantic tree is replaced by its revision.** `semantics.jsonl` already
  holds every tree; copying one into `meta.json` would duplicate an unbounded
  payload in the one file every consumer parses eagerly.
  `TraceReader.crashSemantic()` resolves it.

`events.jsonl` gets a `crash` line carrying only the exit, the screen-tail row
count and the revision — enough to see _that_ it happened while scanning the
log, without putting a screen tail on a line in a file meant to be streamed.

`screenTail` is verbatim terminal output, secrets included, and the driver's
TSDoc says so. That warning has to survive into the artifact, because the
artifact is what gets uploaded to CI and linked in a bug report — so the caveat
is repeated in `TraceCrash`'s TSDoc, in the README, and as a visible banner
above the `<pre>` in the HTML report. Pasted input is the one thing never
included: `CrashInput` reports a paste's size and omits its preview, and the
report renders that as "not recorded" rather than an empty cell.

### Application logs

`logs.jsonl` collapses the driver's two payloads into one line shape. The
driver's `AppLogEvent` carries either `line` (followed file) or `record`
(instrumented adapter), never both; the archive stores `message` for both and
keeps `source` for consumers that care. Every consumer — the report, the runner
UI, an agent reading a replay — wants to print the entry first and inspect its
provenance second, and mutually exclusive fields make the common case the
awkward one.

A followed file line has **no level**, and none is guessed. Parsing `ERROR` out
of a line's text would colour a report by substring match, which is wrong often
enough to be worse than no colour: file lines show up in the log section and
stay out of the timeline's notable set. The runner UI reached the same
conclusion independently.

File entries repeat their `path` rather than indexing into
`meta.logs.sources`. The driver's contract says a label can be short and shared
between sources, so a label cannot attribute a line to its file — two nodes
logging under `app` is a normal setup, and there is a test for it. An index
would avoid the repetition but couples two files' orderings and reads worse in a
JSONL stream; adapter records have no path and pay nothing.

`meta.logs` is absent **only** when nothing was logged and nothing was evicted:
`buildLogSummary()` returns `undefined` on `count === 0 && dropped === 0`, so a
consumer treating its absence as "zero of everything" is telling the truth. The
evicted-everything case (a ceiling of 0) still emits a summary, because
`dropped` is the whole point of it.

The reader does not gate log reads on that summary, though. The summary and the
file are two statements about the same thing, and an archive where they
disagree is one to survive rather than believe — so `stateAt().logs` streams
`logs.jsonl` like `logs()` does, and both report what the file actually holds.

The same gate existed in the runner UI and was removed there for the same
reason, which suggests the shape invites it. If a consumer needs to _detect_
the disagreement rather than just survive it, the rule the UI settled on is
worth reusing instead of inventing a third: **the counter is a claim about the
file, the records on disk are the evidence** — report the larger of the two as
the total and mark the list incomplete, rather than picking a side. This
package does not expose that comparison, because knowing it costs a full stream
of `logs.jsonl` and `stateAt` should not pay for it; a consumer that wants it
already has `meta.logs.count` and `logs()`.

### Log admission is counted at the end, not on the next event

The driver's team flagged a bug pattern worth checking for: a counter
accumulated during rate limiting and reported _when the next event arrives_
loses the last window whenever a flood ends the session — exactly when the
number matters.

The append-only log stream admits up to `maxLogEntries` and increments
`droppedLogs` after the ceiling, read once in `buildLogSummary()` at `finalize()`. There is a test
that floods past the ceiling and then ends the session with no further event of
any kind; the count is still right.

Auditing the rest of the writer for the same shape: `truncated` (output byte
ceiling) is a flag read at finalize, hidden windows are closed at finalize, and
open steps are closed at finalize. None defer work to a next event, so the log
buffer was the only place the pattern could have appeared.

### Driver actions record themselves

The driver emits an `action` event per harness or locator call, so the writer
subscribes instead of asking callers to report their own actions.
`recordAction` stays for work the driver cannot see; calling it for a harness
action would record that action twice, and its TSDoc says so.

Two properties of the event worth remembering:

- **It arrives after the action finished**, so `t` is the completion time and
  the bytes the action sent appear _earlier_ on the timeline than the action
  entry. Anything drawing a "this action caused that output" relationship has to
  read backwards. There is a test asserting the `input`-then-`action` order so
  nobody "fixes" it into the intuitive one.
- **Failed actions are emitted too**, which is the valuable half. `error`
  carries a code (`not-actionable`, `timeout`), not prose — the message
  belongs to the thrown error, the code is for grouping. The report puts failed
  actions on the timeline beside the steps; successful ones stay out, since the
  timeline is for what went wrong.

## Bounds

- Buffered output is capped at `maxOutputBytes` (32 MB default). On overflow the
  writer stops recording output and sets `meta.truncated`; steps, semantics and
  events keep recording. Losing the tail of a recording beats an OOM in CI.
- Pending appends are bounded by both record count and UTF-8 byte size;
  saturation becomes a controlled capacity failure.
- The reader streams `session.cast`, `events.jsonl`, `semantics.jsonl` and
  `logs.jsonl` line by line and caches only a small index of semantic records
  (time, revision, cast offset) — never the snapshots themselves. `semanticAt()`
  re-streams to fetch the one snapshot it needs.
- `openTrace()` reads a zip entirely into memory, guarded by a 512 MB ceiling
  (`archive.ts: MAX_ZIP_BYTES`) raising `TraceError('capacity')`.

## Dependency choices

### `fflate` for the zip container (not `node:zlib`)

`node:zlib` only produces raw deflate/gzip _streams_. A `.twtrace` that
transports as a single file has to be a real **zip container** — local file
headers, a central directory, an end-of-central-directory record — so that CI
artifacts, the runner UI's file picker and `unzip` on any machine can all open
it. Hand-rolling that on top of `zlib` is ~300 lines of byte layout for no gain.

`fflate` is 8 kB, dependency-free, ESM, and offers both the synchronous API used
here and a streaming one if archives ever outgrow memory. Alternatives rejected:
`adm-zip` (CJS, larger), `yazl`/`yauzl` (two packages, callback API), `jszip`
(heavy).

### `asciinema-player` bundled inline

`asciinema-player@3.17` ships a self-contained
`dist/bundle/asciinema-player.min.js` (184 kB) and `.css` (20 kB) — no worker
file, no external fetches. The report inlines both at generation time and mounts
one player per test with `AsciinemaPlayer.create({ data: <cast text> }, el)`.
Verified in a real browser: the page issues exactly one network request
(itself), and the cast's `m` events show up as labelled markers on the player's
progress bar.

Recordings above `maxEmbeddedCastBytes` (4 MB default) are omitted with a note
rather than producing a 100 MB HTML file.

### No direct dependency on xterm

`@termwright/vt` is the only package that knows about xterm; the cell and buffer
types come from it too. `@xterm/addon-serialize` is deliberately **not** used
despite the design doc naming `serializeAsHTML`: it serializes a whole buffer in
one call, and a visual diff needs per-row output so changed rows can be
highlighted and aligned. `render.ts` therefore walks the buffer cell by cell,
producing one HTML fragment per row plus that row's plain text.

### `@termwright/protocol` declared as a dependency

`/CONTRACTS.md` allows trace to type-import from protocol, and it must: the
archive stores `SemanticSnapshot` verbatim, and the driver imports that type
without re-exporting it, so `.d.ts` consumers cannot resolve it transitively
under pnpm's strict layout. Every import is `import type`; nothing from protocol
survives into `dist/index.js`.

## Resolved

Kept so the reasoning is not rediscovered, and so a reader does not mistake a
closed question for an open one.

- **Clock coupling with the driver.** `SessionEventMap.timeMs` is now defined in
  §Trace as milliseconds since session start, monotonic, never resetting. The
  writer still anchors on the first driver event it sees, recording its own
  clock at that moment and following the driver's deltas from there, so it stays
  correct whatever epoch the driver picks — the guarantee makes that belt and
  braces rather than a necessity.
- **Log sources had labels but no paths.** The driver added `path` to `app-log`
  (c73b090); `meta.logs.sources` is `{label?, path?}[]` and file entries carry
  their path. Raised while agreeing the format with the runner UI, which had
  asked for exactly that shape.
- **Replay used different width tables from the session.** Closed by
  `@termwright/vt` and `meta.terminalProfile` — see "The replay measures
  characters like the session" above, which describes the current behaviour.
- **Profile ids had to be cast to a union.** `@termwright/vt` gained
  `resolveProfileId`, a non-throwing lookup for callers whose profile is
  external data, so the cast is gone.
