# Ink runtime observer migration

This note inventories the exact-source Ink probe before any legacy machinery
is removed. It is the acceptance record for moving from compiled-source bytes
to React renderer instrumentation, the committed Ink host tree and Ink's
public render lifecycle.

## Existing integration

The stable outer seam is the Node `--import` / Bun preload interception. It
replaces Ink's public entry module with a namespace-preserving shim and wraps
only `render()`. The fragile inner seam transforms two exact, checksummed Ink
7.1.1 artifacts:

- `renderer.js` calls a Termwright hook with the Ink root, the generated live
  output, its height, retained `<Static>` output and screen-reader mode;
- `ink.js` calls a second hook with the resolved interactive and alternate
  screen modes, debug mode, stdout TTY state and terminal rows immediately
  before Ink's public `onRender` callback.

The transforms also install a two-part sentinel. Production semantic attach is
currently refused unless both exact transforms ran. This is fail-closed, but it
binds semantic compatibility to unrelated bytes and generated file layout.

## Complete old-to-new datum map

| Required datum | Old/current source | Classification and use | Runtime/public result |
|---|---|---|---|
| committed `rootNode` | transformed `renderer.js` argument | semantic truth: hierarchy and identity | **Parity for React commits:** `FiberRoot.containerInfo` is the identical `ink-root` |
| hierarchy/text/style | root DOM reached through renderer hook | semantic truth | **Parity for ordinary commits:** walk the same Ink DOM |
| Yoga geometry | root DOM frozen by renderer capture | layout truth | **Ordinary parity; resize and transient Static fail** |
| role and ARIA state | DOM `internal_accessibility` | semantic truth | **Parity:** role and checked/disabled/expanded/selected/etc. survive |
| accessible name / `aria-label` | source React props; label replaces content in screen-reader mode | semantic truth | **Fiber POC only:** normal host DOM drops it; `memoizedProps` correlates through host `stateNode` |
| `aria-hidden` | source React props | semantic truth | **Fiber POC only:** normal host DOM drops it |
| focus identity | Ink `FocusContext` / hook state | interaction state | **No replacement:** behavior is tested, host DOM has no focus owner |
| render boundary | exact capture plus public `onRender` | lifecycle truth | **Partial:** `onRender` is causal; React commit is later and absent for resize |
| React commit timing | unused by old path | conformance signal | available after Ink `onRender`, not authoritative publication |
| semantic revision timing | session pairs exact capture, publication and marker | causal contract | no React-only replacement |
| terminal flush boundary | `waitUntilRenderFlush()` plus tracked stdout | visual/causal truth | public signal retained; React commit says nothing about PTY application |
| live `output` | transformed renderer result | row positioning artifact | not replaced; PTY should become visual truth after differential proof |
| `outputHeight` | transformed renderer result | live-region origin | ordinary Yoga agrees; resize makes React snapshot stale |
| `staticOutput` / static rows | transformed result and retained Static subtree | retention contract | **Failure:** callback sees detached, zero-height Static |
| screen-reader flag | transformed renderer argument | output configuration | explicit option/environment observable; exact output still required |
| interactive mode | resolved private Ink field | environment-resolved configuration | explicit option known; omitted-option TTY/pipe result now measured, but no public resolved-value hook exists |
| alternate-screen mode | resolved private Ink field | terminal placement | explicit option plus terminal buffer evidence; removal unproven |
| debug mode | private render options | terminal placement | explicit public option available |
| stdout, TTY, rows | render options plus transformed window-size context | configuration/geometry | public wrapped stdout supplies them |
| columns | public stdout, indirectly Yoga width | configuration/geometry | public stdout; resize tested but invalidates React snapshot |
| stderr and stderr TTY | public render option; absent from exact hooks | configuration, not semantic truth | public wrapped stderr; Fiber is unnecessary |

