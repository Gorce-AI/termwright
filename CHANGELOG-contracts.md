# Contract changes

- 2026-08-15: `ProtocolViolation` lives in `@termwright/protocol` (own class);
  the driver wraps it into `TermwrightError('protocol-violation')` at the
  semantic-channel boundary. Other packages may mirror the `TermwrightError`
  shape structurally until they take a runtime dependency on the driver.
- 2026-08-15: `trace` may type-import from `protocol` (dependency rules
  updated).
- 2026-08-15: `events.jsonl` lines carry `castOffset` in addition to `t`;
  readers fall back to `t`.
- 2026-08-15: `SessionEventMap.timeMs` defined as ms-since-session-start,
  monotonic, never resetting (binding for the driver).
- 2026-08-15: snapshot validation is stricter than the origin-spec prose:
  parentless nodes must appear in `rootIds`; `labelledBy`/`describedBy`
  targets must exist in the same snapshot.
- 2026-08-15 (driver landed): `launchTerminal` accepts `LaunchTerminalOptions`
  (superset: + `backend?: PtyBackend`, injectable for mountInk). `recording`
  option is accepted and ignored by the driver — recording belongs to
  `@termwright/trace` via `SessionEvents`. `capabilities().semanticTree` is
  true from successful handshake (not first tree); semantic locators wait when
  no tree arrived yet, `unsupported-action` only in settled-generic sessions.
  `close()` hangs up the PTY (SIGHUP/TerminateProcess) as part of physical
  cleanup; destructive signals remain explicit. `.class` CSS-dialect semantics
  provisional (matches testId/name token) pending protocol-level classes.
- 2026-08-15: `waitForReady` (shell prompt) missing from api.ts — deferred
  addition before 1.0 (timeout class 'ready' already defined).
- 2026-08-15 (mcp landed): `mcp` MAY depend on `@termwright/protocol` for
  constants/types (rule relaxed; removes duplicated SEMANTIC_ROLES/limits).
  Compact snapshot carries BOTH counters explicitly: screen `revision`
  (capture_since cursor) and `semanticRevision` (refs `nX@rev`). Structured
  tool errors ride in `_meta["io.termwright/error"]` (SDK clients validate
  structuredContent against outputSchema even for isError — documented
  deviation from "structuredContent everywhere").
- 2026-08-15 (test landed): `test` MAY depend on `@termwright/protocol` at
  runtime for `SEMANTIC_ROLES`/`SemanticState` (same relaxation as `mcp`; the
  YAML snapshot parser validates roles and flags against the closed sets
  instead of forking them). §YAML additions, all backwards compatible with the
  documented format: `!flag` negates, `flag=value` compares (`checked=mixed`,
  `level=2`), `'* "Name"'` matches any role (must be quoted — a bare `*` is a
  YAML alias), listed children must keep their relative order while unlisted
  siblings are allowed, names are compared whitespace-normalized, and a head
  containing `#` is emitted single-quoted. Snapshot files live in
  `__snapshots__/<test file>.tw-{semantic,cells}.yaml`; the `all|changed|
  missing|none` modes come from `TERMWRIGHT_UPDATE_SNAPSHOTS`, falling back to
  Vitest's `--update` (`-u` → `changed`, plain run → `missing`).
- 2026-08-15 (conformance findings): (1) depth-ceiling violations must map to
  wire 'limit-exceeded' (not 'malformed') — driver maps ProtocolViolation
  machine codes onto the wire taxonomy explicitly. (2) `revision-commit` is
  ADVISORY in v1: pairing authority is snapshot+DCS marker (§4.3); the driver
  records commits in diagnostics only. (3) api.ts extension approved:
  SessionEventMap gains `diagnostic` events and the harness exposes a bounded
  read-only channel-diagnostics log (dropped/superseded revisions, unverified
  markers, pairing expiries).
