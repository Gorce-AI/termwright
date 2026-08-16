/**
 * Delta reception over a real PTY: an adapter that pushes incremental trees,
 * and the two ways that can go wrong — a base the driver does not hold, and a
 * transition the delta format cannot express.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionDiagnostic, TerminalHarness } from './api.js';
import { createNodePtyBackend } from './pty.js';
import { launchTerminal } from './session.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-fixtures');

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

const open: TerminalHarness[] = [];

afterEach(async () => {
  while (open.length > 0) await open.pop()?.close();
});

interface Harness {
  terminal: TerminalHarness;
  diagnostics: SessionDiagnostic[];
}

async function launchDeltaApp(options: Record<string, unknown> = {}): Promise<Harness> {
  const terminal = await launchTerminal({
    command: [process.execPath, join(FIXTURES, 'semantic-app.mjs')],
    columns: 60,
    rows: 10,
    semanticNegotiationMs: 5_000,
    env: { TERMWRIGHT_FIXTURE_DELTAS: '1' },
    ...options,
  });
  open.push(terminal);
  const diagnostics: SessionDiagnostic[] = [];
  terminal.events.on('diagnostic', (entry) => diagnostics.push(entry));
  await terminal.settled({ timeout: 10_000 });
  return { terminal, diagnostics };
}

describe.skipIf(!ptyAvailable())('receiving tree deltas', { timeout: 20_000 }, () => {
  it('negotiates deltas and composes them onto the tree it holds', async () => {
    const { terminal } = await launchDeltaApp();
    expect(terminal.capabilities().capabilities).toContain('tree-diffs');

    const first = terminal.semanticTree();
    expect(first?.revision).toBe(1);
    expect(await terminal.getByTestId('approve').semanticState()).toMatchObject({ focused: true });

    // Tab moves focus and travels as a delta, not a whole tree.
    await terminal.press('Tab');
    await expect
      .poll(() => terminal.semanticTree()?.revision ?? 0, { timeout: 5_000 })
      .toBeGreaterThan(1);

    const composed = terminal.semanticTree();
    expect(await terminal.getByTestId('reject').semanticState()).toMatchObject({ focused: true });
    // Untouched parts of the tree survive composition: the delta carried the
    // buttons, and the dialog came from the base.
    expect(composed?.nodes.find((node) => node.role === 'dialog')?.name).toBe('Permission');
    expect(composed?.columns).toBe(first?.columns);
  });

  it('asks for a full tree when a delta cannot be composed, and recovers', async () => {
    const { terminal, diagnostics } = await launchDeltaApp();
    const before = terminal.semanticTree()?.revision ?? 0;

    // A delta based on a revision nobody holds.
    await terminal.press('B');

    await expect
      .poll(() => diagnostics.some((entry) => entry.code === 'delta-resync'), { timeout: 8_000 })
      .toBe(true);

    const requested = diagnostics.find((entry) => entry.detail.includes('requesting a full tree'));
    expect(requested?.code).toBe('delta-resync');
    expect(requested?.detail).toContain('did not compose');

    // The adapter answers get-tree and the chain is whole again.
    await expect
      .poll(() => diagnostics.some((entry) => entry.detail.includes('resynchronised')), { timeout: 8_000 })
      .toBe(true);
    expect(terminal.semanticTree()?.revision).toBeGreaterThanOrEqual(before);

    // A resync is a repair, not a loss: nothing is reported as dropped.
    expect(diagnostics.some((entry) => entry.code === 'revision-dropped')).toBe(false);

    // And the session keeps working on deltas afterwards.
    await terminal.press('Tab');
    await expect
      .poll(async () => (await terminal.getByTestId('reject').semanticState())?.focused, { timeout: 5_000 })
      .toBe(true);
  });

  it('takes a cursor removal as a full snapshot, which is the only way it can travel', async () => {
    const { terminal } = await launchDeltaApp();
    expect(terminal.semanticTree()?.cursor).toBeDefined();

    // A delta can set a cursor but never clear it, so the fixture sends a whole
    // tree — and the driver must end up holding one with no cursor at all.
    await terminal.press('C');
    await expect
      .poll(() => terminal.semanticTree()?.cursor, { timeout: 5_000 })
      .toBeUndefined();
  });

  it('forces full trees when the caller asks for them', async () => {
    const { terminal, diagnostics } = await launchDeltaApp({ treeUpdates: 'snapshots' });
    // The adapter still offers deltas; the driver declined them.
    expect(terminal.capabilities().capabilities).toContain('tree-diffs');

    await terminal.press('Tab');
    await expect
      .poll(async () => (await terminal.getByTestId('reject').semanticState())?.focused, { timeout: 5_000 })
      .toBe(true);

    // Nothing to compose means nothing to resync.
    expect(diagnostics.some((entry) => entry.code === 'delta-resync')).toBe(false);
  });
});
