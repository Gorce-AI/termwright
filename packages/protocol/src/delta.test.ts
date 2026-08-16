import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, type ProtocolLimits } from './limits.js';
import type { SemanticNode, SemanticSnapshot } from './tree.js';
import { applyTreeDelta, validateTreeDelta, type TreeDelta } from './delta.js';

function baseSnapshot(): SemanticSnapshot {
  return {
    v: 1,
    sessionId: 's1',
    revision: 4,
    columns: 80,
    rows: 24,
    cursor: { row: 1, column: 2, visible: true },
    rootIds: ['root'],
    nodes: [
      { id: 'root', role: 'region', name: 'main' },
      { id: 'dialog', parentId: 'root', role: 'dialog', name: 'Permission' },
      { id: 'ok', parentId: 'dialog', role: 'button', name: 'Approve' },
      { id: 'cancel', parentId: 'dialog', role: 'button', name: 'Reject' },
    ],
  };
}

function delta(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return { baseRevision: 4, revision: 5, changed: [], removed: [], ...overrides };
}

function node(id: string, parentId: string | undefined, name: string): Record<string, unknown> {
  return { id, role: 'button', name, ...(parentId === undefined ? {} : { parentId }) };
}

function shapeCode(value: unknown, limits: ProtocolLimits = DEFAULT_LIMITS): string {
  const result = validateTreeDelta(value, limits);
  return result.ok ? 'ok' : result.code;
}

function applyCode(
  base: SemanticSnapshot,
  value: Record<string, unknown>,
  limits: ProtocolLimits = DEFAULT_LIMITS,
): string {
  const checked = validateTreeDelta(value, limits);
  if (!checked.ok) return `shape:${checked.code}`;
  const result = applyTreeDelta(base, checked.delta, limits);
  return result.ok ? 'ok' : result.code;
}

describe('validateTreeDelta — shape', () => {
  it('accepts a minimal delta', () => {
    expect(shapeCode(delta())).toBe('ok');
  });

  it('accepts changed nodes, removals and a root list', () => {
    expect(
      shapeCode(delta({ changed: [node('new', 'root', 'New')], removed: ['ok'], rootIds: ['root'] })),
    ).toBe('ok');
  });

  it('returns a deep-frozen delta', () => {
    const result = validateTreeDelta(delta({ changed: [node('a', 'root', 'A')] }), DEFAULT_LIMITS);
    if (!result.ok) throw new Error(result.detail);
    expect(Object.isFrozen(result.delta)).toBe(true);
    expect(Object.isFrozen(result.delta.changed)).toBe(true);
    expect(Object.isFrozen(result.delta.changed[0])).toBe(true);
  });

  it('requires the revision to move forward', () => {
    expect(shapeCode(delta({ baseRevision: 5, revision: 5 }))).toBe('revision');
    expect(shapeCode(delta({ baseRevision: 5, revision: 4 }))).toBe('revision');
    expect(shapeCode(delta({ baseRevision: 0, revision: 1 }))).toBe('revision');
  });

  it('rejects unknown delta properties', () => {
    expect(shapeCode(delta({ patch: 'sneaky' }))).toBe('schema');
  });

  it('rejects duplicate ids within changed or removed', () => {
    expect(shapeCode(delta({ changed: [node('a', 'root', 'A'), node('a', 'root', 'B')] }))).toBe(
      'duplicate-id',
    );
    expect(shapeCode(delta({ removed: ['a', 'a'] }))).toBe('duplicate-id');
    expect(shapeCode(delta({ rootIds: ['r', 'r'] }))).toBe('duplicate-id');
  });

  it('rejects an id that is both changed and removed', () => {
    expect(shapeCode(delta({ changed: [node('a', 'root', 'A')], removed: ['a'] }))).toBe('schema');
  });

  it('rejects a node that parents itself', () => {
    expect(shapeCode(delta({ changed: [node('a', 'a', 'A')] }))).toBe('cycle');
  });

  it('validates changed nodes exactly like snapshot nodes', () => {
    expect(shapeCode(delta({ changed: [{ id: 'a', role: 'supervillain', name: 'A' }] }))).toBe(
      'unknown-role',
    );
    expect(shapeCode(delta({ changed: [{ id: 'a', role: 'button', name: 'A', onClick: 'x' }] }))).toBe(
      'schema',
    );
    expect(
      shapeCode(
        delta({
          changed: [{ id: 'a', role: 'button', name: 'A', bounds: { row: 0.5, column: 0, width: 1, height: 1 } }],
        }),
      ),
    ).toBe('bad-rect');
  });

  it('bounds the number of touched nodes', () => {
    const changed = Array.from({ length: 30 }, (_, i) => node(`n${i}`, 'root', 'x'));
    expect(shapeCode(delta({ changed }), { ...DEFAULT_LIMITS, maxNodes: 10 })).toBe('count');
    expect(
      shapeCode(delta({ changed: [node('a', 'root', 'A')], removed: ['b', 'c'] }), {
        ...DEFAULT_LIMITS,
        maxNodes: 2,
      }),
    ).toBe('count');
  });

  it('bounds the serialised size', () => {
    expect(
      shapeCode(delta({ changed: [node('a', 'root', 'A'.repeat(4096))] }), {
        ...DEFAULT_LIMITS,
        maxSnapshotBytes: 512,
      }),
    ).toBe('bytes');
  });

  it('rejects non-object input without throwing', () => {
    for (const value of [null, 42, 'delta', [], true, undefined]) {
      expect(() => validateTreeDelta(value, DEFAULT_LIMITS)).not.toThrow();
      expect(shapeCode(value)).not.toBe('ok');
    }
  });
});

