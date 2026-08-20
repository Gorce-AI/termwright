# Upstream audit — Ink

> **Historical Phase 0 evidence.** The pinned-source measurements below are
> retained as design evidence. Any current support or setup guidance is
> superseded by the website Ink adapter guide and compatibility reference.

**Pinned version: `ink@7.1.1`** (`pnpm-lock.yaml:2727`), React 19.2.8, Yoga via
`yoga-layout`. Every line reference below is to the installed build at
`node_modules/.pnpm/ink@7.1.1_@types+react@19.2.18_react@19.2.8/node_modules/ink/build/`,
abbreviated `build/`. Facts were read from that tree, not from documentation.

Purpose: establish what can be observed, and from where, if instrumentation is
attached by intercepting a normal `import { render } from 'ink'` rather than by
asking the application to call anything of ours.

---

## 1. Where the component hierarchy lives

Ink runs a **custom React reconciler over its own host tree**. The host tree is
not React's fiber tree and does not contain the application's components.

- Host node factory: `createNode(nodeName)` — `build/dom.js:5`.
- Node kinds are a closed set of four: `'ink-root' | 'ink-box' | 'ink-text' |
  'ink-virtual-text'` (`ElementNames`, `build/dom.d.ts`).
- Nodes are created by the reconciler's `createInstance(originalType, newProps,
  …)` — `build/reconciler.js:129`. A `<Text>` nested inside another `<Text>`
  becomes `ink-virtual-text` (`build/reconciler.js:134-136`); a `<Box>` inside a
  `<Text>` throws (`:130-132`).
- Structure is mutated through `appendChildNode` / `insertBeforeNode` /
  `removeChildNode`, wired as the host config's `appendChild`,
  `appendChildToContainer`, etc. — `build/reconciler.js:185-212`, implementations
  in `build/dom.js:21` onwards.
- Parent/child links on the node: `parentNode`, `childNodes` (`build/dom.d.ts`).

**Consequence for instrumentation:** the tree that survives past render is a
four-kind element tree. Everything the application called a "Button" is gone by
this point — see §7.

## 2. Where layout is computed

Yoga, per node, driven from the root once per commit.

- Every element except `ink-virtual-text` gets its own Yoga node at creation:
  `yogaNode: nodeName === 'ink-virtual-text' ? undefined : Yoga.Node.create()` —
  `build/dom.js:12`.
- Styles are pushed into Yoga in `createInstance` when the `style` prop is
  applied: `applyStyles(node.yogaNode, value)` — `build/reconciler.js:143-147`
  (`applyStyles` lives in `build/styles.js`).
- The single layout pass: `Ink.calculateLayout` — `build/ink.js:319`, whose body
  is `this.rootNode.yogaNode.calculateLayout(undefined, undefined,
  Yoga.DIRECTION_LTR)` — `build/ink.js:322`. It is bound to the root as
  `rootNode.onComputeLayout` at `build/ink.js:184` and invoked by the reconciler
  at commit time (§5).
- Public read path: `measureElement(node)` — `build/measure-element.js:31`, which
  sums `getComputedLeft()/getComputedTop()` up the `parentNode` chain
  (`build/measure-element.js:14-22`). It therefore returns coordinates **inside
  Ink's live layout region**, not the terminal viewport.

## 3. Where focus, selection and value live

- **Focus** is a single id on a React context: `FocusContext` created with
  `{activeId: undefined, …}` — `build/components/FocusContext.js:3-4`. A
  component becomes focusable only by calling `useFocus`
  (`build/hooks/use-focus.js`), which computes `isFocused: activeId === id` and
  **registers the component as focusable** as a side effect. Ids are
  `Math.random().toString().slice(2, 7)` unless the author passes one.
  `useFocusManager()` exposes `activeId` publicly
  (`build/hooks/use-focus-manager.js:14`).
- **Selection**: no concept. Ink has no selection model.
- **Value**: no concept. Ink ships no value-bearing widget; text entry is
  third-party (`ink-text-input` and friends) built out of `<Text>`, so a value
  exists only inside application state.

**Consequence:** focus is readable process-wide but **not attributable** — Ink
never associates `activeId` with an element. Value and selection have to come
from the application or from a probe placed in the widget library.

## 4. The central render choke point

`Ink.onRender` — `build/ink.js` (assigned as a class field; the tree-to-string
call is at `build/ink.js:348`). Everything funnels through it:

1. `const { output, outputHeight, staticOutput } = render(this.rootNode, this.isScreenReaderEnabled)` — `build/ink.js:348`;
2. `this.options.onRender?.({renderTime})` — `build/ink.js:349`, i.e. **the
   public callback fires before any byte is written**;
3. the write paths follow (`build/ink.js:359-411`), ending in
   `renderInteractiveFrame`.

It is throttled: `maxFps` (default 30) becomes `renderThrottleMs`
(`build/ink.js:194-199`) and `onRender` is wrapped in `throttle(...)` —
`build/ink.js:205`.

A second, lower choke point exists at the reconciler boundary:
`resetAfterCommit(rootNode)` — `build/reconciler.js:92`.

## 5. What disappears at render, and the earliest point before it does

The tree is converted to **a single string** and everything structural is lost:

- `renderer.js` builds an `Output` and walks the tree:
  `new Output({...})` — `build/renderer.js:22`, `renderNodeToOutput(node, output, …)` — `build/renderer.js:26`.
- The walk reads Yoga coordinates and writes text at cell positions:
  `const x = offsetX + yogaNode.getComputedLeft()` — `build/render-node-to-output.js:82`,
  `let text = squashTextNodes(node)` — `:91`,
  `output.write(x, y, text, {transformers})` — `:100`
  (`Output.write` — `build/output.js:47`, class at `build/output.js:37`).
- After that point only `output` (a string plus height) exists. Roles, node
  identity and parent links are unrecoverable from it.

**Earliest point where both the tree and a fresh layout exist:**
`resetAfterCommit` — `build/reconciler.js:92` — which calls
`rootNode.onComputeLayout()` (`:93-95`, i.e. the Yoga pass) and then
`emitLayoutListeners(rootNode)` (`:96`). Anything that needs geometry plus
structure must run at or after that call and before `build/renderer.js:26`.

In practice `options.onRender` (`build/ink.js:349`) is the usable hook: layout is
already computed for that frame, the tree is intact, and no bytes have been
written yet. `emitLayoutListeners` is the alternative and is what `useBoxMetrics`
subscribes to.

## 6. Stable object identity

Host nodes are **plain objects with no id of any kind** — `createNode`
(`build/dom.js:5`) sets `nodeName`, `style`, `attributes`, `childNodes`,
`parentNode`, `yogaNode` and nothing identifying.

Identity is therefore **object identity of the host node**, which is stable for
as long as React keeps the instance: `createInstance`
(`build/reconciler.js:129`) runs once per mounted element, and re-renders mutate
the existing node rather than replacing it. A keyed remount creates a new node —
the reconciler comment at `build/reconciler.js:217` documents exactly that
ordering hazard.

A `WeakMap` keyed by the node is the only correct way to attach an external id;
this is what our current adapter does.

Ink instances themselves are tracked in a `WeakMap` keyed by the output stream —
`build/instances.js` — which is how consecutive `render()` calls to the same
stdout reuse one `Ink`.

## 7. Observability of custom components

**Zero, in the host tree.** `createInstance` receives `originalType`
(`build/reconciler.js:129`), which is already the host element name — `ink-box`
or `ink-text` — never the application's component. Component names live only in
React's fiber tree, which Ink's host config does not expose (`shouldSetTextContent:
() => false` — `build/reconciler.js:128`, and no `getInstanceFromNode`-style
accessor is provided).

Anything that wants to know a node came from the app's `<Approve>` needs either
an annotation the app wrote, a probe inside the widget library, or access to the
fiber tree by other means.

## 8. Correlating a render with terminal cells

Two independent sources, which must agree:

- **Geometry**: Yoga's computed box, read either through `measureElement`
  (`build/measure-element.js:31`, absolute within the live region) or directly
  off `yogaNode` during the output walk (`build/render-node-to-output.js:82`).
- **Cells**: `Output.write(x, y, text, …)` — `build/output.js:47` — is the only
  place text is placed at a coordinate, and it is internal to the render pass.

The live layout region equals the viewport only when Ink owns the whole screen:
interactive mode plus `alternateScreen`, with no `<Static>` output above it
(`<Static>` writes above the region and scrolls). This is why our adapter reports
the `absolute-bounds` capability conditionally.

## 9. Thread and loop ownership

Single-threaded, no worker, no native loop. Renders are driven by React commits
and rate-limited by the `throttle` at `build/ink.js:205`; writes go straight to
the stdout stream from the same tick (`build/ink.js:359-411`).

Frame writes are wrapped in synchronized-output sequences (`ESC[?2026h` /
`ESC[?2026l`) — `build/ink.js:227-231`, `:374-411`.

**Consequence:** intercepting `process.stdout.write` *does* see every frame, in
order — unlike OpenTUI (see that audit, §9). Our marker relies on this.

## 10. Version-sensitive internals

| Surface | Status | Risk if it changes |
|---|---|---|
| `DOMElement.internal_accessibility` `{role, state}` (`build/dom.d.ts`) | `internal_`-prefixed but in the public type | Role/state for un-annotated apps stops working |
| `internal_transform`, `internal_static` (`build/dom.d.ts`) | internal | Static detection and text transforms |
| `yogaNode` on the host node (`build/dom.js:12`) | internal | All geometry |
| `rootNode.onComputeLayout` / `onRender` / `onImmediateRender` / `onStaticChange` (`build/reconciler.js:92-112`) | internal wiring | The commit hook |
| `emitLayoutListeners` / `addLayoutListener` (`build/dom.js`) | exported from `dom.js`, **not** from the package index | Layout subscription |
| `options.onRender`, `measureElement`, `useFocusManager`, `waitUntilRenderFlush` | **public** (`build/index.d.ts`) | Safe base |

### aria props: what upstream already has

These are **Ink's own**, not something we added; we only read them.

- `<Box>` accepts `aria-role`, `aria-state`, `aria-label`, `aria-hidden`
  (`build/components/Box.d.ts:9-31`). Only `role` and `state` are stored on the
  node, via `internal_accessibility: {role, state}` — `build/components/Box.js`.
- `aria-label` is **not retained**: `Box` renders it as a text child *only when a
  screen reader is active* (`const label = ariaLabel ? <ink-text>{ariaLabel}</ink-text> : undefined`,
  used under `isScreenReaderEnabled`), and `<Text>` drops it the same way
  (`build/components/Text.js`). There is no way to read an accessible name back
  off the tree.
- Ink's role vocabulary is 18 values (`button`, `checkbox`, `combobox`, `list`,
  `listbox`, `listitem`, `menu`, `menuitem`, `option`, `progressbar`, `radio`,
  `radiogroup`, `tab`, `tablist`, `table`, `textbox`, `timer`, `toolbar` —
  `build/components/Box.d.ts:17`), and its state set is `busy`, `checked`,
  `disabled`, `expanded`, `multiline`, `multiselectable`, `readonly`, `required`,
  `selected` (`:21-31`).

**The single most valuable upstream change would be retaining `aria-label` on the
element.** Without it, an application that has fully annotated itself for Ink's
own screen-reader support still yields nameless nodes.

---

## Interception mechanism

Everything in this section was **executed**, not looked up. Probe scripts were
run against this repo's `node_modules`, then deleted.

### Node — two APIs, different reach

| API | 20.17.0 | 22.9.0 | 22.22.0 | 24.1.0 |
|---|---|---|---|---|
| `module.register` (async, off-thread) | ✅ | ✅ | ✅ | ✅ |
| `module.registerHooks` (sync, in-thread) | ❌ | ❌ | ✅ | ✅ |

Measured by running the same probe under each interpreter from `~/.nvm`.

**This matters: our `engines` say `node >= 22` (root `package.json`) and CI runs
the 22 and 24 matrix (`.github/workflows/ci.yml:25`), so `registerHooks` cannot
be assumed.** The boundary is somewhere between 22.9.0 and 22.22.0; Node's
changelog names 22.15.0, which was not verified here.

Both paths were proven to intercept a bare `import('ink')` and have the patched
export visible to the application:

- **`registerHooks`** (sync `load` hook, same thread) — worked on 24.1.0 and
  22.22.0. Appending `export const __TW_PATCHED__ = true` to
  `.../ink/build/index.js` produced `patched = true` in the importing app.
- **`register('./hooks.mjs', import.meta.url)`** (async hooks on a loader
  thread) — worked on 22.9.0 and 24.1.0, i.e. it covers the whole supported
  range.

Two observations that matter for a "leaves no trace" guarantee:

- Only `load` is needed. Matching on the *resolved URL* is what works; a
  `resolve` hook filtering the bare specifier is not required.
- On 22.9.0 the `register()` path emitted
  `ExperimentalWarning: Importing JSON modules` to stderr. Nothing was printed on
  24.1.0. Any launcher using the off-thread path on older Node has to account for
  that line, or suppress it deliberately.

`registerHooks` additionally covers **CJS**, which `register` does not; that is
the reason to prefer it where available rather than a performance argument.
`Module._load` monkey-patching is not needed and is not considered here.

### Bun — `--preload` plus a plugin, no `bunfig.toml`

Verified with Bun 1.2.15 in a directory with **no `bunfig.toml`**:

```
bun --preload ./preload.ts ./app.ts
```

- The flag is `-r, --preload=<val>` (`bun --help`), with `--require` as a Node
  compatibility alias. It must come **before** the entry file; `bun run --preload
  … app.ts` also works, but `bun --preload … run app.ts` is rejected as a usage
  error.
- `BUN_PRELOAD` as an environment variable did **not** work — the preload never
  ran. A launcher must pass the flag on argv.
- Inside the preload, `Bun.plugin({name, setup})` runs before the entry, and its
  `onLoad` replaces module source: patching `.../ink/build/index.js` made
  `__TW_PATCHED__` visible to an app doing `await import('ink')` resolved from
  this repo's pnpm store.
- **`onResolve` with `filter: /^ink$/` did not fire** for that bare import, while
  `onLoad` on the resolved absolute path did. Filter on the resolved path.
- Bun resolves from its own install cache when the entry sits outside a project
  with `node_modules` (observed: `~/.bun/install/cache/ink@7.1.1@@@1/…`). The
  launcher must run the entry inside the application's own tree, or the patched
  copy will not be the one the app loads.
