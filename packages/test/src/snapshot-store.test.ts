import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  beginSnapshotScope,
  pruneObsoleteSnapshots,
  nextSnapshotKey,
  readSnapshot,
  resetSnapshotCache,
  resolveUpdateMode,
  snapshotFilePath,
  writeSnapshot,
} from './snapshot-store.js';

const directories: string[] = [];

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tw-snapshots-'));
  directories.push(dir);
  return dir;
}

afterEach(() => {
  resetSnapshotCache();
  while (directories.length > 0) rmSync(directories.pop() as string, { recursive: true, force: true });
});

describe('snapshotFilePath', () => {
  // Asserted as a directory and a file name rather than one joined string:
  // the separator is the platform's, and rebuilding the whole path with the
  // same expression the implementation uses would assert nothing at all.
  const testFile = resolve(join('repo', 'src', 'login.test.ts'));

  it('puts snapshots next to the test file, one file per kind', () => {
    const semantic = snapshotFilePath(testFile, 'semantic', '__snapshots__');
    expect(dirname(semantic)).toBe(resolve(dirname(testFile), '__snapshots__'));
    expect(basename(semantic)).toBe('login.test.ts.tw-semantic.yaml');

    const cells = snapshotFilePath(testFile, 'cells', '-snapshots');
    expect(dirname(cells)).toBe(resolve(dirname(testFile), '-snapshots'));
    expect(basename(cells)).toBe('login.test.ts.tw-cells.yaml');
  });

  it('accepts an absolute snapshot directory', () => {
    const snapshots = resolve(join('elsewhere', 'snaps'));
    const file = snapshotFilePath(testFile, 'cells', snapshots);
    expect(dirname(file)).toBe(snapshots);
    expect(basename(file)).toBe('login.test.ts.tw-cells.yaml');
  });

  it('keeps an absolute snapshot directory free of the test file directory', () => {
    const snapshots = resolve(join('elsewhere', 'snaps'));
    expect(snapshotFilePath(testFile, 'cells', snapshots).startsWith(snapshots)).toBe(true);
  });
});

describe('reading and writing', () => {
  it('round-trips a snapshot through a literal block', () => {
    const file = join(workspace(), 'nested', 'a.test.ts.tw-semantic.yaml');
    const value = '- dialog "Permission" [modal]:\n    - button "Approve"\n';
    writeSnapshot(file, 'approves 1', value);
    resetSnapshotCache();
    expect(readSnapshot(file, 'approves 1')).toBe(value);
    const raw = readFileSync(file, 'utf8');
    expect(raw).toContain('# @termwright/test snapshots');
    expect(raw).toContain('"approves 1": |');
  });

  it('keeps keys sorted and preserves other entries', () => {
    const file = join(workspace(), 'a.test.ts.tw-cells.yaml');
    writeSnapshot(file, 'b 1', 'second\n');
    writeSnapshot(file, 'a 1', 'first\n');
    const raw = readFileSync(file, 'utf8');
    expect(raw.indexOf('"a 1"')).toBeLessThan(raw.indexOf('"b 1"'));
    resetSnapshotCache();
    expect(readSnapshot(file, 'b 1')).toBe('second\n');
  });

  it('treats a missing file as an empty store', () => {
    expect(readSnapshot(join(workspace(), 'absent.yaml'), 'x 1')).toBeUndefined();
  });

  it('reports a corrupt snapshot file rather than silently ignoring it', () => {
    const dir = workspace();
    const file = join(dir, 'broken.yaml');
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, '"unterminated\n  - [', 'utf8');
    expect(() => readSnapshot(file, 'x 1')).toThrow(/cannot read snapshot file/u);
  });
});

