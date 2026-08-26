/**
 * Probing for a usable pseudo-terminal.
 *
 * Every suite that drives a real program needs the same guard: sandboxed CI,
 * container images without a PTY device and installs whose native prebuild is
 * missing all fail at spawn time, and a suite that treats that as a test
 * failure is a suite people disable. Rather than have each project write the
 * probe again, the preset ships it.
 */

import { createNativePtyBackend, inheritedSpawnEnv } from '@termwright/driver/experimental';

let probe: Promise<boolean> | undefined;
let unavailable: PtyUnavailableReason | undefined;

/**
 * Why this machine reported no pseudo-terminal.
 *
 * `opted-out` is a deliberate choice and means nothing is wrong. `probe-failed`
 * is a machine that cannot do the thing the suite exists to test, and the two
 * must not look alike: a run whose PTY suites all skipped for the second
 * reason has proven nothing, and returning a bare `false` for both is how that
 * becomes a green tick.
 */
export interface PtyUnavailableReason {
  readonly kind: 'opted-out' | 'probe-failed';
  readonly detail: string;
}

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

/**
 * Why the last probe answered `false`, or undefined if it answered `true`.
 *
 * Resolve {@link ptyAvailable} before reading this: the answer is produced by
 * the probe.
 */
export function ptyUnavailableReason(): PtyUnavailableReason | undefined {
  return unavailable;
}

/** Clears the memoized probe. Intended for this package's own tests. */
export function resetPtyProbe(): void {
  probe = undefined;
  unavailable = undefined;
}

async function detect(): Promise<boolean> {
  if (process.env['TERMWRIGHT_SKIP_PTY'] === '1') {
    unavailable = { kind: 'opted-out', detail: 'TERMWRIGHT_SKIP_PTY=1' };
    return false;
  }
  try {
    const pty = createNativePtyBackend().spawn({
      command: [process.execPath, '-e', 'process.exit(0)'],
      env: inheritedSpawnEnv(),
      columns: 20,
      rows: 4,
    });
    pty.dispose();
    unavailable = undefined;
    return true;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    unavailable = { kind: 'probe-failed', detail };
    // Said out loud, once. A machine that cannot open a pseudo-terminal skips
    // every suite that needs one, and without this the log of that run gives
    // no hint that anything was wrong with the machine rather than the code.
    process.stderr.write(`termwright: no usable pseudo-terminal on this machine (${detail})\n`);
    return false;
  }
}
