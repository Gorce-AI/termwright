import { describe, expect, it } from 'vitest';
import {
  defaultDiscoveryCommand,
  discoverTests,
  discoveredId,
  parseDiscoveredId,
  parseListing,
} from './discovery.js';

const listing = JSON.stringify([
  {
    name: 'the todo app > starts on the list it was seeded with',
    file: '/repo/tests/app.feature',
    provider: { id: '@termwright/test', version: 1 },
    kind: 'gherkin-outline-example',
    ancestors: [
      { kind: 'feature', title: 'the todo app' },
      { kind: 'rule', title: 'filtering' },
    ],
    tags: ['@smoke'],
    source: { file: '/repo/tests/app.feature', line: 7, column: 3 },
  },
  { name: 'the todo app > filters the list', file: '/repo/tests/app.test.ts' },
  { name: 'renders the menu', file: '/repo/tests/menu.test.ts' },
]);

describe('parseListing', () => {
  it('reads what vitest list prints', () => {
    expect(parseListing(listing).map((test) => [test.title, test.file])).toEqual([
      ['the todo app > starts on the list it was seeded with', '/repo/tests/app.feature'],
      ['the todo app > filters the list', '/repo/tests/app.test.ts'],
      ['renders the menu', '/repo/tests/menu.test.ts'],
    ]);
  });

  it('canonicalizes Windows paths in catalogue and source metadata', () => {
    const [test] = parseListing(JSON.stringify([{
      name: 'case',
      file: 'C:\\repo\\case.feature',
      source: { file: 'C:\\repo\\case.feature', line: 2, column: 3 },
    }]));
    expect(test).toMatchObject({
      id: 'C:/repo/case.feature::case',
      file: 'C:/repo/case.feature',
      source: { file: 'C:/repo/case.feature', line: 2, column: 3 },
    });
  });

  it('gives every test an id a runner can act on', () => {
    const [first] = parseListing(listing);
    expect(first?.id).toBe('/repo/tests/app.feature::the todo app > starts on the list it was seeded with');
    expect(parseDiscoveredId(first?.id ?? '')).toEqual({
      file: '/repo/tests/app.feature',
      title: 'the todo app > starts on the list it was seeded with',
    });
  });

  it('preserves provider-authored hierarchy and physical source without splitting the title', () => {
    expect(parseListing(listing)[0]).toMatchObject({
      provider: { id: '@termwright/test', version: 1 },
      kind: 'gherkin-outline-example',
      ancestors: [
        { kind: 'feature', title: 'the todo app' },
        { kind: 'rule', title: 'filtering' },
      ],
      tags: ['@smoke'],
      source: { file: '/repo/tests/app.feature', line: 7, column: 3 },
    });
  });

  it('skips whatever the runner printed before the array', () => {
    expect(parseListing(`stderr noise\nDEBUG=1\n${listing}`)).toHaveLength(3);
  });

  it('drops entries it cannot use, and keeps the rest', () => {
    const mixed = JSON.stringify([
      { name: 'good', file: '/repo/a.test.ts' },
      { name: '', file: '/repo/a.test.ts' },
      { file: '/repo/a.test.ts' },
      { name: 'no file' },
      'not an object',
      null,
    ]);
    expect(parseListing(mixed).map((test) => test.title)).toEqual(['good']);
  });

  it('lists a duplicated name once', () => {
    const duplicated = JSON.stringify([
      { name: 'same', file: '/repo/a.test.ts' },
      { name: 'same', file: '/repo/a.test.ts' },
    ]);
    expect(parseListing(duplicated)).toHaveLength(1);
  });

  it('returns nothing for output that is not a listing', () => {
    expect(parseListing('')).toEqual([]);
    expect(parseListing('command not found')).toEqual([]);
    expect(parseListing('[')).toEqual([]);
    expect(parseListing('{"name":"x"}')).toEqual([]);
  });

  it('bounds a listing from a project with an absurd number of tests', () => {
    const many = JSON.stringify(
      Array.from({ length: 20_000 }, (_, index) => ({ name: `t${index}`, file: '/repo/a.test.ts' })),
    );
    expect(parseListing(many)).toHaveLength(10_000);
  });
});

describe('discoverTests', () => {
  it('puts a scoped file before --json so Vitest cannot overwrite the source', () => {
    expect(defaultDiscoveryCommand(['src/app.test.ts'])).toEqual([
      'npx',
      'vitest',
      'list',
      'src/app.test.ts',
      '--json',
    ]);
  });

  it('lists what the command printed', async () => {
    const tests = await discoverTests({ cwd: '/repo', run: async () => listing });
    expect(tests).toHaveLength(3);
  });

  it('returns nothing when the command fails, because discovery is a convenience', async () => {
    const tests = await discoverTests({
      cwd: '/repo',
      run: async () => {
        throw new Error('vitest: not found');
      },
    });
    expect(tests).toEqual([]);
  });
});

describe('parseDiscoveredId', () => {
  it('rejects an id that did not come from discovery', () => {
    expect(parseDiscoveredId('t1')).toBeNull();
    expect(parseDiscoveredId('::orphan')).toBeNull();
    expect(parseDiscoveredId('/repo/a.test.ts::')).toBeNull();
  });

  it('round-trips a title containing colons', () => {
    const id = discoveredId('/repo/a.test.ts', 'parses http://example.com');
    expect(parseDiscoveredId(id)).toEqual({
      file: '/repo/a.test.ts',
      title: 'parses http://example.com',
    });
  });
});
