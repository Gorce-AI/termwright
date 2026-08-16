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
