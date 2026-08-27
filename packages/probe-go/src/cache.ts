/**
 * Where instrumented copies live, and what makes two of them the same copy.
 *
 * A copy is expensive to build and worthless if it is subtly wrong, so the key
 * has to name everything that can change its contents. Three inputs do:
 *
 * - the **framework version**, because the patches are written against exact
 *   line numbers and private fields that tview does not promise to keep
 *   (`docs/architecture/audit/tview.md` §5 — the module ships no CHANGELOG);
 * - the **probe version**, because a patch set can change without the framework
 *   moving, and a stale copy would then be instrumented the old way while
 *   claiming the new probe's capabilities;
 * - the **toolchain**, because the copy is compiled into the user's build and a
 *   different `go` can disagree about what compiles at all.
 *
 * Anything not in the key is a bug waiting for a support thread that starts
 * with "it works on my machine".
 */

import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

/** Everything that can change what a copy contains. */
export interface CopyKeyInput {
  /** Module path of the framework, e.g. `github.com/rivo/tview`. */
  readonly framework: string;
  /** Exact framework version, e.g. `v0.42.0`. */
  readonly frameworkVersion: string;
  /** Version of this probe, which owns the patch set. */
  readonly probeVersion: string;
  /** `go version` output, verbatim. */
  readonly toolchain: string;
  /** Digest of the patch set, so an edited patch invalidates the copy too. */
  readonly patchDigest: string;
}

/** A stable, filesystem-safe key for one instrumented copy. */
export function copyKey(input: CopyKeyInput): string {
  const hash = createHash('sha256');
  // Length-prefixed so two fields cannot be confused by concatenation — the
  // classic way a cache key silently collides.
  for (const part of [
    input.framework,
    input.frameworkVersion,
    input.probeVersion,
    input.toolchain,
    input.patchDigest,
  ]) {
    hash.update(String(part.length));
    hash.update('\0');
    hash.update(part);
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 32);
}

/**
 * Root of the copy cache.
 *
 * Honours `TERMWRIGHT_CACHE_DIR` first, then the XDG cache location, then the
 * home directory. A CI job that wants the cache warm between runs sets the
 * first; everything else gets a sensible default without being asked.
 */
export function cacheRoot(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env['TERMWRIGHT_CACHE_DIR'];
  if (explicit !== undefined && explicit.length > 0) return explicit;
  const xdg = env['XDG_CACHE_HOME'];
  if (xdg !== undefined && xdg.length > 0) return join(xdg, 'termwright');
  const home = env['HOME'] ?? env['USERPROFILE'];
  if (home !== undefined && home.length > 0) return join(home, '.cache', 'termwright');
  return join(tmpdir(), 'termwright-cache');
}

/** Absolute directory a given copy occupies. */
export function copyDir(input: CopyKeyInput, env?: NodeJS.ProcessEnv): string {
  const safeFramework = input.framework.replace(/[^\w.-]+/gu, '-');
  return join(
    cacheRoot(env),
    'copies',
    safeFramework,
    `${input.frameworkVersion}-${copyKey(input)}`,
  );
}

/** Marker file written last, so a half-built copy is never mistaken for a good one. */
const STAMP = '.termwright-complete';

/** Path of the completion stamp for a copy directory. */
export function stampPath(dir: string): string {
  return join(dir, STAMP);
}

/**
 * Whether `dir` holds a finished copy.
 *
 * The stamp is written after everything else, so an interrupted build leaves a
 * directory that fails this check and is rebuilt rather than compiled.
 */
export async function isComplete(dir: string): Promise<boolean> {
  const { access } = await import('node:fs/promises');
  try {
    await access(stampPath(dir));
    return true;
  } catch {
    return false;
  }
}

/** Records the key that produced a copy, for diagnosis and for `prune`. */
export async function markComplete(dir: string, input: CopyKeyInput): Promise<void> {
  await writeFile(stampPath(dir), `${JSON.stringify(input, null, 2)}\n`, 'utf8');
}

/** Creates the copy directory, removing any partial remains first. */
export async function prepareCopyDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
}

/** Removes every cached copy. Used by the CLI and by tests that need a cold start. */
export async function pruneCache(env?: NodeJS.ProcessEnv): Promise<void> {
  await rm(join(cacheRoot(env), 'copies'), { recursive: true, force: true });
}

/** Home directory fallback, exported for the tests that assert the ordering. */
export const _homedir = homedir;
