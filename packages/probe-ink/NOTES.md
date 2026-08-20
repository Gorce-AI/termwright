# @termwright/probe-ink — implementation notes

## Why the shim imports a separate runtime

An ESM export binding cannot be reassigned. The loader therefore replaces Ink's
entry with a module that re-imports the original URL under a query marker,
forwards `export *`, and shadows only `render`.

The wrapper runtime is a separate built entry and never imports Ink at runtime.
It receives the original namespace from the shim. This is what avoids a loader
cycle: importing `ink` from the wrapper would hit the same replacement while
the replacement was still evaluating.

## Root access without an internal import

Ink exposes no root handle. During an active session the wrapper prepends one
`display: none` Box and reads its `parentNode`; that parent is `ink-root`. The
probe-owned Box alone is excluded from observation. An application's own hidden
Box remains in the tree with `displayed: false`.

## Marker ordering

Ink's public `onRender` callback runs after layout but before output. The session
therefore freezes and publishes the tree synchronously in that callback, before
the application callback can schedule another commit. Marker work waits for the
next macrotask, performs a zero-length stdout write with a completion callback,
and appends the marker only after that callback. The revision is checked both
before and after drain, so a newer render suppresses a stale marker instead of
pairing an old tree with newer pixels.

## Runtime interception

Node 22.15+ exposes synchronous `module.registerHooks`; early Node 22 uses the
off-thread `module.register` fallback. `registerHooks` must be read from the
`node:module` namespace: a named import fails module instantiation on Node
22.9, before feature detection can run. No warning suppression flag is added:
on the pinned dependency graph Ink's vanilla import emits the same JSON-import
ExperimentalWarning, and suppressing the entire warning class would mutate an
application's stderr policy.

Bun uses a preload plugin and matches the resolved Ink entry path. The filter
covers both ordinary `node_modules/ink/build/index.js` paths and Bun's versioned
`ink@…/build/index.js` cache form.
