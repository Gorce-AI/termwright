/**
 * The obsolete-snapshot sweep running for real, inside Vitest.
 *
 * The unit tests cover the pruning rule; this covers the wiring that decides
 * what to prune *against* — the declared tests of the file, which is the part
 * that would quietly delete a skipped suite's baselines if it were wrong.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect } from 'vitest';
import { configureTermwright, test } from './index.js';
import { readSnapshot, resetSnapshotCache, snapshotFilePath, writeSnapshot } from './snapshot-store.js';

const DIR = mkdtempSync(join(tmpdir(), 'tw-sweep-'));
const FILE = snapshotFilePath(fileURLToPath(import.meta.url), 'semantic', DIR);

// Seeded at collection time, before any fixture runs the sweep.
configureTermwright({ snapshotDir: DIR, updateSnapshots: 'changed', trace: 'off' });
writeSnapshot(FILE, 'a suite skipped on this machine > keeps its snapshot 1', '- text "kept"\n');
writeSnapshot(FILE, 'a test that no longer exists 1', '- text "orphan"\n');
writeSnapshot(FILE, 'sweeps snapshots left by tests that no longer exist 1', '- text "mine"\n');

afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
});

describe.skip('a suite skipped on this machine', () => {
  test('keeps its snapshot', () => {
    expect.unreachable('this suite is skipped on purpose');
  });
});

test('sweeps snapshots left by tests that no longer exist', () => {
  resetSnapshotCache();
  expect(readSnapshot(FILE, 'a test that no longer exists 1')).toBeUndefined();
  // Skipped, not deleted: this is the case that would destroy the E2E
  // baselines of everyone with a PTY when CI runs without one.
  expect(readSnapshot(FILE, 'a suite skipped on this machine > keeps its snapshot 1')).toBe('- text "kept"\n');
  expect(readSnapshot(FILE, 'sweeps snapshots left by tests that no longer exist 1')).toBe('- text "mine"\n');
});