`output`, `staticOutput` and `outputHeight` are not semantic truth merely because
the old path exposed them. The migration may remove them only after the
differential suite proves the semantic contract from the host tree and the
visual contract from the real terminal.

## Verified React seam

An empirical Ink 7.1.1 experiment established:

- `reconciler.injectIntoDevTools()` can be invoked directly without setting
  `DEV=true`;
- the renderer metadata identifies Ink with `rendererPackageName: "ink"`;
- `onCommitFiberRoot(rendererId, fiberRoot)` receives the Ink root directly as
  `fiberRoot.containerInfo`;
- multiple commits are observable without traversing Fiber internals.

Therefore `DEV=true` is not part of the target runtime contract. Termwright
must not activate `react-devtools-core`, a UI, a WebSocket or another process.
The target is a small composable implementation of the existing React renderer
instrumentation hook. It must preserve an existing hook, its renderer ids and
callbacks, ignore foreign renderers, and isolate multiple Ink roots.

The reconciler module path and callable capability remain runtime assumptions.
They must be detected and fail closed; they are not permission for a fuzzy
source transform.

### Accessibility correlation experiment

Ink 7.1.1 turns Box accessibility props into a host
`internal_accessibility` object containing only role and state. In normal mode
it does not retain `aria-label` or `aria-hidden` on that host object. The real
Ink test proves this narrow correlation:

```text
source Box Fiber memoizedProps (aria-label / aria-hidden)
    -> descendant host Fiber stateNode
    -> identical Ink DOMElement from containerInfo
```

This recovers the two missing values for the measured version. It does **not**
make Fiber a production contract. The POC is explicitly bounded to 100,000
visited Fibers and fails closed when the bound is exceeded. Host hierarchy
continues to come from Ink DOM. Shipping these facts requires behavioral
certification across supported React/Ink candidates or a stable Ink-side
source.

## Differential conformance result (Ink 7.1.1 / React 19.2.8)

`ink-runtime-differential.test.ts` materializes the two certified transforms in
an isolated copy of the real Ink package and runs the exact hooks and the React
bridge in the same renderer. It uses only causal framework promises/events
(`waitUntilRenderFlush` and stdout `resize`); there are no sleeps, retries or
polling windows.

Measured parity:

- initial component-only mount, ordinary rerender, coalesced rapid rerenders
  and multiple simultaneous Ink roots expose the **same `ink-root` object**
  through `FiberRoot.containerInfo` and the exact renderer hook;
- hierarchy, host identity, own text, accessibility role/state and Yoga
  geometry match for those ordinary React commits;
- custom component nesting needs no Fiber traversal because it is already
  represented by the committed Ink host hierarchy;
- explicit screen-reader mode exposes the same host root and ARIA facts, while
  the exact hook records the separate screen-reader output contract;
- explicit interactive/alternate-screen/debug mode and stdout TTY/row facts
  agree with the old frame context;
- nested overflow clipping and wide-cell wrapping produce identical relative
  intended/visible Yoga rectangles when recomputed from the committed
  `containerInfo`; absolute viewport placement still needs rendered row counts,
  mode and ordered terminal position;
- inline, normal interactive, alternate-screen and debug renders were captured
  byte-for-byte through the real Ink stdout option. Clear-line behavior and
  alternate-buffer enter/leave are terminal facts absent from `containerInfo`;
- omitted `interactive` resolves to false for a non-TTY and to the exact
  environment-dependent boolean for a TTY. The measurement closes the unknown
  result, but does not create a public Ink contract for its private CI policy;
- `useInput` dispatch and programmatic `useFocus` transitions produce the
  expected application behavior and commits without polling; the same test
  proves focus ownership is absent from host DOM rather than inventing it;
- two independently registered Ink renderers preserve delegated ids while
  foreign renderers are ignored;
- a real, unskipped Bun process observes the same committed `containerInfo`
  identity.

Measured gaps which block removal of exact instrumentation:

