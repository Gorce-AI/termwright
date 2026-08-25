/** Shared task-id derivation for the nested runner fixtures. */

import { relative } from 'node:path';
import { generateFileHash } from '@vitest/runner/utils';

/**
 * The id Vitest will give a test module, for a config that must name its tasks
 * before the run exists.
 *
 * Vitest hashes the module's slash-separated path. `relative` yields
 * backslashes on Windows, and a config that hashes those names tasks that
 * never appear: the runner then finds no identity for any test and skips the
 * whole file, so the nested run reports its tests and executes none.
 */
export function hostFileId(root: string, file: string): string {
  return generateFileHash(relative(root, file).replaceAll('\\', '/'), undefined);
}
