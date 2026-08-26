# Ink React commit bridge spike

Date: 2026-08-26. Tested versions: Ink 7.1.1, React 19.2.8,
`react-reconciler` 0.33.0, Node 24.1.0, Bun 1.2.15.

## Decision

The React renderer instrumentation seam is real and can be activated at
`DEV=false` without reading or transforming Ink source. Starting from the
loader-resolved public Ink entry URL, Termwright imports the already-loaded
`./reconciler.js` sibling and calls its existing `injectIntoDevTools()` method.
Node and Bun both registered one Ink renderer and delivered commits for two
independent roots. This remains a private package-layout capability, but it is
runtime capability detection rather than content matching: no file is read,
hashed, scanned, or rewritten.

This spike does **not** prove complete parity with the current exact-source
probe. Do not remove the legacy `ink.js`/`renderer.js` instrumentation yet.
Three gaps remain:

1. Ink consumes `aria-label` and `aria-hidden` before creating normal-mode host
   nodes, so the committed Ink DOM does not retain either author intent.
2. A React commit is not a terminal flush barrier. Ink may write before the
   commit callback, or a throttled render may write later. Public `onRender`,
   `waitUntilRenderFlush()`, and platform-processed terminal evidence must close
   the causal frame before a semantic revision is published.
3. Capturing `stdout.write()` before ConPTY is not that evidence. ConPTY
   consumes and transforms legal control sequences (including mouse-mode
   DECSET) and may reorder its host-side output. Exact source-byte comparison
   is therefore not a valid general Ink/Windows contract. The ordered-output
   prototype was rejected as a production path; a lower ConHost observation
   seam is a separate experiment.

The candidate architecture is:

```text
preload installs composable ReactCommitBridge
  -> resolve reconciler beside the public Ink entry and activate its existing hook
  -> commit discovers root identity and committed host tree
  -> wrapped public ink.render composes onRender
  -> waitUntilRenderFlush plus platform-processed terminal evidence closes the revision
```

The commit callback must never publish a revision by itself.

## Empirical evidence

The child-process fixture mounts two independent component roots on two output
streams, rerenders one, then unmounts both. With `DEV=false` and explicit
activation it observed five commits, two `FiberRoot.containerInfo` identities,
and `rendererPackageName: "ink"`. Each `containerInfo` was the same `ink-root`
object found independently through a public host ref's `parentNode`. With
activation omitted, the otherwise identical fixture observed no injection and
no commits; terminal output and stderr were byte-identical.

Explicit activation registered one renderer for both roots in Node and Bun.
Root isolation must nevertheless use `FiberRoot` or `containerInfo`, not
renderer ID. At `DEV=false`, Ink reports React's fallback version in renderer
metadata; certification must resolve the Ink package version independently.

The fixture starts with an existing user hook. The Termwright bridge preserves
unknown properties and the delegated renderer ID, and both observers receive
the same five commits. It forbids observed socket connections and non-`data:`
fetches during module load and render; Node and Bun made zero such attempts.
Together with Ink's `DEV=false` control flow, this demonstrates that the
fixture does not enter Ink's `react-devtools-core` branch. Resource Timing is
not treated as proof of ESM module loading. No DevTools UI, backend, WebSocket
protocol, or external process was used. Yoga's WASM bootstrap uses a local
`data:` URL and is deliberately allowed.

The real reconciler's `injectIntoDevTools()` returns `false` even though it
synchronously calls the hook's `inject` and later delivers all commits. That
boolean is an implementation artifact, not an acceptance contract. Termwright
therefore verifies activation behaviorally: a new Ink renderer must appear in
the bridge registry during the call, otherwise activation fails closed.

Observed unthrottled lifecycle includes:

```text
Ink onRender -> stdout writes -> React onCommitFiberRoot
```

This follows Ink's `resetAfterCommit(root) -> root.onRender()` path, after which
React invokes the instrumentation callback. A throttled render separates those
events further. `waitUntilRenderFlush()` closes Ink's throttle queue but does
not prove drain of an arbitrary stream. The final platform-processed evidence
seam remains a release blocker for replacing the legacy frame path.

