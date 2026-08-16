import { describe, expect, it } from 'vitest';
import { visibleRows } from './command-log.js';
import type { CommandRow } from '../commands.js';

const step = (id: string, depth: number): CommandRow => ({ id, kind: 'step', t: 0, label: id, depth });
const action = (id: string, depth: number): CommandRow => ({ id, kind: 'action', t: 0, label: id, depth });

const ids = (rows: readonly { readonly row: CommandRow }[]): string[] => rows.map((entry) => entry.row.id);

describe('folding a step in the command log', () => {
  const rows = [step('s1', 0), action('a1', 1), step('s2', 1), action('a2', 2), action('a3', 0)];

  it('shows everything when nothing is folded', () => {
    expect(ids(visibleRows(rows, new Set()))).toEqual(['s1', 'a1', 's2', 'a2', 'a3']);
  });

  it('hides what is inside a step, including deeper steps', () => {
    // Folding by the step's id would have hidden `a1` and left `s2` and `a2`
    // behind, because a nested step carries its own id rather than its parent's.
    expect(ids(visibleRows(rows, new Set(['s1'])))).toEqual(['s1', 'a3']);
  });

  it('keeps the step itself, so the shape of the test stays visible', () => {
    expect(ids(visibleRows(rows, new Set(['s2'])))).toEqual(['s1', 'a1', 's2', 'a3']);
  });

  it('numbers rows by their place in the whole log, not in what is shown', () => {
    // The gutter counts the test's commands; a fold must not renumber them.
    const shown = visibleRows(rows, new Set(['s1']));
    expect(shown.map((entry) => entry.index)).toEqual([0, 4]);
  });
});
