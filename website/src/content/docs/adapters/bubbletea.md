---
title: Bubble Tea and Bubbles
description: Add semantic locators to a Go Bubble Tea application.
---

Bubble Tea stores application state in values and renders a string rather than
retaining a widget tree. The Termwright integration observes the model during
an instrumented build and recognizes supported Bubbles components.

## Prepare the application

Install the build helper:

```sh
npm install --save-dev @termwright/probe-charm
```

Use the same release for `termwright` and `@termwright/probe-charm`.

Create `scripts/build.mjs` to prepare the binary:

```ts
import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { prepareInstrumentedBuild } from '@termwright/probe-charm';

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

test('shows the server field', async ({ terminal }) => {
  const app = await terminal.launch({ command: [binaryPath] });
  await expect(app.getByRole('textbox', { name: 'Server host' })).toBeAttached();
});
```

Keep using `teatest` for fast, in-process model tests. Termwright is for tests
that need the compiled program, real terminal input, resize or exit behavior,
and replayable failures.

## Give copied values stable meaning

Annotations are optional. If the application uses them, add the matching Go
client first:

```sh
go get github.com/gorce-ai/termwright/clients/go@v0.4.1
```

The command targets Termwright 0.4.1; keep it aligned with the npm packages.

```go
import "github.com/gorce-ai/termwright/clients/go/annotate"

func (serverInput) TermwrightSemantics() annotate.Semantics {
    return annotate.Semantics{
        Key: "server-host",
        Name: "Server host",
        TestID: "server-host",
    }
}
```

Bubble Tea copies model values between updates. Add a unique `SemanticKey` when
a locator must follow the same element across frames. Duplicate keys fail the
test instead of selecting an arbitrary element. Password values are not
published in semantic state.

## Pointer input

A Bubble Tea application that handles `tea.MouseClickMsg` can register that
same pointer router with Termwright. Termwright uses it to select a cell, then
sends the ordinary mouse sequence through the PTY; it does not call `Update`
directly. See the runnable
[Bubble Tea login example](https://github.com/gorce-ai/termwright/tree/main/examples/bubbletea-login)
for the complete setup.

Without a registered router, use keyboard input. Layout and viewport geometry
cannot be recovered from Bubble Tea's rendered string, so geometry assertions
are unavailable. The build requires Go 1.24 or newer and Node.js 22 or 24.
Only the exact framework versions in
[Framework compatibility](../../reference/compatibility/) are supported.