## Ink host data inventory

`FiberRoot.containerInfo` directly provides:

- `nodeName`, `parentNode`, and `childNodes` for hierarchy and stable host
  object identity;
- `#text.nodeValue` for text;
- `style` and `yogaNode` for layout intent and computed geometry;
- generic `attributes`;
- `internal_accessibility.role` and `.state`;
- `internal_static`, `staticNode`, and renderer callbacks on the root.

The component fixture retains `aria-role="button"` and
`aria-state.disabled`, but retains neither `aria-label` nor `aria-hidden` in
host attributes or accessibility data. Box/Text consume both props. In
screen-reader mode the label replaces content and hidden nodes are omitted; in
normal mode both author intents are lost before host-node creation. The bridge
therefore does not yet provide complete accessibility semantics. A targeted
Fiber `memoizedProps`/`stateNode` correlation, upstream Ink retention, or a
small remaining hook is required. Whole-tree Fiber traversal is unnecessary
for the other proven fields.

The targeted correlation POC tested the first option without making Fiber the
semantic tree. For each committed root it indexes the live Ink DOM identities,
then maps only exact Fiber `stateNode` identities to `memoizedProps`. That map is
complete and unambiguous for live `ink-box`/`ink-text` hosts, but their props no
longer contain `aria-label` or `aria-hidden`. The original values remain on one
ancestor component Fiber whose `stateNode` is null. This is the same result for
a custom component, rerender, unmount, two simultaneous roots, Node, and Bun.
Consequently the proposed direct `memoizedProps + stateNode` seam does **not**
close the accessibility gap. Associating a state-less ancestor with descendant
hosts would make semantic attribution depend on Fiber topology and becomes
ambiguous for components that render multiple hosts, so the POC deliberately
does not guess. A missing host, duplicate identity, cycle, non-object props, or
absent `current` fails the whole correlation. The POC is internal and is not
integrated into the production probe; upstream Ink retention or a minimal
remaining hook is still required for exact label/hidden intent.

Focus is also not attributable from the host tree. Ink exposes a context-level
`activeId`, but not a stable mapping to a host element. Value, selection, and
scroll are not native Ink host concepts.

## Exact-source patch inventory

The two transforms have a much smaller responsibility than the complete probe.
They exchange data through process-global symbols and never change Ink's return
values. The renderer wrapper returns the original result after synchronously
calling Termwright's capture hook.

### `renderer.js`

The transform wraps all three exact return sites: normal rendering,
screen-reader rendering, and the empty-root path. Its invocation is the signal
that Ink has completed the corresponding private render calculation. It
provides the following values.

| Patched value or signal | Immediate consumer | Downstream use | Classification |
|---|---|---|---|
| `node` (`root`) | `installInkCaptureHook()` keys `latest` and calls `captureInkLayout()` | root/capture correlation, host traversal, stable host identity, Yoga geometry | semantic truth and correlation anchor |
| hook invocation at each renderer return | `installInkCaptureHook()` | freezes the host layout before later Ink mutation, especially `<Static>` detachment | lifecycle signal |
| `result.output` | `visibleRows()` in `frame-capture.ts` | derives `liveRows`, which places live geometry relative to the terminal cursor | visual-derived placement evidence; cell content is not semantic truth |
| `result.staticOutput` | `visibleRows()` and static-retention logic | derives `staticRows`, detects newly committed static output, shifts retained static geometry | visual-derived placement and retention evidence |
| `result.outputHeight` | retained inside `InkFrameCapture.rendered` | no current production read after capture | implementation artifact; no parity requirement unless a contract is identified |
| `screenReader` | capture hook and `session.ts` | selects the screen-reader capture path and refuses authoritative cell geometry for that frame | render-mode/config metadata plus a fail-closed guard |
| injected renderer SHA/version sentinel | `instrumentationSentinel()` | permits the wrapper to advertise semantics only when both exact transforms ran | certification metadata, not application semantics |

