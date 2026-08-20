import { describe, expect, it } from 'vitest';
import { termwrightProvider, type TermwrightProviderDeclaration } from '@termwright/ui/provider';
import { filterSuite } from './ui-runner.js';

interface FakeTask {
  type: 'test' | 'suite';
  name: string;
  mode: string;
  meta: object;
  tasks?: FakeTask[];
  suite?: FakeTask & { type: 'suite'; tasks: FakeTask[] };
  filepath?: string;
}

const task = (
  name: string,
  owned: boolean,
  declaration: TermwrightProviderDeclaration = { mode: 'run', exclusive: false },
): FakeTask =>
  ({
    type: 'test',
    name,
    mode: 'run',
    meta: owned
      ? { termwright: { provider: termwrightProvider('@termwright/test'), declaration } }
      : {},
  });

const suite = (name: string, tasks: FakeTask[]): FakeTask & { type: 'suite'; tasks: FakeTask[] } => {
  const value: FakeTask & { type: 'suite'; tasks: FakeTask[] } = {
    type: 'suite',
    name,
    mode: 'run',
    meta: {},
    tasks,
  };
  for (const child of tasks) child.suite = value;
  return value;
};

describe('the UI-only Vitest runner filter', () => {
  it('keeps provider cases and skips a foreign sibling in a mixed suite', () => {
    const owned = task('owned', true);
    const foreign = task('foreign', false);
    const file = suite('file', [owned, foreign]);

    expect(filterSuite(file)).toBe(true);
    expect(owned.mode).toBe('run');
    expect(foreign.mode).toBe('skip');
    expect(file.mode).toBe('run');
  });

  it('skips an entire branch which contains no provider cases', () => {
    const foreign = suite('foreign branch', [task('foreign', false)]);
    const owned = suite('owned branch', [task('owned', true)]);
    const file = suite('file', [foreign, owned]);

    filterSuite(file);
    expect(foreign.mode).toBe('skip');
    expect(owned.mode).toBe('run');
  });

  it('restores provider modes after a foreign only suppressed them', () => {
    const normal = task('normal', true);
    normal.mode = 'skip';
    const declaredSkip = task('declared skip', true, { mode: 'skip', exclusive: false });
    const declaredTodo = task('declared todo', true, { mode: 'todo', exclusive: false });
    const foreignOnly = task('foreign only', false);
    const file = suite('file', [normal, declaredSkip, declaredTodo, foreignOnly]);

    filterSuite(file);
    expect(normal.mode).toBe('run');
    expect(declaredSkip.mode).toBe('skip');
    expect(declaredTodo.mode).toBe('todo');
    expect(foreignOnly.mode).toBe('skip');
  });

  it('reapplies the UI name pattern after restoring declaration modes', () => {
    const selected = task('selected', true);
    const sibling = task('sibling', true);
    selected.mode = 'skip';
    sibling.mode = 'skip';
    const group = suite('group', [selected, sibling, task('foreign only', false)]);
    const file = suite('file', [group]);
    file.filepath = '/repo/file.test.ts';

    filterSuite(file, { testNamePattern: /^group selected$/u });
    expect(selected.mode).toBe('run');
    expect(sibling.mode).toBe('skip');
  });

  it('keeps provider-owned only semantics inside the provider boundary', () => {
    const normal = task('normal', true);
    const exclusive = task('exclusive', true, { mode: 'run', exclusive: true });
    normal.mode = 'skip';
    const file = suite('file', [normal, exclusive, task('foreign', false)]);

    filterSuite(file);
    expect(normal.mode).toBe('skip');
    expect(exclusive.mode).toBe('run');
  });

  it('preserves Vitest mode decisions for an explicit file:line selection', () => {
    const outsideLine = task('outside line', true);
    outsideLine.mode = 'skip';
    const file = suite('file', [outsideLine, task('foreign only', false)]);

    filterSuite(file, { restoreDeclaredModes: false });
    expect(outsideLine.mode).toBe('skip');
  });

  it('selects exact file and title pairs without a cross-file name product', () => {
    const aFoo = task('foo', true);
    const aBar = task('bar', true);
    const fileA = suite('file a', [aFoo, aBar]);
    fileA.filepath = '/repo/a.test.ts';
    const bFoo = task('foo', true);
    const bBar = task('bar', true);
    const fileB = suite('file b', [bFoo, bBar]);
    fileB.filepath = '/repo/b.test.ts';
    const selectedCases = [
      { file: '/repo/a.test.ts', title: 'foo' },
      { file: '/repo/b.test.ts', title: 'bar' },
    ];

    filterSuite(fileA, { selectedCases });
    filterSuite(fileB, { selectedCases });

    expect([aFoo.mode, aBar.mode, bFoo.mode, bBar.mode]).toEqual(['run', 'skip', 'skip', 'run']);
  });
});
