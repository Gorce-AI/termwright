import { describe, expect, it } from 'vitest';
import { discoverTests, type DiscoveredTest } from './discovery.js';

const tests: readonly DiscoveredTest[] = [
  {
    id: 'runner-task:00000000-0000-4000-8000-000000000001',
    title: 'the todo app > starts on the list it was seeded with',
    file: '/repo/tests/app.feature',
    provider: { id: '@termwright/test', version: 1 },
    kind: 'gherkin-outline-example',
    ancestors: [{ kind: 'feature', title: 'the todo app' }],
    tags: ['@smoke'],
    source: { file: '/repo/tests/app.feature', line: 7, column: 3 },
  },
  {
    id: 'runner-task:00000000-0000-4000-8000-000000000002',
    title: 'the todo app > filters the list',
    file: 'C:\\repo\\tests\\app.test.ts',
  },
];

describe('native host discovery', () => {
  it('preserves native task identity, duplicate names and provider metadata', async () => {
    const discovered = await discoverTests({ cwd: '/repo', load: async () => tests });
    expect(discovered).toHaveLength(2);
    expect(discovered[0]).toMatchObject({
      id: tests[0]?.id,
      provider: { id: '@termwright/test', version: 1 },
      kind: 'gherkin-outline-example',
      source: { line: 7, column: 3 },
    });
    expect(discovered[1]?.file).toBe('C:/repo/tests/app.test.ts');
  });

  it('rejects duplicate native identities instead of silently deduplicating', async () => {
    await expect(
      discoverTests({ cwd: '/repo', load: async () => [tests[0]!, tests[0]!] }),
    ).rejects.toThrow('duplicate/invalid id');
  });

  it('keeps collection failure distinct from an empty suite', async () => {
    await expect(
      discoverTests({
        cwd: '/repo',
        load: async () => {
          throw new Error('collection failed');
        },
      }),
    ).rejects.toThrow('collection failed');
    await expect(discoverTests({ cwd: '/repo', load: async () => [] })).resolves.toEqual([]);
  });

  it('rejects an unbounded catalogue', async () => {
    const many = Array.from({ length: 10_001 }, (_, index): DiscoveredTest => ({
      id: `runner-task:00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      title: `t${index}`,
      file: '/repo/a.test.ts',
    }));
    await expect(discoverTests({ cwd: '/repo', load: async () => many })).rejects.toThrow(
      'exceeded',
    );
  });
});
