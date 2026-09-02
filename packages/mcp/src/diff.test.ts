import { describe, expect, it } from 'vitest';
import { diffRows, diffSemantic } from './diff.js';
import type { SemanticNode, SemanticSnapshot } from './model.js';

const geometry = (rect?: {
  row: number;
  column: number;
  width: number;
  height: number;
}): SemanticNode['geometry'] =>
  rect === undefined
    ? {
        displayed: { status: 'unknown', reason: 'awaiting-revision-pair' },
        intendedRect: { status: 'unknown', reason: 'awaiting-revision-pair' },
        visibleRect: { status: 'unknown', reason: 'awaiting-revision-pair' },
      }
    : {
        displayed: {
          status: 'known',
          value: true,
          evidence: {
            source: 'framework',
            method: 'native',
            strength: 'authoritative',
            providerId: 'mcp-test',
          },
        },
        intendedRect: {
          status: 'known',
          value: { ...rect },
          evidence: {
            source: 'framework',
            method: 'native',
            strength: 'authoritative',
            providerId: 'mcp-test',
          },
        },
        visibleRect: {
          status: 'known',
          value: { ...rect },
          evidence: {
            source: 'framework',
            method: 'native',
            strength: 'authoritative',
            providerId: 'mcp-test',
          },
        },
      };

function snapshot(revision: number, nodes: readonly SemanticNode[]): SemanticSnapshot {
  return {
    v: 3,
    sessionId: 's1',
    revision,
    columns: 80,
    rows: 24,
    rootIds: nodes.filter((node) => node.parentId === undefined).map((node) => node.id),
    nodes,
    coordinateSpace: { status: 'unknown', reason: 'awaiting-revision-pair' },
    hitGrid: {
      status: 'unsupported',
      capability: 'pointer-hit-grid',
      reason: 'framework-unobservable',
    },
  };
}

const dialog: SemanticNode = { id: 'n1', role: 'dialog', name: 'Permission', geometry: geometry() };
const approve: SemanticNode = {
  id: 'n2',
  parentId: 'n1',
  role: 'button',
  name: 'Approve',
  state: { focused: true },
  geometry: geometry(),
};
const reject: SemanticNode = {
  id: 'n3',
  parentId: 'n1',
  role: 'button',
  name: 'Reject',
  geometry: geometry(),
};

describe('row diffs', () => {
  it('reports only the rows that differ', () => {
    expect(diffRows(['a', 'b', 'c'], ['a', 'B', 'c'])).toEqual([{ row: 1, text: 'B' }]);
  });

  it('reports rows that appeared and rows the terminal lost', () => {
    expect(diffRows(['a'], ['a', 'new'])).toEqual([{ row: 1, text: 'new' }]);
    expect(diffRows(['a', 'gone'], ['a'])).toEqual([{ row: 1, text: '' }]);
  });
});

describe('semantic diffs', () => {
  it('finds nothing when nothing moved', () => {
    const before = snapshot(1, [dialog, approve, reject]);
    const after = snapshot(2, [dialog, approve, reject]);
    expect(diffSemantic(before, after)).toEqual([]);
  });

  it('reports a state change as one updated subtree', () => {
    const before = snapshot(1, [dialog, approve, reject]);
    const after = snapshot(2, [dialog, { ...approve, state: { focused: false } }, reject]);
    const changes = diffSemantic(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.change).toBe('updated');
    expect(changes[0]?.ref).toBe('semantic:n2@2');
    expect(changes[0]?.compact).toBe('button "Approve" ref=semantic:n2@2');
  });

  it('folds a changed child into its changed parent instead of reporting both', () => {
    const before = snapshot(1, [dialog, approve]);
    const after = snapshot(2, [
      { ...dialog, name: 'Permission required' },
      { ...approve, name: 'Allow' },
    ]);
    const changes = diffSemantic(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.ref).toBe('semantic:n1@2');
    expect(changes[0]?.compact.split('\n')).toEqual([
      'dialog "Permission required" ref=semantic:n1@2',
      '  button "Allow" ref=semantic:n2@2 focused',
    ]);
  });

  it('reports new nodes as added and vanished nodes as removed', () => {
    const before = snapshot(1, [dialog, approve]);
    const after = snapshot(2, [dialog, reject]);
    const changes = diffSemantic(before, after);
    expect(changes.map((change) => [change.change, change.ref])).toEqual([
      ['added', 'semantic:n3@2'],
      ['removed', 'semantic:n2@1'],
    ]);
  });

  it('treats a session that lost its tree as a full removal', () => {
    const changes = diffSemantic(snapshot(1, [dialog, approve]), null);
    expect(changes.every((change) => change.change === 'removed')).toBe(true);
    expect(changes).toHaveLength(2);
  });
});
