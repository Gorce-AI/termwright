import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  RUN_MANIFEST_VERSION,
  parseRunManifest,
  readRunHistory,
  readRunManifest,
  runId,
  writeRunManifest,
  type RunManifest,
} from './runs.js';

const manifest = (partial: Partial<RunManifest> = {}): RunManifest => ({
  v: RUN_MANIFEST_VERSION,
  id: '2026-08-16T10-00-00-000Z',
  startedAt: 1_760_000_000_000,
  finishedAt: 1_760_000_002_000,
  summary: { total: 2, passed: 1, failed: 1, skipped: 0, flaky: 0, durationMs: 2_000 },
  tests: [
    {
      id: 't1',
      title: 'logs in',
      file: '/repo/a.test.ts',
      status: 'passed',
      durationMs: 300,
      flaky: false,
      lostLogRecords: 0,
    },
    {
      id: 't2',
      title: 'rejects a bad password',
      file: '/repo/a.test.ts',
      status: 'failed',
      durationMs: 500,
      flaky: false,
      lostLogRecords: 0,
      traceRef: '/repo/out/t2.twtrace',
      error: 'button stayed disabled',
    },
  ],
  ...partial,
});

const emptyDir = async (): Promise<string> => mkdtemp(join(tmpdir(), 'tw-runs-'));

describe('writeRunManifest / readRunManifest', () => {
  it('round-trips a run', async () => {
    const dir = await emptyDir();
    await writeRunManifest(dir, manifest());
    expect(await readRunManifest(dir, manifest().id)).toEqual(manifest());
  });

  it('keeps the path of each test’s archive, not a copy of it', async () => {
    const dir = await emptyDir();
    await writeRunManifest(dir, manifest());
    const read = await readRunManifest(dir, manifest().id);
    expect(read?.tests[1]?.traceRef).toBe('/repo/out/t2.twtrace');
  });

  it('refuses to write a manifest the reader would reject', async () => {
    const dir = await emptyDir();
    // `summary.durationMs` missing: the writer used to accept this happily and
    // the reader then returned null, so the run vanished from the history with
    // nothing said. The two now agree on what a manifest is.
    const broken = manifest({
      summary: { total: 2, passed: 1, failed: 1, skipped: 0, flaky: 0 },
    } as unknown as Partial<RunManifest>);

    await expect(writeRunManifest(dir, broken)).rejects.toThrow(/would not read back/);
    expect(await readRunManifest(dir, broken.id)).toBeNull();
  });
});

describe('readRunHistory', () => {
  it('lists runs newest first', async () => {
    const dir = await emptyDir();
    for (const id of ['2026-08-14T10-00-00-000Z', '2026-08-16T10-00-00-000Z', '2026-08-15T10-00-00-000Z']) {
      await writeRunManifest(dir, manifest({ id }));
    }
    expect((await readRunHistory(dir)).map((run) => run.id)).toEqual([
      '2026-08-16T10-00-00-000Z',
      '2026-08-15T10-00-00-000Z',
      '2026-08-14T10-00-00-000Z',
    ]);
  });

  it('reports no runs rather than failing when nothing was ever recorded', async () => {
    expect(await readRunHistory(join(await emptyDir(), 'never-written'))).toEqual([]);
  });

  it('skips a half-written run and keeps the ones around it', async () => {
    const dir = await emptyDir();
    await writeRunManifest(dir, manifest({ id: '2026-08-16T10-00-00-000Z' }));
    await mkdir(join(dir, '2026-08-16T11-00-00-000Z'), { recursive: true });
    await writeFile(join(dir, '2026-08-16T11-00-00-000Z', 'manifest.json'), '{"v":1,', 'utf8');
    expect((await readRunHistory(dir)).map((run) => run.id)).toEqual(['2026-08-16T10-00-00-000Z']);
  });

  it('summarises without carrying every test', async () => {
    const dir = await emptyDir();
    await writeRunManifest(dir, manifest());
    const [run] = await readRunHistory(dir);
    expect(run?.testCount).toBe(2);
    expect(run?.summary.failed).toBe(1);
  });
});

describe('parseRunManifest', () => {
  it('rejects a manifest from a version this build does not know', () => {
    expect(parseRunManifest(JSON.stringify({ ...manifest(), v: 99 }))).toBeNull();
    // v1 is this project's own previous format, and is rejected on the same
    // grounds: its tests carry no `lostLogRecords`, so reading one would mean
    // inventing the number.
    expect(parseRunManifest(JSON.stringify({ ...manifest(), v: 1 }))).toBeNull();
  });

  it('rejects one missing what the list needs', () => {
    expect(parseRunManifest(JSON.stringify({ ...manifest(), summary: { total: 1 } }))).toBeNull();
    expect(parseRunManifest(JSON.stringify({ ...manifest(), startedAt: 'today' }))).toBeNull();
    expect(parseRunManifest('not json')).toBeNull();
    expect(parseRunManifest('[]')).toBeNull();
  });

  it('drops unusable tests but keeps the run', () => {
    const parsed = parseRunManifest(
      JSON.stringify({
        ...manifest(),
        tests: [
          { id: 't1', title: 'ok', status: 'passed', lostLogRecords: 0 },
          // No `lostLogRecords`: usable in v1, not in v2.
          { id: 't-old', title: 'ok', status: 'passed' },
          { id: 't2' },
          'nope',
          { status: 'exploded' },
        ],
      }),
    );
    expect(parsed?.tests.map((test) => test.id)).toEqual(['t1']);
    expect(parsed?.tests[0]?.durationMs).toBe(0);
  });

  it('keeps ordered retry attempts and remains compatible when they are absent', () => {
    const current = manifest();
    const withAttempts = {
      ...current,
      tests: current.tests.map((test, index) => index === 0 ? {
        ...test,
        flaky: true,
        attempts: [
          { attempt: 1, status: 'failed', errors: ['first failure'], traceRefs: ['retry-1.twtrace'] },
          { attempt: 2, status: 'passed', durationMs: 12, errors: [] },
        ],
      } : test),
    };
    expect(parseRunManifest(JSON.stringify(withAttempts))?.tests[0]?.attempts).toEqual(withAttempts.tests[0]?.attempts);
    expect(parseRunManifest(JSON.stringify(current))?.tests[0]).not.toHaveProperty('attempts');
  });
});

describe('readRunManifest', () => {
  it('refuses an id that would walk out of the runs directory', async () => {
    const dir = await emptyDir();
    expect(await readRunManifest(dir, '../../etc')).toBeNull();
    expect(await readRunManifest(dir, 'a/b')).toBeNull();
    expect(await readRunManifest(dir, '')).toBeNull();
  });
});

describe('runId', () => {
  it('is a sortable timestamp usable as a directory name', () => {
    const id = runId(Date.parse('2026-08-16T10:00:00.000Z'));
    expect(id).toBe('2026-08-16T10-00-00-000Z');
    expect(id).not.toMatch(/[:/\\]/);
    expect(runId(Date.parse('2026-08-15T10:00:00.000Z')) < id).toBe(true);
  });
});
