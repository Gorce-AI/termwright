# @termwright/probe-charm

Prepare a Bubble Tea application for semantic Termwright tests.

## Install

```sh
npm install --save-dev termwright @termwright/probe-charm
```

Keep `termwright` and `@termwright/probe-charm` on the same release version.
The Go client is optional unless the application adds annotations or evidence;
when needed for Termwright 0.4.1, install it with:

```sh
go get github.com/gorce-ai/termwright/clients/go@v0.4.1
```

The build helper requires Node.js 22 or 24 and Go 1.24 or newer.

Use `prepareInstrumentedBuild()` in the script that builds the test binary:

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
const prepared = await prepareInstrumentedBuild({ moduleDir: appDirectory });
await exec('go', ['build', ...prepared.goArgs, '-o', binaryPath, '.'], {
  cwd: prepared.moduleDir,
  env: { ...process.env, ...prepared.env },
});
```

The helper recognizes the supported Bubble Tea and Bubbles versions and leaves
the project's `go.mod`, `go.sum`, vendor files, and existing workspace
unchanged. The resulting binary publishes model semantics only when Termwright
provides a session.

See the [Bubble Tea integration guide](https://gorce-ai.github.io/termwright/adapters/bubbletea/)
and the runnable login example for complete build and test files, stable keys,
pointer setup, and limitations.
