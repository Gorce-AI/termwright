# Upstream audit — OpenTUI

> **Historical Phase 0 evidence.** The pinned-source measurements below are
> retained as design evidence. Any current support or setup guidance is
> superseded by the website OpenTUI adapter guide and compatibility reference.

**Pinned version: `@opentui/core@0.5.3`** (`pnpm-lock.yaml:1412`). Line
references are to the installed package at
`node_modules/.pnpm/@opentui+core@0.5.3_typescript@5.9.3_web-tree-sitter@0.25.10/node_modules/@opentui/core/`,
paths below relative to that directory.

**Material note:** the package ships **no `src/`**. On disk there are full
`.d.ts` files plus bundled ESM — `index.node.js` re-exporting
`chunk-node-kq7as74d.js` and `chunk-node-aj3n20gq.js` (Bun variant:
`index.bun.js`, `chunk-bun-*.js`). All line numbers below are in those real
files. `chunk-node-kq7as74d.js.map` carries `sourcesContent` with the original
TypeScript for 23 files, so the sources can be recovered 1:1 if a future round
needs them.

---

## 1. Where the component hierarchy lives

A retained object tree of `Renderable` instances, rooted at the renderer.

- `abstract class BaseRenderable extends EventEmitter` — `Renderable.d.ts:89`
  (impl. `chunk-node-kq7as74d.js:138`); `abstract class Renderable extends
BaseRenderable` — `Renderable.d.ts:116` (impl. `:192`).
- Root: `class RootRenderable extends Renderable` — `Renderable.d.ts:333`, id
  forced to `"__root__"` (`chunk-node-kq7as74d.js:1374`), reachable as
  `renderer.root` — `renderer.d.ts:236`.
- **Two parallel child lists**: `_childrenInLayoutOrder` and
  `_childrenInZIndexOrder` — `Renderable.d.ts:152-153`. `getChildren()` returns a
  **copy** of the layout-order list (`chunk-node-kq7as74d.js:1114-1116`).
- Mutations: `add()` — `Renderable.d.ts:262` (impl. `:977-1018`, inserts the Yoga
  child at `:1012`), `insertBefore()` — `:263` (impl. `:1019-1080`), `remove()` —
  `:265` (impl. `:1084-1112`).
- Text lives in a **separate subtree**: `TextNodeRenderable extends
BaseRenderable` — `renderables/TextNode.d.ts:17` — with its own children and no
  Yoga node and no position.

## 2. Where layout is computed

Yoga, same as Ink, but native and driven from the root once per frame when dirty.

- `protected yogaNode: YogaNode` on every `Renderable` — `Renderable.d.ts:146`,
  created as `yoga_default.Node.createForOpenTUI()` —
  `chunk-node-kq7as74d.js:260`.
- Results land in `_x`, `_y`, `_screenX`, `_screenY`, `_widthValue`,
  `_heightValue` — `Renderable.d.ts:122-129` — inside `updateFromLayout()`
  (`chunk-node-kq7as74d.js:901-930`): `_x = layout.left` (`:911`), `_screenX =
parentScreenX + _x + _translateX` (`:915`). **Screen coordinates accumulate
  from the parent, so a parent must be updated earlier in the same frame**; a
  per-frame guard sits at `:903-905`.
- Public getters `screenX/screenY/x/y/width/height` — `Renderable.d.ts:193-210`.
- The pass itself: `RootRenderable.calculateLayout()` —
  `chunk-node-kq7as74d.js:1459-1464` — runs Yoga, bumps a layout generation and
  emits `"layout-changed"`. Called from `RootRenderable.render()` only when
  `yogaNode.isDirty()` (`:1407-1411`).

`screenX/screenY` are true terminal cells, with no live-region caveat — a real
difference from Ink.

## 3. Where focus, selection and value live

- **Focus is attributable here**, unlike Ink. Per node: `_focusable`, `_focused`,
  `_hasFocusedDescendant` — `Renderable.d.ts:134-136`; public `focused` /
  `focusable` — `:164-165, 179`. Centrally: `renderer.currentFocusedRenderable` —
  `renderer.d.ts:385`, with `focusRenderable()/blurRenderable()` — `:389-390`
  (impl. `chunk-node-kq7as74d.js:7497-7521`) emitting `focused_renderable`
  (`:7509`). There is no separate FocusManager class.
