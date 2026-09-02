import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from './limits.js';
import { applySemanticDelta, diffSemanticSnapshots } from './semantic-state.js';
import type { SemanticNode, SemanticSnapshot } from './tree.js';

const frameworkEvidence = {
  source: 'framework',
  method: 'native',
  strength: 'authoritative',
  providerId: 'test',
} as const;

const geometry = () =>
  ({
    displayed: { status: 'known', value: true, evidence: { ...frameworkEvidence } },
    intendedRect: {
      status: 'known',
      value: { row: 0, column: 0, width: 4, height: 1 },
      evidence: { ...frameworkEvidence },
    },
    visibleRect: {
      status: 'known',
      value: { row: 0, column: 0, width: 4, height: 1 },
      evidence: { ...frameworkEvidence },
    },
  }) as const;

function node(id: string, parentId?: string): SemanticNode {
  return {
    id,
    ...(parentId === undefined ? {} : { parentId }),
    role: parentId === undefined ? 'application' : 'button',
    name: id,
    geometry: geometry(),
  };
}

function snapshot(): SemanticSnapshot {
  return {
    v: 3,
    sessionId: 's1',
    revision: 4,
    columns: 80,
    rows: 24,
    cursor: { row: 0, column: 0, visible: true },
    rootIds: ['root'],
    nodes: [node('root'), node('save', 'root')],
    coordinateSpace: {
      status: 'known',
      value: 'viewport-cells',
      evidence: frameworkEvidence,
    },
    hitGrid: {
      status: 'unsupported',
      capability: 'pointer-hit-grid',
      reason: 'not-negotiated',
    },
  };
}

describe('revisioned semantic state', () => {
  it('applies add, update, clear, remove and snapshot changes atomically', () => {
    const result = applySemanticDelta(
      snapshot(),
      {
        v: 3,
        sessionId: 's1',
        revision: 5,
        baseRevision: 4,
        removeNodeIds: ['save'],
        addNodes: [{ ...node('cancel', 'root'), description: 'temporary' }],
        updateNodes: [{ id: 'root', set: { name: 'Application' }, clear: ['description'] }],
        snapshot: { columns: 100, rootIds: ['root'], clear: ['cursor'] },
      },
      DEFAULT_LIMITS,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot).toMatchObject({ revision: 5, columns: 100 });
    expect(result.snapshot.cursor).toBeUndefined();
    expect(result.snapshot.nodes.map(({ id }) => id)).toEqual(['root', 'cancel']);
    expect(result.snapshot.nodes[0]?.name).toBe('Application');
    expect([...result.changedNodeIds].sort()).toEqual(['cancel', 'root', 'save']);
  });

  it('distinguishes an absent field from explicit clear', () => {
    const base = { ...snapshot(), nodes: [{ ...node('root'), description: 'keep me' }] };
    const unchanged = applySemanticDelta(
      base,
      { v: 3, sessionId: 's1', revision: 5, baseRevision: 4 },
      DEFAULT_LIMITS,
    );
    expect(unchanged.ok && unchanged.snapshot.nodes[0]?.description).toBe('keep me');
    const cleared = applySemanticDelta(
      base,
      {
        v: 3,
        sessionId: 's1',
        revision: 5,
        baseRevision: 4,
        updateNodes: [{ id: 'root', clear: ['description'] }],
      },
      DEFAULT_LIMITS,
    );
    expect(cleared.ok && cleared.snapshot.nodes[0]?.description).toBeUndefined();
  });

  it('requests resync on a base mismatch without changing committed state', () => {
    const base = snapshot();
    const result = applySemanticDelta(
      base,
      { v: 3, sessionId: 's1', revision: 7, baseRevision: 6 },
      DEFAULT_LIMITS,
    );
    expect(result).toMatchObject({ ok: false, code: 'base-revision', resyncRequired: true });
    expect(base).toEqual(snapshot());
  });

  it('reconstructs the exact target from a deterministic diff', () => {
    const base = snapshot();
    const { cursor: _cursor, ...withoutCursor } = base;
    const target: SemanticSnapshot = {
      ...withoutCursor,
      revision: 5,
      columns: 100,
      nodes: [
        { ...base.nodes[0]!, name: 'Application' },
        { ...base.nodes[1]!, description: 'changed' },
        node('cancel', 'root'),
      ],
    };
    const delta = diffSemanticSnapshots(base, target);
    expect(delta).toMatchObject({
      revision: 5,
      baseRevision: 4,
      addNodes: [{ id: 'cancel' }],
      updateNodes: [{ id: 'root' }, { id: 'save' }],
      snapshot: { columns: 100, clear: ['cursor'] },
    });
    const applied = applySemanticDelta(base, delta, DEFAULT_LIMITS);
    expect(applied.ok && applied.snapshot).toEqual(target);
  });

  it.each([
    ['cycle', { updateNodes: [{ id: 'root', set: { parentId: 'save' } }] }],
    ['missing parent', { updateNodes: [{ id: 'save', set: { parentId: 'missing' } }] }],
    [
      'duplicate operation',
      { removeNodeIds: ['save'], updateNodes: [{ id: 'save', set: { name: 'x' } }] },
    ],
    [
      'set and clear',
      { updateNodes: [{ id: 'save', set: { description: 'x' }, clear: ['description'] }] },
    ],
    ['clear required', { updateNodes: [{ id: 'save', clear: ['geometry'] }] }],
  ])('rejects %s without publishing partial state', (_label, operations) => {
    const base = snapshot();
    const result = applySemanticDelta(
      base,
      { v: 3, sessionId: 's1', revision: 5, baseRevision: 4, ...operations },
      DEFAULT_LIMITS,
    );
    expect(result.ok).toBe(false);
    expect(base).toEqual(snapshot());
  });
});