- 2026-08-15 (driver round 2, f78174f): api.ts gains — `diagnostic` event +
  `harness.diagnostics()` with CLOSED DiagnosticCode set (13 values; adding one
  is a contract change), `waitForReady` (OSC 133 preferred, settled-screen
  fallback, strategy reported via 'ready-strategy' diagnostic),
  `locatorForRef(ref)` (identity-based, semantic `nX@rev` and grid
  `grid:r,c,w,h@rev` refs, stale checked at resolve), `Locator.description`,
  and `envMode` — BREAKING DEFAULT: 'replace' (allowlist PATH/HOME/LANG/
  LC_ALL/SHELL/TMPDIR/USER/TERM + explicit env + handshake vars; matches mcp
  SAFE_ENV_KEYS). Ceiling violations (frame-oversized, dto-depth) map to wire
  'limit-exceeded'; structural violations stay 'malformed'. revision-commit is
  advisory, recorded as 'revision-commit' diagnostic.
- 2026-08-15: textbox textContent returns `value` whenever defined (including
  ''), falling back to `name` only when value is undefined.
- 2026-08-16: SessionDiagnostic gains optional `wireCode?` on
  'protocol-violation' entries (approved; closes the last indirect
  conformance assertion). `waitForReady` must check process liveness before
  reporting readiness (consistent with other waits).
- 2026-08-16: DiagnosticCode 'ready-strategy' is REPLACED by two codes:
  'ready-shell-integration' and 'ready-settled-screen' (fact vs heuristic must
  be distinguishable by code, not prose). Closed-set size: 14.
- 2026-08-16 (ui landed): `ui` may **type-import** from `protocol`
  (`SemanticSnapshot` passes through the UI verbatim), same relaxation as
  `trace`; it stays a dev dependency, no runtime import. `§UI events` is
  implemented exactly as written — the runner's extra needs (session list,
  `stateAt` for time travel, recorder codegen) are HTTP routes under `/api/`,
  not new message types. Clarifications used by the implementation, all within
  the contract's wording: `step` carries optional `stepId`/`t`/`status` (nested
  steps pair up, offsets are cast-timeline milliseconds), `pick` carries an
  optional `enabled` flag so pick mode can be turned off, and `run-start`
  carries `mode` (`live` | `post-mortem` | `record`) plus `startedAt`. Live
  `output`/`semantic` messages are produced by whoever owns the session
  (`attachSession(hub, harness)`); the Vitest bridge alone cannot emit them from
  a worker process and emits `step` messages post-hoc from the test's trace.
- 2026-08-16: task #17 approved — `mcp` MAY depend on `@termwright/trace` for
  trace.* replay tools; new package `@termwright/screenshot` (SVG + resvg PNG,
  no Chromium) owned alongside trace.