- **Selection** is a first-class, global concept: `renderer.getSelection()` —
  `renderer.d.ts:584`, `startSelection/updateSelection/clearSelection` —
  `:587-596`, event `selection` — `:200`. Per node: `selectable`,
  `hasSelection()`, `getSelectedText()` — `Renderable.d.ts:131, 172-174`.
- **Value** exists per widget — see the table in §6. `InputRenderable.value` is a
  real accessor (`renderables/Input.d.ts:50-51`, verified).

**There is no accessibility layer at all.** A grep for `aria`, `role`, `checked`
across every `.d.ts` in the package returns nothing but `ConsoleMode =
"disabled"` (`renderer.d.ts:58`). No roles, no `checked`, no `disabled` state.
Whatever semantics we want has to be derived from class identity plus the fields
below.

## 4. The central render choke point

`CliRenderer.loop()` — declared `renderer.d.ts:576`, implemented
**`chunk-node-kq7as74d.js:9757-9876`**. One frame passes through it:

1. `this._frameId++` (`:9767`);
2. requestAnimationFrame callbacks (`:9777-9780`) and `frameCallbacks`
   (`:9784-9790`) — the latter run **before** the tree walk;
3. **`this.root.render(this.nextRenderBuffer, deltaTime)`** (`:9793`);
4. `postProcessFns` (`:9794-9796`);
5. `this.renderNative()` (`:9799`);
6. `emit(FRAME, {frameId})` (`:9814-9818`) — **only when
   `listenerCount("frame") > 0`**, so a subscriber must exist before the loop
   starts;
7. reschedule via `clock.setTimeout` (`:9826-9829`).

Scene-level choke point: `RootRenderable.render()` —
`chunk-node-kq7as74d.js:1398-1449` — which interprets a command list and calls
`command.renderable.render(...)` at `:1429`. Note the list is **reused between
frames when layout did not change** (`:1414-1421`), so "we walked the tree this
frame" is not a safe inference.

## 5. What disappears at render, and the earliest point before it does

Less is lost than in Ink, and later. `Renderable.render()`
(`chunk-node-kq7as74d.js:1181-1200`) draws into an `OptimizedBuffer` and then
registers the node in a hit grid: `_ctx.addToHitGrid(screenX, screenY, width,
height, this.num)` (`:1196`). The tree stays alive after the frame; nothing about
structure is destroyed.

What _is_ unavailable in JS is the **output**: see §9. The bytes are produced
natively.

**Earliest useful points**, in order of preference, all public:

- `renderer.setFrameCallback(fn)` — `renderer.d.ts:557` — before the walk;
- `renderable.renderBefore` / `renderAfter` — `Renderable.d.ts:161-162`
  (verified) — a **per-node hook that needs no subclassing**;
- `renderable.onLifecyclePass` — `Renderable.d.ts:160` (verified), invoked for
  all registered nodes at the start of `RootRenderable.render()`
  (`chunk-node-kq7as74d.js:1402-1406`);
- `renderer.addPostProcessFn(fn)` — `renderer.d.ts:554` — after the walk, with
  the buffer;
- `root.on('layout-changed')` — `Renderable.d.ts:11-14`, emitted at
  `chunk-node-kq7as74d.js:1463` — the best "geometry changed" signal.

## 6. Stable object identity

Two identifiers, both stable for the object's lifetime:

- **`readonly num: number`** — `Renderable.d.ts:93` — from a monotonic static
  counter: `this.num = BaseRenderable.renderableNumber++`
  (`chunk-node-kq7as74d.js:148`, verified). No setter. This is the reliable key,
  and it is what the hit grid uses (`:1196`).
- `id: string` — `Renderable.d.ts:92, 106-107` — `options.id ?? \`renderable-${this.num}\``
(`chunk-node-kq7as74d.js:149`, verified). **Mutable at runtime**, and changing
it updates no index (lookup is a linear scan, `:1082`), so it is an
  author-supplied label, not an identity.

A process-wide registry exists: `static renderablesByNumber: Map<number,
Renderable>` — `Renderable.d.ts:117` (verified), populated in the constructor
(`:242`) and cleared in `destroy()` (`:1242`). `Renderable` is exported from the
index, so **every live node in the process is reachable without patching
anything**.

Identity survives re-render and even `remove()` (which does not destroy —
`:1084-1112`). It does _not_ survive a reactive layer above the core recreating
instances.

## 7. Observability of custom components

Better than Ink, but still class-level. A custom widget is a subclass of
`Renderable`, so it is a first-class node in the tree with its own `constructor.name`
— unlike Ink, where user components vanish into four host element kinds.

