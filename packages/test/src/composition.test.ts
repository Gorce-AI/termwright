/**
 * The composition path: `test` is Vitest's own `extend`, so a project builds
 * its own fixtures on top of it rather than waiting for the preset to grow an
 * option for every setup.
 *
 * This file pins the three things that make the pattern usable: the types flow
 * through, a composed fixture can use the terminal, and teardown runs
 * inside-out — the user's fixture still has a live session when it cleans up.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect } from 'vitest';
import type { TerminalHarness } from '@termwright/driver';
import { configureTermwright, ptyAvailable, test } from './index.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'driver', 'test-fixtures');

configureTermwright({
  columns: 60,
  rows: 10,
  trace: 'off',
  command: [process.execPath, join(FIXTURES, 'semantic-app.mjs')],
});

const pty = await ptyAvailable();

/** What a project's own `app` fixture looks like: launch, wait, hand over. */
const order: string[] = [];

const appTest = test.extend<{ app: TerminalHarness }>({
  app: async ({ terminal }, use) => {
    const app = await terminal.launch();
    await app.waitForText('Permission required');
    order.push('app:setup');

    await use(app);

    // Still inside the terminal fixture, so the session is alive here: a
    // fixture that logs out, deletes a record or asserts a final state can do
    // it with the program still running.
    expect(app.screen().text()).toContain('Permission required');
    order.push('app:teardown');
  },
});

afterAll(() => {
  if (!pty) return;
  expect(order).toEqual(['app:setup', 'body', 'app:teardown']);
});

describe.skipIf(!pty)('a fixture composed on top of the preset', () => {
  appTest('receives a ready program and the preset fixtures beside it', { timeout: 30_000 }, async ({
    app,
    terminal,
    step,
  }) => {
    order.push('body');
    // The composed fixture's value is a real harness…
    await expect(app.getByRole('button', { name: 'Approve' })).toBeFocused();
    // …and the preset's own fixtures are still injectable next to it.
    expect(terminal.sessions).toContain(app);
    await step('use both', async () => {
      await app.press('Tab');
      await expect(app.getByRole('button', { name: 'Reject' })).toBeFocused();
    });
  });
});
