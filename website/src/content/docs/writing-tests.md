---
title: Writing tests
description: Structure Termwright tests around launch, interaction, assertions, and automatic cleanup.
---

A normal Termwright test launches an application, waits for its initial state,
performs real input, and asserts the observable result.

```ts
import {fileURLToPath} from 'node:url';
import {expect, test} from 'termwright/test';

const program = fileURLToPath(new URL('../profile.js', import.meta.url));

test('saves a profile', async ({terminal, step}) => {
  const app = await terminal.launch({command: [process.execPath, program]});
  await app.waitForText('Profile name');

  await step('enter a name', async () => {
    await app.type('release');
    await app.press('Tab');
  });

  await step('save', async () => {
    await app.press('Enter');
  });

  await expect(app).toHaveText('Saved release');
});
```

## Launch the application

Pass a command for one test:

```ts
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

const app = await terminal.launch({
  command: [process.execPath, cli],
});
```

If every test uses the same command, set it once in `termwright.config.ts` and
call `terminal.launch()` without arguments. See [Configuration](../reference/configuration/).

## Seed files before launch

Files are written into the test's isolated working directory before the process
starts:

```ts
const editor = fileURLToPath(new URL('../editor.js', import.meta.url));

const app = await terminal.launch({
  command: [process.execPath, editor],
  files: {
    'config.json': JSON.stringify({theme: 'dark'}),
    'notes/todo.md': '- write tests\n',
  },
});
```

Use `template` when a test needs an existing directory tree. See
[Test files and isolation](../guides/test-files/).

## Wait for observable state

Prefer a wait or retrying assertion that describes the state you need:

```ts
await app.waitForText('Ready');
await app.press('Tab');
await expect(app.getByRole('button', {name: 'Save'})).toBeFocused();
```

Avoid `setTimeout()` and fixed sleeps. They add latency and still fail under a
slower machine.

Use `waitForQuiet()` before an action that requires geometry to stop moving.
Use `waitForExit()` when process termination is the outcome under test.

## Group actions into steps

Named steps appear in traces, reports, Gherkin scenarios, and the Runner
timeline:

```ts
await step('confirm deletion', async () => {
  await app.getByRole('button', {name: 'Delete'}).activate();
  await expect(app.getByRole('dialog')).toBeVisible();
});
```

Steps should describe user intent. Keep individual assertions and input calls
inside the step so a failure retains its context.

## Let fixtures clean up

Every `terminal.launch()` call is tracked by the test fixture. Sessions and the
isolated directory are cleaned up after the case, including when an assertion
fails. Call `close()` only when closing the session is part of the test.

## Next steps

- [Locators](../guides/locators/)
- [Actions and input](../guides/actions/)
- [Assertions](../guides/assertions/)
- [Snapshots](../guides/snapshots/)
- [Gherkin scenarios](../guides/gherkin/)
