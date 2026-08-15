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
