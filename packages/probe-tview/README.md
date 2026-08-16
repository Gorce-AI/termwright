# @termwright/probe-tview

Semantics from a [tview](https://github.com/rivo/tview) application that
**imports nothing of ours**.

The application is built through an ephemeral Go workspace that redirects
`github.com/rivo/tview` to an instrumented copy. Nothing is written into the
project: its `go.mod`, its `go.sum` and any `go.work` of its own come out of the
build byte-identical.

## Install

```sh
npm install --save-dev @termwright/probe-tview
```

Requires the Go toolchain and `git` (which the toolchain needs anyway). Node >= 22.

## Usage

One call prepares the build; the launcher owns everything else.

```ts
import {prepareInstrumentedBuild} from '@termwright/probe-tview';

const build = await prepareInstrumentedBuild({moduleDir: 'path/to/app'});

// build.env carries GOWORK; the project's own files are untouched.
await execFile('go', ['build', '-o', 'app-binary', '.'], {cwd: 'path/to/app', env: build.env});

await launchTerminal({command: ['./app-binary']});
```

The framework version is read from the module, the instrumented copy is cached,
and a second call with the same inputs reuses it.

## What it gives you

Being inside the package is the point. A `tview.Grid` exposes no accessor for
its children at all, so an out-of-package adapter has to be handed a callback;
here it is a field read that also carries whether the item was drawn. A widget
on a `Pages` page that is not shown reports as **hidden** rather than going
missing, so a test can tell "not on screen" from "not there".

Identity is the primitive's pointer: tview retains its widget tree, so the same
`*Button` is the same button across frames.

## Dormant without instrumentation

Without `TERMWRIGHT_ENDPOINT` and `TERMWRIGHT_TOKEN` the instrumented copy opens
no socket, writes no marker and renders exactly what upstream renders. That is
measured, not asserted: the test suite builds the same application twice, once
against untouched tview and once against the copy, and requires the two screens
to be byte-identical.

## When it refuses

- `-mod=vendor` in `GOFLAGS` is reported by name rather than overridden;
  workspace mode is incompatible with it, and overriding would change what
  compiles.
- A framework version with no patch set is named as such — "this is not
  tview v0.42.0" — instead of failing somewhere inside a diff.

## Development

```sh
pnpm build && pnpm typecheck && pnpm test
```

The suites that need Go or a pseudo-terminal skip themselves where either is
missing, and say so in a test named for it. `TERMWRIGHT_SKIP_GO=1` and
`TERMWRIGHT_SKIP_PTY=1` force it. Implementation notes, including the traps
that cost time, are in [`NOTES.md`](NOTES.md).
