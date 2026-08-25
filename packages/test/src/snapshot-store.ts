/**
 * External snapshot files.
 *
 * Snapshots live next to the test file in `__snapshots__/<test file>.tw-<kind>.yaml`
 * as one literal block per assertion, so a review sees the tree that changed
 * rather than an escaped one-liner.
 *
 * ## Update modes
 *
 * Vitest exposes two states through `--update` (write missing / write
 * everything) but the contract asks for three. The mode is therefore resolved
 * as: `TERMWRIGHT_UPDATE_SNAPSHOTS` (`all|changed|missing|none`) when set,
 * otherwise Vitest's own flag — `--update` maps to `changed`, its default maps
 * to `missing`, and `--update=none`/CI without a flag maps to `none` for
 * mismatches while still writing brand-new snapshots. `all` rewrites files even
 * when they already match, which only the environment variable can request.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { UpdateSnapshotsMode } from './config.js';
import { currentAttemptRuntime } from './attempt-context.js';

/** Which oracle a snapshot belongs to; each kind gets its own file. */
export type SnapshotKind = 'semantic' | 'cells';

const HEADER = [
  '# @termwright/test snapshots — generated, but review them like test source.',
  '# Update with `vitest -u` or TERMWRIGHT_UPDATE_SNAPSHOTS=changed.',
  '',
].join('\n');

/** Path of the snapshot file backing a test file. */
export function snapshotFilePath(testFile: string, kind: SnapshotKind, snapshotDir: string): string {
  const dir = isAbsolute(snapshotDir) ? snapshotDir : join(dirname(testFile), snapshotDir);
  return resolve(join(dir, `${basename(testFile)}.tw-${kind}.yaml`));
}

/**
 * Resolves the update mode for this run.
 *
 * @param env - environment to read `TERMWRIGHT_UPDATE_SNAPSHOTS` from.
 * @param vitestUpdate - Vitest's `snapshotState._updateSnapshot`, when readable.
 */
export function resolveUpdateMode(
  env: Readonly<Record<string, string | undefined>> = process.env,
  vitestUpdate?: 'all' | 'new' | 'none' | string,
): UpdateSnapshotsMode {
  const explicit = env['TERMWRIGHT_UPDATE_SNAPSHOTS'];
  if (explicit !== undefined && explicit.length > 0) {
    if (explicit === 'all' || explicit === 'changed' || explicit === 'missing' || explicit === 'none') {
      return explicit;
    }
    throw new TypeError(
      `TERMWRIGHT_UPDATE_SNAPSHOTS must be all | changed | missing | none, received ${explicit}`,
    );
  }
  if (vitestUpdate === 'all') return 'changed';
  if (vitestUpdate === 'none') return 'none';
  return 'missing';
}

const files = new Map<string, Map<string, string>>();

/** Reads a snapshot file, caching it for the lifetime of the worker. */
function load(file: string): Map<string, string> {
  const cached = files.get(file);
  if (cached !== undefined) return cached;
  const entries = new Map<string, string>();
  try {
    const parsed = parseYaml(readFileSync(file, 'utf8')) as unknown;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === 'string') entries.set(key, value);
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new TypeError(`cannot read snapshot file ${file}: ${(error as Error).message}`);
    }
  }
  files.set(file, entries);
  return entries;
}

/** The stored snapshot, or `undefined` when this assertion has none yet. */
export function readSnapshot(file: string, key: string): string | undefined {
  return load(file).get(key);
}

/** Stores a snapshot and rewrites the file, keys sorted for stable diffs. */
export function writeSnapshot(file: string, key: string, value: string): void {
  const entries = load(file);
  entries.set(key, value);
  persist(file, entries);
}

function persist(file: string, entries: ReadonlyMap<string, string>): void {
  mkdirSync(dirname(file), { recursive: true });
  const body = stringifyYaml(Object.fromEntries(entries), {
    defaultStringType: 'BLOCK_LITERAL',
    defaultKeyType: 'QUOTE_DOUBLE',
    lineWidth: 0,
    sortMapEntries: true,
  });
  writeFileSync(file, `${HEADER}${body}`, 'utf8');
}

/** What {@link pruneObsoleteSnapshots} found, and whether it acted. */
export interface ObsoleteSnapshots {
  readonly file: string;
  /** Keys whose test no longer exists, in file order. */
  readonly keys: readonly string[];
  /** True when the keys were removed from the file. */
  readonly removed: boolean;
}

/**
 * Finds — and in a writing mode removes — snapshots no test claims any more.
 *
 * A key is obsolete when the test name it carries is not among `declared`.
 * `declared` must list every test the file *declares*, skipped ones included;
 * pruning against the tests that merely *ran* would delete the snapshots of a
 * suite skipped on this machine.
 *
 * @param declared - full test names, as {@link collectTestNames} produces them.
 * @param mode - `changed` and `all` remove; every other mode only reports.
 */
export function pruneObsoleteSnapshots(
  file: string,
  declared: ReadonlySet<string>,
  mode: UpdateSnapshotsMode,
): ObsoleteSnapshots {
  const entries = load(file);
  if (entries.size === 0 || declared.size === 0) {
    // No snapshots, or a file whose tests could not be enumerated: pruning on
    // an empty picture of the world is how a whole file gets wiped.
    return { file, keys: [], removed: false };
  }
  const keys = [...entries.keys()].filter((key) => !declared.has(testNameOf(key)));
  if (keys.length === 0) return { file, keys, removed: false };
  if (mode !== 'changed' && mode !== 'all') return { file, keys, removed: false };
  for (const key of keys) entries.delete(key);
  persist(file, entries);
  return { file, keys, removed: true };
}

/** `'login > shows the dialog 2'` -> `'login > shows the dialog'`. */
function testNameOf(key: string): string {
  const match = /^(.*) \d+$/u.exec(key);
  return match?.[1] ?? key;
}

/** Forgets cached files. Intended for this package's own tests. */
export function resetSnapshotCache(): void {
  files.clear();
}

/** Resets counters inside the current AttemptId; primarily useful to test retry semantics. */
export function beginSnapshotScope(): void {
  currentAttemptRuntime().snapshotCounters.clear();
}

/**
 * Allocates the next key for a test, e.g. `login > shows the dialog 2`.
 */
export function nextSnapshotKey(testName: string, kind: SnapshotKind): string {
  const counters = currentAttemptRuntime().snapshotCounters;
  const counterKey = `${testName}::${kind}`;
  const next = (counters.get(counterKey) ?? 0) + 1;
  counters.set(counterKey, next);
  return `${testName} ${next}`;
}
