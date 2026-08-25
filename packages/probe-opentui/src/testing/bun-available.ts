/**
 * Whether a `bun` binary can be reached from this machine.
 *
 * Bun is required in the supported-runtime CI matrix and its dedicated adapter
 * lane, but remains optional on developer machines. Suites that need Bun skip
 * locally with the reason in their title, so reduced coverage is explicit.
 */

import { spawnSync } from 'node:child_process';
import { bunTestCapability } from '../../../../scripts/test-support/bun-runtime.mjs';

let cached: boolean | undefined;

/** Memoized probe. Local runs may set `TERMWRIGHT_SKIP_BUN=1`. */
export function bunAvailable(): boolean {
  return bunTestCapability(() => {
    if (cached !== undefined) return cached;
    const result = spawnSync('bun', ['--version'], { timeout: 30_000, encoding: 'utf8' });
    cached = result.status === 0;
    return cached;
  });
}

/** Clears the memoized probe. Intended for this package's own tests. */
export function resetBunProbe(): void {
  cached = undefined;
}
