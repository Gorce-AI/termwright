# Ink implementation notes

The public package is intentionally smaller than the injected probe. It stores
developer intent behind `Symbol.for('termwright.annotation.ink.v1')`; the SDK
and probe duplicate only the runtime-neutral registry shape, so applications do
not acquire a runtime dependency on the probe.

The registry contains a `WeakMap` from retained Ink host objects to stable
annotation slots. A slot is updated during React render so Ink's `onRender`
callback observes the annotation from the same commit. The host registration is
created in a layout effect, kept across updates, moved if reconciliation
replaces the host object, and disposed only on unmount. Relationship targets
are stored as `WeakRef`s.

Optional annotations are fail-open: malformed getters or unavailable refs do
not break the application. Protocol validation remains the trust boundary when
the injected probe publishes the resulting Probe IR.

The physical/intent boundary is strict. The SDK has no API for text, value,
focus, visibility, bounds, clipping, occlusion, or portable framework state.
Ink-retained ARIA fields are represented separately as framework-native
accessibility hints, not as Termwright annotations.

## Component testing

The in-process backend supplies Ink with private stdin/stdout streams and the
session environment without mutating the test runner. It calls normal
`ink.render`, wrapped only by `@termwright/probe-ink/internal/testing`; that
entry point is not part of the probe's public root API.

Output produced synchronously inside `spawn()` is buffered until the driver
subscribes, mirroring a PTY kernel buffer. `applyOnlcr` reproduces PTY newline
translation. Input is delivered verbatim, matching Ink's raw mode.

The mount and fixture paths intentionally differ in process identity,
environment isolation, signals, and crash reporting. Their semantic tree,
screen, and input model remain the same. File logging is delegated to the
driver; console capture is not part of the removed Ink renderer adapter.