Caveats:

- `constructor.name` is the only signal, and it does not survive minification.
- Composite widgets inject nodes the author never wrote: `ScrollBoxRenderable`
  puts `wrapper`, `viewport` and `content` between itself and the user's children
  (`renderables/ScrollBox.d.ts:36-38`), and `ContentRenderable`
  (`renderables/ScrollBox.d.ts:9`) is **not exported**, so it can only be
  recognised by name.

## 8. Correlating a render with terminal cells

Direct: `screenX/screenY/width/height` are terminal cells
(`Renderable.d.ts:193-210`), and the same values are handed to the hit grid at
`chunk-node-kq7as74d.js:1196`, which is what mouse hit-testing uses. Geometry and
input therefore already agree without any work on our side.

## 9. Thread and loop ownership — the decisive difference

The JS loop is on the main thread (`chunk-node-kq7as74d.js:9826-9829`; no worker
for rendering), but **the renderer core is native Zig reached over FFI**:

- boundary class `FFIRenderLib` — `chunk-node-aj3n20gq.js:15176`, `dlopen(...)` at
  `:13512`; binaries ship as `@opentui/core-<platform>` optional dependencies;
- backend selection: `bun:ffi` under Bun, `node:ffi` under Node (needs Node 26.1+
  or `--experimental-ffi`), otherwise unsupported —
  `chunk-node-aj3n20gq.js:234-245`;
- every frame crosses at `this.lib.render(this.rendererPtr, force)` —
  `chunk-node-kq7as74d.js:9905` (verified).

`useThread` defaults to `true` (forced `false` on Linux) —
`chunk-node-kq7as74d.js:7270-7274`. When on, a **Zig thread writes the bytes**.

> **Intercepting `process.stdout.write` will not see the frames.** This is the
> single most important finding for instrumentation, and the opposite of Ink.

The legal ways to get output bytes in JS:

- pass a custom `stdout` in the config, which allocates a `NativeSpanFeed` whose
  `onData` returns bytes to JS — `chunk-node-kq7as74d.js:7237, 7247-7254,
7280-7284`;
- `addPostProcessFn` and read the `OptimizedBuffer` before the native call;
- the undocumented escape hatch `OTUI_NO_NATIVE_RENDER`
  (`chunk-node-kq7as74d.js:7417-7420`).

Our render-commit marker cannot be written by appending to stdout the way it is
under Ink; it has to go through whichever of these the launcher chooses.

## 10. Version-sensitive internals

**Safe base — exported from the index and public in the types:**
`createCliRenderer` (`renderer.d.ts:186`), `CliRenderer` and its whole event set
(`renderer.d.ts:187-204`), `Renderable`/`BaseRenderable`/`RootRenderable`,
`getChildren()`, `id`, `num`, `parent`, `focused`, `focusable`,
`screenX/screenY/width/height`, `addPostProcessFn`, `setFrameCallback`,
`renderBefore`/`renderAfter`, `onLifecyclePass`, `Renderable.renderablesByNumber`.

**Private or protected — reachable only by cast or prototype patch:**
`_childrenInLayoutOrder` / `_childrenInZIndexOrder` (`Renderable.d.ts:152-153`),
`_focused` / `_focusable` (`:134-136`), `_screenX` and friends (`:124-129`),
`_ctx` (`:119`), `yogaNode` (`:146`), and **most widget state**:
`SelectRenderable._options` / `_selectedIndex` (`renderables/Select.d.ts:43-44`,
verified — and `selectedIndex` has a **setter with no getter**, `:120`),
`TabSelectRenderable.selectedIndex` (no underscore —
`renderables/TabSelect.d.ts:40`), `SliderRenderable._value`
(`renderables/Slider.d.ts:17`).

**Not exported, yet needed:**

- `rendererTracker` — `chunk-node-kq7as74d.js:6969-6972` (verified) — a singleton
  holding `renderers: Set` and `streamOwners: WeakMap`, registered at `:7399`.
  Absent from `index.d.ts`; reachable only as
  `globalThis[Symbol.for("@opentui/core/singleton")].RendererTracker`
  (mechanism at `chunk-node-aj3n20gq.js:748-756`). This is a real route to "find
  the renderer without touching the application", on a string key with no
  contract.
- `ContentRenderable` (`renderables/ScrollBox.d.ts:9`), present in every
  ScrollBox subtree.