1. **Callback order is the reverse of the proposed model.** Ink invokes public
   `onRender` from reconciler `resetAfterCommit`; React invokes
   `onCommitFiberRoot` only after that callback returns. The observed order is
   `exact renderer capture -> exact frame context -> Ink onRender -> React
   commit observer`.
2. **Resize is not a React commit.** A stdout resize recomputes Yoga and emits
   `onRender`, but no `onCommitFiberRoot` occurs. The exact/public boundary saw
   width 16 while the last React commit snapshot still had width 24.
3. **`<Static>` is transient before the React observer.** The exact renderer
   hook freezes its children, positive Yoga height and rendered rows. By the
   later DevTools commit callback Ink has detached/zeroed that layout.
4. **Root teardown is not identified by the public callback surface.** React
   reports individual Fiber unmounts, but without reading Fiber internals they
   do not identify which `FiberRoot` the bridge should evict.
5. **Visual/mode artifacts are not properties of `containerInfo`.** Rendered
   output/static output, resolved default interactive mode and terminal flush
   causality still need independent public/terminal replacements. Explicit
   render options do not certify Ink's environment-dependent default.
6. **Accessible name, hidden state and focus are not all host-DOM facts.** Role
   and ARIA state survive. Label/hidden require the experimental Fiber
   correlation; focus remains application/context state.
7. **Relative clipping is recoverable, absolute placement is not React-only.**
   The same host nodes and Yoga state reproduce nested clipping and wrapping,
   but `containerInfo` has no live/static output row counts, active terminal
   buffer or ordered cursor position.

The React seam is therefore a strong root-discovery and normal-commit
conformance signal, but it does not replace the renderer boundary. Full parity
is not claimed.

## Exact coverage matrix

This table distinguishes completed tests from the planned removal gate.

| Contract/scenario | Evidence now | Status for removing exact path |
|---|---|---|
| `containerInfo` identity | real Ink Node test, Bun process and same-renderer differential | pass |
| component-only mount / nested custom components | real host hierarchy differential | pass for host tree |
| rerender / component replacement | exact/runtime comparison | pass for ordinary commits |
| rapid consecutive rerenders | final authoritative tree comparison | pass; not a pending-stdout race proof |
| several roots | real differential | discovery passes; teardown isolation fails |
| several Ink renderers / foreign renderer | deterministic bridge unit tests | pass at hook layer |
| existing hook composition | ids, prototype properties, callback `this`, repeated install, throwing callback and frozen-target refusal | pass for tested surface |
| role / ARIA state | real Box role/state equality | pass |
| name / `aria-hidden` | real Fiber `memoizedProps` -> host `stateNode` POC | experimental only |
| screen-reader separation | explicit screen-reader differential | partial; exact output remains |
| Yoga on ordinary commit | exact/runtime host facts | pass |
| clipping/wrapping/visible rect | exact/runtime comparison over the identical host nodes | relative intended/visible rect parity; absolute viewport placement still requires exact output + terminal evidence |
| stdout resize | causal resize and flush | fail: no React commit, stale snapshot |
| `<Static>` retention | pre/post callback comparison | fail: detached and zero-height |
| unmount | real Fiber callbacks | fail: public callback cannot identify root |
| focus / `useInput` | causal callback promises and committed host output | behavior proven; semantic focus source absent |
| explicit interactive/alternate/debug | frame-context plus captured inline/normal/alternate/debug stdout and clear/rerender behavior | terminal behavior measured; it is absent from React host data |
| resolved interactive default | omitted-option TTY and pipe differential | resolved values measured; public replacement still missing because CI policy is private |
| terminal flush / revision authority | public flush plus existing session tests | React-only replacement fails |
| `DEV=true` | isolated Node processes compare bytes and trap socket connect | pass for 7.1.1; Termwright does not set DEV |
| Bun | real unskipped Bun bridge process | pass locally; CI must provide Bun |
| pending stdout plus next commit/resize/unmount | deterministic `RenderBoundaryQueue` causal tests with deferred promises | queue contract passes without clocks; full Ink/PTY integration remains covered only by ordinary flush tests |
| traversal performance | real 513-node Ink host tree, 100 `observeInkTree` + JSON serialization iterations | measured; no timing threshold, numbers below |

