---
title: Bubble Tea and Bubbles
description: Build verified Bubble Tea applications with frame-local semantic component state.
---

Bubble Tea models are values rather than retained widgets. Termwright observes
the model at each rendered frame and recognizes supported Bubbles components.

## Install and prepare the build

```sh
npm install --save-dev @termwright/probe-charm
```

```ts
import {prepareInstrumentedBuild} from '@termwright/probe-charm';

const build = await prepareInstrumentedBuild({moduleDir: appDirectory});
await execFile('go', ['build', '-o', binaryPath, '.'], {
  cwd: appDirectory,
  env: {...process.env, ...build.env},
});
const app = await terminal.launch({command: [binaryPath]});
```

Supported Bubble Tea versions are verified and unknown versions are refused.

## Use teatest for model tests

`teatest` remains useful for fast, in-process tests of a Bubble Tea `Model`.
Use Termwright for end-to-end tests that need the compiled program, a real
terminal, keyboard input, resize behavior, exit behavior, traces, or semantic
state from the instrumented build.

The same project can use `teatest` for model tests and Termwright for the
end-to-end lane.

## Add stable application meaning

```go
func (serverInput) TermwrightSemantics() annotate.Semantics {
    return annotate.Semantics{
        Key: "server-host",
        Name: "Server host",
        TestID: "server-host",
    }
}
```

A unique key stabilizes an annotated copied value between frames. Duplicate or
missing keys remain frame-local and cannot become relation targets.

## Supported behavior

Bubble Tea 1.3.10 and 2.0.8 with Go 1.24+ are verified. Roles, names, values,
selection, and observable component state are available. Password values are
withheld. Geometry and hit testing are unsupported; use keyboard input.

See [Framework compatibility](../../reference/compatibility/) for current coverage.
