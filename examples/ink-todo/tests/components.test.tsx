/**
 * Component tests for the dialog on its own: fast, and able to pass a spy as a
 * prop, while still driving the component with the bytes a terminal sends.
 *
 * `mountInk` renders in this process, so no pseudo-terminal is involved and
 * this file runs everywhere the suite runs.
 */

import { mountInk } from 'termwright/ink';
import { expect, test, vi } from 'termwright/test';
import { ConfirmDialog } from '../src/confirm-dialog.js';

test('confirms through terminal input, and reports it once', async () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const dialog = await mountInk(
    <ConfirmDialog title='Remove "ship 1.0"?' onConfirm={onConfirm} onCancel={onCancel} />,
    { columns: 40, rows: 8 },
  );

  await dialog.press('Tab');
  await dialog.waitForQuiet();
  await dialog.press('Enter');

  // Every wait in the harness is driven by rendered frames, and a callback
  // that only notifies its parent renders nothing. So the spy — unlike a
  // locator matcher — needs an explicit poll.
  await vi.waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
  expect(onCancel).not.toHaveBeenCalled();

  await dialog.close();
});

test('opens with Cancel focused and dismisses on Escape', async () => {
  const onCancel = vi.fn();
  const dialog = await mountInk(
    <ConfirmDialog title='Remove "ship 1.0"?' onConfirm={vi.fn()} onCancel={onCancel} />,
    { columns: 40, rows: 8 },
  );

  // A pattern starts at the tree's roots, and Ink's root is the application
  // itself; everything below is partial, so unlisted children are don't-care.
  await expect(dialog).toMatchSemanticSnapshot(`
    - application:
        - dialog "Confirm":
            - text
            - generic:
                - button "Delete"
                - button "Cancel"
  `);

  await dialog.press('Escape');
  await vi.waitFor(() => expect(onCancel).toHaveBeenCalledOnce());

  await dialog.close();
});

test('moves the focus with Tab and activates with Enter', async () => {
  const onConfirm = vi.fn();
  const dialog = await mountInk(
    <ConfirmDialog title="Remove?" confirmLabel="Discard" onConfirm={onConfirm} onCancel={vi.fn()} />,
    { columns: 40, rows: 8 },
  );

  await dialog.press('Tab');
  await dialog.waitForQuiet();
  await dialog.press('Enter');
  await vi.waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());

  await dialog.close();
});