The patch does **not** calculate geometry itself. `frame-capture.ts` walks the
captured root synchronously, reads Yoga, computes nested overflow intersections,
and snapshots `staticNode.childNodes`. Consequently, geometry and retained
static subtrees are semantic/spatial truth obtained from the host tree; exact
source instrumentation currently contributes the timing and root reference
that make that snapshot authoritative.

Neither rendered string is compared with terminal cells or published as
semantic text. The actual terminal position and buffer come from the shadow VT
tracker, while application text comes from Ink host text nodes. This limits the
replacement requirement for `output` and `staticOutput` to row placement and
causal/static-retention invariants, not preservation of a duplicate visual
model.

### `ink.js`

The transform runs immediately after private `render(rootNode,
isScreenReaderEnabled)` returns and immediately before Ink invokes the public
`options.onRender` callback. It associates these frame-local facts with the
same root.

| Patched value or signal | Immediate consumer | Downstream use | Classification |
|---|---|---|---|
| `rootNode` | frame-context hook looks up the renderer capture in `latest` | joins mode facts to the exact root/render capture | correlation anchor |
| effective `interactive` | `qualifyFrame()` | distinguishes inline non-interactive placement from mutable live output | runtime-normalized render configuration (explicit option or Ink's CI/TTY default) |
| effective `alternateScreen` | `session.ts` | verifies the tracked active VT buffer and anchors live geometry at row zero | runtime-normalized render configuration (requested option gated by interactivity) and safety invariant |
| `debug` | `qualifyFrame()` | selects debug/full-output viewport placement rules | normalized render configuration |
| `stdout.isTTY` | `qualifyFrame()` | participates in fullscreen detection | runtime stream metadata |
| current stdout `rows` | `qualifyFrame()` | participates in fullscreen detection with `liveRows` | runtime stream geometry metadata |
| hook position before `onRender` | wrapped public `onRender` calls `notifyRender()` | guarantees that the matching renderer capture already has context when the semantic tree is frozen | lifecycle ordering signal |
| injected core SHA/version sentinel | `instrumentationSentinel()` | completes fail-closed certification together with renderer SHA | certification metadata, not application semantics |

The core patch does not supply `stdout`, `stderr`, columns, output bytes,
`renderTime`, commit generations, or teardown state. Those come respectively
from normalized public render options, stream interception, the public
`onRender` callback, Termwright's hidden host sentinel, and the public Ink
instance lifecycle.

### Current causal chain and non-patched inputs

```text
private renderer reaches one of three return sites
  -> renderer.js hook captures root/result/screenReader and freezes Yoga/Static
  -> ink.js hook joins interactive/alternate/debug/TTY/rows to that root
  -> wrapped public onRender freezes the semantic observation
  -> waitUntilRenderFlush drains Ink's throttled work
  -> shadow tracker drain supplies cursor/buffer/input-mode evidence
  -> latest-frame check coalesces a superseded render
  -> channel publishes snapshot and stdout callback flushes its marker
  -> waitUntilExit/session.flush preserve the final publication during teardown
```

Only the first two arrows require exact Ink source today. The public wrapper
already owns callback composition, `rerender`, `unmount`, `cleanup`,
`waitUntilRenderFlush`, and `waitUntilExit`. Stream interception supplies
stdout/stderr bytes and input-mode state independently of the two transforms.
The React bridge adds committed-root, commit, and unmount signals, but a commit
alone does not replace the renderer-return or terminal-output boundaries.

## Required-data replacement map

| Required datum | Current source | Candidate source | Status |
|---|---|---|---|
| Ink root | exact `renderer.js` capture | `FiberRoot.containerInfo` | proven |
| hierarchy/identity | captured Ink DOM | committed Ink DOM/WeakMap | proven |
| text/style | Ink DOM | committed Ink DOM | proven |
| role/state | `internal_accessibility` | committed Ink DOM | proven |
| explicit `aria-label` | not retained in normal host DOM | targeted Fiber props or upstream retention | missing |
| explicit `aria-hidden` | consumed by Box/Text | targeted Fiber props or upstream retention | missing |
| Yoga geometry | synchronous tree walk at renderer return | committed `yogaNode`; public `measureElement` | live tree proven; clipping/timing diff incomplete |
| renderer-complete signal | exact renderer return-site hook | composed `onRender` plus validated host capture | lifecycle parity incomplete |
| rendered output row count | `visibleRows(result.output)` | PTY/terminal frame or equivalent platform-processed evidence | replacement incomplete |
| `outputHeight` | exact renderer return, currently unread | remove unless differential work finds a contract | no current consumer |
| detached `<Static>` | root/static subtree snapshot at renderer return | `staticNode`, public lifecycle, terminal evidence | mutation-race diff incomplete |
| screen-reader mode | exact renderer boolean | captured render options/environment metadata | config derivation incomplete; do not enable by default |
| interactive/alternate/debug | exact effective `ink.js` state | public options plus CI/TTY derivation and terminal-buffer evidence | derivation and ordering certification incomplete |
| rows/columns/TTY | exact core context plus public stream | public render stream sampled at the authoritative boundary | source stable; boundary incomplete |
| stdout/stderr bytes | tracked streams, not either source patch | PTY/terminal emulator plus platform-processed evidence | causal replacement incomplete |
| render timing | public `onRender({renderTime})` | composed public callback | proven public seam |
| React commit timing | unavailable | commit callback | proven; not a flush barrier |
| semantic revision timing | patched capture, public callback/flush, tracker, marker | commit, public lifecycle, platform-processed evidence | causal seam unresolved |

SHA profiles certify the two exact insertion points. Preload/module
interception and the public `render()` wrapper are the stable parts and remain
useful even if both source transforms disappear.

## Bridge composition and fail-closed rules

The bridge delegates `inject`, commit, and unmount to an existing hook with its
original receiver. A proxy overlay also delegates unknown methods, accessors,
and mutations to that original receiver while preserving stable function
identity. It preserves the delegated renderer ID and ignores foreign renderers.
Invalid or reused delegated IDs fail closed;
allocating a local substitute would split React's and the existing observer's
identity spaces. `uninstall()` makes retained bridge references inactive,
clears renderer state, and restores the prior global hook only while it still
owns the slot.

Replacing the hook after a renderer injected cannot work because React retains
the original object. Activation therefore requires the supplied bridge to own
the global slot. Missing entry path, reconciler module, method, compatible hook,
or observed Ink renderer registration rejects activation. Registration alone
does not certify root access: final integration must remain unavailable until
the first valid committed `FiberRoot.containerInfo` is observed, and must poison
the capability if an Ink renderer later supplies an incompatible root. The
diagnostic is:

```text
Ink semantic probe unavailable:
React renderer instrumentation did not expose expected committed Ink root.
```

There is no heuristic or partial-tree fallback.

## Activation decision

Unconditionally setting `DEV=true` remains rejected: when
`react-devtools-core` resolves, Ink may probe `ws://localhost:8097`, wait, and
warn. Resolving the reconciler sibling relative to the public entry works under
Node and Bun at `DEV=false`, including multiple roots and an existing hook, and
does not justify a loader source transform. The best long-term contract is
still an upstream Ink API that explicitly activates renderer instrumentation
without DevTools networking.

## Differential status

The bridge proves root acquisition, live hierarchy, identity, text, style,
role/state, Yoga access, multiple roots, rerender/unmount, existing-hook
composition, and Node/Bun activation. It does not yet prove complete OLD-vs-NEW
parity for label/hidden semantics, Static retention, screen-reader mode,
throttled rapid renders, concurrent roots, resize during a pending frame,
alternate screen, debug, output height, or causal terminal revision ordering.
No sleep, retry, polling, timeout increase, or skipped test was used.

Before removing either transform, one process should feed the same committed
render to both capture paths and compare their immutable results before Ink can
mutate the host tree. The comparison must cover the following matrix.

| Area | Required cases | Parity invariants |
|---|---|---|
| host tree | one component root, nested custom components, sibling host nodes, root replacement | host kinds, parent/child order, text, stable identity across rerender, new identity after replacement |
| accessibility | content-derived names, `aria-label`, `aria-hidden`, every retained role/state, dynamic prop changes | role, accessible name, state, displayed/hidden state, no partial Fiber correlation |
| Yoga geometry | nested boxes, alignment, padding, margin, wrapping, borders, zero-sized and `display:none` nodes | intended rectangles and authoritative absence of geometry |
| clipping | nested overflow, independent X/Y overflow, fully clipped descendants, wide and wrapped cells | visible rectangles and ancestor-clip intersections |
| `<Static>` | initial static output, multiple append batches, live output after static output, no-new-static rerender | retained root/child identity, accumulated row offsets, no duplicated or lost static nodes |
| lifecycle | initial mount, rerender, rapid consecutive rerenders, replacement, unmount during pending work | one authoritative snapshot per non-coalesced render, stale frames suppressed, no post-unmount publication |
| roots/renderers | two simultaneous Ink roots, interleaved updates, one root unmounting, a foreign React renderer | isolated root/capture/revision identity and no foreign-tree publication |
| render scheduling | unthrottled, throttled, `waitUntilRenderFlush()`, user `onRender` that synchronously rerenders | matching host generation and callback composition without reordering user behavior |
| terminal modes | inline interactive, non-interactive, alternate screen, debug, fullscreen-height output, clear/rerender | live/static origin, active buffer agreement, visible viewport clipping |
| resize | resize before render, during throttled output, between commit and publication | rows/columns sampled for the same authoritative frame; no mixed geometry/viewport generation |
| terminal content | ASCII, empty output, trailing newline, wrapped text, emoji/CJK, stdout and custom streams | live/static row counts and terminal frame corresponding to the semantic generation |
| input/focus | `useInput`, mouse/focus DECSET, dynamic visibility, focus changes | no regression in input-mode evidence; no invented element focus attribution |
| screen reader | explicit normal-mode semantics and a separate screen-reader-mode run | normal behavior remains unchanged; screen-reader geometry still fails closed where unavailable |
| teardown | explicit cleanup, unmount, natural `useApp().exit()`, stream/channel close while pending | final eligible revision drains exactly once; closed guarantees reject rather than truncate |

For every eligible frame, compare the complete `ProbeFrame` and resulting
`SemanticTreeV2`: hierarchy, text, role/name/state, hidden state, intended and
visible bounds, live/static region, object ordering, and identity continuity.
Also compare lifecycle evidence independently: renderer capture generation,
React commit/root, Ink `onRender`, flush completion, platform terminal frame,
published revision, and unmount. Equality of tree shape without equality of
that causal ordering is not parity.

`outputHeight` is included only as an audit assertion that it has no consumer.
It should not keep source patching alive unless a failing differential case
demonstrates a real Termwright contract that cannot be obtained from Yoga or
the terminal. The suite must be deterministic and event-driven; a pass cannot
depend on sleeps, retries, polling, larger timeouts, skipped cases, or weakened
assertions.

| Mechanism | Before | Candidate after spike |
|---|---:|---:|
| module preload | yes | yes |
| React instrumentation | no | runtime POC in Node and Bun |
| public Ink lifecycle | partial | available; causal integration pending |
| Ink DOM/Yoga semantics | indirect | direct except label/hidden intent |
| exact `ink.js` patch | yes | retain pending parity |
| exact `renderer.js` patch | yes | retain pending parity |
| SHA certification | yes | retain pending parity |
| zero-config | yes | activation POC yes; full probe pending |
| component testing | existing harness | two-root POC proven |
| full CLI E2E | yes | legacy path remains |
