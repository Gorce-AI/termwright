import { describe, expect, it } from 'vitest';
import { node, snapshot } from './__fixtures__/fake-session.js';
import { childrenOf, formatMs, nextMarker, nodeAt, rootsOf, statesOf } from './view-model.js';

describe('tree shaping', () => {
  const tree = snapshot(1, [
    node({ id: 'd1', role: 'dialog', name: 'Permission' }),
    node({ id: 'b1', role: 'button', name: 'Approve', parentId: 'd1' }),
    node({ id: 'b2', role: 'button', name: 'Reject', parentId: 'd1' }),
  ]);

  it('groups children by parent, in snapshot order', () => {
    expect(childrenOf(tree).get('d1')?.map((child) => child.id)).toEqual(['b1', 'b2']);
  });

  it('uses rootIds for the roots', () => {
    expect(rootsOf(tree).map((root) => root.id)).toEqual(['d1']);
  });

  it('falls back to parentless nodes when rootIds is empty', () => {
    const orphaned = { ...tree, rootIds: [] };
    expect(rootsOf(orphaned).map((root) => root.id)).toEqual(['d1']);
  });

  it('ignores a rootId that names no node', () => {
    const stale = { ...tree, rootIds: ['gone', 'd1'] };
    expect(rootsOf(stale).map((root) => root.id)).toEqual(['d1']);
  });

  it('renders set flags the way the YAML snapshots write them', () => {
    expect(
      statesOf(node({ id: 'n1', role: 'checkbox', state: { checked: 'mixed', disabled: false, focused: true } })),
    ).toEqual(['checked=mixed', 'focused']);
    expect(statesOf(node({ id: 'n1', role: 'button' }))).toEqual([]);
  });
});

describe('nodeAt', () => {
  const nodes = [
    node({ id: 'd1', role: 'dialog', name: 'Permission', bounds: { row: 0, column: 0, width: 40, height: 5 } }),
    node({ id: 'b1', role: 'button', name: 'Approve', parentId: 'd1', bounds: { row: 2, column: 2, width: 11, height: 1 } }),
    node({ id: 'x1', role: 'text', name: 'no bounds' }),
  ];

  it('picks the innermost node containing the cell', () => {
    expect(nodeAt(nodes, { row: 2, column: 5 })?.id).toBe('b1');
  });

  it('falls back to the container outside the button', () => {
    expect(nodeAt(nodes, { row: 4, column: 30 })?.id).toBe('d1');
  });

  it('returns nothing outside every node', () => {
    expect(nodeAt(nodes, { row: 20, column: 70 })).toBeUndefined();
  });

  it('never picks a node without bounds', () => {
    expect(nodeAt([nodes[2] as never], { row: 0, column: 0 })).toBeUndefined();
  });

  it('treats bounds as half-open on both axes', () => {
    expect(nodeAt(nodes, { row: 2, column: 13 })?.id).toBe('d1');
    expect(nodeAt(nodes, { row: 5, column: 0 })).toBeUndefined();
  });
});

describe('nextMarker', () => {
  const markers = [{ t: 0 }, { t: 1_000 }, { t: 1_500 }];

  it('finds the next and previous marker', () => {
    expect(nextMarker(markers, 0, 1)).toBe(1_000);
    expect(nextMarker(markers, 1_500, -1)).toBe(1_000);
  });

  it('returns nothing past the ends', () => {
    expect(nextMarker(markers, 1_500, 1)).toBeUndefined();
    expect(nextMarker(markers, 0, -1)).toBeUndefined();
  });

  it('does not get stuck on the marker it is sitting on', () => {
    expect(nextMarker(markers, 1_000, 1)).toBe(1_500);
    expect(nextMarker(markers, 1_000, -1)).toBe(0);
  });
});

describe('formatMs', () => {
  it('scales the unit to the magnitude', () => {
    expect(formatMs(320)).toBe('320ms');
    expect(formatMs(1_500)).toBe('1.5s');
    expect(formatMs(64_000)).toBe('1m 04s');
  });
});
