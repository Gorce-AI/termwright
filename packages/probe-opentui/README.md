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

## Runtime notes

Both are measured against `@opentui/core@0.5.3`, Bun 1.2.15 and Node 22/24; see
`docs/architecture/audit/opentui.md`.

- **Bun** is the primary runtime: `bun:ffi` is OpenTUI's supported FFI backend,
  while `node:ffi` needs Node 26.1+ or an experimental flag. The flag must sit
  before the entry file, and the application must be launched inside its own
  tree or Bun resolves the framework from its own install cache instead.
- **Node** uses `module.registerHooks` where available and falls back to
  `module.register`, which covers the whole `>= 22` range.
