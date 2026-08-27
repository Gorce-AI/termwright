import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, type ProtocolLimits } from './limits.js';
import type { SemanticSnapshot } from './tree.js';
import { type ValidationErrorCode, validateSnapshot } from './validate.js';

function unknownGeometry(): Record<string, unknown> {
  return {
    displayed: { status: 'unknown', reason: 'awaiting-revision-pair' },
    intendedRect: { status: 'unknown', reason: 'awaiting-revision-pair' },
    visibleRect: { status: 'unknown', reason: 'awaiting-revision-pair' },
  };
}

/** A minimal valid snapshot: one root region containing one button. */
function baseSnapshot(): Record<string, unknown> {
  const evidence = () => ({
    source: 'framework',
    method: 'native',
    strength: 'authoritative',
    providerId: 'test',
  });
  const geometry = (rect: Record<string, number>) => ({
    displayed: { status: 'known', value: true, evidence: evidence() },
    intendedRect: { status: 'known', value: { ...rect }, evidence: evidence() },
    visibleRect: { status: 'known', value: { ...rect }, evidence: evidence() },
  });
  return {
    v: 2,
    sessionId: 's1',
    revision: 1,
    columns: 80,
    rows: 24,
    rootIds: ['root'],
    nodes: [
      {
        id: 'root',
        role: 'region',
        name: 'main',
        geometry: geometry({ row: 0, column: 0, width: 80, height: 24 }),
      },
      {
        id: 'ok',
        parentId: 'root',
        role: 'button',
        name: 'OK',
        geometry: geometry({ row: 2, column: 4, width: 6, height: 1 }),
        state: { focused: true },
      },
    ],
    coordinateSpace: { status: 'known', value: 'viewport-cells', evidence: evidence() },
    hitGrid: {
      status: 'unsupported',
      capability: 'pointer-hit-grid',
      reason: 'framework-unobservable',
    },
  };
}

function withLimits(overrides: Partial<ProtocolLimits>): ProtocolLimits {
  return Object.freeze({ ...DEFAULT_LIMITS, ...overrides });
}

/** Validate and assert failure, returning the error code for comparison. */
function codeOf(
  value: unknown,
  limits: ProtocolLimits = DEFAULT_LIMITS,
): ValidationErrorCode | 'ok' {
  const result = validateSnapshot(value, limits);
  return result.ok ? 'ok' : result.code;
}

