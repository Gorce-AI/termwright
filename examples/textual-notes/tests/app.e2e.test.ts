/**
 * A TypeScript test driving a Python application. The driver spawns
 * `python3 app/notes_app.py` in a pseudo-terminal and addresses it by role,
 * so this file looks exactly like the Ink one — that is the whole point of the
 * protocol being language-neutral.
 *
 * Skipped when Python, Textual or the `termwright` package is missing, or when
 * no pseudo-terminal can be opened (`TERMWRIGHT_SKIP_PTY=1` skips explicitly).
 */

import { fileURLToPath } from 'node:url';
import { expect, test } from '@termwright/test';
import { ptyAvailable } from './pty.js';
import { pythonWithTextual } from './python.js';

const python = pythonWithTextual();
const script = fileURLToPath(new URL('../app/notes_app.py', import.meta.url));
const testIf = python !== null && ptyAvailable() ? test : test.skip;

/** The command, resolved once. `python` is non-null wherever this is used. */
const command = [python ?? 'python3', script];

testIf('publishes the notebook as a semantic tree', async ({ terminal }) => {
  const app = await terminal.launch({ command });
  await app.waitForText('write the release notes');
  await app.waitForStable();

  // The matcher polls, so it is what waits for the handshake; the plain read
  // of the capability is only safe once a tree has actually arrived.
  await expect(app).toMatchSemanticSnapshot();
  expect(app.capabilities().semanticTree).toBe(true);
});

testIf('adds a note from the input field', async ({ terminal, step }) => {
  const app = await terminal.launch({ command });
  await app.waitForText('write the release notes');
  // `waitForText` is satisfied by the screen, and the tree describing that
  // frame is published a beat later. Matchers poll through that gap; an
  // *action* does not, so a test that acts first waits for the frame to settle.
  await app.waitForStable();

  await step('type into the draft field', async () => {
    await app.getByRole('textbox').click();
    await app.type('ship 1.0');
    await expect(app.getByRole('textbox')).toHaveText('ship 1.0');
  });

  await app.getByRole('button', { name: 'Add' }).activate();

  // The assertion is the wait: it re-probes until Textual has published the
  // tree for the frame the click caused.
  await expect(app.getByRole('listitem', { name: 'ship 1.0' })).toBeVisible();
  await expect(app).toHaveText('status: added ship 1.0');
});

testIf('asks for confirmation before deleting a note', async ({ terminal, step }) => {
  const app = await terminal.launch({ command });
  await app.waitForText('write the release notes');
  await app.waitForStable();

  await step('open the dialog', async () => {
    await app.getByRole('button', { name: 'Delete' }).activate();
  });

  await expect(app.getByRole('dialog')).toBeVisible();
  await expect(app.getByRole('button', { name: 'Cancel' }).within(app.getByRole('dialog'))).toBeFocused();

  await step('dismiss it with Escape', async () => {
    await app.press('Escape');
    await expect(app.getByRole('dialog')).not.toBeVisible();
  });

  await expect(app).toHaveText('status: cancelled');

  await step('confirm the second time', async () => {
    await app.getByRole('button', { name: 'Delete' }).activate();
    // Scoped to the dialog: the toolbar has a Delete button too, and an
    // unscoped locator would fail as ambiguous rather than pick one.
    const confirm = app.locator('dialog button#confirm');
    await expect(confirm).toBeVisible();
    // Textual fades a modal in, so the button exists at coordinates that are
    // still moving. A click needs the frame to hold still; a matcher, which
    // only reads the tree, does not.
    await app.waitForStable();
    await confirm.activate();
  });

  await expect(app.getByRole('listitem', { name: 'buy milk' })).not.toBeVisible();
  await expect(app).toHaveText('status: deleted buy milk');
});
