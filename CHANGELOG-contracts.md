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
- 2026-08-16 (protocol, task #25, 338932e/99eeed6): tree deltas. New adapter→
  driver message `tree-delta {baseRevision, revision, changed, removed,
  rootIds?, cursor?}` (capability tree-diffs); HelloAck.subscribe gains
  'diffs' — safe ONLY because the driver picks it solely for adapters that
  announced tree-diffs (gate, not set; extending a closed set WITHOUT such a
  gate stays breaking). Four normative composition rules: (a) changed =
  whole-node upsert by id (no field merging); (b) removed cascades through
  the subtree; (c) rootIds present replaces the root list, absent = base
  roots minus removed (adding a root REQUIRES rootIds); (d) removals apply
  BEFORE inserts (a delta may rescue a node from a removed subtree). Cursor:
  present replaces, absent = unchanged; hiding is visible:false; columns/
  rows/sessionId are inherited (resize deserves a full snapshot). Validation
  split: validateTreeDelta checks shape only; parent existence, acyclicity,
  depth and viewport membership are properties of the COMPOSED tree checked
  by applyTreeDelta via validateSnapshot. Resync per origin §8.3: mismatched
  base or removing an unknown node points at get-tree, never speculative
  patching. The reference composition (applyTreeDelta) lives in the protocol
  deliberately — one tested implementation instead of five.
- 2026-08-16 (#19/#23, driver 787c60a/94a0c37): new package @termwright/vt —
  single createTerminal(profile) factory; TerminalProfile with three REAL
  profiles (default, kitty, iterm2-ambiguous-wide), all on Unicode 11
  (unicode-graphemes addon hangs vitest workers — measured, documented,
  return path in vt/NOTES). Profiles are documented as differentiating
  switches, not emulator emulation. LaunchOptions.terminalProfile +
  SessionCapabilities.terminalProfile. harness.settled(opts?) returns
  capabilities once they stop changing (negotiation + grace + first tree);
  bare capabilities() stays sync. Field rename approved: reflowOnResize →
  reflowCursorLineOnResize (the name must not promise what xterm cannot do).
- 2026-08-16 (#19 trace side): §Trace — `meta.json` gains `terminalProfile?`
  (absent = 'default'), and replay must build its emulator through
  `@termwright/vt`'s `createTerminal` with it. Closes a silent inconsistency:
  the driver activated Unicode 11 and trace's own replay did not, so a session
  counted an emoji as two columns and its replay as one. An unknown profile is
  a `protocol-violation` — wrong width tables produce a frame that looks right
  and is not. Stored in `meta.json` rather than the asciicast header: it
  describes the session, and our file has no collision risk with the format.
- 2026-08-16 (driver 4a3261c): SessionEventMap gains `action` (ActionEvent
  {api, selector?, ref?, ok, error?, timeMs}) for every harness/locator
  action, emitted AFTER completion (input bytes precede the action entry on
  any timeline); `error` carries the CODE, not prose; failures are reported
  too. Approved for #25 reception round: new DiagnosticCode 'delta-resync'
  (set: 17) — resync is the opposite of loss; subscribe defaults to 'diffs'
  for tree-diffs adapters with a LaunchOptions override to force snapshots.
- 2026-08-16: §UI events gains `session {sessionId, terminalProfile, columns,
  rows}` emitted on live attach — profile describes a session, not a test.
  Post-mortem reads the profile from TraceMeta.terminalProfile (NOT from the
  cast header — trace deliberately keeps foreign formats clean).
- 2026-08-16 (#25 cursor clarification, protocol fa7235a): a delta can SET
  the cursor but cannot CLEAR it; `{visible:false}` (cursor exists, hidden)
  differs from an absent `cursor` (no cursor information). PRODUCER
  OBLIGATION: a tree transitioning from has-cursor to no-cursor REQUIRES a
  full snapshot, same as columns/rows changes. All three language clients
  independently implemented this degradation before it was written down —
  and one of them caught the gap; driver reception must honor the same rule.
- 2026-08-16 (driver 21a2847, #25 reception): subscribe defaults to 'diffs'
  for tree-diffs adapters; LaunchOptions.treeUpdates:'snapshots' forces
  snapshots (deltas then refused). Composition base is the HEAD OF THE CHAIN,
  held separately from what pairing published — a lost marker does not
  desync the chain. Failed composition → get-tree + 'delta-resync'
  diagnostic (set=17); deltas ignored until a full tree arrives; a get-tree
  timeout drops the REQUEST, not the session. A get-tree response at an
  already-held revision replaces the composition base without being
  re-published (a successful repair must not report as data loss).
  @termwright/vt gains /unicode subpath (applyProfile) for browser/trace use.
- 2026-08-16 (marker encoding, DECIDED by owner-delegated evidence): the
  render-commit marker moves from private DCS to a PRIVATE OSC everywhere —
  single path, no negotiation. Evidence: the in-CI escape-transparency probe
  shows ConPTY drops DCS/APC/OSC-8 but passes private OSC (BEL and ST) and
  OSC 133 on Windows; POSIX passes everything. Emit with BEL, accept BEL and
  ST. The probe stays in CI as a standing invariant ("what survives the pty
  is a conformance property"). Coordinated round: protocol (encodeMarker/
  verifyMarkerPayload + docs), driver (OSC handler), ink + py/go clients
  (emission), conformance (fixtures + asserts).
- 2026-08-16 (Windows mouse, DECIDED on probe evidence): ConPTY consumes
  mouse DECSET (1000/1002/1006) on the way to the observer while the child
  still enables and decodes mouse (probe: mouseTracking=none,
  childDecodedReport=true; 2004/1049 pass). TerminalModes.mouseTracking and
  mouseEncoding gain the value 'unknown', reported when the platform makes
  the mode unobservable (win32/ConPTY). The pointer gate refuses only a
  KNOWN-off mode; on 'unknown' it sends SGR-encoded input and records a new
  diagnostic 'mouse-mode-unverifiable' (closed set: 18). POSIX behavior
  unchanged ('none' remains known-off).
- 2026-08-16 (test): opcje per plik/suite przez natywne
  `test.scoped({ termwrightOptions })`; scalanie klucz-po-kluczu w `launch()`
  w kolejności config < scoped < launch(options), z `env` i `timeouts`
  scalanymi wpisami, `command` zastępowanym w całości; `launch({ files,
  template })` zasiewa prywatny katalog testu przed startem programu, ścieżki
  wychodzące poza niego są odrzucane. Polityka `trace` jest per SESJA
  (rozstrzygana przy launch), nie per test.
- 2026-08-16 (ui): §UI events + `tests-discovered` (listing projektu przed
  runem; id = `<file>::<name>`, wiersze adoptowane przez run, discovery
  nieblokujące). Historia runów: manifest `.termwright/runs/<ts>/manifest.json`
  (v:1, jeden producent — reporter; ścieżki archiwów, nie kopie; `lostRecords`
  per test), jeden czytnik `openArchive` dla --trace i widoku Runs.
- 2026-08-16 (driver): `TerminalModes.focusReporting` → `'on' | 'off' |
  'unknown'` — na ConPTY odczyt jest stanem HOSTA (włącza 1004 sam) i nie
  mówi nic o dziecku; przy 'unknown' driver wysyła CSI I/O + diagnostyka.
  Kod `mouse-mode-unverifiable` przemianowany na `mode-unverifiable` z polem
  `mode?: 'mouse' | 'focus'` (zbiór kodów zostaje 18, wpis raz na sesję per
  tryb). Opcja `mouseModesObservable` → `modesObservable`. Bez aliasów.
- 2026-08-16 (ui): §UI events `test-end` + wymagane `lostLogRecords: number`
  (0 reprezentowalne; „nic nie zginęło" ≠ „nikt nie liczył"). Manifest runów
  v2: licznik per test WYMAGANY; wpisy v1 odrzucane przez istniejący
  mechanizm wersji.
- 2026-08-16 (ui/cli): `termwright report --trace <plik> [--out-file] [--json]`
  emituje samowystarczalny raport HTML (bundle viewera + dane inline, file://,
  0 żądań sieciowych; budżet 8 MiB — klatki cięte od końca, logi od
  najstarszych, oba cięcia widoczne). `DataSource` = szew panelu: Server/Inline,
  źródło DEKLARUJE features {live, history, openTrace}. Raport HTML w
  packages/trace pozostaje osobnym artefaktem crash-owym (ui zależy od trace,
  nigdy odwrotnie — bundla viewera nie da się dosięgnąć z trace).
- 2026-08-16 (driver): expiry parowania od BARIERY DRENAŻU — połówka pary
  rewizji nie może wygasnąć, dopóki emulator nie przetworzył wszystkiego, co
  dotarło do momentu jej przyjęcia; dopiero wtedy rusza zegar
  `pairingTimeoutMs`. Dzięki temu `revision-expired` znaczy „druga połówka
  nie przyszła", a nie „driver jeszcze jej nie odczytał". Eksmisja
  (`maxPending`, `revision-dropped`) bez zmian. Asercje floodów w konformancji
  sprawdzają „ostatnia rewizja ląduje po ustaniu floodu" — przepustowość
  emulatora to pomiar, nie kontrakt.
- 2026-08-16 (driver, korekta poprzedniego wpisu): expiry parowania rusza,
  gdy emulator nadgonił ORAZ strumień wyjścia milczał przez
  `pairingTimeoutMs` — bariera drenażu nie widziała bajtów w drodze
  (mechanizm B: p50=1697 ms, max=3359 ms przy oknie 1000 ms). GRANICA: cisza
  przedłuża okno tylko gdy wyjście płynie; sesja milcząca, której marker
  przyjdzie później, wygasa w terminie — inaczej timeout nigdy by nie zapadał.
  Ograniczoność: maxPending nadal tnie na 32 (`revision-dropped`).
- 2026-08-16 (driver): driver GWARANTUJE dziecku `TERM=xterm-256color` i
  `COLORTERM=truecolor` w obu trybach env, przed nadpisaniami użytkownika
  (`env: { TERM: ... }` wygrywa); `TERM` usunięty z allowlist. To koniec
  rozjazdu platform, nie nowa polityka: node-pty na POSIX już nadpisywał TERM
  nazwą terminala (unixTerminal.js:53-54), na Windows nie zapisywał nic —
  dziecko jest podpięte do naszego emulatora, nie do terminala rodzica.
- 2026-08-16 (driver): nowy kod `not-found` w `TermwrightErrorCode` (+ klasa
  `NotFoundError`): „wskazany zasób nie istnieje" — kontrast z
  `protocol-violation` (zasób istnieje i jest zniekształcony). Konsumenci:
  trace (openTrace: brakująca ścieżka / katalog bez meta.json; zepsute
  archiwum pozostaje protocol-violation), driver (nieistniejący cwd/command
  odrzucany PRZED powstaniem pty; tylko polecenia będące ścieżką — goła nazwa
  nadal idzie w PATH), CLI mapuje not-found → exit 2.
- 2026-08-16 (ui): manifest runów v3 — OPCJONALNA sekcja `git {commit,
  message, author, branch}` (wszystkie cztery pola albo żadne; nieobecność =
  „to nie było repozytorium", nie puste łańcuchy). Manifesty v2 odrzucane
  przez mechanizm wersji (bez migracji — jedna generacja przed 1.0). Fakty o
  projekcie (mtime, średnie czasy, ostatnie wyniki) idą przez niekontraktowe
  GET /api/specs, nie przez §UI events — strumień zdarzeń opisuje przebieg,
  nie stan dysku.
- 2026-08-16 (protocol, kampania #34 Phase 1): warstwa Probe IR w
  packages/protocol/src/probe/ — fakty przed interpretacją. Reguły
  normatywne: (a) tożsamość = typowana zdolność `stable | frame-local`
  (frame-local pełnoprawne; para „frame-local + stable-identity" odrzucana na
  wire; zakaz korelacji frame-local między klatkami); (b) `intendedRect`
  osobno od `visibleRect` (wyprowadzanie drugiego z pierwszego = wymyślanie
  faktu; słowa region/area zakazane w IR); (c) trójwartościowość: jawna
  lista `unobservable`, zgłoszenie pola zadeklarowanego jako nieobserwowalne
  odrzucane. `selection` rozdzielone na selectedIndex/textSelection. D1:
  `frameworkType` wymagany na `generic`. D2: provenance `p`+`px` nad
  zamkniętym zbiorem annotation|recognizer|framework|correlation|heuristic;
  merge annotation > recognizer > framework > render-inference > heuristic,
  fakty fizyczne nieprzesłanialne adnotacją. D3=(a): retrakcja przez
  podmianę węzła w całości; częściowe patche tylko z pomiarami kosztu px.
  D4: maxSnapshotBytes 1 → 2 MiB. D5: `hello` + opcjonalny blok `probe`;
  `frame-begin` OPCJONALNE za capability (brak ≠ „nie ma klatki"); begin dla
  N domyka klatki niższe; FRAME_END = doradczy revision-commit; producent,
  który pod backpressure porzucił fakty, MUSI wysłać pełny snapshot.
  `paintOrder` opcjonalne z capability (3/6 frameworków); własność komórki
  poza IR.