- 2026-08-16 (opentui + umbrella landed): no contract changes; two
  clarifications adapter authors need. (1) `validateSnapshot`'s DTO projection
  rejects a snapshot in which **any value is reachable twice** ("value is
  reachable more than once at $.nodes[N].actions"). A role→actions table that
  hands out one shared frozen array therefore fails validation as soon as two
  nodes share a role; every adapter must copy such arrays per node.
  `@termwright/opentui` does; `@termwright/ink` did not, and fixed it in
  6f41325. **Blast radius, corrected after impl-ink verified it:** the wire is
  unaffected, because `encodeFrame` is `JSON.stringify`, which has no concept
  of reference identity and flattens an alias into two equal values. Only
  IN-PROCESS consumers of a snapshot object see it — `@termwright/ink-testing`,
  the conformance probe's in-memory checks, and `get-tree` answers that hand
  back the retained object. This is therefore a TypeScript-only trap; a Python,
  Go or Rust adapter serialises on the way out and cannot hit it.
  The same fact explains why it hides: a test that validates what came off the
  socket validates a post-serialisation copy, and serialisation destroys the
  evidence. Two same-role nodes are necessary but not sufficient to catch it —
  the snapshot must be validated **in memory**, straight off the collector.
  Copy at the node-construction site rather than making the role table return
  fresh arrays: the second alias source is an application author reusing one
  `const actions` across several annotation calls, and only the collector-side
  copy catches both. (2) `maxDepth` bounds the DTO projector's *object nesting*, not just
  semantic tree depth, so it cannot be tightened below what a snapshot object
  itself needs (~5) when testing truncation.
  The umbrella `termwright` CLI adds no taxonomy of its own: it imports
  `EXIT_CODES` / `exitCodeFor` / `toErrorPayload` / `buildAgentContext` /
  `buildUsage` / `buildAgentSkill` / `runCli` from `@termwright/mcp`, and
  `termwright mcp <args>` forwards verbatim. Its one added rule is that a
  failing test run under `termwright ui` exits 1 (assertion), not 5.
- 2026-08-16 (examples finding): stored semantic snapshot FILES are compared
  STRICTLY (full tree, exact flags; new nodes/states fail; `changed` rewrites
  on any textual diff). Inline patterns remain partial. Previously file
  snapshots silently used partial matching and could never fail on additions.
- 2026-08-16 (approved, driver 7f77ea3): negotiation window says when a session
  STARTS behaving generic; a bounded late-attach grace (default 2 s) says when
  that verdict becomes FINAL. During grace semantic locators wait; after it
  they throw 'unsupported-action' immediately. Hello after grace expiry is
  REJECTED (wire 'internal' + diagnostic) — §4.1 "late hello never flips a
  selected mode" is now enforced, with the grace as the explicit tolerance.
  api.ts gains LaunchOptions.debug?: boolean (TERMWRIGHT_DEBUG=1|all).
- 2026-08-16 (screenshot landed): `@termwright/screenshot` depends on `driver`
  types + `protocol` type-imports (`CursorInfo`), never on `trace`. §Trace gains
  a reader-side helper: `frameAt(reader, timeMs)` / `frameFromAnsi(ansi, opts)`
  return a `TraceFrame` — a structural subset of `ScreenSnapshot` (columns,
  rows, cursor, `cell()`, `line()`, `text()`, plus `timeMs`/`semanticRevision`)
  with no `revision`/`modes`/`buffer`, because a recording stores output, not
  emulator state. `ReportTestResult` gains `screenshots?: {label, image,
  mediaType?}[]`, inlined as data URIs; the report never rasterises anything
  itself, so no native renderer enters the default test-run dependency tree.
- 2026-08-16 (crash report, driver 0d02ab2): api.ts gains `crashReport()`,
  `crash` event (emitted just before `exit`), crash summary in
  'process-exited' diagnostics. "Unexpected" = signal or code!=0 without a
  harness-initiated close()/signal(). `exit` is now published only after the
  VT queue drains (<=250 ms) — waitForExit resolves on a complete screen.
  waitForReady counts OSC 133 B or D as readiness (A/C are not). screenTail
  is deliberately NOT redacted (a faithful screen record) — consumers must
  treat crash reports like screenshots when storing/transmitting;
  recentInputs records paste only as size.
- 2026-08-16 (soak finding, BINDING evolution rule): `limits` in hello-ack is
  ADDITIVE — receivers (all protocol clients) MUST ignore unknown keys in the
  `limits` object (tolerant reader). Known keys stay strictly typed. Closed
  sets (message types, roles, actions, state fields) remain strict — those
  are behavioral. Adding a ProtocolLimits key is NOT a breaking change;
  removing/retyping one is. Reference schema and py/go/rust clients updated
  accordingly; test vectors gain an unknown-limit-key acceptance case.
- 2026-08-16 (crash in trace): §Trace — `meta.json` gains `crash?`, mirroring
  the driver's `CrashReport` but carrying `castOffset` and storing
  `lastSemanticRevision` instead of the tree (resolved via
  `TraceReader.crashSemantic()`); `events.jsonl` gains a `crash` kind carrying
  the exit, screen-tail row count and revision only. `crash` fires before
  `exit`, and `exit` only after the emulator drains, so the stored screen tail
  is the screen the recording ends on. `meta.crash.screenTail` is NOT redacted
  (driver's wording is binding): every consumer that displays it repeats the
  warning — the HTML report shows it as a banner above the tail.
- 2026-08-16 (log tail, driver 9d7987a): LaunchOptions.logs (file tail) +
  SessionEventMap 'app-log' {source:'file'|'adapter', label?, line?, record?}.
  Two new DiagnosticCodes: 'log-dropped' (data we failed to deliver) and
  'log-source' (source state change: attach/rotate/truncate/error). Closed
  set: 16.
- 2026-08-16 (evolution rule, part 2): driver→adapter messages (hello-ack,
  get-tree request) are TOLERANT READERS end to end — adapters/clients ignore
  unknown fields anywhere in these envelopes (known fields stay type-checked).
  Rationale: the driver is the trusted side and these messages are
  informational; behavior is governed by negotiated capabilities. Adapter→
  driver messages remain STRICT (hostile-input boundary). Adding an optional
  field to a driver→adapter message is NOT breaking; adapter→driver envelope
  changes still are.
- 2026-08-16 (protocol, task #22 phase 1, 90ca78f): capability `logs` +
  adapter→driver message `log { record }`, LogRecord {ts(epoch ms), level,
  message, seq, attrs?(flat, <=64 keys), logger?, revision?}. ProtocolLimits
  += maxLogRecordBytes, maxLogQueue. HelloAck.logs {enabled,
  maxRecordsPerSecond, burst} is OPTIONAL — absent means logs disabled (older
  drivers stay correct). `limits` additive rule implemented (unknown keys
  ignored and passed through). New package `@termwright/logs`: channel
  `termwright:log` (node:diagnostics_channel) as a public contract; bridges
  pino/winston/consola/otel as optional peers; secret redaction on both sides.
- 2026-08-16 (protocol 63e1dbc): direction decides strictness — implemented.
  parseDriverMessage tolerant end to end (envelope + nested driver objects
  marker/logs, unknown fields passed through); parseAdapterMessage strict.
  The bidirectional `error` message is read strict from the adapter and
  tolerant from the driver. Still strict both ways: known-field types and
  closed sets (type, error.code, subscribe, roles, actions, log levels).
  Vector `hello-ack-extra-field` moves reject→accept as
  `hello-ack-unknown-envelope-field` (clients to update).
- 2026-08-16 (driver 1e2aba7, #22 phase 2b): 'app-log' carries both paths —
  {source:'file', line} and {source:'adapter', record: LogRecord}. Adapter
  logs without a negotiated budget close the channel as a protocol violation.
  Wall-clock record ts is anchored to the session clock at handshake and
  clamped to [0, now]. DiagnosticCode set stays 16.
- 2026-08-16 (logs in trace, #22): §Trace gains an OPTIONAL fifth member
  `logs.jsonl` (absent when the session logged nothing) plus `meta.logs`
  `{count, dropped, sources, levels}`. One line shape for both driver payloads:
  `line` and `record.message` both land in `message`, `source` keeps the
  provenance — a file line has no `level` and consumers must not infer one from
  its text. `dropped` counts oldest-first evictions and is computed at
  finalize (a counter flushed on the next event loses the last window when a
  flood ends the session). `TraceState` gains `logs` (window of preceding
  entries, `stateAt(t, {logWindow})`, default 20) and `TraceReader` gains
  `logs()`. Redaction is the source's job (`@termwright/logs`); tailed file
  lines are raw and carry `crash.screenTail`'s handling caveat.
- 2026-08-16 (seq semantics): LogRecord.seq is STRICTLY increasing within a
  semantic session. A duplicate or decreasing seq rejects that single record
  with a 'log-dropped' diagnostic (detail names the reason); it does NOT
  close the channel. An upward gap still means source-side dropping and is
  reported as before. File follower fingerprint fix (driver 56c410f): head
  window fixed at snapshot time, no re-emission on append to short files.
- 2026-08-16 (driver c73b090): AppLogEvent gains optional `path` (filled for
  source 'file'); adapter records carry none. Additive.
- 2026-08-16 (seq authority): the ADAPTER is the authority for wire `seq` —
  it renumbers records crossing the public channel in send order; the
  publisher's own seq is a local hint only. Records dropped by the adapter's
  rate limit still CONSUME numbers, so an upward gap keeps meaning
  source-side dropping. This makes strict-increase trivially satisfiable
  even with multiple independent publishers on `termwright:log`.
- 2026-08-16 (ui 7c743be): §UI events gains `app-log`. `ui` needs no
  dependency relaxation for logs — the level ladder is duplicated locally
  (browser bundle cannot import Node-only protocol) and pinned by an equality
  test against LOG_LEVELS.
- 2026-08-16 (approved): SessionDiagnostic gains optional `count?: number` —
  how many things the entry covers (records dropped at source / by driver
  budget, file lines rate-limited, revisions dropped). Filled wherever the
  number previously lived only in `detail` prose. Closed code set stays 16.
- 2026-08-16 (ui 880a7fe): §UI events extended — test-start gains file?,
  startedAt?, sessionId?; test-end gains error?, durationMs?, flaky?;
  run-end summary gains flaky?, durationMs?. All optional/additive. test↔
  session binding remains optional (reporter cannot know worker sessions);
  no testId on output/semantic.
- 2026-08-16 (owner decision): pre-1.0 there is ONE producer generation —
  §UI events fields are REQUIRED (file, startedAt, durationMs, flaky,
  summary.flaky, summary.durationMs); optional only where genuinely unknowable
  (sessionId) or genuinely absent (traceRef, error). Receiver-side fallbacks
  removed. General rule for all in-repo contracts until 1.0 ships: no
  backward-compat shims, no "older producer" branches.
- 2026-08-16 (driver 3a1f27a): SessionDiagnostic.count is filled only where
  the entry AGGREGATES lost items; a rejected seq-duplicate is not a loss and
  carries no count; single-item entries identify via `revision`. Absent count
  means "this entry does not aggregate", NOT zero.
- 2026-08-16 (mountOpenTui, task #27b): `@termwright/opentui` gains a
  **`./testing` subpath** that imports `@termwright/driver` and
  `@termwright/ink-testing`. Read against §Dependency rules ("adapters depend on
  `protocol` + their framework, never on driver") this is a deviation, and it is
  deliberate: task #27b placed the mount inside the adapter package rather than
  in a sibling `opentui-testing` the way Ink has one. The rule's actual purpose —
  an adapter is imported by the application in production and must not drag a pty
  binary in — is preserved structurally instead of by package boundary: the mount
  is unreachable from the root entry, both packages are **optional peer**
  dependencies (a production install resolves neither), and
  `packages/opentui/src/mount.test.ts` asserts against the built `dist/index.js`
  that it references neither, so re-exporting the mount from `src/index.ts` fails
  the suite. Adapters in general remain bound by the rule as written; if a second
  consumer needs these at the adapter's root, split out
  `@termwright/opentui-testing` and mirror Ink.
- 2026-08-16 (ui e6e4403): §UI events gains `action` (driver call/assertion
  mirror of events.jsonl); live producer is the reporter via Vitest 3.2
  onTestAnnotate.
- 2026-08-16 (#27f): §Trace — `meta.logs.sources` is `{label?, path?}[]` (was
  `string[]`), and `logs.jsonl` file entries carry `path`, following the
  driver's `app-log` gaining it (c73b090). Per-entry rather than an index into
  `sources`, because the driver's own contract says a label can be shared
  between sources — two nodes logging under `app` must stay distinguishable.
  No compatibility branch: one generation of producers.
- 2026-08-16 (approved): SessionEventMap gains `action`
  {api, selector?, ref?, ok, error?, timeMs} — emitted by the driver for every
  locator/harness action (click/press/type/...), success and failure alike.
  TraceWriter records it as events.jsonl kind 'action'; the preset records
  only assertions (its own layer); UI live gets actions via attachSession.
- 2026-08-16 (owner rule applied to §Trace): castOffset is REQUIRED on every
  events.jsonl line; the reader fallback to `t` is removed (single writer
  generation pre-1.0).
