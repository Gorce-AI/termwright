/**
 * The preset driving a real program over a real PTY: fixtures, retry-able
 * matchers, both snapshot oracles and trace collection.
 *
 * Skipped automatically where no pseudo-terminal can be opened (sandboxed CI,
 * missing prebuild), like the driver's own integration suite; set
 * `TERMWRIGHT_SKIP_PTY=1` to skip explicitly.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect } from 'vitest';
import { createNodePtyBackend } from '@termwright/driver';
import { configureTermwright, test } from './index.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'driver', 'test-fixtures');
const OUTPUT = mkdtempSync(join(tmpdir(), 'tw-preset-'));

configureTermwright({
  columns: 60,
  rows: 10,
  trace: 'on',
  outputDir: OUTPUT,
  timeouts: { expect: 5_000 },
  command: [process.execPath, join(FIXTURES, 'semantic-app.mjs')],
});

function ptyAvailable(): boolean {
  if (process.env['TERMWRIGHT_SKIP_PTY'] === '1') return false;
  try {
    const pty = createNodePtyBackend().spawn({
      command: [process.execPath, '-e', 'process.exit(0)'],
      env: { PATH: process.env['PATH'] ?? '' },
      columns: 20,
      rows: 4,
    });
    pty.dispose();
    return true;
  } catch {
    return false;
  }
}

const available = ptyAvailable();

afterAll(() => {
  rmSync(OUTPUT, { recursive: true, force: true });
});

describe.skipIf(!available)('the preset against a real PTY', { timeout: 30_000 }, () => {
  test('asserts the semantic tree, the screen and the effect of an action', async ({ terminal, step }) => {
    const app = await terminal.launch();
    // A screen wait: the tree for this frame is paired with its render-commit
    // marker slightly later, so every semantic assertion below is landing in
    // that gap on purpose. They pass because the matchers re-probe.
    await app.waitForText('Permission required');
    expect(app.capabilities().semanticTree).toBe(true);

    await expect(app).toMatchSemanticSnapshot(`
      - dialog "Permission" [modal]:
          - button "Approve" [focused]
          - button "Reject" [!focused]
    `);
    await expect(app.getByRole('button', { name: 'Approve' })).toBeVisible();
    await expect(app.getByRole('button', { name: 'Approve' })).toBeFocused();
    await expect(app.getByTestId('reject')).toHaveState({ focused: false });
    await expect(app.getByTestId('approve')).toHaveText('Approve');

    await step('move the focus', async () => {
      await app.press('Tab');
      // No wait: the matcher polls until the adapter publishes the new tree.
      await expect(app.getByRole('button', { name: 'Reject' })).toBeFocused();
    });

    await step('activate the focused button', async () => {
      await app.getByRole('button', { name: 'Reject' }).activate();
      await expect(app).toHaveText('ACTIVATED reject');
    });

    await expect(app).toMatchCellSnapshot();
  });

  test('isolates each test with its own directory and session', async ({ terminal, termwright }) => {
    const app = await terminal.launch();
    await app.waitForText('Permission required');
    expect(termwright.tmpdir).toContain('termwright-');
    expect(existsSync(termwright.tmpdir)).toBe(true);
    expect(terminal.sessions).toHaveLength(1);
    expect(app.sessionId).toEqual(expect.any(String));
  });

  test('records a trace archive with the steps it was given', async ({ terminal, step }) => {
    const app = await terminal.launch();
    await app.waitForText('Permission required');
    await step('a named step', async () => {
      await app.press('Tab');
      await expect(app.getByTestId('reject')).toBeFocused();
    });
  });
});

describe.skipIf(!available)('trace collection', () => {
  test('leaves finished archives behind for the reporter', async () => {
    const traces = join(OUTPUT, 'traces');
    const archives = readdirSync(traces).filter((entry) => entry.endsWith('.twtrace'));
    expect(archives.length).toBeGreaterThan(0);
    const archive = join(traces, archives[0] as string);
    const meta = JSON.parse(readFileSync(join(archive, 'meta.json'), 'utf8')) as { v: number; semanticTree: boolean };
    expect(meta.v).toBe(1);
    expect(meta.semanticTree).toBe(true);
    expect(existsSync(join(archive, 'session.cast'))).toBe(true);
    expect(existsSync(join(archive, 'events.jsonl'))).toBe(true);
    expect(existsSync(join(archive, 'semantics.jsonl'))).toBe(true);

    const events = archives.flatMap((entry) =>
      readFileSync(join(traces, entry, 'events.jsonl'), 'utf8')
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as { kind: string; api?: string; title?: string }),
    );
    expect(events.some((event) => event.kind === 'step-start' && event.title === 'a named step')).toBe(true);
    expect(events.some((event) => event.kind === 'assert' && event.api === 'toBeFocused')).toBe(true);
  });
});
