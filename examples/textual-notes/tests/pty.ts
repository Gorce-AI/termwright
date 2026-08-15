/**
 * Whether this machine can open a pseudo-terminal.
 *
 * Every termwright package skips its PTY suites the same way, and a project
 * that runs in more than one container wants the same escape hatch: a run in a
 * sandbox that cannot fork a terminal should say "skipped", not "failed".
 */

import { createNodePtyBackend } from '@termwright/driver';

let cached: boolean | undefined;

export function ptyAvailable(): boolean {
  if (cached !== undefined) return cached;
  if (process.env['TERMWRIGHT_SKIP_PTY'] === '1') return (cached = false);
  try {
    const pty = createNodePtyBackend().spawn({
      command: [process.execPath, '-e', 'process.exit(0)'],
      env: { PATH: process.env['PATH'] ?? '' },
      columns: 20,
      rows: 4,
    });
    pty.dispose();
    return (cached = true);
  } catch {
    return (cached = false);
  }
}
