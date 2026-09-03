---
title: Install and run your first test
description: Install Termwright, start a small terminal program, interact with it, and inspect a failure.
---

This tutorial starts a real terminal program, presses a key, and checks the
rendered result. It does not require a framework integration.

## Install Termwright

<!-- BEGIN GENERATED RUNTIME REQUIREMENTS -->
<!-- Generated from package.json; do not edit this block by hand. -->
- Use Node.js 22 or 24. Other major versions are not supported.
- You do not need to install Vitest separately. Termwright includes Vitest 4.1.11.
<!-- END GENERATED RUNTIME REQUIREMENTS -->

The native PTY package supports macOS 13.5+, Windows 10 1809+ or Server 2019+,
and glibc 2.35+ Linux. Alpine/musl is not supported. See
[supported platforms](../reference/limitations/) for architectures and other
limits.

Install the `termwright` package:

```sh
npm install --save-dev termwright
```

Then check that Termwright can load its test engine and native PTY backend:

```sh
npx termwright doctor
```

The command exits with code 0 when each required check passes.

## Create a program to test

Save this as `app.mjs`. The `.mjs` extension keeps the example self-contained
and does not require changing your project's module type.

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

The program waits for Enter before printing its result. It uses raw input, so a
plain redirected `stdin`/`stdout` test would not reproduce how it runs in a
terminal.

## Write the test

Create `tests/permission.test.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { expect, test } from 'termwright/test';

const program = fileURLToPath(new URL('../app.mjs', import.meta.url));

test('approves a command', async ({ terminal }) => {
  const app = await terminal.launch({ command: [process.execPath, program] });

  await app.waitForText('Permission required');
  await app.press('Enter');

  await expect(app).toHaveText('running: ls -la');
});
```

Run the test:

```sh
npx termwright test
```

The command reports one passing test and exits with code 0. Termwright closes
the application and removes the test's temporary working directory after the
test completes.

A runnable version of this example is available in
[`examples/getting-started`](https://github.com/gorce-ai/termwright/tree/main/examples/getting-started).

## Inspect a failure

Change the expected text to `running: pwd` and run the test again. The assertion
waits for the configured timeout, reports the observed terminal state, and keeps
a trace for the failed attempt.

Open the Runner:

```sh
npx termwright ui
```

The Runner starts in watch mode and will see the failed test in the current
project. Select its failed attempt to inspect the terminal, steps, and replay
timeline. Put the original expectation back when you are done.

## Test your own program

Replace `program` with the command your users run. Keep command arguments as
separate array items:

```ts
const app = await terminal.launch({
  command: ['my-cli', 'deploy', '--environment', 'staging'],
});
```

Use text and keyboard APIs for a black-box test. If your application uses Ink,
OpenTUI, Textual, tview, Bubble Tea, or Ratatui, follow its
[integration guide](../adapters/) before using controls by role or label. With
an integration enabled:

```ts
const approve = app.getByRole('button', { name: 'Approve' });
await expect(approve).toBeAttached();
await app.press('Enter');
await expect(app.getByRole('status')).toHaveText('Approved');
```

## Next steps

- [Structure a test](../writing-tests/)
- [Choose a locator](../guides/locators/)
- [Send keyboard and mouse input](../guides/actions/)
- [Run tests locally and in CI](../running-tests/)
