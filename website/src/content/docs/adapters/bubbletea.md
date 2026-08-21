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

A unique key stabilizes an annotated copied value between frames. A missing key
is explicitly frame-local. Duplicate explicit keys are a producer-contract
violation and fail with `TW_DUPLICATE_SEMANTIC_KEY` rather than selecting an
unstable winner.

## Expose a production pointer router

Bubble Tea applications commonly route `tea.MouseClickMsg` themselves. Register
that exact router before `tea.NewProgram(...).Run()`:

```go
registration, err := evidence.RegisterPointerEvidenceProvider(provider)
if err != nil { return err }
defer registration.Close()
```

The provider returns `semantic node → region` and optionally `x/y → semantic
node`; it does not call `Update` and has no dispatch callback. Termwright plans
a physical point and sends the ordinary mouse protocol through the PTY. The
runnable [Bubble Tea login example](https://github.com/gorce-ai/termwright/tree/main/examples/bubbletea-login)
uses an explicit SemanticKey for its Submit control and proves that only the
normal `tea.MouseClickMsg` branch changes its status.

## Supported behavior

Bubble Tea 1.3.10 and 2.0.8 with Go 1.24+ are verified. Roles, names, values,
selection, and observable component state are available. Password values are
withheld. Layout geometry is unavailable automatically. Exact pointer regions
and hit testing are application-integrated through a production router; without
one, use keyboard input.

See [Framework compatibility](../../reference/compatibility/) for current coverage.
