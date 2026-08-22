# termwright — normative cross-package contracts

Read together with `docs/superpowers/specs/2026-08-15-termwright-design.md`
(the design) and the origin spec it references. On conflict: this file wins for
interfaces, the design doc wins for scope, the origin spec wins for invariants.

## Source of truth per interface

| Contract | Normative location |
|---|---|
| Semantic wire protocol (messages, framing, marker, limits, roles) | `packages/protocol/src/*.ts` |
| Driver public API (`TerminalHarness`, `Locator`, errors, events) | `packages/driver/src/api.ts` |
| Trace archive format | this file, §Trace |
| UI ↔ runner event protocol | this file, §UI events |
| MCP tool surface | this file, §MCP |
| Semantic YAML snapshot format | this file, §YAML snapshots |

Changing a normative file requires: update it first, note the change in
`CHANGELOG-contracts.md`, then adapt consumers. Never fork a contract locally.

## Dependency rules (enforced by review)

- `protocol` depends on `zod` only. Never on React, Ink, MCP, PTY, driver.
- `driver` depends on `protocol` + PTY/VT libs. Never on Ink, Vitest, MCP.
- `opentui` is an annotation-only SDK. It depends on `protocol`, declares its
  framework as a peer, and never depends on driver or owns a semantic
  transport. Its process-local weak registry is the boundary probes read when
  the SDK is present.
- `test` depends on `driver`, `trace`, `protocol` constants/types and UI's
  Node-only `live-client`; it declares `vitest` as a peer. The live client is
  fail-open and dormant unless `TERMWRIGHT_UI_URL` is set.
- `ink` contains both the annotation SDK and component-test harnesses. It
  depends on `driver`, `probe-ink` and `protocol`; its in-process testing entry
  is not a public manual adapter.
- `mcp` depends on `driver` + MCP SDK behind `src/sdk-facade.ts` (may also import constants/types from `protocol`). No session logic of its own.
- `trace` depends on `driver` types only (consumes `SessionEvents`) and may
  type-import from `protocol` (it stores `SemanticSnapshot` verbatim).
- `screenshot` depends on `driver` types only (consumes `CellSnapshot`) and may
  type-import from `protocol` (`CursorInfo`). Never on `trace` — the trace
  reader produces frames for it, not the other way round.
- `vt` depends on xterm packages only (`@xterm/headless`, addons). driver,
  trace, screenshot and ui consume terminals SOLELY via its
  `createTerminal(profile)` — private per-package terminal factories are how
  the U6/U11 width split happened and are banned.
- `logs` depends on `protocol` only; logger libraries (pino, winston,
  consola, OpenTelemetry) are OPTIONAL peers, never runtime dependencies.
- `ui` depends on `trace` + `driver` and `ws` for its Node transports, and may
  type-import protocol DTOs. It talks to Vitest only via our own event
  protocol; `test` may consume its isolated `live-client` subpath without
  importing the browser/server entry.
- `probe-runtime` depends on `protocol`; `recognizers` depends on `protocol`;
  `probe-go` has no runtime dependencies. Framework probes may compose those
  shared layers instead of duplicating transport, normalization or build-copy
  machinery. A runtime-interception probe may declare the observed framework
  as a peer; an exact-version build probe redirects a dependency by path and
  does not import the framework from its Node launcher. The driver never
  depends on a framework probe.
- `conformance` may depend on everything; nothing depends on it.

## Engineering baseline (all packages)

ESM only, Node >= 22, TS strict per `tsconfig.base.json`, build with tsup,
tests with vitest (`*.test.ts` next to sources), no default exports, no `any`
in public surfaces. Every public function/type gets TSDoc. Errors thrown across
package boundaries must be `TermwrightError` subclasses. All I/O bounded per
`DEFAULT_LIMITS`/`ABSOLUTE_LIMITS`. Hostile-input suites must pass under
`node --max-old-space-size=128`.

"The screen settled" and "the semantic tree caught up" are TWO different
events — the tree travels over the socket, the commit marker over the byte
stream. Any test that reads semantics after an action waits for the
REVISION to advance, never for the render to settle.

Validation-rule discipline (born of the frameworkType incident): a runtime
validation rule has no reflection in the types, so a clean typecheck proves
nothing about its blast radius — the rule's author asks "who produces values
this will reject" and pings those owners BEFORE the rule lands. A validation
test asserts the REJECTION CODE, never the bare fact of rejection —
otherwise every rule that fires earlier silently hollows out the fixtures of
later ones. Reviewing a test-vector regeneration means diffing each
vector's `code` under an unchanged name: that diff is the only trace
masking leaves.

