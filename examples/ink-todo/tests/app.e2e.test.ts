/**
 * End to end: the built CLI runs in a real pseudo-terminal, and every action
 * below is real bytes on its stdin. Nothing imports the application.
 *
 * Skipped where no pseudo-terminal can be opened — a sandboxed container, or an
 * install without the native prebuild. `TERMWRIGHT_SKIP_PTY=1` skips it
 * explicitly.
 *
 * Run with `TERMWRIGHT_DEBUG=1` to watch the session decide: every call, every
 * wait and how it ended, every revision.
 */

import { existsSync } from 'node:fs';
import { describe, expect, ptyAvailable, test } from 'termwright/test';
import { cli } from '../termwright.config.js';

// The built CLI is as much a precondition as the pseudo-terminal: without it
// the launch starts nothing, the probe has nothing to attach to, and the
// failure reads as a missing semantic capability instead of a missing build.
// Every other example already gates on its own artifact this way.
const runnable = (await ptyAvailable()) && existsSync(cli);
if (process.env['TERMWRIGHT_REQUIRE_EXAMPLES'] === '1' && !runnable) {
  throw new Error('Ink end-to-end example requires a built CLI and a working pseudo-terminal');
}

describe.skipIf(!runnable)('the todo app', () => {
  test('starts on the list it was seeded with', async ({ terminal }) => {
    const app = await terminal.launch();
    // No shell integration here, so this settles on a quiet screen — the
    // diagnostic log says which of the two strategies was used.
    await app.waitForQuiet();

    // Written to __snapshots__/app.e2e.test.ts.tw-semantic.yaml on first run
    // and compared strictly after that: a file snapshot is a fence around the
    // whole tree, so anything appearing or vanishing fails it. It also polls,
    // so it is what waits for the probe's handshake — the plain read of the
    // capability below is only meaningful once a tree has arrived.
    await expect(app).toMatchSemanticSnapshot();
    expect(app.contract()?.capabilities['semantic-tree'].status).toBe('supported');
    // A semantic snapshot can pass on a blank screen: the tree is published by
    // the probe, not read off the terminal. The cell snapshot is the second
    // oracle that says something was actually painted.
    await expect(app).toMatchCellSnapshot();
  });

  test('filters the list by what is typed into the filter box', async ({ terminal }) => {
    const app = await terminal.launch();
    await app.waitForQuiet();

    await app.type('ship');

    // The assertion is the wait: the matcher re-probes until the probe has
    // published the tree for the frame the typing caused. There is no sleep and
    // no explicit wait between the input and the expectation.
    await expect(app.getByRole('listitem')).toHaveText('ship 1.0');
    await expect(app.getByRole('listitem', { name: 'record a demo' })).toBeDetached();
  });

  test('asks for confirmation before removing a todo', async ({ terminal, step }) => {
    const app = await terminal.launch();
    await app.waitForQuiet();

    await step('open the dialog', async () => {
      // The semantic action uses the application's authoritative pointer
      // router and verifies the committed causal consequence. A chain of raw
      // keys plus generic screen revisions could be satisfied by unrelated
      // terminal mode output on a loaded worker.
      await app.getByRole('button', { name: 'Remove' }).click();
    });

    // Scoped to the dialog, so the pattern says what this test is about
    // instead of spelling out the path from the application root. Inside a
    // scope the match is partial: unlisted children are don't-care, and the
    // flags assert only what they list. Cancel holds the focus, which is the
    // point of the dialog — an accidental Enter must not delete anything.
    await expect(app.getByRole('dialog')).toBeAttached();

    await step('cancel it', async () => {
      await app.press('Escape');
      await expect(app.getByRole('dialog')).toBeDetached();
    });

    await expect(app).toHaveText('status: cancelled');
    await expect(app.getByRole('listitem', { name: 'record a demo' })).toBeAttached();

    await step('open it again and confirm', async () => {
      await app.getByRole('button', { name: 'Remove' }).click();
      await expect(app.getByRole('dialog')).toBeAttached();
      await app.getByRole('button', { name: 'Delete' }).click();
    });

    await expect(app.getByRole('listitem', { name: 'write the README' })).toBeDetached();
    await expect(app).toHaveText('status: removed write the README');
  });

  test('uses the production pointer router but delivers clicks through the PTY', async ({
    terminal,
  }) => {
    const app = await terminal.launch();
    await app.waitForQuiet();

    const remove = await app.getByRole('button', { name: 'Remove' }).click();
    await expect(app.getByRole('dialog', { name: 'Confirm' })).toBeAttached();
    const confirm = await app.getByRole('button', { name: 'Delete' }).click();

    await expect(app.getByRole('listitem', { name: 'write the README' })).toBeDetached();
    await expect(app).toHaveText('status: removed write the README');
    expect(remove.executed.map((step) => `${step.device}:${step.kind}`)).toEqual([
      'mouse:down',
      'mouse:up',
    ]);
    expect(confirm.plan.strategy).toBe('authoritative-pointer-region');
    expect(app.contract()?.capabilities['pointer-hit-testing']).toMatchObject({
      status: 'supported',
      evidence: { providerId: 'ink-todo-production-router' },
    });
  });
});