describe('validateSnapshot — happy path', () => {
  it('accepts a well-formed snapshot', () => {
    const result = validateSnapshot(baseSnapshot(), DEFAULT_LIMITS);
    expect(result.ok).toBe(true);
  });

  it('accepts revision-bound authoritative application pointer evidence', () => {
    const snapshot = baseSnapshot();
    snapshot['providerEvidence'] = [
      {
        providerId: 'app.router',
        sessionId: 's1',
        revision: 1,
        status: 'available',
        evidence: {
          source: 'application',
          method: 'declared',
          strength: 'authoritative',
          providerId: 'app.router',
        },
        pointerRegions: [
          {
            recipientId: 'ok',
            regionBounds: { row: 2, column: 4, width: 6, height: 1 },
            spans: [{ row: 2, from: 4, to: 10 }],
          },
        ],
        hitGrid: {
          regions: [
            {
              recipientId: 'ok',
              rect: { row: 2, column: 4, width: 6, height: 1 },
            },
          ],
        },
      },
    ];
    expect(codeOf(snapshot)).toBe('ok');
  });

  it('rejects stale, duplicate, forged, and out-of-bounds provider evidence', () => {
    const entry = {
      providerId: 'app.router',
      sessionId: 's1',
      revision: 1,
      status: 'available',
      evidence: {
        source: 'application',
        method: 'declared',
        strength: 'authoritative',
        providerId: 'app.router',
      },
      pointerRegions: [
        {
          recipientId: 'ok',
          regionBounds: { row: 2, column: 4, width: 6, height: 1 },
          spans: [{ row: 2, from: 4, to: 10 }],
        },
      ],
    };
    const stale = baseSnapshot();
    stale['providerEvidence'] = [{ ...entry, revision: 2 }];
    expect(codeOf(stale)).toBe('provider');

    const duplicate = baseSnapshot();
    duplicate['providerEvidence'] = [entry, structuredClone(entry)];
    expect(codeOf(duplicate)).toBe('provider');

    const forged = baseSnapshot();
    forged['providerEvidence'] = [
      {
        ...entry,
        evidence: { ...entry.evidence, providerId: 'someone-else' },
      },
    ];
    expect(codeOf(forged)).toBe('schema');

    const outside = baseSnapshot();
    outside['providerEvidence'] = [
      {
        ...entry,
        pointerRegions: [
          {
            ...entry.pointerRegions[0],
            spans: [{ row: 2, from: 4, to: 81 }],
          },
        ],
      },
    ];
    expect(codeOf(outside)).toBe('bad-rect');
  });

  it('returns a deep-frozen copy that shares nothing with the input', () => {
    const input = baseSnapshot();
    const result = validateSnapshot(input, DEFAULT_LIMITS);
    if (!result.ok) throw new Error(`expected ok, got ${result.code}: ${result.detail}`);

    const snapshot: SemanticSnapshot = result.snapshot;
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.nodes)).toBe(true);
    expect(Object.isFrozen(snapshot.nodes[0])).toBe(true);
    expect(Object.isFrozen(snapshot.nodes[1]?.geometry)).toBe(true);
    expect(snapshot.nodes).not.toBe(input['nodes']);
  });

  it('accepts every declared role and action', () => {
    const snapshot = baseSnapshot();
    (snapshot['nodes'] as Record<string, unknown>[])[1]!['actions'] = ['focus', 'activate'];
    expect(codeOf(snapshot)).toBe('ok');
  });

  it('accepts bounded JSON domain state in its explicit namespace', () => {
    const snapshot = baseSnapshot();
    (snapshot['nodes'] as Record<string, unknown>[])[1]!['extended'] = {
      deploymentStatus: 'rolling-out',
      retryCount: 2,
      overdue: false,
      rollout: { regions: ['eu', 'us'], progress: 0.5 },
    };
    expect(codeOf(snapshot)).toBe('ok');
  });

  it('rejects unbounded domain containers and strings', () => {
    const tooMany = baseSnapshot();
    (tooMany['nodes'] as Record<string, unknown>[])[1]!['extended'] = {
      values: ['a', 'b', 'c'],
    };
    expect(codeOf(tooMany, withLimits({ maxRelationTargets: 2 }))).toBe('count');

    const tooLong = baseSnapshot();
    (tooLong['nodes'] as Record<string, unknown>[])[1]!['extended'] = { key: 'oversized' };
    expect(codeOf(tooLong, withLimits({ maxStringBytes: 4 }))).toBe('string-bytes');
  });
});

describe('validateSnapshot — generic nodes and provenance (D1, D2)', () => {
  it('requires a frameworkType on a generic node', () => {
    // An unrecognised widget survives as `generic` instead of being dropped —
    // but only if it says what the framework called it.
    const snapshot = baseSnapshot();
    (snapshot['nodes'] as Record<string, unknown>[])[1] = {
      id: 'ok',
      parentId: 'root',
      role: 'generic',
      name: '',
    };
    expect(codeOf(snapshot)).toBe('schema');
  });

  it('accepts a generic node that names its framework type', () => {
    const snapshot = baseSnapshot();
    (snapshot['nodes'] as Record<string, unknown>[])[1] = {
      id: 'ok',
      parentId: 'root',
      role: 'generic',
      frameworkType: 'ScrollBoxRenderable',
      name: '',
      geometry: unknownGeometry(),
    };
    expect(codeOf(snapshot)).toBe('ok');
  });

  it('marks the affected generic node when its children are opaque', () => {
    const snapshot = baseSnapshot();
    (snapshot['nodes'] as Record<string, unknown>[])[1] = {
      id: 'ok',
      parentId: 'root',
      role: 'generic',
      frameworkType: 'CustomContainer',
      opaqueChildren: true,
      name: '',
      geometry: unknownGeometry(),
    };
    expect(codeOf(snapshot)).toBe('ok');
    (snapshot['nodes'] as Record<string, unknown>[])[1]!['opaqueChildren'] = 'yes';
    expect(codeOf(snapshot)).toBe('schema');
  });

  it('rejects an empty frameworkType, which carries no more than its absence', () => {
    const snapshot = baseSnapshot();
    (snapshot['nodes'] as Record<string, unknown>[])[1] = {
      id: 'ok',
      parentId: 'root',
      role: 'generic',
      frameworkType: '',
      name: '',
    };
    expect(codeOf(snapshot)).toBe('schema');
  });

  it('does not require a frameworkType on a recognised role', () => {
    expect(codeOf(baseSnapshot())).toBe('ok');
  });

  it('accepts node provenance and per-field exceptions', () => {
    const snapshot = baseSnapshot();
    (snapshot['nodes'] as Record<string, unknown>[])[1]!['p'] = 'framework';
    (snapshot['nodes'] as Record<string, unknown>[])[1]!['px'] = { name: 'annotation' };
    expect(codeOf(snapshot)).toBe('ok');
  });

  it('keeps the provenance source set closed', () => {
    const snapshot = baseSnapshot();
    (snapshot['nodes'] as Record<string, unknown>[])[1]!['p'] = 'vibes';
    expect(codeOf(snapshot)).toBe('schema');

    const other = baseSnapshot();
    (other['nodes'] as Record<string, unknown>[])[1]!['px'] = { name: 'guesswork' };
    expect(codeOf(other)).toBe('schema');
  });
});

