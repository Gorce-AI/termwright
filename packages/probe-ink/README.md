# @termwright/probe-ink

Zero-config semantics for an Ink 7 application that imports nothing from
termwright. The application keeps its normal `import {render} from 'ink'` and
normal `render(<App />)` call; the launcher adds one preload flag.

## Install and launch

```sh
npm install --save-dev @termwright/probe-ink
```

Peers: `ink >= 7.1 < 8`, React >= 19.2. Node >= 22, or Bun.

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
`--import`. The returned preload path is a `file://` URL, including on Windows.

Early Node 22 releases do not have `module.registerHooks`; the preload detects
that case and uses `module.register`. It does not change Node's warning policy.
Pinned Ink itself emits a JSON-import ExperimentalWarning on Node 22.9, with or
without the probe, and byte parity retains it.

## Dormant and failure behaviour

Without both `TERMWRIGHT_ENDPOINT` and `TERMWRIGHT_TOKEN`, the preload installs
no loader hook and `ink.render` is untouched. If the driver is unavailable or
the observed Ink internals move, semantics disable themselves and the
application continues. Process tests assert byte identity for dormant and
faulted runs under both Node and Bun.

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

Bounds are published only when Ink runs interactively in the alternate screen
buffer and no `<Static>` content shifts the live region. Otherwise coordinates
are omitted rather than reported as terminal-absolute when they are not.
With `TERMWRIGHT_PROTOCOL=termwright/2`, those facts use tagged observations:
display is known, intended bounds are known or explicitly unsupported, and
visible clipping plus pointer ownership are unsupported rather than inferred.

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
