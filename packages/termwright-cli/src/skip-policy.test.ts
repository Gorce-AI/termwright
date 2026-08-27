import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadRepositorySkipDeclarations } from './skip-policy.js';

describe('repository native skip policy', () => {
  it('loads only applicable exact rules and registered platform deviations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'termwright-skip-policy-'));
    await mkdir(join(root, 'quality'));
    await writeFile(
      join(root, 'quality', 'applicability-skips.json'),
      JSON.stringify({
        version: 1,
        rules: [
          {
            id: 'all',
            file: 'all.test.ts',
            suite: 'adapter conformance: exact',
            fullName: 'always optional',
          },
          {
            id: 'windows',
            file: 'win.test.ts',
            fullName: 'win only',
            platforms: ['win32'],
            required: true,
          },
        ],
      }),
    );
    await writeFile(
      join(root, 'quality', 'platform-deviations.json'),
      JSON.stringify({
        version: 1,
        deviations: [
          {
            id: 'POSIX-DEVIATION',
            predicate: 'non-win32',
            tests: [['posix.test.ts', 'POSIX-only suite']],
            skipPolicyTests: [['posix.test.ts', 'not on Windows']],
          },
        ],
      }),
    );

    await expect(loadRepositorySkipDeclarations(root, 'linux')).resolves.toEqual([
      {
        id: 'all',
        file: 'all.test.ts',
        suite: 'adapter conformance: exact',
        fullName: 'always optional',
        required: false,
      },
      {
        id: 'POSIX-DEVIATION:posix.test.ts:not on Windows',
        file: 'posix.test.ts',
        fullName: 'not on Windows',
        required: true,
      },
    ]);
  });

  it('fails closed on malformed policy instead of dropping it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'termwright-skip-policy-bad-'));
    await mkdir(join(root, 'quality'));
    await writeFile(
      join(root, 'quality', 'applicability-skips.json'),
      '{"version":1,"rules":[{}]}',
    );
    await expect(loadRepositorySkipDeclarations(root, 'linux')).rejects.toThrow(/non-empty id/u);
  });

  it('rejects an unknown platform instead of silently making a rule inapplicable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'termwright-skip-policy-platform-'));
    await mkdir(join(root, 'quality'));
    await writeFile(
      join(root, 'quality', 'applicability-skips.json'),
      JSON.stringify({
        version: 1,
        rules: [{ id: 'typo', file: 'case.test.ts', fullName: 'case', platforms: ['banana'] }],
      }),
    );
    await expect(loadRepositorySkipDeclarations(root, 'linux')).rejects.toThrow(
      /invalid platforms/u,
    );
  });
});