describe('validateSnapshot — offscreen', () => {
  function withState(state: Record<string, unknown>): Record<string, unknown> {
    const snapshot = baseSnapshot();
    (snapshot['nodes'] as Record<string, unknown>[])[1]!['state'] = state;
    return snapshot;
  }

  it('accepts the scrolled-away pair', () => {
    expect(codeOf(withState({ hidden: true, offscreen: true }))).toBe('ok');
  });

  it('accepts hidden without offscreen — never displayed is a different state', () => {
    expect(codeOf(withState({ hidden: true }))).toBe('ok');
  });

  it('refuses offscreen on a visible node', () => {
    // Every cell outside the visible area and the node still visible cannot
    // both be true; allowing it would make `offscreen` a weaker synonym for
    // `hidden` rather than a claim about scrolling.
    expect(codeOf(withState({ offscreen: true }))).toBe('schema');
    expect(codeOf(withState({ offscreen: true, hidden: false }))).toBe('schema');
  });

  it('accepts an explicit negative claim on a visible node', () => {
    expect(codeOf(withState({ offscreen: false }))).toBe('ok');
  });

  it('lets a zero-area rectangle through when the node says why', () => {
    const snapshot = baseSnapshot();
    const node = (snapshot['nodes'] as Record<string, unknown>[])[1]!;
    const geometry = node['geometry'] as Record<string, Record<string, unknown>>;
    geometry['intendedRect']!['value'] = { row: 3, column: 4, width: 0, height: 0 };
    geometry['visibleRect']!['value'] = { row: 3, column: 4, width: 0, height: 0 };
    node['state'] = { hidden: true, offscreen: true };
    expect(codeOf(snapshot)).toBe('ok');
  });
});

describe('validateSnapshot — structural invariants', () => {
  it('rejects duplicate node ids', () => {
    const snapshot = baseSnapshot();
    (snapshot['nodes'] as Record<string, unknown>[])[1]!['id'] = 'root';
    expect(codeOf(snapshot)).toBe('duplicate-id');
  });

  it('rejects duplicate root ids', () => {
    const snapshot = baseSnapshot();
    snapshot['rootIds'] = ['root', 'root'];
    expect(codeOf(snapshot)).toBe('duplicate-id');
  });

  it('rejects a parent that does not exist', () => {
    const snapshot = baseSnapshot();
    (snapshot['nodes'] as Record<string, unknown>[])[1]!['parentId'] = 'ghost';
    expect(codeOf(snapshot)).toBe('missing-parent');
  });

  it('rejects a rootId that names no node', () => {
    const snapshot = baseSnapshot();
    snapshot['rootIds'] = ['ghost'];
    expect(codeOf(snapshot)).toBe('missing-parent');
  });

  it('rejects a parentless node missing from rootIds', () => {
    const snapshot = baseSnapshot();
    delete (snapshot['nodes'] as Record<string, unknown>[])[1]!['parentId'];
    expect(codeOf(snapshot)).toBe('schema');
  });

  it('rejects a root node that also declares a parent', () => {
    const snapshot = baseSnapshot();
    snapshot['rootIds'] = ['root', 'ok'];
    expect(codeOf(snapshot)).toBe('schema');
  });

  it('rejects a self-parented node', () => {
    const snapshot = baseSnapshot();
    (snapshot['nodes'] as Record<string, unknown>[])[1]!['parentId'] = 'ok';
    expect(codeOf(snapshot)).toBe('cycle');
  });

  it('rejects a multi-node parent cycle', () => {
    const snapshot = baseSnapshot();
    snapshot['rootIds'] = [];
    snapshot['nodes'] = [
      {
        id: 'a',
        parentId: 'c',
        role: 'generic',
        frameworkType: 'Fixture',
        name: 'a',
        geometry: unknownGeometry(),
      },
      {
        id: 'b',
        parentId: 'a',
        role: 'generic',
        frameworkType: 'Fixture',
        name: 'b',
        geometry: unknownGeometry(),
      },
      {
        id: 'c',
        parentId: 'b',
        role: 'generic',
        frameworkType: 'Fixture',
        name: 'c',
        geometry: unknownGeometry(),
      },
    ];
    expect(codeOf(snapshot)).toBe('cycle');
  });

  it('rejects unresolvable labelledBy targets', () => {
    const snapshot = baseSnapshot();
    (snapshot['nodes'] as Record<string, unknown>[])[1]!['labelledBy'] = ['ghost'];
    expect(codeOf(snapshot)).toBe('missing-parent');
  });

  it('accepts labelledBy pointing at a real node', () => {
    const snapshot = baseSnapshot();
    (snapshot['nodes'] as Record<string, unknown>[])[1]!['labelledBy'] = ['root'];
    expect(codeOf(snapshot)).toBe('ok');
  });
});

