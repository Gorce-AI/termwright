# @termwright/probe-tview — implementation notes

This probe is the reference implementation of Termwright's T0+T1 Go
integration. The binding policy is
[`semantic-probe-injection-doctrine.md`](../../docs/architecture/semantic-probe-injection-doctrine.md).

## Why `-toolexec`

The required private facts are sealed inside tview and tcell, but observing
them does not require editing existing control flow. Go's official
`-toolexec` hook exposes the package import path through
`TOOLEXEC_IMPORTPATH`; Termwright adds an owned source file to the compiler
invocation for only the matching package.

This is T1 rather than a patch:

- upstream source files and module-cache entries remain byte-identical;
- the owned unit has a reproducible digest;
- renamed private fields fail compilation;
- one invocation can inject units into module-cache, workspace/replacement and
  vendor layouts without generating competing overlays;
- the application build fails if the promised unit is absent.

`go -overlay` was rejected for the ordinary module-cache case because Go
forbids replacements beneath `GOMODCACHE`. A local-module demonstration does
not establish a production mechanism.

The tool executor augments both `compile` input and the generated `importcfg`,
then adds the owned package dependencies to link configuration. It must
preserve all unrelated compiler arguments and act as a transparent pass-through
for every other tool and package. Tests cover normal module cache, local
replacement and vendored applications.

## Lifecycle boundary

tview's public `AfterDraw` callback runs under `Application`'s write lock but
before its final `Screen.Show`. It cannot by itself prove that terminal bytes
were flushed. Calling `Show` in that callback is also wrong: upstream calls it
again, and the later call may emit cursor or resize bytes after the marker.

The add-only tview unit therefore composes the public before/after-draw hooks
and installs a transparent `tcell.Screen` decorator before `Application.Run`:

```text
Application.draw
  -> composed beforeDraw (start phase)
  -> application/custom drawing
  -> composed afterDraw (arm final commit)
  -> decorated Screen.Show
       -> underlying Show
       -> read current Application.root under the existing draw lock
       -> build and admit snapshot without blocking
       -> write authenticated marker through the same screen sink
```

Only tview's final output commit is authoritative. A `Show` issued by a custom
primitive or by either application hook still reaches the underlying screen,
but remains unarmed and cannot publish a partially drawn semantic frame. A
before-draw short-circuit arms its own final `Show`. Reading `Application.root`
at that point follows dynamic `SetRoot` calls rather than retaining the root
passed to `Attach` forever. Replacing either composed hook at runtime is a typed
fail-closed lifecycle violation.

The decorator never calls `Show` recursively and uses no process-global frame
lock. Different applications can render concurrently. Re-entrant `Show`
cannot be represented as one causal frame, so the probe reports a typed
adapter-guarantee violation and leaves the underlying UI unblocked.

If the application supplied a screen before `Attach`, cleanup restores that
screen only while the decorator still owns the slot. If Termwright created the
screen, cleanup finalizes it. A later application `SetScreen` always wins.

## Render-thread work and publication

Geometry is valid only at the completed draw boundary. The render goroutine
therefore walks the tree and encodes one immutable snapshot, but it does not
perform semantic socket I/O. A bounded publication queue owns transport on its
worker. Admission is non-blocking and reserves a revision/marker only for a
complete accepted snapshot.

The marker is written after admission and through the same sink as `Show`:

- Unix uses public `Screen.Tty()`;
- Windows uses a T1 tcell unit which reaches `cScreen`'s active console handle
  and preserves the VT mode needed by the private OSC marker.

There is no stdout fallback. Admission refusal, worker failure, partial marker
write or missing sink closes semantic publication. Timeouts remain watchdogs,
not evidence that a frame is complete.

## Sealed state and public traversal

Public APIs cover Flex, Pages, Form, Frame, TreeView, List, Table, DropDown,
primitive rectangles, focus and most state. The owned tview unit is limited to
facts without equivalent accessors: application root, Grid items and computed
visibility, Modal internals, DropDown options and selected rendered private
state.

Unknown application primitives remain generic nodes. Their unenumerable child
surface is declared through `opaqueChildren` and
`custom-container-enumeration`; it is never silently dropped. Clipped geometry
which tview does not expose remains a named degraded capability.

Identity is session-local and assigned monotonically when a primitive is first
seen. Raw pointer values are neither serialized nor persisted. Optional
annotations live in a side table, enrich only intent, and are not required for
structure.

## Dormancy

The public `Attach` checks both rendezvous variables before consulting the
injected registry. With no Termwright session it creates no client, socket,
goroutine, channel or screen hook. Fixed provider slots avoid an eagerly
allocated registry map. Non-interference tests compare instrumented and
ordinary terminal output byte for byte and inspect dormant process behavior.

The one-line import is deliberate. Unlike framework wrappers, it does not
replace widget construction or break fluent APIs, and it is the maximum author
opt-in allowed by the doctrine.

## Certification obligations

A candidate tview/tcell pair is green only when all of these hold:

1. both owned units compile against the actual resolved build graph;
2. injection presence is asserted explicitly;
3. the same application is byte-identical with the probe dormant;
4. hierarchy, state, geometry, dynamic roots and frame revisions pass through
   a real PTY;
5. bounded refusal and worker failure are typed and non-blocking;
6. nested/re-entrant and concurrent application tests preserve UI progress;
7. Go tests pass under `-race -count=1`;
8. the native Windows row proves same-console marker delivery through the
   vendored passthrough ConPTY path.

Linux and Windows remain a required platform conjunction. A new release does
not generate an exact-version source patch; failed compilation or conformance
creates a compatibility issue describing the missing capability.
