# OpenTUI annotation implementation notes

The SDK stores author intent behind
`Symbol.for('termwright.annotation.opentui.v1')`. The value is a process-local
`WeakMap` keyed by Renderable objects; relationship targets are `WeakRef`s. The
zero-config probe duplicates the small runtime-neutral shape so the SDK does
not depend on transport or renderer instrumentation.

`describeRenderable` is usable before a Termwright session exists. Each call
replaces the current annotation and returns an ownership-safe disposer: an old
disposer cannot delete a newer description of the same object. Collection of a
Renderable releases its registry entry naturally.

The SDK accepts only author intent: role, name, description, test id, JSON
domain state, actions, and relationships. It cannot provide geometry, text,
focus, value, selection, visibility, clipping, occlusion, or framework state.
Those facts are observed by `@termwright/probe-opentui` from the real retained
tree.

There is no renderer wrapper, mount helper, collector, publisher, convention
property adapter, or manual channel in this package.
