# @termwright/probe-opentui

Semantics from an OpenTUI application that **imports nothing of ours**.

The application is launched with one extra flag. A module hook replaces
`@opentui/core`'s entry with a shim that wraps `createCliRenderer`, and the
probe observes the renderer's retained tree from there. Nothing is written into
the project, no configuration file is needed, and the application's source is
untouched.

## Install

```sh
npm install --save-dev @termwright/probe-opentui
```

Peer: `@opentui/core >= 0.5.0`. Node >= 22, or Bun.

## Usage

A launcher composes the command; this package never spawns anything.

```ts
import {withProbe} from '@termwright/probe-opentui';

const {command} = withProbe('bun', ['bun', 'app.ts']);
// ['bun', '--preload', '/…/bun-preload.js', 'app.ts']

await launchTerminal({command, env: {TERMWRIGHT_ENDPOINT: endpoint, TERMWRIGHT_TOKEN: token}});
```

Under Node the flag is `--import` instead, because the probe is ESM.

## Dormant without instrumentation

With no `TERMWRIGHT_ENDPOINT` and `TERMWRIGHT_TOKEN` in the environment the
entry points install **nothing** — no module hook, no global, no allocation —
so a preload that ends up somewhere it was not meant to be is inert. The test
suite asserts this in both runtimes.

## What an instrumented run produces

A vanilla application — no import, no annotation, no configuration — publishes a
semantic tree built from what OpenTUI exposes: roles from the widget classes,
real terminal cells for bounds, focus from the renderer, values from the input
widgets. Output stays byte-identical to an uninstrumented run apart from the
render-commit markers, which is asserted rather than asserted-to.

What OpenTUI has no concept of — roles, `checked`, `disabled`, `expanded` — is
reported as **unobservable** rather than as absent, so a test can tell "this is
off" from "this framework never said".

An application may optionally call `describeRenderable` from
`@termwright/opentui`. The SDK stores only developer intent in a process-local
weak registry; this injected probe consumes it and merges it with framework
geometry, text, focus, value, selection, and visibility. The annotation API can
provide `role`, `name`, `description`, `testId`, JSON `extended` domain state,
actions, and relationships, but cannot override those physical/runtime facts.
The renderer is still created and owned entirely by the application.

## Deviations

**`frameworkType` comes from `constructor.name`.** OpenTUI has no accessibility
layer at all, so a class name is the only signal there is. It does not survive
minification: a bundled application's widgets arrive as `generic` with a mangled
type. Nothing is lost that was not already unknowable, but the names get worse.

**`visibleRect` is never reported.** OpenTUI clips with ancestor scissor rects
at render time and exposes no per-node visible rectangle, so those intermediate
clips remain unobservable. The recognizer does apply the terminal viewport — a
real outer clip known from the frame itself — to intended bounds. A non-empty
widget entirely outside that viewport is reported `hidden + offscreen`; an
intrinsically zero-area widget is only hidden when the framework says it is.

**`paint-order` is announced but omitted per tree where it cannot be honoured.**
The z-order child list is a protected field upstream; when a version stops
exposing it, the walk falls back to document order and drops `paintOrder`
entirely rather than passing one off as the other.

## Runtime notes

Both are measured against `@opentui/core@0.5.3`, Bun 1.2.15 and Node 22/24; see
`docs/architecture/audit/opentui.md`.

- **Bun** is the primary runtime: `bun:ffi` is OpenTUI's supported FFI backend,
  while `node:ffi` needs Node 26.1+ or an experimental flag. The flag must sit
  before the entry file, and the application must be launched inside its own
  tree or Bun resolves the framework from its own install cache instead.
- **Node** uses `module.registerHooks` where available and falls back to
  `module.register`, which covers the whole `>= 22` range.
