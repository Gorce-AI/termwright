---
title: Write a terminal test
description: Launch a program, wait for its UI, perform input, and assert the result.
---

A Termwright test follows the same sequence as a person using the program:
start it, wait for a recognizable screen, perform an action, and check the
result.

```ts
import { fileURLToPath } from 'node:url';
import { expect, test } from 'termwright/test';

const program = fileURLToPath(new URL('../profile.js', import.meta.url));

test('saves a profile', async ({ terminal }) => {
  const app = await terminal.launch({ command: [process.execPath, program] });

  await app.waitForText('Profile name');
  await app.type('release');
  await app.press('Tab');
  await app.press('Enter');

  await expect(app).toHaveText('Saved release');
});
```

## Start the application

Pass the executable and its arguments as an array:

```ts
const app = await terminal.launch({
  command: ['my-cli', 'edit', '--profile', 'staging'],
});
```

Termwright does not invoke a shell for this form. Arguments containing spaces
remain one argument. Use the [shell API](../guides/shell-commands/) only when the
shell itself is part of the behavior under test.

The application's default working directory is private to the test. Use an
absolute path for a program built inside your repository, and pass required
environment variables explicitly:

```ts
const app = await terminal.launch({
  command: [process.execPath, program],
  env: { API_BASE_URL: 'http://127.0.0.1:4100' },
});
```

Use `envMode: 'inherit'` only when the application intentionally needs the
complete parent environment.

If most tests launch the same application, configure a default command and call
`terminal.launch()` without arguments. Follow the complete
[configuration setup](../reference/configuration/); Termwright does not discover
a `termwright.config.ts` file implicitly.

## Wait for the screen you need

Use the condition that makes the next action valid:

```ts
await app.waitForText('Profile name');
// Requires a framework integration:
await expect(app.getByRole('textbox', { name: 'Profile name' })).toBeFocused();
```

Do not add a fixed sleep before an action or assertion. Screen waits and
Termwright matchers retry as the terminal changes and finish as soon as the
condition passes.

Use `waitForExit()` when process termination is the result. `waitForQuiet()` is
a heuristic for an operation that needs screen geometry to stop changing.

## Find controls at the right level

With a framework integration, prefer the identity a user would recognize:

```ts
const save = app.getByRole('button', { name: 'Save' });
const profileName = app.getByLabel('Profile name');
```

Without an integration, locate rendered text or interact through the terminal:

```ts
const prompt = app.getByScreenText('Press Enter to continue');
await expect(prompt).toBeVisible();
await app.press('Enter');
```

See [Choose a locator](../guides/locators/) for the recommended order and
framework requirements.

## Perform one user action at a time

```ts
await app.type('release');
await app.press('Tab');
await app.press('Enter');
```

Send keys separately when the application must render between them. See
[Press keys](../guides/actions/#press-keys) for batched key sequences.

Named steps make longer flows easier to inspect in a failure trace:

```ts
test('deletes a profile', async ({ terminal, step }) => {
  const app = await terminal.launch({ command: [process.execPath, program] });

  await step('confirm deletion', async () => {
    await app.getByRole('button', { name: 'Delete' }).activate();
    await app.getByRole('button', { name: 'Confirm' }).activate();
  });

  await expect(app).toHaveText('Profile deleted');
});
```

## Assert observable behavior

```ts
await expect(app).toHaveText('Saved release');
await expect(app.getByRole('button', { name: 'Save' })).toBeDisabled();
await expect(app.getByRole('status')).toHaveText('Saved');
```

Termwright's terminal and locator matchers are asynchronous. Always `await`
them. Prefer a focused assertion over a cell or semantic snapshot unless the
complete screen or tree is the behavior you want to protect.

## Keep tests independent

Each test receives a fresh temporary working directory. Seed the files a test
needs when launching the application. The application reads and writes these
files from its default working directory:

```ts
const app = await terminal.launch({
  files: {
    'config.json': JSON.stringify({ theme: 'dark' }),
    'notes/todo.md': '- write tests\n',
  },
});
```

Every launched session is closed during fixture cleanup, including after a
failure. Call `app.close()` yourself only when closing the application is part
of the scenario.

## Continue

- [Send keyboard, paste, mouse, resize, and signals](../guides/actions/)
- [Use retrying assertions](../guides/assertions/)
- [Prepare files and templates](../guides/test-files/)
- [Open a failed test in the Runner](../tools/debugging/)