- `ctx.__otuiLayoutGeneration` / `__otuiRenderListRevision`
  (`chunk-node-kq7as74d.js:181, 189`) — in no `.d.ts`, but the only cheap
  "something changed" signal.

**Highest practical risk:** widget values behind private fields with no getter;
`rendererTracker` by string key; and the fact that the whole output path
(`writeOut` / `NativeSpanFeed` / stdout interception —
`chunk-node-kq7as74d.js:7237-7284, 7400, 7551-7561`) is an unpublished contract.

---

## Interception mechanism

### The point to wrap: `createCliRenderer`

- Signature: `export declare function createCliRenderer(config?:
CliRendererConfig): Promise<CliRenderer>` — **`renderer.d.ts:186`** (verified);
  implementation `chunk-node-kq7as74d.js:6973-6993`, which constructs
  `new CliRenderer(...)` at `:6981` and awaits `setupTerminal()` at `:6983`.
- It **returns a class instance**, not an object literal, so a wrapper can hand
  back the same object after attaching listeners — no proxying of a literal's
  methods required.
- Re-exported from the index via `export * from "./renderer.js"` —
  `index.d.ts:15` (verified); in the runtime bundle at `index.node.js:14999`.
  Wrapping the module export therefore reaches every caller.
- Because the async function `await`s terminal setup, a wrapper can attach before
  the first frame without racing the loop, which only starts on `start()`/`auto()`
  (`renderer.d.ts:562-569`).

Two fallbacks exist if the export cannot be wrapped: the `rendererTracker`
singleton (§10) and `Renderable.renderablesByNumber` (§6), both of which find
live objects without any module interception.

### Node and Bun module hooks

The runtime entry mechanisms were verified empirically: `module.registerHooks`
(Node 22.22.0+, absent on 22.9.0), `module.register` (whole `>=22` range) and
Bun's `--preload` plus `Bun.plugin().onLoad` intercept the public package entry
and return a shim around its real exports. Unlike Ink's exact-source semantic
transforms, OpenTUI now uses runtime observation for semantics and a small
structural AST transform only for causal stdout-feed transport.

One OpenTUI-specific consequence: **Bun is the likely runtime here**, since
`bun:ffi` is the supported FFI backend while `node:ffi` needs Node 26.1+ or an
experimental flag (`chunk-node-aj3n20gq.js:234-245`). The Bun path —
`bun --preload <probe> <entry>`, flag before the entry, no `bunfig.toml`, filter
on the resolved path rather than the bare specifier — is therefore the primary
one to support, not the fallback.

## Runtime-observer refactor evidence (2026-08-25)

The generated-source investigation above remains upstream audit evidence. The
shipped probe intercepts the public package entry and `createCliRenderer()`. It
wraps the live renderer/root/buffer
lifecycle, samples the exact-version-certified `renderOffset` at the same
`root.render()` boundary, commits geometry on `CliRenderEvents.FRAME`, and uses
the renderer's native `hitTest()` for pointer ownership. Semantic observation
never transforms a chunk. A separate output-only AST transform retains the
NativeSpanFeed because public hooks do not expose successful native byte
delivery. It discovers no chunk name and uses no source or bundle digest.

Before removing the source transform, the old exact observer and the runtime
observer were run together against `@opentui/core@0.5.3` under real Bun. The
comparison covered nested clipping and overflow, scrolling and culling,
overlapping ownership, buffered and custom renderables, custom local scissor
activity, resize, dynamic mount/unmount, consecutive frames, hit-grid results,
identity, intended/visible bounds, ordering and frame revision. The public
runtime surfaces matched except for split-footer surface origin: the public
tree and hit grid are surface-local while private `renderOffset` identifies the
terminal row. Reading that field at the same render pass restored exact parity;
estimating `terminalHeight - height` did not (observed origin 1 versus estimate
12 in the adversarial case).

The production invariant is therefore:

```text
exact allowlisted package version
  -> structural stdout/feed capability match
  -> createCliRenderer wrapper
  -> capability-check renderer/root/renderList/renderOffset/hit APIs
  -> observe one synchronous root render pass
  -> FRAME commits the complete observation
  -> session publishes and appends the marker on the same sink
```

Any missing capability, partial/unbalanced pass, render-list replacement,
unknown command, missing same-writer sink or mismatched frame ID terminates the
adapter with `adapter-guarantee-violation`. Candidate admission reruns the real
Bun behavior and full conformance suites and records only the accepted package
version in `certified-runtime.json`.
