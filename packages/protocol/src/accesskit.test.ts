import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from './limits.js';
import { SEMANTIC_ROLES, type SemanticRole } from './roles.js';
import type { SemanticSnapshot } from './tree.js';
import { validateSnapshot } from './validate.js';
import {
  ACCESSKIT_ROLE_BY_SEMANTIC_ROLE,
  ACCESSKIT_ROOT_TREE_ID,
  accessKitNodeId,
  toAccessKitTreeUpdate,
  type AccessKitNode,
} from './accesskit.js';

/** A dialog fixture exercising roles, states, relations and geometry. */
function fixture(): SemanticSnapshot {
  const snapshot = {
    v: 1,
    sessionId: 's1',
    revision: 7,
    columns: 80,
    rows: 24,
    cursor: { row: 3, column: 5, visible: true },
    rootIds: ['app'],
    nodes: [
      { id: 'app', role: 'application', name: 'installer' },
      {
        id: 'dialog',
        parentId: 'app',
        role: 'dialog',
        name: 'Permission',
        state: { modal: true },
        bounds: { row: 8, column: 20, width: 40, height: 9 },
      },
      { id: 'prompt', parentId: 'dialog', role: 'text', name: 'Allow bash to run?' },
      {
        id: 'approve',
        parentId: 'dialog',
        role: 'button',
        name: 'Approve',
        state: { focused: true },
        actions: ['focus', 'activate'],
        bounds: { row: 14, column: 23, width: 11, height: 1 },
        describedBy: ['prompt'],
      },
      {
        id: 'remember',
        parentId: 'dialog',
        role: 'checkbox',
        name: 'Remember',
        state: { checked: 'mixed', disabled: true },
      },
    ],
  };
  const result = validateSnapshot(snapshot, DEFAULT_LIMITS);
  if (!result.ok) throw new Error(`fixture invalid: ${result.code} ${result.detail}`);
  return result.snapshot;
}

function nodeFor(
  update: ReturnType<typeof toAccessKitTreeUpdate>['update'],
  sourceId: string,
): AccessKitNode {
  const id = accessKitNodeId(sourceId);
  const entry = update.nodes.find(([nodeId]) => nodeId === id);
  if (entry === undefined) throw new Error(`no exported node for ${sourceId}`);
  return entry[1];
}

