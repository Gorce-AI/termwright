/**
 * End to end: the built CLI runs in a real pseudo-terminal, and every action
 * below is real bytes on its stdin. Nothing imports the application.
 *
 * Skipped where no pseudo-terminal can be opened (a sandboxed container, a
 * machine where the native binding did not build); `TERMWRIGHT_SKIP_PTY=1`
 * skips it explicitly.
 */

import { expect, test } from '@termwright/test';
import { ptyAvailable } from './pty.js';

const describeIf = ptyAvailable() ? test : test.skip;

describeIf('starts on the list it was seeded with', async ({ terminal }) => {
  const app = await terminal.launch();
  // No shell integration here, so this settles on a quiet screen — the
  // diagnostic log says which of the two strategies was used.
  await app.waitForReady();

  // Written to __snapshots__/app.e2e.test.ts.tw-semantic.yaml on first run.
  // It goes first because it polls: being ready means the screen settled, not
  // that the adapter finished its handshake, so this is what proves the
  // instrumentation is live — and the plain read below is safe after it.
  await expect(app).toMatchSemanticSnapshot();
  expect(app.capabilities().semanticTree).toBe(true);
  // A semantic snapshot can pass on a blank screen: the tree is published by
  // the adapter, not read off the terminal. The cell snapshot is the second
  // oracle that says something was actually painted.
  await expect(app).toMatchCellSnapshot();
});

describeIf('filters the list by what is typed into the filter box', async ({ terminal, step }) => {
  const app = await terminal.launch();
  await app.waitForReady();
  // Ready means the screen settled, not that the tree for it arrived. An
  // *action* resolves its locator once and fails outright when there is no
  // tree yet — only matchers poll through that gap — so a test that acts
  // before it asserts waits for the frame and its tree to be paired.
  await app.waitForStable();

  await step('focus the filter with the mouse', async () => {
    // A real SGR mouse report. The driver refuses to send one unless the
    // application enabled mouse reporting, so this passing means it did.
    await app.getByRole('textbox', { name: 'Filter' }).click();
    await expect(app.getByRole('textbox', { name: 'Filter' })).toHaveState({ focused: true });
  });

  await app.type('ship');

  // The assertion is the wait: the matcher re-probes until the adapter has
  // published the tree for the frame the typing caused. There is no sleep and
  // no explicit wait between the input and the expectation.
  await expect(app.getByRole('listitem')).toHaveText('ship 1.0');
  await expect(app.getByRole('listitem', { name: 'record a demo' })).not.toBeVisible();
  await expect(app.getByRole('button', { name: 'Add' })).toHaveState({ disabled: false });
});

describeIf('asks for confirmation before removing a todo', async ({ terminal, step }) => {
  const app = await terminal.launch();
  await app.waitForReady();
  await app.waitForStable();

  await app.press('ArrowDown');
  await expect(app.getByRole('listitem', { name: 'record a demo' })).toHaveState({ selected: true });

  await step('open the dialog', async () => {
    await app.getByRole('button', { name: 'Remove' }).click();
  });

  // A pattern starts at the tree's roots — for an Ink app that is the
  // application node — and everything below is partial: children left out are
  // don't-care, and the flags assert only what they list. Cancel holds the
  // focus, which is the point of the dialog: an accidental Enter must not
  // delete anything.
  await expect(app).toMatchSemanticSnapshot(`
    - application:
        - dialog "Confirm" [modal]:
            - button "Delete" [!focused]
            - button "Cancel" [focused]
  `);

  await step('cancel it', async () => {
    await app.getByRole('button', { name: 'Cancel' }).within(app.getByRole('dialog')).click();
    await expect(app.getByRole('dialog')).not.toBeVisible();
  });

  await expect(app).toHaveText('status: cancelled');
  await expect(app.getByRole('listitem', { name: 'record a demo' })).toBeVisible();

  await step('open it again and confirm', async () => {
    await app.getByRole('button', { name: 'Remove' }).click();
    // Scoping a destructive action to its dialog is the habit worth keeping:
    // it still works the day someone adds a Delete button to the toolbar, and
    // an unscoped locator would start failing as ambiguous instead.
    await app.locator('dialog button#confirm').click();
  });

  await expect(app.getByRole('listitem', { name: 'record a demo' })).not.toBeVisible();
  await expect(app).toHaveText('status: removed record a demo');
});
