# @termwright/probe-ink

Zero-config semantics for an Ink 7.1.1 application that imports nothing from
termwright. The application keeps its normal `import {render} from 'ink'` and
normal `render(<App />)` call; the launcher adds one preload flag.

## Install and launch

```sh
npm install --save-dev @termwright/probe-ink
```

Peers: Ink 7.1.1, React >= 19.2. Node >= 22, or Bun. The Ink version is exact:
the preload verifies both instrumented upstream modules by SHA-256 before it
negotiates semantic capabilities.

```ts
import {withProbe} from '@termwright/probe-ink';

const {command} = withProbe('node', ['node', 'app.mjs']);
await launchTerminal({
  command,
  env: {
    TERMWRIGHT_ENDPOINT: endpoint,
    TERMWRIGHT_TOKEN: token,
  },
});
```

For Bun, pass `withProbe('bun', ['bun', 'app.tsx'])`; the launcher places
`--preload` before the application entry, where Bun requires it. Node uses
`--import`. Node receives a `file://` preload URL, including on Windows; Bun
receives a native absolute path because its Windows preload resolver does not
load `file://` entries.

Early Node 22 releases do not have `module.registerHooks`; the preload detects
that case and uses `module.register`. It does not change Node's warning policy.
Pinned Ink itself emits a JSON-import ExperimentalWarning on Node 22.9, with or
without the probe, and byte parity retains it.

## Dormant and failure behaviour

Without both `TERMWRIGHT_ENDPOINT` and `TERMWRIGHT_TOKEN`, the preload installs
no loader hook and `ink.render` is untouched. If either Ink artifact does not
match 7.1.1 exactly, the adapter does not attach or advertise a partial
contract. An unreachable driver remains isolated from the application. Process
tests assert byte identity for dormant and faulted runs under Node and Bun.

## What is observed

Every retained Ink host survives into Probe IR:

- `ink-root` becomes `application`;
- `ink-text` and `ink-virtual-text` become `text`;
- every unannotated `ink-box` remains a `generic` node with its subtree;
- retained `aria-role` plus `checked`, `disabled`, `expanded`, `readonly`,
  `selected`, `busy`, and `multiline` aria-state facts are read directly;
- host object identity is kept in a `WeakMap`, so it is stable across renders.

An application may optionally import `@termwright/ink` and attach developer
intent with `useSemantic` or `<Semantic>`. The injected probe consumes that
process-local weak registry and merges `role`, `name`, `description`, `testId`,
domain `extended` state, actions, and relationships with the retained tree.
Developer annotations have annotation provenance; Ink-retained ARIA hints keep
framework provenance. Physical facts such as text, state, focus, visibility,
value, and bounds cannot be supplied by the annotation SDK.

Each live update publishes a full snapshot and revision commit. Ink calls
`onRender` before it writes frame bytes, so the probe freezes the laid-out host
tree synchronously, then drains the output stream and writes the authenticated
marker last. A newer render that arrives during drain suppresses the stale
marker. Instrumented output is byte-identical to vanilla output after those
markers are removed.

The checksummed renderer hook records Yoga rectangles and the same nested
overflow intersections used by `render-node-to-output`. A paired output tracker
maps those relative rectangles into the committed normal or alternate VT
viewport. It handles terminal wrapping, wide cells, resize, fullscreen scroll,
and `<Static>` output retained above the live region. Hidden nodes publish
authoritative absence instead of fabricated zero-sized boxes. Every marker is
written only after the corresponding output bytes drain.

Ink does not expose pointer ownership. Bounds therefore do not enable click,
hover, or drag by themselves. Those actions require an application evidence
provider that publishes revision-bound pointer regions and a native hit test;
device input still travels through the real PTY.

## Deliberate limits

Ink's reconciler discards application component names before creating the host
tree. A source component such as `ApproveButton` therefore cannot be reported:
`frameworkType` honestly remains `ink-box`, never a guessed component name or
stack. The same boundary prevents attributing Ink's active focus id to a host.
Text selection and third-party input values also remain unobservable without a
widget-library probe or author annotation. Ink retains `required` and
`multiselectable`, but the current semantic wire has no corresponding state
fields, so this probe omits them rather than repurposing a different fact.

Ink does not retain `aria-label` on a host element. A role that takes its name
from content uses rendered text; containers keep an empty name. These limits are
upstream facts documented in `docs/architecture/audit/ink.md`, not heuristics.

`@termwright/ink` is only the optional annotation SDK. Rendering, observation,
transport, and revision publication remain owned by this injected probe.
