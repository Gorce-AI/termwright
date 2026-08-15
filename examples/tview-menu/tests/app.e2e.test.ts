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
import { expect, test } from '@termwright/test';
import { binary } from '../termwright.config.js';
import { ptyAvailable } from './pty.js';

const runnable = ptyAvailable() && existsSync(binary);
const testIf = runnable ? test : test.skip;

testIf('publishes the menu as a semantic tree', async ({ terminal }) => {
  const app = await terminal.launch();
  await app.waitForText('New file');
  await app.waitForStable();

  expect(app.capabilities().semanticTree).toBe(true);
  await expect(app).toMatchSemanticSnapshot();
  await expect(app).toMatchCellSnapshot();
});

testIf('walks the menu with the keyboard', async ({ terminal }) => {
  const app = await terminal.launch();
  await app.waitForText('New file');

  // No settle needed before a matcher: it polls until the adapter publishes
  // the tree for the frame the screen already showed.
  await expect(app.getByRole('listitem', { name: 'New file' })).toHaveState({ selected: true });

  await app.press('ArrowDown');
  await expect(app.getByRole('listitem', { name: 'Settings' })).toHaveState({ selected: true });
});

testIf('opens the settings form and saves it', async ({ terminal, step }) => {
  const app = await terminal.launch();
  await app.waitForText('New file');
  // An action, unlike a matcher, does not poll for the tree.
  await app.waitForStable();

  await expect(app.getByRole('button', { name: 'Save' })).not.toBeVisible();

  await step('open Settings from the menu', async () => {
    await app.press('ArrowDown Enter');
    // The form sits on a tview page that was hidden until now. Its widgets
    // were in the tree the whole time, carrying `hidden`, so this asserts what
    // the test means — the form is on screen — rather than that it exists.
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
