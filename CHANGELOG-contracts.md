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
