---
title: Getting started
description: Install Termwright, run a terminal application in a real PTY, interact with it, and open the Runner UI.
---

This tutorial creates one test for a terminal program. It uses rendered text
and keyboard input, so it works without a framework integration.

## Prerequisites

- Node.js 22 or newer
- an ESM project
- macOS, Windows, or glibc-based Linux

Alpine/musl is not currently supported by the prebuilt PTY dependency. For
Linux CI, use a Debian- or Ubuntu-based Node image such as `node:22-slim`.

## Install Termwright

```sh
npm install --save-dev termwright
```

Add scripts that use the locally installed binaries:

```json
{
  "scripts": {
    "test": "termwright test",
    "test:watch": "termwright watch",
    "test:ui": "termwright ui"
  }
}
```

## Create a terminal program

Create `app.js` (the same source is checked in at
[`examples/getting-started/app.js`](https://github.com/gorce-ai/termwright/blob/main/examples/getting-started/app.js)):

```js
import readline from 'node:readline';

readline.emitKeypressEvents(process.stdin);
process.stdin.setRawMode?.(true);

process.stdout.write('Permission required\n[Approve]  Reject\n');
process.stdin.once('keypress', (_input, key) => {
  if (key.name === 'return') {
    process.stdout.write('running: ls -la\n');
    process.exit(0);
  }
});
```

Termwright launches this program inside a pseudo-terminal. The program sees a
terminal, not a mocked stream.

## Write the test

Create `tests/permission.test.ts`. This example is also executed from
[`examples/getting-started/tests/permission.test.ts`](https://github.com/gorce-ai/termwright/blob/main/examples/getting-started/tests/permission.test.ts):

```ts
import {fileURLToPath} from 'node:url';
import {expect, test} from 'termwright/test';

const program = fileURLToPath(new URL('../app.js', import.meta.url));

test('approves a command', async ({terminal}) => {
  const app = await terminal.launch({command: [process.execPath, program]});

  await app.waitForText('Permission required');
  await app.press('Enter');

  await expect(app).toHaveText('running: ls -la');
});
```

Run it:

```sh
npm test
```

The `terminal` fixture closes every launched session after the test. Each test
also receives an isolated temporary working directory and a minimal inherited
environment.

## Open the Runner UI

```sh
npm run test:ui
```

Interactive use opens the Termwright desktop application. The Specs view lets
you run the project, a directory, a file, or one case. The Runner shows the
terminal, test steps, retained evidence, and replay controls. Use
`termwright ui --browser` to open the same interface in your system browser, or
`termwright ui --no-open` to print the local URL only.

## Add semantic locators

The first test uses text and keyboard input because every terminal program
supports them. A framework integration can additionally publish roles, names, state,
and—where the framework exposes it—geometry and pointer ownership.

With semantics available, the interaction can be written as:

```ts
await app.getByRole('button', {name: 'Approve'}).activate();
await expect(app.getByRole('dialog')).toBeDetached();
```

Do not add arbitrary sleeps while waiting for the UI. Termwright waits and
assertions observe terminal or semantic revisions and retry until their timeout.

## Continue

- [Write maintainable tests](../writing-tests/)
- [Run a suite, file, or case](../running-tests/)
- [Understand test files and isolation](../guides/test-files/)
- [Choose locators](../guides/locators/)
- [Send keyboard, pointer, and terminal input](../guides/actions/)
- [Use assertions](../guides/assertions/)
- [Choose snapshots](../guides/snapshots/)
- [Choose a framework integration](../adapters/)
- [Debug a failed test](../tools/debugging/)
