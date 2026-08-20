# Ink annotation implementation notes

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
