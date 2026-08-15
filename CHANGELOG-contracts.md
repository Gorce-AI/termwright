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