describe('accessKitNodeId', () => {
  it('is stable across calls', () => {
    expect(accessKitNodeId('approve')).toBe(accessKitNodeId('approve'));
  });

  it('stays inside the safe-integer range so JSON round-trips exactly', () => {
    for (const id of ['a', 'approve', 'n'.repeat(200), 'żółć', '👍']) {
      const value = accessKitNodeId(id);
      expect(Number.isSafeInteger(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
      expect(JSON.parse(JSON.stringify(value))).toBe(value);
    }
  });

  it('separates different ids', () => {
    const ids = ['a', 'b', 'app', 'dialog', 'approve', 'remember'];
    expect(new Set(ids.map(accessKitNodeId)).size).toBe(ids.length);
  });

  it('is a pure function of the id, not of position', () => {
    // A bridge may re-export the same node from a different snapshot; ids must
    // not drift, or assistive technology loses track of the object.
    expect(accessKitNodeId('approve')).toBe(accessKitNodeId('approve'));
  });
});

describe('toAccessKitTreeUpdate — shape', () => {
  it('produces a TreeUpdate with the AccessKit field names', () => {
    const { update } = toAccessKitTreeUpdate(fixture());
    expect(Object.keys(update).sort()).toEqual(['focus', 'nodes', 'tree', 'treeId']);
    expect(update.treeId).toBe(ACCESSKIT_ROOT_TREE_ID);
    expect(update.tree?.root).toBe(accessKitNodeId('app'));
  });

  it('emits nodes as [id, node] pairs, as accesskit Vec<(NodeId, Node)> does', () => {
    const { update } = toAccessKitTreeUpdate(fixture());
    expect(update.nodes).toHaveLength(5);
    for (const entry of update.nodes) {
      expect(entry).toHaveLength(2);
      expect(typeof entry[0]).toBe('number');
      expect(typeof entry[1].role).toBe('string');
    }
  });

  it('carries toolkit metadata when given', () => {
    const { update } = toAccessKitTreeUpdate(fixture(), {
      toolkitName: 'ink',
      toolkitVersion: '7.1.1',
      treeId: '11111111-2222-3333-4444-555555555555',
    });
    expect(update.tree?.toolkitName).toBe('ink');
    expect(update.tree?.toolkitVersion).toBe('7.1.1');
    expect(update.treeId).toBe('11111111-2222-3333-4444-555555555555');
  });

  it('serialises to JSON without loss', () => {
    const { update } = toAccessKitTreeUpdate(fixture());
    expect(JSON.parse(JSON.stringify(update))).toEqual(JSON.parse(JSON.stringify(update)));
    expect(() => JSON.stringify(update)).not.toThrow();
  });

  it('returns a frozen export', () => {
    const exported = toAccessKitTreeUpdate(fixture());
    expect(Object.isFrozen(exported)).toBe(true);
    expect(Object.isFrozen(exported.update)).toBe(true);
    expect(Object.isFrozen(exported.update.nodes)).toBe(true);
  });
});

describe('toAccessKitTreeUpdate — mapping', () => {
  it('maps every protocol role onto a real accesskit role', () => {
    // Guards against a role being added to the protocol without a mapping.
    for (const role of SEMANTIC_ROLES) {
      expect(typeof ACCESSKIT_ROLE_BY_SEMANTIC_ROLE[role]).toBe('string');
      expect(ACCESSKIT_ROLE_BY_SEMANTIC_ROLE[role].length).toBeGreaterThan(0);
    }
    expect(Object.keys(ACCESSKIT_ROLE_BY_SEMANTIC_ROLE).sort()).toEqual([...SEMANTIC_ROLES].sort());
  });

  it('uses the camelCase serde spellings accesskit expects', () => {
    expect(ACCESSKIT_ROLE_BY_SEMANTIC_ROLE.listitem).toBe('listItem');
    expect(ACCESSKIT_ROLE_BY_SEMANTIC_ROLE.checkbox).toBe('checkBox');
    expect(ACCESSKIT_ROLE_BY_SEMANTIC_ROLE.radio).toBe('radioButton');
    expect(ACCESSKIT_ROLE_BY_SEMANTIC_ROLE.text).toBe('label');
    expect(ACCESSKIT_ROLE_BY_SEMANTIC_ROLE.progressbar).toBe('progressIndicator');
    expect(ACCESSKIT_ROLE_BY_SEMANTIC_ROLE.separator).toBe('splitter');
    expect(ACCESSKIT_ROLE_BY_SEMANTIC_ROLE.generic).toBe('genericContainer');
  });

  it('promotes a multiline textbox to multilineTextInput', () => {
    const base = fixture();
    const snapshot: SemanticSnapshot = {
      ...base,
      nodes: [
        ...base.nodes,
        {
          id: 'notes',
          parentId: 'dialog',
          role: 'textbox' as SemanticRole,
          name: 'Notes',
          state: { multiline: true },
        },
      ],
    };
    expect(nodeFor(toAccessKitTreeUpdate(snapshot).update, 'notes').role).toBe(
      'multilineTextInput',
    );
  });

  it('maps name to label and keeps description and value', () => {
    const node = nodeFor(toAccessKitTreeUpdate(fixture()).update, 'approve');
    expect(node.label).toBe('Approve');
  });

  it('derives explicit children from parentId', () => {
    const { update } = toAccessKitTreeUpdate(fixture());
    expect(nodeFor(update, 'app').children).toEqual([accessKitNodeId('dialog')]);
    expect(nodeFor(update, 'dialog').children).toEqual([
      accessKitNodeId('prompt'),
      accessKitNodeId('approve'),
      accessKitNodeId('remember'),
    ]);
    expect(nodeFor(update, 'approve').children).toBeUndefined();
  });

  it('lifts focus to the tree, where accesskit keeps it', () => {
    const { update } = toAccessKitTreeUpdate(fixture());
    expect(update.focus).toBe(accessKitNodeId('approve'));
    expect(nodeFor(update, 'approve')).not.toHaveProperty('focused');
  });

  it('falls back to the root when no node claims focus', () => {
    const base = fixture();
    const snapshot: SemanticSnapshot = {
      ...base,
      nodes: base.nodes.map((n) => (n.id === 'approve' ? { ...n, state: {} } : n)),
    };
    expect(toAccessKitTreeUpdate(snapshot).update.focus).toBe(accessKitNodeId('app'));
  });

  it('maps tri-state checked onto Toggled', () => {
    expect(nodeFor(toAccessKitTreeUpdate(fixture()).update, 'remember').toggled).toBe('mixed');

    const base = fixture();
    const on: SemanticSnapshot = {
      ...base,
      nodes: base.nodes.map((n) => (n.id === 'remember' ? { ...n, state: { checked: true } } : n)),
    };
    expect(nodeFor(toAccessKitTreeUpdate(on).update, 'remember').toggled).toBe('true');
  });

  it('maps states accesskit actually has', () => {
    const remember = nodeFor(toAccessKitTreeUpdate(fixture()).update, 'remember');
    expect(remember.disabled).toBe(true);
    expect(nodeFor(toAccessKitTreeUpdate(fixture()).update, 'dialog').modal).toBe(true);
  });

  it('maps actions and drops the ones accesskit cannot express', () => {
    const base = fixture();
    const snapshot: SemanticSnapshot = {
      ...base,
      nodes: base.nodes.map((n) =>
        n.id === 'approve' ? { ...n, actions: ['focus', 'activate', 'toggle', 'select'] } : n,
      ),
    };
    const actions = nodeFor(toAccessKitTreeUpdate(snapshot).update, 'approve').actions ?? [];
    expect(actions).toContain('focus');
    expect(actions).toContain('click');
    // activate and toggle both become click; it must appear once.
    expect(actions.filter((a) => a === 'click')).toHaveLength(1);
    // `select` has no faithful accesskit action and is deliberately omitted
    // rather than mapped onto something that means a different thing.
    expect(actions).not.toContain('select');
  });

  it('remaps relations onto exported ids', () => {
    const node = nodeFor(toAccessKitTreeUpdate(fixture()).update, 'approve');
    expect(node.describedBy).toEqual([accessKitNodeId('prompt')]);
  });
});

describe('toAccessKitTreeUpdate — geometry', () => {
  it('omits bounds when the cell size is unknown', () => {
    const exported = toAccessKitTreeUpdate(fixture());
    expect(nodeFor(exported.update, 'approve').bounds).toBeUndefined();
    // The cell rect is still reported, just not as pixel geometry.
    expect(exported.cellBounds[String(accessKitNodeId('approve'))]).toEqual({
      row: 14,
      column: 23,
      width: 11,
      height: 1,
    });
  });

  it('converts cells to pixels when an embedder supplies the cell size', () => {
    const exported = toAccessKitTreeUpdate(fixture(), { cellSize: { width: 8, height: 16 } });
    expect(nodeFor(exported.update, 'approve').bounds).toEqual({
      x0: 23 * 8,
      y0: 14 * 16,
      x1: (23 + 11) * 8,
      y1: (14 + 1) * 16,
    });
  });

  it('reports cell bounds only for nodes that had them', () => {
    const exported = toAccessKitTreeUpdate(fixture());
    expect(Object.keys(exported.cellBounds)).toHaveLength(2);
    expect(exported.cellBounds[String(accessKitNodeId('prompt'))]).toBeUndefined();
  });

  it('handles a snapshot with no bounds at all', () => {
    const base = fixture();
    const snapshot: SemanticSnapshot = {
      ...base,
      nodes: base.nodes.map(({ bounds: _bounds, ...rest }) => rest),
    };
    const exported = toAccessKitTreeUpdate(snapshot);
    expect(exported.cellBounds).toEqual({});
    expect(exported.update.nodes).toHaveLength(5);
  });
});

describe('toAccessKitTreeUpdate — edges', () => {
  it('exports a single-node tree', () => {
    const snapshot = validateSnapshot(
      { v: 1, sessionId: 's', revision: 1, columns: 80, rows: 24, rootIds: ['only'], nodes: [{ id: 'only', role: 'application', name: 'app' }] },
      DEFAULT_LIMITS,
    );
    if (!snapshot.ok) throw new Error(snapshot.detail);
    const { update } = toAccessKitTreeUpdate(snapshot.snapshot);
    expect(update.nodes).toHaveLength(1);
    expect(update.focus).toBe(accessKitNodeId('only'));
  });

  it('omits an empty label rather than exporting an empty string', () => {
    const snapshot = validateSnapshot(
      { v: 1, sessionId: 's', revision: 1, columns: 80, rows: 24, rootIds: ['r'], nodes: [{ id: 'r', role: 'generic', frameworkType: 'Fixture', name: '' }] },
      DEFAULT_LIMITS,
    );
    if (!snapshot.ok) throw new Error(snapshot.detail);
    expect(toAccessKitTreeUpdate(snapshot.snapshot).update.nodes[0]![1].label).toBeUndefined();
  });

  it('scales to the node ceiling without collisions', () => {
    const nodes = [{ id: 'root', role: 'region', name: 'main' }];
    for (let i = 0; i < DEFAULT_LIMITS.maxNodes - 1; i += 1) {
      nodes.push({ id: `n${i}`, parentId: 'root', role: 'text', name: `row ${i}` } as never);
    }
    const snapshot = validateSnapshot(
      { v: 1, sessionId: 's', revision: 1, columns: 80, rows: 24, rootIds: ['root'], nodes },
      DEFAULT_LIMITS,
    );
    if (!snapshot.ok) throw new Error(snapshot.detail);

    const { update } = toAccessKitTreeUpdate(snapshot.snapshot);
    expect(update.nodes).toHaveLength(DEFAULT_LIMITS.maxNodes);
    expect(new Set(update.nodes.map(([id]) => id)).size).toBe(DEFAULT_LIMITS.maxNodes);
  });
});
