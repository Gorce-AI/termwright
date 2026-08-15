/**
 * Probing for a usable pseudo-terminal.
 *
 * Every suite that drives a real program needs the same guard: sandboxed CI,
 * container images without a PTY device and installs whose native prebuild is
 * missing all fail at spawn time, and a suite that treats that as a test
 * failure is a suite people disable. Rather than have each project write the
 * probe again, the preset ships it.
 */

import { createNodePtyBackend } from '@termwright/driver';

let probe: Promise<boolean> | undefined;

/**
 * Whether this machine can open a pseudo-terminal.
 *
 * Spawns the shortest-lived process there is and disposes it. The result is
 * memoized: it cannot change within a process, and probing per test file would
 * spawn one process per file for no information.
 *
 * Set `TERMWRIGHT_SKIP_PTY=1` to answer `false` without probing — the escape
 * hatch for skipping PTY suites deliberately.
 *
 * @example
 * ```ts
 * import { describe } from 'vitest';
 * import { ptyAvailable, test } from '@termwright/test';
 *
 * const pty = await ptyAvailable();
 *
 * describe.skipIf(!pty)('the app', () => {
 *   test('starts', async ({ terminal }) => {
 *     const app = await terminal.launch({ command: ['node', 'app.js'] });
 *     await app.waitForText('ready');
 *   });
 * });
 * ```
 */
export function ptyAvailable(): Promise<boolean> {
  probe ??= detect();
  return probe;
}

/** Clears the memoized probe. Intended for this package's own tests. */
export function resetPtyProbe(): void {
  probe = undefined;
}

async function detect(): Promise<boolean> {
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
