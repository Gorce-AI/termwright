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
import { describe, expect, ptyAvailable, test } from '@termwright/test';
import { pythonWithTextual } from './python.js';

const python = pythonWithTextual();
const script = fileURLToPath(new URL('../app/notes_app.py', import.meta.url));
const runnable = python !== null && (await ptyAvailable());

/** `python` is non-null wherever this command is used. */
const command = [python ?? 'python3', script];

describe.skipIf(!runnable)('the notes app', () => {
  test('publishes the notebook as a semantic tree', async ({ terminal }) => {
    const app = await terminal.launch({ command });
    await app.waitForText('write the release notes');

    // The matcher polls, so it is what waits for the adapter's handshake — a
    // plain read of the capability is only meaningful once a tree arrived.
    await expect(app).toMatchSemanticSnapshot();
    expect(app.capabilities().semanticTree).toBe(true);
  });

  test('adds a note from the input field', async ({ terminal, step }) => {
    const app = await terminal.launch({ command });
    await app.waitForText('write the release notes');

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

  test('asks for confirmation before deleting a note', async ({ terminal, step }) => {
    const app = await terminal.launch({ command });
    await app.waitForText('write the release notes');

    await step('open the dialog', async () => {
      await app.getByRole('button', { name: 'Delete' }).activate();
    });

    await expect(app.getByRole('dialog')).toBeVisible();
    // Textual nests its dialog in layout containers, so a scoped pattern would
    // have to spell them out; what this test means is simply that Cancel holds
    // the focus, so an accidental Enter deletes nothing.
    await expect(app.getByRole('button', { name: 'Cancel' }).within(app.getByRole('dialog'))).toBeFocused();
    await expect(app.getByRole('button', { name: 'Delete' }).within(app.getByRole('dialog'))).not.toBeFocused();

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
});
