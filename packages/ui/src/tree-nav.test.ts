import { describe, expect, it } from 'vitest';
import { navigateTree, type TreeNavState, type TreeRow } from './tree-nav.js';

/** dialog > [button, list > [item]] */
const rows: TreeRow[] = [
  { id: 'd1', hasChildren: true },
  { id: 'b1', hasChildren: false, parentId: 'd1' },
  { id: 'l1', hasChildren: true, parentId: 'd1' },
  { id: 'i1', hasChildren: false, parentId: 'l1' },
];

const at = (selectedId: string | null, collapsed: string[] = []): TreeNavState => ({
  selectedId,
  collapsed: new Set(collapsed),
});

describe('navigateTree', () => {
  it('moves down and up through the visible rows', () => {
    expect(navigateTree(rows, at('d1'), 'down').selectedId).toBe('b1');
    expect(navigateTree(rows, at('b1'), 'up').selectedId).toBe('d1');
  });

  it('stops at the ends rather than wrapping around', () => {
    expect(navigateTree(rows, at('i1'), 'down').selectedId).toBe('i1');
    expect(navigateTree(rows, at('d1'), 'up').selectedId).toBe('d1');
  });

  it('lands on the first row when nothing is selected yet', () => {
    expect(navigateTree(rows, at(null), 'down').selectedId).toBe('d1');
    expect(navigateTree(rows, at(null), 'up').selectedId).toBe('d1');
  });

  it('opens a closed node with right, then steps into it', () => {
    const opened = navigateTree(rows, at('l1', ['l1']), 'right');
    expect([...opened.collapsed]).toEqual([]);
    expect(opened.selectedId).toBe('l1');

    expect(navigateTree(rows, at('l1'), 'right').selectedId).toBe('i1');
  });

  it('does nothing on right at a leaf', () => {
    const state = at('b1');
    expect(navigateTree(rows, state, 'right')).toBe(state);
  });

  it('closes an open node with left, then steps out to the parent', () => {
    const closed = navigateTree(rows, at('l1'), 'left');
    expect([...closed.collapsed]).toEqual(['l1']);
    expect(closed.selectedId).toBe('l1');

    expect(navigateTree(rows, at('l1', ['l1']), 'left').selectedId).toBe('d1');
    expect(navigateTree(rows, at('b1'), 'left').selectedId).toBe('d1');
  });

  it('does nothing on left at a closed root', () => {
    const state = at('d1', ['d1']);
    expect(navigateTree(rows, state, 'left')).toBe(state);
  });

  it('leaves an empty tree alone', () => {
    const state = at(null);
    expect(navigateTree([], state, 'down')).toBe(state);
  });

  it('never mutates the collapsed set it was given', () => {
    const state = at('l1');
    const before = new Set(state.collapsed);
    navigateTree(rows, state, 'left');
    expect(state.collapsed).toEqual(before);
  });
});