describe('applyTreeDelta — composition', () => {
  it('binds an exact base revision and refuses to patch anything else', () => {
    const result = applyTreeDelta(
      baseSnapshot(),
      { baseRevision: 3, revision: 5, changed: [], removed: [] },
      DEFAULT_LIMITS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('revision');
    // The detail must point at the recovery path, not just state the mismatch.
    expect(result.detail).toContain('full snapshot');
  });

  it('upserts a new node', () => {
    const result = applyTreeDelta(
      baseSnapshot(),
      { baseRevision: 4, revision: 5, changed: [{ id: 'extra', parentId: 'dialog', role: 'text', name: 'Note' }], removed: [] },
      DEFAULT_LIMITS,
    );
    if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
    expect(result.snapshot.revision).toBe(5);
    expect(result.snapshot.nodes.map((n) => n.id)).toContain('extra');
  });

  it('replaces an existing node wholesale rather than merging fields', () => {
    const base = baseSnapshot();
    const withState: SemanticNode = { id: 'ok', parentId: 'dialog', role: 'button', name: 'Approve', state: { focused: true } };
    const first = applyTreeDelta(base, { baseRevision: 4, revision: 5, changed: [withState], removed: [] }, DEFAULT_LIMITS);
    if (!first.ok) throw new Error(first.detail);
    expect(first.snapshot.nodes.find((n) => n.id === 'ok')?.state?.focused).toBe(true);

    // Re-sending the node without `state` must clear it: a delta replaces.
    const cleared: SemanticNode = { id: 'ok', parentId: 'dialog', role: 'button', name: 'Approve' };
    const second = applyTreeDelta(first.snapshot, { baseRevision: 5, revision: 6, changed: [cleared], removed: [] }, DEFAULT_LIMITS);
    if (!second.ok) throw new Error(second.detail);
    expect(second.snapshot.nodes.find((n) => n.id === 'ok')?.state).toBeUndefined();
  });

  it('removes a node together with its whole subtree', () => {
    const result = applyTreeDelta(
      baseSnapshot(),
      { baseRevision: 4, revision: 5, changed: [], removed: ['dialog'] },
      DEFAULT_LIMITS,
    );
    if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
    // Removing the dialog must take its buttons with it, or they would be
    // orphans referencing a parent that no longer exists.
    expect(result.snapshot.nodes.map((n) => n.id)).toEqual(['root']);
  });

  it('applies removals before upserts, so a node can be rescued from a removed subtree', () => {
    const result = applyTreeDelta(
      baseSnapshot(),
      {
        baseRevision: 4,
        revision: 5,
        changed: [{ id: 'ok', parentId: 'root', role: 'button', name: 'Approve' }],
        removed: ['dialog'],
      },
      DEFAULT_LIMITS,
    );
    if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
    expect(result.snapshot.nodes.map((n) => n.id).sort()).toEqual(['ok', 'root']);
    expect(result.snapshot.nodes.find((n) => n.id === 'ok')?.parentId).toBe('root');
  });

  it('refuses to remove a node the base does not have', () => {
    const result = applyTreeDelta(
      baseSnapshot(),
      { baseRevision: 4, revision: 5, changed: [], removed: ['ghost'] },
      DEFAULT_LIMITS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('missing-parent');
    expect(result.detail).toContain('resynchronised');
  });

  it('replaces the cursor when the delta carries one', () => {
    const result = applyTreeDelta(
      baseSnapshot(),
      { baseRevision: 4, revision: 5, changed: [], removed: [], cursor: { row: 9, column: 12, visible: true } },
      DEFAULT_LIMITS,
    );
    if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
    expect(result.snapshot.cursor).toEqual({ row: 9, column: 12, visible: true });
  });

  it('hides the cursor through visible:false, since a delta cannot remove it', () => {
    const result = applyTreeDelta(
      baseSnapshot(),
      { baseRevision: 4, revision: 5, changed: [], removed: [], cursor: { row: 1, column: 2, visible: false } },
      DEFAULT_LIMITS,
    );
    if (!result.ok) throw new Error(result.detail);
    expect(result.snapshot.cursor?.visible).toBe(false);
  });

  it('rejects a cursor outside the viewport, which only composition can see', () => {
    // The delta carries no columns/rows, so this passes the shape check.
    const value = {
      baseRevision: 4,
      revision: 5,
      changed: [],
      removed: [],
      cursor: { row: 900, column: 0, visible: true },
    };
    expect(shapeCode(value)).toBe('ok');
    expect(applyCode(baseSnapshot(), value)).toBe('bad-rect');
  });

  it('rejects a malformed cursor at the shape check', () => {
    expect(shapeCode(delta({ cursor: { row: -1, column: 0, visible: true } }))).toBe('schema');
    expect(shapeCode(delta({ cursor: { row: 0, column: 0 } }))).toBe('schema');
    expect(shapeCode(delta({ cursor: { row: 0, column: 0, visible: true, blink: true } }))).toBe(
      'schema',
    );
  });

  it('inherits the cursor and viewport from the base', () => {
    const result = applyTreeDelta(baseSnapshot(), { baseRevision: 4, revision: 5, changed: [], removed: [] }, DEFAULT_LIMITS);
    if (!result.ok) throw new Error(result.detail);
    expect(result.snapshot.cursor).toEqual({ row: 1, column: 2, visible: true });
    expect(result.snapshot.columns).toBe(80);
    expect(result.snapshot.sessionId).toBe('s1');
  });

  it('drops removed ids from the inherited root list', () => {
    const base: SemanticSnapshot = {
      ...baseSnapshot(),
      rootIds: ['root', 'aside'],
      nodes: [...baseSnapshot().nodes, { id: 'aside', role: 'region', name: 'Aside' }],
    };
    const result = applyTreeDelta(base, { baseRevision: 4, revision: 5, changed: [], removed: ['aside'] }, DEFAULT_LIMITS);
    if (!result.ok) throw new Error(result.detail);
    expect(result.snapshot.rootIds).toEqual(['root']);
  });

  it('requires rootIds when the delta introduces a new root', () => {
    // A parentless node missing from rootIds is what validateSnapshot rejects,
    // so the omission fails loudly instead of producing a detached tree.
    const withoutRoots = applyCode(baseSnapshot(), {
      baseRevision: 4,
      revision: 5,
      changed: [{ id: 'aside', role: 'region', name: 'Aside' }],
      removed: [],
    });
    expect(withoutRoots).toBe('schema');

    const withRoots = applyCode(baseSnapshot(), {
      baseRevision: 4,
      revision: 5,
      changed: [{ id: 'aside', role: 'region', name: 'Aside' }],
      removed: [],
      rootIds: ['root', 'aside'],
    });
    expect(withRoots).toBe('ok');
  });
});

describe('applyTreeDelta — invariants only the composed tree can show', () => {
  it('rejects a delta that introduces a cycle', () => {
    // Neither node is self-parented, so the delta is shape-valid; the cycle
    // only exists once the pair is composed onto the base.
    expect(
      applyCode(baseSnapshot(), {
        baseRevision: 4,
        revision: 5,
        changed: [
          { id: 'dialog', parentId: 'ok', role: 'dialog', name: 'Permission' },
          { id: 'ok', parentId: 'dialog', role: 'button', name: 'Approve' },
        ],
        removed: [],
      }),
    ).toBe('cycle');
  });

  it('rejects a delta whose node points at a parent nobody has', () => {
    expect(
      applyCode(baseSnapshot(), {
        baseRevision: 4,
        revision: 5,
        changed: [node('orphan', 'nowhere', 'Orphan')],
        removed: [],
      }),
    ).toBe('missing-parent');
  });

  it('rejects bounds that fall outside the viewport, which a delta cannot check alone', () => {
    // The delta carries no viewport, so this passes the shape check and can
    // only be caught against the base snapshot's columns/rows.
    const value = {
      baseRevision: 4,
      revision: 5,
      changed: [{ id: 'ok', parentId: 'dialog', role: 'button', name: 'Approve', bounds: { row: 900, column: 900, width: 4, height: 1 } }],
      removed: [],
    };
    expect(shapeCode(value)).toBe('ok');
    expect(applyCode(baseSnapshot(), value)).toBe('bad-rect');
  });

  it('rejects a composition that exceeds the depth ceiling', () => {
    const base = baseSnapshot();
    const changed = [];
    let parent = 'ok';
    for (let i = 0; i < 12; i += 1) {
      changed.push(node(`d${i}`, parent, 'deep'));
      parent = `d${i}`;
    }
    expect(applyCode(base, { baseRevision: 4, revision: 5, changed, removed: [] }, { ...DEFAULT_LIMITS, maxDepth: 6 })).toBe(
      'depth',
    );
  });

  it('rejects a composition that exceeds the node ceiling', () => {
    // The delta itself stays under the ceiling (6 touched, limit 8); only the
    // composition with the base's 4 nodes crosses it.
    const base = baseSnapshot();
    const changed = Array.from({ length: 6 }, (_, i) => node(`n${i}`, 'root', 'x'));
    const value = { baseRevision: 4, revision: 5, changed, removed: [] };
    const limits = { ...DEFAULT_LIMITS, maxNodes: 8 };
    expect(shapeCode(value, limits)).toBe('ok');
    expect(applyCode(base, value, limits)).toBe('count');
  });

  it('returns a deep-frozen composed snapshot', () => {
    const result = applyTreeDelta(baseSnapshot(), { baseRevision: 4, revision: 5, changed: [], removed: [] }, DEFAULT_LIMITS);
    if (!result.ok) throw new Error(result.detail);
    expect(Object.isFrozen(result.snapshot)).toBe(true);
    expect(Object.isFrozen(result.snapshot.nodes)).toBe(true);
  });
});
