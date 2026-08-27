import { describe, expect, it } from 'vitest';
import type { SemanticNode, SemanticSnapshot } from '@termwright/protocol';
import { colorMatches, matchSemantic, SemanticIndex } from './matching.js';
import { parseSelector, roleQuery, textMatcher } from './selectors.js';

function tree(nodes: readonly Partial<SemanticNode>[]): SemanticIndex {
  const snapshot: SemanticSnapshot = {
    v: 2,
    sessionId: 's',
    revision: 3,
    columns: 80,
    rows: 24,
    rootIds: ['root'],
    nodes: nodes.map((node) => ({ role: 'generic', name: '', ...node }) as SemanticNode),
    coordinateSpace: {
      status: 'known',
      value: 'viewport-cells',
      evidence: {
        source: 'driver',
        method: 'native',
        strength: 'authoritative',
        providerId: 'test',
      },
    },
    hitGrid: {
      status: 'unsupported',
      capability: 'pointer-hit-grid',
      reason: 'framework-unobservable',
    },
  };
  return new SemanticIndex(snapshot);
}

const dialog = tree([
  { id: 'root', role: 'application', name: 'app' },
  { id: 'd1', parentId: 'root', role: 'dialog', name: 'Permission', state: { modal: true } },
  {
    id: 'b1',
    parentId: 'd1',
    role: 'button',
    name: 'Approve',
    testId: 'approve primary',
    state: { focused: true },
  },
  {
    id: 'b2',
    parentId: 'd1',
    role: 'button',
    name: 'Reject',
    testId: 'reject',
    state: { disabled: true },
  },
  { id: 'l1', parentId: 'root', role: 'text', name: 'Your name' },
  {
    id: 'i1',
    parentId: 'root',
    role: 'textbox',
    name: '',
    value: {
      status: 'known',
      value: 'Ada',
      sensitivity: 'public',
      evidence: {
        source: 'driver',
        method: 'native',
        strength: 'authoritative',
        providerId: 'test',
      },
    },
    labelledBy: ['l1'],
  },
  { id: 'b3', parentId: 'root', role: 'button', name: 'Approve' },
]);

describe('matchSemantic', () => {
  it('matches by role and name', () => {
    const matches = matchSemantic(
      dialog,
      roleQuery('button', textMatcher('Approve', true), {}).steps,
    );
    expect(matches.map((node) => node.id)).toEqual(['b1', 'b3']);
  });

  it('narrows by a descendant chain', () => {
    const matches = matchSemantic(dialog, parseSelector('dialog button').steps);
    expect(matches.map((node) => node.id)).toEqual(['b1', 'b2']);
  });

  it('matches pseudo-class state', () => {
    expect(matchSemantic(dialog, parseSelector('button:focused').steps).map((n) => n.id)).toEqual([
      'b1',
    ]);
    expect(matchSemantic(dialog, parseSelector('button:disabled').steps).map((n) => n.id)).toEqual([
      'b2',
    ]);
  });

  it('matches #testId and .class tokens', () => {
    expect(matchSemantic(dialog, parseSelector('#reject').steps).map((n) => n.id)).toEqual(['b2']);
    // '.class' is provisional: it matches a token of testId (or of the name),
    // while '#id' still requires the whole testId to match.
    expect(matchSemantic(dialog, parseSelector('button.primary').steps).map((n) => n.id)).toEqual([
      'b1',
    ]);
    expect(matchSemantic(dialog, parseSelector('button.Approve').steps).map((n) => n.id)).toEqual([
      'b1',
      'b3',
    ]);
    expect(matchSemantic(dialog, parseSelector('#approve').steps)).toHaveLength(0);
  });

  it('scopes matching to a subtree', () => {
    const scoped = matchSemantic(
      dialog,
      roleQuery('button', textMatcher('Approve', true), {}).steps,
      'd1',
    );
    expect(scoped.map((node) => node.id)).toEqual(['b1']);
  });

  it('resolves labels through labelledBy', () => {
    const node = dialog.node('i1');
    expect(node).toBeDefined();
    expect(dialog.label(node as SemanticNode)).toBe('Your name');
    const matches = matchSemantic(dialog, parseSelector('textbox').steps);
    expect(matches).toHaveLength(1);
  });

  it('reports ancestors and descendants', () => {
    const button = dialog.node('b1') as SemanticNode;
    expect(dialog.ancestors(button).map((node) => node.id)).toEqual(['d1', 'root']);
    expect(dialog.isDescendantOf(button, 'd1')).toBe(true);
    expect(dialog.isDescendantOf(button, 'b2')).toBe(false);
  });

  it('survives a parent chain that points at a missing node', () => {
    const broken = tree([{ id: 'x', parentId: 'ghost', role: 'button', name: 'B' }]);
    const node = broken.node('x') as SemanticNode;
    expect(broken.ancestors(node)).toEqual([]);
    expect(matchSemantic(broken, parseSelector('dialog button').steps)).toHaveLength(0);
  });
});

describe('colorMatches', () => {
  it('matches named colors, palette indices and rgb', () => {
    expect(colorMatches({ kind: 'palette', index: 1 }, 'red')).toBe(true);
    expect(colorMatches({ kind: 'palette', index: 9 }, 'brightRed')).toBe(true);
    expect(colorMatches({ kind: 'palette', index: 196 }, '196')).toBe(true);
    expect(colorMatches({ kind: 'rgb', r: 18, g: 52, b: 86 }, '#123456')).toBe(true);
    expect(colorMatches({ kind: 'default' }, 'default')).toBe(true);
  });

  it('rejects mismatches and nonsense predicates', () => {
    expect(colorMatches({ kind: 'palette', index: 2 }, 'red')).toBe(false);
    expect(colorMatches({ kind: 'default' }, 'red')).toBe(false);
    expect(colorMatches({ kind: 'rgb', r: 1, g: 2, b: 3 }, '#zzzzzz')).toBe(false);
    expect(colorMatches({ kind: 'palette', index: 1 }, 'burgundy')).toBe(false);
  });
});
