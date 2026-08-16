/**
 * Whether a `bun` binary can be reached from this machine.
 *
 * Bun is installed in one CI lane, not in the build jobs, and "this runner has
 * no Bun" is not a test result — the same reasoning the conformance package
 * applies to a missing pseudo-terminal. Suites that need Bun skip with the
 * reason in their title, so a skipped run says why rather than looking green
 * for the wrong cause.
 */

import { spawnSync } from 'node:child_process';

let cached: boolean | undefined;

/** Memoized probe. Set `TERMWRIGHT_SKIP_BUN=1` to force the skip. */
export function bunAvailable(): boolean {
  if (cached !== undefined) return cached;
  if (process.env['TERMWRIGHT_SKIP_BUN'] === '1') {
    cached = false;
    return cached;
  }
  try {
    const result = spawnSync('bun', ['--version'], { timeout: 30_000, encoding: 'utf8' });
    cached = result.status === 0;
  } catch {
    cached = false;
  }
  return cached;
}

/** Clears the memoized probe. Intended for this package's own tests. */
export function resetBunProbe(): void {
  cached = undefined;
}