## §Trace — `.twtrace` archive

A directory (zipped for transport) containing:

- `COMMITTED` — versioned SHA-256 manifest for every required member. The
  writer prepares and fsyncs a sibling staging directory, writes this marker
  last, then atomically renames the directory into place. A staging directory,
  a missing marker, or a checksum mismatch is never a readable complete trace.
  `packTrace()` accepts only such a committed directory.

- `meta.json` — `{ v: 1, sessionId, command, columns, rows, startedAt,
  platform, terminalProfile?, semanticTree: boolean, exit?: {code, signal},
  crash?: {t, castOffset, exit, screenTail, lastSemanticRevision,
  recentInputs, diagnosticsTail} }`. `crash` mirrors the driver's
  `CrashReport` with two changes: it carries `castOffset`, and it stores the
  last semantic *revision* instead of the tree (the tree is already in
  `semantics.jsonl`). **`screenTail` is verbatim terminal output and is never
  redacted** — an archive carrying a crash must be treated like a screenshot;
  consumers that display it must repeat that warning.
- `session.cast` — asciicast **v3**; markers array entries map to test steps:
  label = step title. Recording includes all PTY output; `Hide()/Show()`
  windows excluded at write time.
- `events.jsonl` — one JSON object per line:
  `{ t: <ms>, castOffset: <ms>, kind: 'input'|'resize'|'step-start'|'step-end'|
     'action'|'assert'|'crash', ... }` where `action` carries
  `{ api, selector?, ref?, ok, error? }`. `castOffset` is REQUIRED and
  positions the event on the (idle-trimmed, hide-window-adjusted) recording
  timeline. There is no reader fallback — one writer generation exists.

`terminalProfile` is `TerminalHarness.terminalProfile`; absent in a legacy
archive means
`'default'`. Replay MUST construct its emulator through `@termwright/vt`'s
`createTerminal` with that profile — a session and its replay measuring
characters differently place wide characters a column apart with nothing
failing. A profile the reader does not know is a `protocol-violation`, never a
fallback to default. It lives in `meta.json`, not in the asciicast header: it
describes the session, and `meta.json` is ours to extend.

`SessionEventMap` `timeMs` semantics (binding for the driver): milliseconds
since session start, monotonic, never resets for the lifetime of a session
(reconnects included).
- `semantics.jsonl` — `{ t: <ms>, revision, castOffset: <ms>, snapshot }`,
  snapshot = `SemanticSnapshot` verbatim.
- `logs.jsonl` — OPTIONAL, absent when the session logged nothing. One entry
  per line: `{ t: <ms>, castOffset: <ms>, source: 'file'|'adapter', label?,
  level?, message, attrs?, seq?, revision?, ts? }`. The driver's `app-log`
  carries either `line` (followed file) or `record` (adapter); both are stored
  as `message`, with `source` preserving the provenance. A file line has NO
  `level` — consumers must not infer one from its text. `meta.logs`
  summarises: `{ count, dropped, sources, levels }`, where `sources` is
  `{label?, path?}[]` and `dropped` counts entries evicted by the writer's
  ceiling (oldest first) and is computed at finalize, never flushed on a
  following event. A file entry repeats its `path`: a label may be shared
  between sources, so a label alone cannot attribute a line to its file. Redaction happens at the
  source (`@termwright/logs`); file lines are RAW and carry the same handling
  caveat as `crash.screenTail`.

Writer/reader live in `@termwright/trace`; UI and HTML report consume only via
those readers. Readers classify artifacts as `complete`, `incomplete`,
`corrupt`, or `unsupported-version`; they never silently treat partial output
as an older valid trace.

## §UI events — runner ↔ browser

