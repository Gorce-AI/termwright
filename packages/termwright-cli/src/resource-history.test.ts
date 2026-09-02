import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ResourceCostHistory } from './resource-history.js';

const directories: string[] = [];
afterEach(async () =>
  Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  ),
);

describe('bounded resource cost history', () => {
  it('persists only a stable identity hash and computes bounded p50/p95/EWMA', async () => {
    const directory = await temporaryDirectory();
    const identity = ResourceCostHistory.identity({
      project: 'core',
      file: '/secret/repo/a.test.ts',
      fullName: 'suite > test',
      line: 4,
      column: 2,
    });
    const history = await ResourceCostHistory.load(directory, { now: () => 10 });
    for (let value = 1; value <= 40; value += 1)
      history.observe(identity, { durationMs: value, workerPeakRssBytes: value * 100 });
    await history.save();
    const body = await readFile(join(directory, 'resource-costs-v1.json'), 'utf8');
    expect(body).not.toContain('/secret/repo');
    const reloaded = await ResourceCostHistory.load(directory);
    expect(reloaded.estimate(identity)).toEqual({
      samples: 32,
      durationP50Ms: 24,
      durationP95Ms: 39,
      durationEwmaMs: expect.any(Number),
      workerPeakRssP95Bytes: 3900,
    });
  });

  it('treats oversized, malformed and prototype-bearing persistence as a cache miss', async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, 'resource-costs-v1.json');
    await writeFile(path, '{"v":1,"entries":{"__proto__":{}}}');
    const history = await ResourceCostHistory.load(directory);
    expect(history.estimate('0'.repeat(64))).toBeUndefined();
    await writeFile(path, 'x'.repeat(4 * 1024 * 1024 + 1));
    expect((await ResourceCostHistory.load(directory)).estimate('0'.repeat(64))).toBeUndefined();
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'termwright-resource-history-'));
  directories.push(directory);
  return directory;
}
