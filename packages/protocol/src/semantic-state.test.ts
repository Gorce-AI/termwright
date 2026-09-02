import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, type ProtocolLimits } from './limits.js';
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

  const invalidDeltas: ReadonlyArray<
    readonly [label: string, delta: unknown, limits?: ProtocolLimits, wireBytes?: number]
  > = [
    ['a scalar envelope', null],
    [
      'an over-deep DTO',
      {
        v: 3,
        sessionId: 's1',
        revision: 5,
        baseRevision: 4,
        snapshot: { providerEvidence: { source: { nested: true } } },
      },
      { ...DEFAULT_LIMITS, maxDepth: 2 },
    ],
    [
      'an oversized frame',
      { v: 3, sessionId: 's1', revision: 5, baseRevision: 4 },
      DEFAULT_LIMITS,
      DEFAULT_LIMITS.maxSnapshotBytes + 1,
    ],
    [
      'an unknown envelope field',
      { v: 3, sessionId: 's1', revision: 5, baseRevision: 4, surprise: true },
    ],
    ['a foreign version', { v: 2, sessionId: 's1', revision: 5, baseRevision: 4 }],
    ['a foreign session', { v: 3, sessionId: 'other', revision: 5, baseRevision: 4 }],
    ['a fractional revision', { v: 3, sessionId: 's1', revision: 4.5, baseRevision: 4 }],
    ['a non-positive base', { v: 3, sessionId: 's1', revision: 5, baseRevision: 0 }],
    ['a stale revision', { v: 3, sessionId: 's1', revision: 4, baseRevision: 4 }],
    ['non-array operations', { v: 3, sessionId: 's1', revision: 5, baseRevision: 4, addNodes: {} }],
    [
      'too many operations',
      {
        v: 3,
        sessionId: 's1',
        revision: 5,
        baseRevision: 4,
        removeNodeIds: ['one', 'two', 'three'],
      },
      { ...DEFAULT_LIMITS, maxNodes: 2 },
    ],
    [
      'an empty operation id',
      { v: 3, sessionId: 's1', revision: 5, baseRevision: 4, removeNodeIds: [''] },
    ],
    [
      'an unknown removal',
      { v: 3, sessionId: 's1', revision: 5, baseRevision: 4, removeNodeIds: ['missing'] },
    ],
    [
      'an existing add',
      { v: 3, sessionId: 's1', revision: 5, baseRevision: 4, addNodes: [node('root')] },
    ],
    [
      'an unknown update',
      {
        v: 3,
        sessionId: 's1',
        revision: 5,
        baseRevision: 4,
        updateNodes: [{ id: 'missing', set: { name: 'x' } }],
      },
    ],
    [
      'an update envelope extension',
      {
        v: 3,
        sessionId: 's1',
        revision: 5,
        baseRevision: 4,
        updateNodes: [{ id: 'save', set: { name: 'x' }, extra: true }],
      },
    ],
    [
      'an empty update',
      {
        v: 3,
        sessionId: 's1',
        revision: 5,
        baseRevision: 4,
        updateNodes: [{ id: 'save' }],
      },
    ],
    [
      'a non-record set',
      {
        v: 3,
        sessionId: 's1',
        revision: 5,
        baseRevision: 4,
        updateNodes: [{ id: 'save', set: [] }],
      },
    ],
    [
      'a non-array node clear',
      {
        v: 3,
        sessionId: 's1',
        revision: 5,
        baseRevision: 4,
        updateNodes: [{ id: 'save', clear: 'description' }],
      },
    ],
    [
      'a non-string node clear',
      {
        v: 3,
        sessionId: 's1',
        revision: 5,
        baseRevision: 4,
        updateNodes: [{ id: 'save', clear: [1] }],
      },
    ],
    [
      'a duplicate node clear',
      {
        v: 3,
        sessionId: 's1',
        revision: 5,
        baseRevision: 4,
        updateNodes: [{ id: 'save', clear: ['description', 'description'] }],
      },
    ],
    [
      'an unknown node set field',
      {
        v: 3,
        sessionId: 's1',
        revision: 5,
        baseRevision: 4,
        updateNodes: [{ id: 'save', set: { mystery: true } }],
      },
    ],
    [
      'an id mutation',
      {
        v: 3,
        sessionId: 's1',
        revision: 5,
        baseRevision: 4,
        updateNodes: [{ id: 'save', set: { id: 'other' } }],
      },
    ],
    [
      'an unknown node clear field',
      {
        v: 3,
        sessionId: 's1',
        revision: 5,
        baseRevision: 4,
        updateNodes: [{ id: 'save', clear: ['mystery'] }],
      },
    ],
    [
      'a non-record snapshot patch',
      { v: 3, sessionId: 's1', revision: 5, baseRevision: 4, snapshot: [] },
    ],
    [
      'an unknown snapshot field',
      {
        v: 3,
        sessionId: 's1',
        revision: 5,
        baseRevision: 4,
        snapshot: { mystery: true },
      },
    ],
    [
      'a non-array snapshot clear',
      {
        v: 3,
        sessionId: 's1',
        revision: 5,
        baseRevision: 4,
        snapshot: { clear: 'cursor' },
      },
    ],
    [
      'a non-string snapshot clear',
      {
        v: 3,
        sessionId: 's1',
        revision: 5,
        baseRevision: 4,
        snapshot: { clear: [1] },
      },
    ],
    [
      'a duplicate snapshot clear',
      {
        v: 3,
        sessionId: 's1',
        revision: 5,
        baseRevision: 4,
        snapshot: { clear: ['cursor', 'cursor'] },
      },
    ],
    [
      'a required snapshot clear',
      {
        v: 3,
        sessionId: 's1',
        revision: 5,
        baseRevision: 4,
        snapshot: { clear: ['rows'] },
      },
    ],
    [
      'a snapshot set and clear collision',
      {
        v: 3,
        sessionId: 's1',
        revision: 5,
        baseRevision: 4,
        snapshot: { cursor: { row: 1, column: 1, visible: true }, clear: ['cursor'] },
      },
    ],
    [
      'an invariant-breaking root update',
      {
        v: 3,
        sessionId: 's1',
        revision: 5,
        baseRevision: 4,
        snapshot: { rootIds: ['missing'] },
      },
    ],
  ];

  it.each(invalidDeltas)('rejects %s at the atomic delta boundary', (...args: unknown[]) => {
    const [, delta, limitOverride, wireBytes] = args as [
      string,
      unknown,
      ProtocolLimits | undefined,
      number | undefined,
    ];
    const limits = limitOverride ?? DEFAULT_LIMITS;
    const base = snapshot();
    const result = applySemanticDelta(base, delta, limits, wireBytes);
    expect(result.ok).toBe(false);
    expect(base).toEqual(snapshot());
  });

  it('covers structural equality and all deterministic diff operation shapes', () => {
    const base = {
      ...snapshot(),
      nodes: [
        { ...node('root'), actions: ['focus'], description: 'remove me' },
        node('save', 'root'),
        node('gone', 'root'),
      ],
    } satisfies SemanticSnapshot;
    const { cursor: _cursor, ...baseWithoutCursor } = base;
    const { description: _description, ...rootWithoutDescription } = base.nodes[0]!;
    const target: SemanticSnapshot = {
      ...baseWithoutCursor,
      revision: 5,
      hitGrid: {
        status: 'known',
        value: {
          regions: [{ rect: { row: 0, column: 0, width: 1, height: 1 }, recipientId: 'save' }],
        },
        evidence: frameworkEvidence,
      },
      nodes: [
        { ...rootWithoutDescription, actions: ['focus', 'activate'] },
        base.nodes[1]!,
        node('new', 'root'),
      ],
    };
    const delta = diffSemanticSnapshots(base, target);
    expect(delta).toMatchObject({
      addNodes: [{ id: 'new' }],
      removeNodeIds: ['gone'],
      updateNodes: [{ id: 'root', clear: ['description'] }],
      snapshot: { clear: ['cursor'] },
    });
    const result = applySemanticDelta(base, delta, DEFAULT_LIMITS);
    expect(result.ok && result.snapshot).toEqual(target);
    expect(result.ok && result.changedNodes.get('gone')).toBeUndefined();
  });

  it('refuses to diff unrelated or non-forward revisions', () => {
    expect(() => diffSemanticSnapshots(snapshot(), { ...snapshot(), sessionId: 's2' })).toThrow(
      'different sessions',
    );
    expect(() => diffSemanticSnapshots(snapshot(), snapshot())).toThrow('newer than its base');
  });
});
