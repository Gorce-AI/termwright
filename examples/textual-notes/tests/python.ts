/**
 * Whether this machine can run the Textual application.
 *
 * A checkout without Python, without Textual or without the `termwright`
 * package should report the suite as skipped, not failed — the JavaScript side
 * of a polyglot repository is usually installed on its own.
 */

import { spawnSync } from 'node:child_process';

let cached: string | null | undefined;

/** The interpreter that can run the app, or `null` when there is none. */
export function pythonWithTextual(): string | null {
  if (cached !== undefined) return cached;
  for (const candidate of ['python3', 'python']) {
    const probe = spawnSync(candidate, ['-c', 'import textual, termwright'], { stdio: 'ignore' });
    if (probe.status === 0) return (cached = candidate);
  }
  return (cached = null);
}
