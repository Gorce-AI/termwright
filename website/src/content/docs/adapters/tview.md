---
title: tview
description: Build a verified tview application with semantic observation and optional Go annotations.
---

tview requires an instrumented build because its useful component structure is
private. Termwright prepares a checksummed copy of the exact supported version;
it does not edit application modules or source files.

## Install and prepare the build

```sh
npm install --save-dev @termwright/probe-tview
```

```ts
import {prepareInstrumentedBuild} from '@termwright/probe-tview';

const build = await prepareInstrumentedBuild({moduleDir: appDirectory});
await execFile('go', ['build', '-o', binaryPath, '.'], {
  cwd: build.moduleDir,
  env: {...process.env, ...build.env},
});
const app = await terminal.launch({command: [binaryPath]});
```

Unsupported versions are rejected. The temporary workspace does not modify
`go.mod`, `go.sum`, or an existing `go.work`.

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

tview 0.42.0 with Go 1.24+ is verified. Stable primitive identity is automatic.
Primitive rectangles can appear as diagnostic observations, but the framework
does not guarantee intended geometry because synthetic List and DropDown items
do not own authoritative rectangles. Viewport clipping and exact hit testing
are unsupported; use keyboard input.

See [Framework compatibility](../../reference/compatibility/) for the matrix.
