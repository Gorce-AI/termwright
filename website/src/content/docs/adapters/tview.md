---
title: tview
description: Add semantic locators to a Go tview application.
---

The tview integration observes built-in primitives, their roles, focus, state,
and layout. It prepares an instrumented build because tview does not expose all
of that information through its public API.

## Prepare the application

Install the build helper:

```sh
npm install --save-dev @termwright/probe-tview
go get github.com/gorce-ai/termwright/clients/go@v0.4.1
```

Use the same release for `termwright`, `@termwright/probe-tview`, and the Go
client. The commands above target Termwright 0.4.1.

Attach the probe where the application starts tview:

```go
import "github.com/gorce-ai/termwright/clients/go/tviewprobe"

defer tviewprobe.Attach(app, root)()
if err := app.SetRoot(root, true).Run(); err != nil {
    panic(err)
}
```

The attachment does nothing during an ordinary application run. It publishes
semantics only when Termwright provides a session endpoint.

Create `scripts/build.mjs` to prepare the binary:

```ts
import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { prepareInstrumentedBuild } from '@termwright/probe-tview';

const exec = promisify(execFile);
const appDirectory = fileURLToPath(new URL('../app', import.meta.url));
const binaryPath = fileURLToPath(new URL('../dist/app', import.meta.url));
await mkdir(fileURLToPath(new URL('../dist', import.meta.url)), { recursive: true });
const build = await prepareInstrumentedBuild({ moduleDir: appDirectory });

await exec('go', ['build', ...build.goArgs, '-o', binaryPath, '.'], {
  cwd: build.moduleDir,
  env: { ...process.env, ...build.env },
});
```

Run that script from the package `pretest` command or before the test suite.
Then launch the prepared binary from `tests/app.test.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { expect, test } from 'termwright/test';

const binaryPath = fileURLToPath(new URL('../dist/app', import.meta.url));

test('shows the main list', async ({ terminal }) => {
  const app = await terminal.launch({ command: [binaryPath] });
  await expect(app.getByRole('list')).toBeAttached();
});
```

The build uses Go's `-toolexec` support and leaves `go.mod`, `go.sum`,
`go.work`, vendor files, and downloaded modules unchanged. A prebuilt binary
cannot be instrumented; test it through Termwright's black-box terminal API.

## Add application meaning

```go
import "github.com/gorce-ai/termwright/clients/go/annotate"

annotate.Tag(unreadBadge, annotate.Semantics{
    Role: "status",
    Name: "Unread messages",
    TestID: "unread-badge",
})
```

Use annotations for names, relationships, actions, or state that a built-in
tview primitive does not provide.

## Supported behavior

tview exposes stable primitive identity, focus, state, and intended bounds.
Lists and drop-downs also expose their derived item rectangles. Full clipping
through application-defined containers and paint order are unavailable.

Locator-based clicks need the application's real pointer router to be
registered with Termwright. Registration uses
`evidence.RegisterPointerEvidenceProvider`; its `HitTest` callback must be the
same application-owned router used for real mouse input. If the application
does not have such a router, use keyboard input rather than inventing geometry
for the test. The
[provider contract](https://github.com/gorce-ai/termwright/blob/main/clients/go/evidence/registry.go)
defines the observations and capabilities.

tview requires Go
1.24 or newer and Node.js 22 or 24 for the build helper. See
[Framework compatibility](../../reference/compatibility/)
for the measured minimum version.
