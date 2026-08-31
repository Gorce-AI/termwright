import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect } from 'vitest';
import { it as resourceAwareIt } from '../packages/resource-broker/src/vitest.ts';
import {
  fingerprintPerformanceHarness,
  PERFORMANCE_HARNESS_FILES,
  PERFORMANCE_HARNESS_FINGERPRINT_KIND,
} from './performance-harness-fingerprint.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const it = resourceAwareIt.resources({ hostPressure: 'exclusive' });
const temporary = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('paired performance harness fingerprint', () => {
  it('produces a deterministic canonical digest for the closed methodology surface', async () => {
    const first = await fingerprintPerformanceHarness({ root });
    const second = await fingerprintPerformanceHarness({
      root,
      expectedFiles: [...PERFORMANCE_HARNESS_FILES].reverse(),
    });
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      kind: PERFORMANCE_HARNESS_FINGERPRINT_KIND,
      schemaVersion: 1,
      algorithm: 'sha256',
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(first.files.map((entry) => entry.path)).toEqual(PERFORMANCE_HARNESS_FILES);
    const identity = {
      kind: first.kind,
      schemaVersion: first.schemaVersion,
      algorithm: first.algorithm,
      files: first.files,
    };
    expect(first.sha256).toBe(createHash('sha256').update(JSON.stringify(identity)).digest('hex'));
  });

  it('changes when one methodology byte changes', async () => {
    const copy = await copyHarness();
    const before = await fingerprintPerformanceHarness({ root: copy });
    const target = PERFORMANCE_HARNESS_FILES.find((path) =>
      path.endsWith('quality-performance-timing.mjs'),
    );
    if (target === undefined)
      throw new Error('timing harness is absent from the fingerprint contract');
    await writeFile(join(copy, target), `${await readFile(join(copy, target), 'utf8')}\n`, 'utf8');
    const after = await fingerprintPerformanceHarness({ root: copy });
    expect(after.sha256).not.toBe(before.sha256);
    expect(after.files.find((entry) => entry.path === target)?.sha256).not.toBe(
      before.files.find((entry) => entry.path === target)?.sha256,
    );
  });

  it('fails closed for a missing file or any missing, extra or duplicate expectation', async () => {
    const copy = await copyHarness();
    await unlink(join(copy, PERFORMANCE_HARNESS_FILES[0]));
    await expect(fingerprintPerformanceHarness({ root: copy })).rejects.toThrow(
      /missing or unreadable/u,
    );

    await expect(
      fingerprintPerformanceHarness({
        root,
        expectedFiles: PERFORMANCE_HARNESS_FILES.slice(1),
      }),
    ).rejects.toThrow(/expected-file contract differs/u);
    await expect(
      fingerprintPerformanceHarness({
        root,
        expectedFiles: [...PERFORMANCE_HARNESS_FILES, 'extra-methodology-file'],
      }),
    ).rejects.toThrow(/expected-file contract differs/u);
    await expect(
      fingerprintPerformanceHarness({
        root,
        expectedFiles: [...PERFORMANCE_HARNESS_FILES, PERFORMANCE_HARNESS_FILES[0]],
      }),
    ).rejects.toThrow(/expected-file contract differs/u);
  });

  it('excludes the production subject and dependency lockfile', () => {
    expect(PERFORMANCE_HARNESS_FILES).not.toContain('pnpm-lock.yaml');
    expect(PERFORMANCE_HARNESS_FILES).toContain('scripts/is-direct-execution.mjs');
    expect(PERFORMANCE_HARNESS_FILES).not.toContain('scripts/performance-harness-fingerprint.mjs');
    expect(PERFORMANCE_HARNESS_FILES).not.toContain('scripts/performance-observations.mjs');
    expect(PERFORMANCE_HARNESS_FILES.some((path) => path.startsWith('packages/driver/'))).toBe(
      false,
    );
    expect(PERFORMANCE_HARNESS_FILES.some((path) => path.startsWith('packages/protocol/'))).toBe(
      false,
    );
    expect(PERFORMANCE_HARNESS_FILES.some((path) => path.startsWith('packages/test/'))).toBe(false);
  });
});

async function copyHarness() {
  const directory = await mkdtemp(join(tmpdir(), 'termwright-performance-harness-'));
  temporary.push(directory);
  for (const path of PERFORMANCE_HARNESS_FILES) {
    const target = join(directory, path);
    await mkdir(dirname(target), { recursive: true });
    await cp(join(root, path), target, { recursive: false, force: false });
  }
  return directory;
}
