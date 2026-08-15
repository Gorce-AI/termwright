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

`events.jsonl` stores `castOffset` on every line. `/CONTRACTS.md` §Trace shows
`{ t, kind, ... }`; the field is additive and readers fall back to `t` when it is
absent, so older archives still open.

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
