import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadPerformanceObservations } from './performance-observations.mjs';

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('performance observation runtime boundary', () => {
  it('attests a descriptor against the real process runtime with no caller override', async () => {
    const platform = process.platform === 'darwin' ? 'linux' : 'darwin';
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const nodeMajor = /^(\d+)\./u.exec(process.versions.node)?.[1];
    expect(nodeMajor).toBeDefined();
    const directory = await mkdtemp(join(tmpdir(), 'termwright-runtime-boundary-'));
    roots.push(directory);
    const environment = join(directory, 'environment.json');
    await writeFile(
      environment,
      JSON.stringify({
        kind: 'termwright-performance-environment',
        schemaVersion: 1,
        class: `${platform}-${arch}-node${nodeMajor}-go1.25-bun1.2.15`,
        runner: { image: 'forged-runner', platform, arch },
        toolchains: {
          node: { qualified: nodeMajor, resolved: process.versions.node },
          go: { qualified: '1.25', resolved: '1.25.0' },
          bun: { qualified: '1.2.15', resolved: '1.2.15' },
        },
      }),
    );

    await expect(loadPerformanceObservations({ environment }, 'a'.repeat(40))).rejects.toThrow(
      `requires platform=${platform}, observed ${process.platform}`,
    );
  });
});