### Reproducible runtime measurement

`ink-runtime-performance.test.ts` renders 256 Box/Text pairs (513 host nodes),
then runs the production `observeInkTree` traversal and JSON serialization 100
times. It reports rather than gates wall time, CPU, event-loop utilization,
heap/RSS deltas, V8 malloc deltas, peak malloc and serialized bytes. The fixed
tree and iteration count make runs comparable without pretending scheduler or
GC variance is a correctness condition.

The 2026-08-27 macOS arm64 / Node 24.1.0 full-suite run measured 51,300
visited nodes, 16,773,790 serialized bytes, 74,592,041 ns wall time, 88,631 µs
user CPU, 5,313 µs system CPU, 1,148,432 bytes heap-used delta, 15,679,488
bytes RSS delta, -2,141,696 bytes V8 malloc delta and 15,281,152 bytes peak malloc.
Signed allocation deltas are expected because GC may run; they are reported as
empirical memory evidence, never asserted as a budget.

The full local Ink run completed 113 tests across 19 files in 26.53 seconds.
This is an engineering measurement, not a timing assertion. CI correctness has
no wall-clock threshold, and the new differential, lifecycle and performance
tests use no sleeps, retries or polling.

## DEV decision and non-interference

Termwright directly invokes the reconciler instrumentation function and never
sets `DEV`. An isolated-process test also imports and renders Ink 7.1.1 with
`DEV` absent and with `DEV=true`, traps every attempted `net.Socket.connect`,
and compares captured Ink stdout plus process stderr byte-for-byte. They match
and no socket is opened. This proves `DEV` is unnecessary and non-interfering
for the pinned dependency graph; it is not permission to enable `DEV` in
production.

## Revised causal publication contract

React commit and terminal flush are distinct facts, and the React callback is
not emitted for every Ink render:

```text
Ink renderer / public onRender
    -> host tree and transient Static state are frozen
React Ink commit (when one exists)
    -> post-boundary root identity/conformance evidence
waitUntilRenderFlush + ordered terminal evidence
    -> output is causally complete
bounded semantic publication + same-writer marker
    -> authoritative SemanticTreeV2 revision
```

No semantic revision may be emitted merely because a React commit occurred.
Resize proves that some authoritative renders have no React commit, and Static
proves that waiting for the callback can be too late. Public `onRender` plus the
hidden host ref remains the stable zero-source route to the live root for
ordinary and resize renders. A smaller exact seam is still required to freeze
transient Static state unless another pre-detachment runtime hook is found.

## Removal gate

The new observer runs alongside the exact probe until differential conformance
matches hierarchy, identity, text, accessibility state, intended and clipped
geometry, static/live regions, lifecycle ordering and terminal placement. The
**planned** matrix includes initial mount, rapid rerender, unmount, component
replacement, multiple roots, nested custom components, wrapping, `<Static>`,
focus/input, normal and alternate screens, debug, resize and explicit
screen-reader mode. The exact coverage matrix above is authoritative about
which rows pass today.

Only full parity permits removal of `ink.js`/`renderer.js` source transforms,
their SHA profiles, sentinels and source-candidate discovery. A missing datum
must instead be recorded precisely and leave only the smallest exact hook that
provides it. There is no heuristic or incomplete-tree fallback.

Current decision: **do not remove either transform yet.** `renderer.js` still
uniquely supplies the pre-detachment Static snapshot and exact rendered-output
facts. Most explicit `ink.js` context facts have public replacements, but the
environment-resolved interactive value and exact causal contract still have no
public replacement even though their current behavior is now measured. The next safe target is a
minimal Static/render-boundary hook, not a React-only observer.