describe('validateSnapshot — capacity limits', () => {
  it('rejects more nodes than maxNodes allows', () => {
    const snapshot = baseSnapshot();
    const nodes: Record<string, unknown>[] = [
      { id: 'root', role: 'region', name: 'main', geometry: unknownGeometry() },
    ];
    for (let i = 0; i < 20; i += 1) {
      nodes.push({
        id: `n${i}`,
        parentId: 'root',
        role: 'text',
        name: `n${i}`,
        geometry: unknownGeometry(),
      });
    }
    snapshot['nodes'] = nodes;
    expect(codeOf(snapshot, withLimits({ maxNodes: 5 }))).toBe('count');
  });

  it('rejects a tree deeper than maxDepth', () => {
    const nodes: Record<string, unknown>[] = [
      { id: 'n0', role: 'region', name: 'n0', geometry: unknownGeometry() },
    ];
    for (let i = 1; i < 10; i += 1) {
      nodes.push({
        id: `n${i}`,
        parentId: `n${i - 1}`,
        role: 'generic',
        frameworkType: 'Fixture',
        name: `n${i}`,
        geometry: unknownGeometry(),
      });
    }
    const snapshot = { ...baseSnapshot(), rootIds: ['n0'], nodes };
    expect(codeOf(snapshot, withLimits({ maxDepth: 5 }))).toBe('depth');
    expect(codeOf(snapshot, withLimits({ maxDepth: 10 }))).toBe('ok');
  });

  it('rejects strings longer than maxStringBytes, counting UTF-8 bytes', () => {
    const snapshot = baseSnapshot();
    // 'ż' is 2 UTF-8 bytes, so 6 characters exceed a 10-byte ceiling.
    (snapshot['nodes'] as Record<string, unknown>[])[1]!['name'] = 'ż'.repeat(6);
    expect(codeOf(snapshot, withLimits({ maxStringBytes: 10 }))).toBe('string-bytes');
    expect(codeOf(snapshot, withLimits({ maxStringBytes: 18 }))).toBe('ok');
  });

  it('rejects a snapshot heavier than maxSnapshotBytes', () => {
    expect(codeOf(baseSnapshot(), withLimits({ maxSnapshotBytes: 64 }))).toBe('bytes');
  });

  it('rejects more relation targets than maxRelationTargets', () => {
    const snapshot = baseSnapshot();
    (snapshot['nodes'] as Record<string, unknown>[])[1]!['describedBy'] = ['root', 'root', 'root'];
    expect(codeOf(snapshot, withLimits({ maxRelationTargets: 2 }))).toBe('count');
  });
});