describe('resolveUpdateMode', () => {
  it('prefers the environment variable', () => {
    expect(resolveUpdateMode({ TERMWRIGHT_UPDATE_SNAPSHOTS: 'all' }, 'none')).toBe('all');
    expect(resolveUpdateMode({ TERMWRIGHT_UPDATE_SNAPSHOTS: 'none' }, 'all')).toBe('none');
  });

  it('maps Vitest flags onto the contract modes', () => {
    expect(resolveUpdateMode({}, 'all')).toBe('changed');
    expect(resolveUpdateMode({}, 'new')).toBe('missing');
    expect(resolveUpdateMode({}, 'none')).toBe('none');
    expect(resolveUpdateMode({}, undefined)).toBe('missing');
  });

  it('rejects an unknown mode instead of guessing', () => {
    expect(() => resolveUpdateMode({ TERMWRIGHT_UPDATE_SNAPSHOTS: 'yes' })).toThrow(/must be all \| changed/u);
  });
});

describe('key allocation', () => {
  it('numbers assertions within a test', () => {
    beginSnapshotScope();
    expect(nextSnapshotKey('t1', 'shows the dialog', 'semantic')).toBe('shows the dialog 1');
    expect(nextSnapshotKey('t1', 'shows the dialog', 'semantic')).toBe('shows the dialog 2');
    expect(nextSnapshotKey('t1', 'shows the dialog', 'cells')).toBe('shows the dialog 1');
  });

  it('restarts numbering for a retried test', () => {
    beginSnapshotScope();
    expect(nextSnapshotKey('t1', 'flaky', 'semantic')).toBe('flaky 1');
    beginSnapshotScope();
    expect(nextSnapshotKey('t1', 'flaky', 'semantic')).toBe('flaky 1');
  });

  it('restarts numbering when the test changes, even without a scope', () => {
    expect(nextSnapshotKey('t1', 'first', 'semantic')).toBe('first 1');
    expect(nextSnapshotKey('t2', 'second', 'semantic')).toBe('second 1');
  });
});

describe('pruneObsoleteSnapshots', () => {
  const declared = new Set(['login > shows the dialog', 'login > approves']);

  function seed(): string {
    const file = join(workspace(), 'login.test.ts.tw-semantic.yaml');
    writeSnapshot(file, 'login > shows the dialog 1', 'a\n');
    writeSnapshot(file, 'login > shows the dialog 2', 'b\n');
    writeSnapshot(file, 'login > approves 1', 'c\n');
    writeSnapshot(file, 'login > renamed away 1', 'd\n');
    return file;
  }

  it('finds keys whose test no longer exists', () => {
    const file = seed();
    const report = pruneObsoleteSnapshots(file, declared, 'missing');
    expect(report.keys).toEqual(['login > renamed away 1']);
    expect(report.removed).toBe(false);
    expect(readSnapshot(file, 'login > renamed away 1')).toBe('d\n');
  });

  it('removes them in changed and all modes', () => {
    for (const mode of ['changed', 'all'] as const) {
      const file = seed();
      const report = pruneObsoleteSnapshots(file, declared, mode);
      expect(report.removed).toBe(true);
      resetSnapshotCache();
      expect(readSnapshot(file, 'login > renamed away 1')).toBeUndefined();
      expect(readSnapshot(file, 'login > approves 1')).toBe('c\n');
      expect(readFileSync(file, 'utf8')).toContain('# @termwright/test snapshots');
    }
  });

  it('keeps every numbered snapshot of a test that still exists', () => {
    const file = seed();
    pruneObsoleteSnapshots(file, declared, 'changed');
    resetSnapshotCache();
    expect(readSnapshot(file, 'login > shows the dialog 2')).toBe('b\n');
  });

  it('refuses to prune when no test could be enumerated', () => {
    // A file whose tests are all skipped, or a caller that could not read the
    // task tree: pruning here would delete the whole file.
    const file = seed();
    const report = pruneObsoleteSnapshots(file, new Set(), 'all');
    expect(report).toEqual({ file, keys: [], removed: false });
    resetSnapshotCache();
    expect(readSnapshot(file, 'login > renamed away 1')).toBe('d\n');
  });

  it('says nothing about a snapshot file that does not exist', () => {
    const file = join(workspace(), 'absent.test.ts.tw-cells.yaml');
    expect(pruneObsoleteSnapshots(file, declared, 'all')).toEqual({ file, keys: [], removed: false });
    expect(existsSync(file)).toBe(false);
  });
});
