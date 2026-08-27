---
title: tview
description: Build a verified tview application with semantic observation and optional Go annotations.
---

tview requires a controlled build because part of its useful component
structure is private. Termwright uses Go's official `-toolexec` seam to compile
owned add-only capability units inside the resolved tview and tcell packages.
It does not copy or edit upstream modules or application source files.

## Install and prepare the build

```sh
npm install --save-dev @termwright/probe-tview
```

```ts
import { prepareInstrumentedBuild } from '@termwright/probe-tview';

const build = await prepareInstrumentedBuild({ moduleDir: appDirectory });
await execFile('go', ['build', ...build.goArgs, '-o', binaryPath, '.'], {
  cwd: appDirectory,
  env: { ...process.env, ...build.env },
});
const app = await terminal.launch({ command: [binaryPath] });
```

Add one dormant lifecycle attachment to the application:

```go
import "github.com/gorce-ai/termwright/clients/go/tviewprobe"

defer tviewprobe.Attach(app, root)()
if err := app.SetRoot(root, true).Run(); err != nil {
    panic(err)
}
```

This is the only application-side opt-in. Without the Termwright environment
it returns before allocating or installing hooks. Candidate versions are
admitted by compiler and behavioral conformance; missing private capabilities
fail loudly instead of generating an exact source-patch profile. The controlled
build does not modify `go.mod`, `go.sum`, an existing `go.work`, the vendor tree,
or upstream module bytes.

## Add application meaning

```go
annotate.Tag(unreadBadge, annotate.Semantics{
    Role: "status",
    Name: "Unread messages",
    TestID: "unread-badge",
})
```

Use annotations for domain names, relationships, actions, and state that tview
cannot provide.

## Supported behavior

tview 0.42.0 with Go 1.24+ is verified. Stable primitive identity, framework
state and intended geometry are automatic. Synthetic List and DropDown entries
carry derived item rectangles, declared as such instead of being presented as
direct primitive geometry. Full ancestor-clipped geometry and enumeration of
children hidden behind application-defined containers remain named degraded
capabilities. Use keyboard input where authoritative pointer ownership is not
available.

See [Framework compatibility](../../reference/compatibility/) for the matrix.