WebSocket, JSON messages `{ v: 1, type, ... }`:
- server→client: `tests-discovered {tests: [{id, title, file, ...}]}` (project
  listing from programmatic native collection; `id` is the invocation-scoped
  `RunnerTaskId`; duplicate names and parameterized cases remain distinct;
  collection/config failure emits `collection-failed` and is never rewritten
  as an empty suite),
  `run-start {runId, mode, startedAt}` (`runId` is the exact host RunId;
  `mode` is `live | post-mortem | record`),
  `session {sessionId, terminalProfile, columns, rows, testId?, contract?,
  adapterStatus?}` (sent when a live session attaches; the browser MUST build
  its terminal via the session's profile or state the widths it renders with;
  `testId` is the owning AttemptId; `contract` is the frozen Effective Session
  Contract; a later `session` for the same id replaces its lifecycle facts in
  the recoverable-state backlog),
  `test-start {id, runnerTaskId?, executionId?, attempt?, title, file,
  startedAt, sessionId?}` (`id` is AttemptId for native execution; the optional
  identity fields are absent only for recorder pseudo-cases),
  `step {testId, title, phase, stepId?, t?, status?}`,
  `output {sessionId, dataB64, t}`,
  `semantic {sessionId, revision, snapshot}`,
  `app-log {sessionId, t, source, level, message, label?, logger?, seq?,
  revision?, attrs?}`,
  `action-start {actionId, api, t, testId?, sessionId?, selector?, stepId?}`,
  `action {kind, api, t, ok, actionId?, testId?, sessionId?, selector?, ref?,
  error?, stepId?}` (`actionId` correlates a driver completion with its live
  start edge and is scoped to `sessionId`; assertions may publish only the
  completion),
  `test-end {id, status, durationMs, flaky, lostLogRecords, traceRef?,
  error?, attempt?, priorFailures?}` (`attempt` is the one-based native retry
  ordinal; `priorFailures` is its ordered `{attempt, errors[]}` history.
  `lostLogRecords` is REQUIRED — 0 is representable, and "nothing
  was lost" and "nobody counted" are different facts),
  `run-end {summary: {total, passed, failed, skipped, flaky, durationMs}}`,
  `run-cancelled {stoppedAt}` (emitted after the stopped test process exits;
  unfinished rows become cancelled, never silently skipped),
  `run-cancel-failed {error}` (the process could not be stopped; the run stays
  active),
  `actionability-inspection {requestId, sessionId, nodeId, results|error}`
  (request-scoped reply; `results` contains exactly the live worker's four
  ActionPlanner explanations for click, hover, focus and type, all bound to the
  same committed checkpoint; the server neither reconstructs nor caches these
  answers, and sends them only to the requesting browser).
  Optional fields are exactly those marked `?` above. In particular,
  `test-start.sessionId` may be absent because an attempt can launch zero or
  several terminal sessions; the worker-side bridge sends ownership on
  `session.testId` instead. `traceRef` is absent when no archive was
  retained, and `test-end.error` is absent on pass.
  `tests-discovered.id` and `test-start.runnerTaskId` are the same native
  RunnerTaskId. `test-start.id`, `test-end.id`, `step.testId`,
  `action-start.testId`, `action.testId` and `session.testId` carry AttemptId.
  No event is reconciled by file/title.
  There are no receiver-side fallbacks — this protocol has exactly one
  producer generation. `summary.flaky` is counted separately from `passed` —
  hiding flaky inside passes is how flaky stays forever.

`app-log` carries one application log entry: `source` is `'file'` (a followed
file line) or `'adapter'` (a record from an instrumented adapter), `t` is
session-clock milliseconds, `level` is a protocol `LogLevel` or **`null`** —
a file line has no level and none may be inferred from its text. `attrs` are
flat scalars. Receivers mark only `warn`/`error`/`fatal` on the timeline;
level-less entries produce no markers but are always listed.

`action` carries one driver call (`kind: 'action'`) or one assertion
(`kind: 'assert'`), exactly as `events.jsonl` records them: `api` is the
API/matcher name, `t` is session-clock ms, `ok` is the outcome, `ref` is the
resolved target: either semantic `semantic:n8@42` or revision-bound screen
`grid:r,c,w,h@rev`. Stable semantic refs may re-resolve across revisions;
frame-local semantic refs are refused and grid refs expire with their screen
revision. Receivers build a command log identical to what replay reads from the
archive.
- client→server: `pick {sessionId}` (inspector pick-mode),
  `input {sessionId, dataB64}` (recorder mode only),
  `inspect-actionability {requestId, sessionId, nodeId}` (live mode only; routed
  to the owning worker's production ActionPlanner, never answered from replay
  or browser-side geometry).
Run/rerun/stop are typed HTTP requests carrying RunnerTaskIds and exact RunId;
they return an outcome and are never fire-and-forget WebSocket controls.
The native host owns the authoritative Run Event Journal. Worker producers use
an authenticated channel with exact RunId, producer epoch and sequence; UI and
human reporters are projections and browser code never imports Vitest.

Run history is committed by the host under the collision-safe RunId. A staging
directory contains start-time Git/CI/runtime/resource provenance, the complete
accepted event journal, native Spec/Task/Execution/Attempt identities and the
terminal run state. Checksums, fsync and one atomic rename are the certification
commit. Readers distinguish `complete`, `incomplete`, `corrupt` and
`unsupported-version`; there is no timestamp identity or legacy manifest
fallback. Opening a retained trace still goes through the same `openArchive`
validation path as `--trace`.

## §MCP — tool surface (all tools validate with zod, return structuredContent)

`terminal.launch`, `terminal.capabilities`, `terminal.snapshot` (compact ref
format + visible text; `full` variant writes to disk and returns refs),
`terminal.capture_since {cursor}` (changed rows + changed semantic subtrees),
`terminal.query {selector|role/name}`, `terminal.checkpoint`, `terminal.actionability`,
`terminal.click`, `terminal.double_click`, `terminal.hover`, `terminal.press`,
`terminal.type`, `terminal.fill`, `terminal.check`, `terminal.uncheck`, `terminal.paste`, `terminal.write_raw`,
`terminal.drag`, `terminal.wheel`, `terminal.resize`, `terminal.signal`,
`terminal.scrollback`, `terminal.select_cells`, `terminal.copy_selection`,
`terminal.wait_for`, `terminal.close`.

Compact snapshot format (normative):

```
Terminal t1 100x30 revision 42
semanticTree: available
dialog "Permission" ref=semantic:n7@42 bounds=(8,20,40,9) modal
  button "Approve" ref=semantic:n8@42 bounds=(14,23,11,1) focused
visible text:
<grid text>
```

CLI: exit codes 0 ok / 1 assertion / 2 usage / 3 no-session / 4 ipc / 5 internal;
global `--json` (errors carry `kind`); `termwright agent-context` emits
versioned JSON generated from the zod schemas.

## §YAML snapshots — semantic snapshot format

```yaml
- dialog "Permission" [modal]:
    - text "Allow bash to run?"
    - button "Approve" [focused]
    - button /Rej.*/
```

Rules: node = `- role "name" [state,flags]` with children nested; name may be a
`/regex/`; omitted name matches any. TWO comparison modes, by source:
- **inline pattern** (argument to the matcher): partial — omitted children =
  don't-care, `[state]` flags assert only what they list;
- **stored file snapshot** (generated into `__snapshots__`): STRICT — full
  tree, exact flags; any difference (including a NEW node or state) fails,
  and update mode `changed` rewrites on any textual difference.
Serializer+matcher live in `@termwright/test`; format shared with docs and UI
inspector copy-paste.

## Git hygiene in this shared tree (binding for every agent)

The git index is shared between concurrently working agents. Therefore:
1. Commit ONLY with explicit paths: `git commit --only <your-paths> -m ...`
   (never bare `git commit`, never `-a`, never `git add -A` without paths).
2. Never `git stash`, `git checkout`, `git reset` on the whole tree — your
   own paths only. To test "is my new test red without my fix", copy the
   file aside, don't rewind the tree.
3. Never `--amend` and never rewrite history: check `git log -1` before you
   commit; if HEAD is not yours, that's fine — just commit your paths.
   Practice notes: `--only` SKIPS untracked files — `git add <new files>`
   first, then `git commit --only <paths>`. And `--only <path>` protects
   against OTHER FILES entering your commit, NOT against someone else's
   uncommitted changes INSIDE the same file — the commit takes the tree's
   content for that path, period. For shared files (cli.ts, args.ts): announce
   yourself BEFORE the first edit, and check `git diff` for hunks that are
   not yours before committing. And `git checkout <ref> -- <paths>`
   writes to the shared INDEX, not just the working tree — check the first
   column of `git status --short` before committing.
4. Root files (pnpm-lock.yaml, CONTRACTS.md, workspace config) are committed
   by the coordinator only; report needed changes instead of committing them.

## Definition of done (every package)

1. `pnpm build && pnpm typecheck && pnpm test` green in the package.
2. Public surface documented (TSDoc) and exported through `src/index.ts` only.
3. Unit tests cover the package's contract obligations, including error paths.
4. No TODO/stub left in exported code paths; internal TODOs tracked in the
   package's `NOTES.md` if any.
5. README.md in the package: purpose, install, 30-line usage example.
