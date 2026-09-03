# Public API, configuration, and error surface audit

Status: **IMPLEMENTED — EXTERNAL CERTIFICATION PENDING**

## Public package exports

All 33 publishable npm packages and every manifest export are classified in
`quality/public-api-surface.json`. `check:package-metadata` compares that
registry with the manifests in both directions: an unclassified new export, a
stale registry entry, a duplicate classification, or any published `internal`
namespace fails CI.

The stable-ish surface is deliberately small: the `termwright` application-test
entries and the public authoring roots for Test, Ink, OpenTUI, and Gherkin.
Engine embedding, adapter/probe hooks, protocol packages, low-level driver/VT,
resource transports, UI live transport, and native binary packages are
classified as advanced but intentional. They exist for integration authors or
installer/runtime ownership and are not presented as ordinary test-suite
choices.

The audit removed the unused `@termwright/ui/provider` facade and the Vitest
runner exports described in `vitest-engine-boundary.md`. The Ink component
harness genuinely needs the probe wrapper across a package boundary, so the
misleading `@termwright/probe-ink/internal/testing` export became the explicit
advanced `@termwright/probe-ink/instrumentation` entry. No deprecated alias was
retained.

`@termwright/test/config` remains intentional rather than duplicate: Vitest
loads it while evaluating configuration, where importing the authoring root
would instantiate suite fixtures before a suite exists. `termwright/host` and
`termwright/cli` likewise remain documented embedding APIs.

## Configuration

`TermwrightConfig` has one responsibility per field: viewport, timeout classes,
trace retention, artifact/snapshot location, default command, capability
requirements, environment, terminal behavior profile, palette, named profile,
structured-log threshold, and snapshot update policy. Resource scheduling is a
CLI/host policy instead of a second set of project knobs; session-only process,
security, and semantic negotiation options stay on `launch()`.

The terminal profile is now the closed `TerminalProfileId` union (`default` or
`cjk-wide`) through driver, project, suite, and launch types. Configuration
validation rejects an unknown id immediately. There is no Unicode-version,
emulator-selection, compatibility, or legacy-mode option.

The documentation contract parses the actual `TermwrightConfig` declaration
and requires an exact Project options table. This found the previously missing
`updateSnapshots` row. Generated resource-profile documentation continues to
come from the host policy source.

## Errors

User operations expose stable categories through `TermwrightErrorCode` and
typed subclasses rather than requiring exact-message matching:

| Category                   | Public codes/classes                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| assertion/action           | `ambiguous-locator`, `not-actionable`, `stale-snapshot`, `input-mode-disabled`                                    |
| timeout                    | `timeout` / `TimeoutError`                                                                                        |
| capability                 | `capability-unavailable`, `semantic-capability-unavailable`                                                       |
| adapter                    | `probe-attach-failed`, `adapter-guarantee-violation`, `capability-provider-lost`, `capability-provider-violation` |
| semantic protocol/evidence | `protocol-violation`, `evidence-conflict`, `duplicate-semantic-key`, `history-truncated`                          |
| resource capacity          | `capacity` / `CapacityError`; broker and journal transports retain more specific machine codes internally         |
| PTY/process/session        | `pty-backend-failed`, `process-exited`, `session-closed`                                                          |
| artifact input             | `not-found` versus malformed `protocol-violation`                                                                 |

Host preflight, host timeout, trace, broker, and journal transports keep their
own typed infrastructure errors at the owning boundary. The CLI maps usage and
infrastructure failures to distinct documented exit codes. In particular,
resource saturation cannot become a generic green test, and adapter attach
failure cannot be reported as an unexplained timeout.

## Remaining evidence

The classifications and packed subpath failures pass locally on macOS arm64
Node 24. Final status remains external-certification pending until the same
packed artifacts and API surface gates complete on Linux, macOS, and Windows
under Node 22 and 24.
