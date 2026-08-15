/**
 * The same test shapes as the Ink example, against a Go program.
 *
 * Nothing here knows the application is written in Go: the driver speaks to it
 * over a pseudo-terminal and a socket, so a test reads the same either way.
 *
 * Skipped when the binary was not built (no Go toolchain) or when no
 * pseudo-terminal can be opened; `TERMWRIGHT_SKIP_PTY=1` skips it explicitly.
 */

import { existsSync } from 'node:fs';
import { describe, expect, ptyAvailable, test } from '@termwright/test';
import { binary } from '../termwright.config.js';

const runnable = (await ptyAvailable()) && existsSync(binary);

describe.skipIf(!runnable)('the tview menu', () => {
  test('publishes the menu as a semantic tree', async ({ terminal }) => {
    const app = await terminal.launch();
    await app.waitForText('New file');

    // The matcher polls, so it is what waits for the adapter's handshake — a
    // plain read of the capability is only meaningful once a tree arrived.
    await expect(app).toMatchSemanticSnapshot();
    expect(app.capabilities().semanticTree).toBe(true);
    await expect(app).toMatchCellSnapshot();
  });

  test('walks the menu with the keyboard', async ({ terminal }) => {
    const app = await terminal.launch();
    await app.waitForText('New file');

    await expect(app.getByRole('listitem', { name: 'New file' })).toHaveState({ selected: true });

    await app.press('ArrowDown');
    await expect(app.getByRole('listitem', { name: 'Settings' })).toHaveState({ selected: true });
  });

  test('opens the settings form and saves it', async ({ terminal, step }) => {
    const app = await terminal.launch();
    await app.waitForText('New file');

    // The form's widgets are in the tree from the start, on a page tview has
    // not shown yet — and they carry `hidden`, so visibility means what it says.
    await expect(app.getByRole('button', { name: 'Save' })).not.toBeVisible();

    await step('open Settings from the menu', async () => {
      await app.press('ArrowDown Enter');
      await expect(app.getByRole('textbox', { name: 'Name' })).toBeVisible();
    });

    await app.type('release');
    // tview keeps the value on the widget, so it arrives as the node's value
    // rather than as screen text — which is what makes this assertion survive a
    // change of the field's decoration.
    await expect(app.getByRole('textbox', { name: 'Name' })).toHaveText('release');

    await step('save', async () => {
      // Tab out of the field and onto the button row, then activate: the receipt
      // says which physical strategy was used.
      await app.press('Tab');
      const receipt = await app.getByRole('button', { name: 'Save' }).activate();
      expect(['click', 'focus-enter', 'focus-space']).toContain(receipt.strategy);
    });

    await expect(app).toHaveText('status: saved release');
  });
});
