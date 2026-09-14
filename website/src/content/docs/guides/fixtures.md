---
title: Extend test fixtures
description: Compose reusable application setup on top of the Termwright Vitest fixtures.
---

Use `test.extend()` when several tests need the same launch and setup. Keep
one-off files and options in the test that uses them.

## Create an application fixture

```ts
import { fileURLToPath } from 'node:url';
import type { TerminalHarness } from 'termwright';
import { expect, test as base } from 'termwright/test';

const editor = fileURLToPath(new URL('../editor.js', import.meta.url));

const test = base.extend<{ app: TerminalHarness }>({
  app: async ({ terminal }, use) => {
    const app = await terminal.launch({
      command: [process.execPath, editor],
      files: { 'config.json': '{}' },
    });
    await app.waitForText('Ready');
    await use(app);
  },
});

test('saves on Ctrl+S', async ({ app }) => {
  await app.press('Control+s');
  await expect(app).toHaveText('Saved');
});
```

The custom fixture is typed alongside `terminal`, `step`, and the other
Termwright fixtures. Teardown runs inside-out, so the terminal session remains
available while the custom fixture finishes its cleanup.

## Own resources and sidecar processes

Every test receives an abort-aware `resources` scope. Register cleanup as soon
as a resource is created; Termwright runs it once in reverse order on success,
failure, or timeout:

```ts
test('uses a disposable server', async ({ resources, termwright }) => {
  const database = resources.use(await openDatabase());
  const server = await termwright.sidecars.launch({
    command: [process.execPath, 'server.js'],
    ready: /listening on/,
  });

  // database and server remain alive for the test and are always closed.
});
```

Use `resources.acquire((signal) => createResource(signal))` when setup can
outlive a test timeout. A late result is still disposed. Sidecars retain bounded
stdout and stderr tails for readiness failures and terminate their complete
process tree during teardown.

## Apply options to a file or suite

Use `test.override()` to change launch defaults for a file or nested `describe`:

```ts
import { describe, test } from 'termwright/test';

test.override({ termwrightOptions: { columns: 120, trace: 'on' } });

describe('wide layout', () => {
  test.override({ termwrightOptions: { columns: 200 } });
  // Tests here use 200 columns. Other tests in the file use 120.
});
```

Suite overrides merge between project configuration and an individual launch:

```text
configureTermwright() < test.override() < terminal.launch()
```

`env` and `timeouts` merge by key. `command` replaces the complete argv rather
than concatenating argument lists. See [Configuration](../../reference/configuration/)
for the exact option surface.

## Choose where setup belongs

| Setup                                 | Recommended location                    |
| ------------------------------------- | --------------------------------------- |
| Files needed by one case              | `terminal.launch({files})` in that case |
| Shared project tree                   | `terminal.launch({template})`           |
| Reusable launch and login flow        | `test.extend()` fixture                 |
| Viewport or trace default for a suite | `test.override()`                       |
| Project-wide default                  | `configureTermwright()`                 |

See [Test files and isolation](../test-files/) for working-directory behavior.