describe('validateSnapshot — scalar and shape checks', () => {
  it('rejects an unknown role', () => {
    const snapshot = baseSnapshot();
    (snapshot['nodes'] as Record<string, unknown>[])[1]!['role'] = 'supervillain';
    expect(codeOf(snapshot)).toBe('unknown-role');
  });

  it('rejects an unknown action', () => {
    const snapshot = baseSnapshot();
    (snapshot['nodes'] as Record<string, unknown>[])[1]!['actions'] = ['selfDestruct'];
    expect(codeOf(snapshot)).toBe('schema');
  });

  it('rejects unknown properties rather than ignoring them', () => {
    const snapshot = baseSnapshot();
    (snapshot['nodes'] as Record<string, unknown>[])[1]!['onClick'] = 'rm -rf /';
    expect(codeOf(snapshot)).toBe('schema');
  });

  it('rejects a non-positive or non-integral revision', () => {
    for (const revision of [0, -1, 1.5, '1']) {
      expect(codeOf({ ...baseSnapshot(), revision })).toBe('revision');
    }
  });

  it('rejects a wrong version tag', () => {
    expect(codeOf({ ...baseSnapshot(), v: 1 })).toBe('schema');
  });

  it('rejects unsafe integers in rects', () => {
    const snapshot = baseSnapshot();
    const geometry = (snapshot['nodes'] as Record<string, unknown>[])[1]!['geometry'] as Record<
      string,
      Record<string, unknown>
    >;
    geometry['intendedRect']!['value'] = {
      row: Number.MAX_SAFE_INTEGER,
      column: 0,
      width: 1,
      height: 4,
    };
    expect(codeOf(snapshot)).toBe('bad-rect');
  });

  it('rejects negative rect extents', () => {
    const snapshot = baseSnapshot();
    const geometry = (snapshot['nodes'] as Record<string, unknown>[])[1]!['geometry'] as Record<
      string,
      Record<string, unknown>
    >;
    geometry['intendedRect']!['value'] = {
      row: 0,
      column: 0,
      width: -5,
      height: 1,
    };
    expect(codeOf(snapshot)).toBe('bad-rect');
  });

  it('rejects a non-empty visible rectangle outside the viewport', () => {
    const snapshot = baseSnapshot();
    const geometry = (snapshot['nodes'] as Record<string, unknown>[])[1]!['geometry'] as Record<
      string,
      Record<string, unknown>
    >;
    geometry['intendedRect']!['value'] = { row: 9_000, column: 9_000, width: 5, height: 5 };
    geometry['visibleRect']!['value'] = { row: 9_000, column: 9_000, width: 5, height: 5 };
    expect(codeOf(snapshot)).toBe('bad-rect');
  });

  it('rejects a visible rectangle that escapes its intended rectangle', () => {
    const snapshot = baseSnapshot();
    const geometry = (snapshot['nodes'] as Record<string, unknown>[])[1]!['geometry'] as Record<
      string,
      Record<string, unknown>
    >;
    geometry['intendedRect']!['value'] = { row: 2, column: 4, width: 3, height: 1 };
    geometry['visibleRect']!['value'] = { row: 2, column: 4, width: 6, height: 1 };
    expect(codeOf(snapshot)).toBe('bad-rect');
  });

  it('rejects a cursor outside the viewport', () => {
    expect(codeOf({ ...baseSnapshot(), cursor: { row: 24, column: 0, visible: true } })).toBe(
      'bad-rect',
    );
  });

  it('rejects a text range that ends before it starts', () => {
    const snapshot = baseSnapshot();
    (snapshot['nodes'] as Record<string, unknown>[])[1]!['textRanges'] = [
      { startOffset: 5, endOffset: 2, rect: { row: 0, column: 0, width: 1, height: 1 } },
    ];
    expect(codeOf(snapshot)).toBe('bad-rect');
  });
});

describe('validateSnapshot — hostile input', () => {
  it('rejects a snapshot whose fields are getters, without invoking them', () => {
    let invoked = false;
    const hostile = {
      ...baseSnapshot(),
      get revision(): number {
        invoked = true;
        return 1;
      },
    };
    expect(codeOf(hostile)).toBe('schema');
    expect(invoked).toBe(false);
  });

  it('rejects a self-referential structure instead of hanging', () => {
    const hostile = baseSnapshot() as Record<string, unknown>;
    hostile['self'] = hostile;
    expect(codeOf(hostile)).toBe('schema');
  });

  it('rejects a __proto__ payload without polluting Object.prototype', () => {
    const hostile = JSON.parse('{"__proto__":{"polluted":true},"v":1}') as unknown;
    expect(codeOf(hostile)).toBe('schema');
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('rejects unpaired surrogates in names', () => {
    const snapshot = baseSnapshot();
    (snapshot['nodes'] as Record<string, unknown>[])[1]!['name'] = 'OK\uD800';
    expect(codeOf(snapshot)).toBe('schema');
  });

  it('rejects nesting deeper than the projection ceiling', () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i < 200; i += 1) deep = { deep };
    expect(codeOf(deep, withLimits({ maxDepth: 16 }))).toBe('depth');
  });

  it('rejects non-object inputs', () => {
    for (const value of [null, 42, 'snapshot', [], true]) {
      expect(codeOf(value)).toBe('schema');
    }
  });

  it('never throws, whatever it is handed', () => {
    const inputs: unknown[] = [
      undefined,
      Number.NaN,
      Symbol('x'),
      () => 1,
      new Proxy(baseSnapshot(), {}),
      new Map(),
      Object.create(null),
    ];
    for (const value of inputs) {
      expect(() => validateSnapshot(value, DEFAULT_LIMITS)).not.toThrow();
      expect(codeOf(value)).not.toBe('ok');
    }
  });
});
