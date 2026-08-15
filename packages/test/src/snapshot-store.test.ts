import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  beginSnapshotScope,
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
  it('puts snapshots next to the test file, one file per kind', () => {
    expect(snapshotFilePath('/repo/src/login.test.ts', 'semantic', '__snapshots__')).toBe(
      '/repo/src/__snapshots__/login.test.ts.tw-semantic.yaml',
    );
    expect(snapshotFilePath('/repo/src/login.test.ts', 'cells', '-snapshots')).toBe(
      '/repo/src/-snapshots/login.test.ts.tw-cells.yaml',
    );
  });

  it('accepts an absolute snapshot directory', () => {
    expect(snapshotFilePath('/repo/src/a.test.ts', 'cells', '/tmp/snaps')).toBe(
      '/tmp/snaps/a.test.ts.tw-cells.yaml',
    );
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
