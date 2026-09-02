# Vitest engine boundary

Status: **IMPLEMENTED — EXTERNAL CERTIFICATION PENDING**

## Baseline

The native runner was already shipped by Termwright, but attempt finalization
mutated Vitest task-owned `onFinished` and `onFailed` arrays. The package also
published `@termwright/test/runner` and `@termwright/test/vitest-engine`, making
private engine details look like supported extension points.

## Exact 4.1.11 evidence

The installed `@vitest/runner` 4.1.11 declaration exposes
`onAfterRetryTask(test, { retry, repeats })`. Its implementation awaits that
hook after `afterEach`, ordinary fixture cleanup, `onTestFinished`, and
`onTestFailed`, once for each concrete repeat/retry try. The existing
attempt-context fixture proves that Termwright commits only after throwing user
completion/failure hooks have run.

The same upstream implementation calls `onAfterRetryTask` inside
`callAroundEachHooks`. An enclosing `aroundEach` teardown and fixtures acquired
by that hook are cleaned afterwards. Therefore this public API does **not**
support the stronger claim “after every possible aroundEach teardown”.
Termwright does not use `aroundEach` to own ALS or finalization: registration
order across user setup files would turn correctness into an ordering
assumption. ALS remains runner-owned from `onBeforeTryTask`, before ordinary
fixture resolution, through the public finalization hook.

## Chosen boundary

- `TermwrightTestRunner` is the sole Vitest-specific worker adapter.
- `onAfterRetryTask` replaces mutation of `test.onFinished` and
  `test.onFailed`.
- The hook's `{retry,repeats}` value is validated against the active ALS
  attempt before committing it.
- `onAfterRunTask` remains a fail-closed barrier for an attempt that never
  reached the per-try hook.
- `@termwright/test/runner` and `@termwright/test/vitest-engine` are no longer
  package exports. The CLI locates the packaged private runner beside the
  package root entry.
- The host-facing engine interface and wire DTO are private to the CLI engine
  adapter. Public Termwright authoring APIs contain no Vitest task, reporter,
  or hook-array types.

## Rejected alternatives

- Mutating completion arrays was rejected because those are mutable task
  internals and made ordering depend on Vitest's stack/parallel implementation.
- A setup-file `aroundEach` wrapper was rejected because it starts after its
  own fixture resolution and cannot prove it is outermost relative to consumer
  setup files.
- Finalizing only in `onAfterRunTask` was rejected because it is per test, not
  per try, and cannot represent retries atomically.

## Remaining limitation

Direct consumer `aroundEach` teardown is outside Vitest 4.1.11's public
per-try finalization hook. It is not represented as part of a Termwright
attempt commit. Supporting it requires a future public engine boundary after
outer-hook cleanup; Termwright will not recover that guarantee by reaching
back into mutable task internals.
