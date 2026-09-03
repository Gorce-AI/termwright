# @termwright/probe-tview

Prepare a Go tview application for semantic Termwright tests.

## Install

```sh
npm install --save-dev termwright @termwright/probe-tview
go get github.com/gorce-ai/termwright/clients/go@v0.4.1
```

The command targets Termwright 0.4.1. Keep the npm packages and Go client on
the same release version.

The build helper requires Node.js 22 or 24 and Go 1.24 or newer.

Add the probe immediately before the application's `Run` call:

```go
import "github.com/gorce-ai/termwright/clients/go/tviewprobe"

defer tviewprobe.Attach(app, root)()
if err := app.SetRoot(root, true).Run(); err != nil {
    panic(err)
}
```

Then use `prepareInstrumentedBuild()` in the script that builds the test
binary. It returns the Go arguments and environment needed for that one build
and does not modify the project's modules or vendor files.

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
const prepared = await prepareInstrumentedBuild({ moduleDir: appDirectory });
await exec('go', ['build', ...prepared.goArgs, '-o', binaryPath, '.'], {
  cwd: prepared.moduleDir,
  env: { ...process.env, ...prepared.env },
});
```

See the [tview integration guide](https://gorce-ai.github.io/termwright/adapters/tview/)
and the runnable tview example for complete build and test files, supported
versions, pointer setup, and limitations.
