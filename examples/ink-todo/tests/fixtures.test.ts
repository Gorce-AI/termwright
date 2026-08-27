/**
 * Composing a fixture on top of the preset's own.
 *
 * A suite where every test needs the same starting state says so once, in a
 * fixture, instead of repeating a launch. `test` here is Vitest's `test.extend`,
 * so the preset's fixtures stay injectable next to the new one and the types
 * flow through.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  describe,
  expect,
  ptyAvailable,
  test as base,
  type TerminalHarness,
} from 'termwright/test';
import { cli } from '../termwright.config.js';

// The built CLI gates this suite for the same reason it gates the end-to-end
// one: an unbuilt example launches nothing and fails as a missing capability.
const runnable = (await ptyAvailable()) && existsSync(cli);

const SEEDED = [
  { id: 1, text: 'restore the backup', done: false },
  { id: 2, text: 'rotate the keys', done: true },
];

const test = base.extend<{ app: TerminalHarness }>({
  app: async ({ terminal }, use) => {
    // The file is written into the test's private directory — which is also
    // the program's cwd — before the program starts, so the app reads it on
    // its first frame. No shared fixtures directory, so no test can be
    // affected by what another one left behind.
    const app = await terminal.launch({ files: { 'todos.json': JSON.stringify(SEEDED) } });
    await app.waitForQuiet();

    await use(app);

    // Teardown runs inside-out, so the session is still alive here. That is
    // what lets a fixture assert a final state — or log out, or shut a server
    // down — after the test body has finished.
    const saved: unknown = JSON.parse(readFileSync(join(terminal.tmpdir, 'todos.json'), 'utf8'));
    expect(Array.isArray(saved)).toBe(true);
  },
});

describe.skipIf(!runnable)('a suite with its own fixture', () => {
  test('starts from the state the fixture declared', async ({ app }) => {
    await expect(app.getByRole('listitem', { name: 'restore the backup' })).toBeAttached();
    await expect(app).toHaveText('[x] rotate the keys');
    // The seed the app falls back to on a first run is not what it read.
    await expect(app.getByRole('listitem', { name: 'ship 1.0' })).toBeDetached();
  });

  test('takes the preset fixtures alongside its own', async ({ app, step, terminal }) => {
    expect(terminal.sessions).toHaveLength(1);

    await step('tick the first todo off', async () => {
      // Tab moves the focus onto the list without moving the selection, which
      // an arrow key would.
      await app.press('Tab');
      // Ink does not expose authoritative host-level focus evidence. The
      // application's own status is therefore the causal production fact:
      // unlike a quiet-window heuristic, it proves the Tab reached the child
      // and its focus manager committed the transition before Space is sent.
      await expect(app).toHaveText('status: focused list');

      await app.press('Space');
      await expect(app).toHaveText('[x] restore the backup');
    });

    // The app writes its state out, so the change survives the process — which
    // is what the fixture's teardown reads back.
    await expect(app).toHaveText('restore the backup');
  });
});
