import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, type ProtocolLimits } from './limits.js';
import type { SemanticSnapshot } from './tree.js';
import { type ValidationErrorCode, validateSnapshot } from './validate.js';

/** A minimal valid snapshot: one root region containing one button. */
function baseSnapshot(): Record<string, unknown> {
  return {
    v: 1,
    sessionId: 's1',
    revision: 1,
    columns: 80,
    rows: 24,
    rootIds: ['root'],
    nodes: [
      { id: 'root', role: 'region', name: 'main', bounds: { row: 0, column: 0, width: 80, height: 24 } },
      {
        id: 'ok',
        parentId: 'root',
        role: 'button',
        name: 'OK',
        bounds: { row: 2, column: 4, width: 6, height: 1 },
        state: { focused: true },
      },
    ],
  };
}

function withLimits(overrides: Partial<ProtocolLimits>): ProtocolLimits {
  return Object.freeze({ ...DEFAULT_LIMITS, ...overrides });
}

/** Validate and assert failure, returning the error code for comparison. */
function codeOf(value: unknown, limits: ProtocolLimits = DEFAULT_LIMITS): ValidationErrorCode | 'ok' {
  const result = validateSnapshot(value, limits);
  return result.ok ? 'ok' : result.code;
}

describe('validateSnapshot — happy path', () => {
  it('accepts a well-formed snapshot', () => {
    const result = validateSnapshot(baseSnapshot(), DEFAULT_LIMITS);
    expect(result.ok).toBe(true);
  });

  it('returns a deep-frozen copy that shares nothing with the input', () => {
    const input = baseSnapshot();
    const result = validateSnapshot(input, DEFAULT_LIMITS);
    if (!result.ok) throw new Error(`expected ok, got ${result.code}: ${result.detail}`);

    const snapshot: SemanticSnapshot = result.snapshot;
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.nodes)).toBe(true);
    expect(Object.isFrozen(snapshot.nodes[0])).toBe(true);
    expect(Object.isFrozen(snapshot.nodes[1]?.bounds)).toBe(true);
    expect(snapshot.nodes).not.toBe(input['nodes']);
  });

  it('accepts a node without bounds (class-B/C adapters)', () => {
    const snapshot = baseSnapshot();
    delete (snapshot['nodes'] as Record<string, unknown>[])[1]!['bounds'];
    expect(codeOf(snapshot)).toBe('ok');
  });

  it('accepts an offscreen node when it is marked hidden', () => {
    const snapshot = baseSnapshot();
    const node = (snapshot['nodes'] as Record<string, unknown>[])[1]!;
    node['bounds'] = { row: 500, column: 500, width: 4, height: 1 };
    node['state'] = { hidden: true };
    expect(codeOf(snapshot)).toBe('ok');
  });

  it('accepts a node clipped by the viewport edge', () => {
    const snapshot = baseSnapshot();
    (snapshot['nodes'] as Record<string, unknown>[])[1]!['bounds'] = {
      row: -1,
      column: 78,
      width: 10,
      height: 3,
    };
    expect(codeOf(snapshot)).toBe('ok');
  });

  it('accepts every declared role and action', () => {
    const snapshot = baseSnapshot();
    (snapshot['nodes'] as Record<string, unknown>[])[1]!['actions'] = ['focus', 'activate'];
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
      { id: 'a', parentId: 'c', role: 'generic', name: 'a' },
      { id: 'b', parentId: 'a', role: 'generic', name: 'b' },
      { id: 'c', parentId: 'b', role: 'generic', name: 'c' },
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
    const nodes: Record<string, unknown>[] = [{ id: 'root', role: 'region', name: 'main' }];
    for (let i = 0; i < 20; i += 1) {
      nodes.push({ id: `n${i}`, parentId: 'root', role: 'text', name: `n${i}` });
    }
    snapshot['nodes'] = nodes;
    expect(codeOf(snapshot, withLimits({ maxNodes: 5 }))).toBe('count');
  });

  it('rejects a tree deeper than maxDepth', () => {
    const nodes: Record<string, unknown>[] = [{ id: 'n0', role: 'region', name: 'n0' }];
    for (let i = 1; i < 10; i += 1) {
      nodes.push({ id: `n${i}`, parentId: `n${i - 1}`, role: 'generic', name: `n${i}` });
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
    expect(codeOf(snapshot, withLimits({ maxStringBytes: 12 }))).toBe('ok');
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
    expect(codeOf({ ...baseSnapshot(), v: 2 })).toBe('schema');
  });

  it('rejects unsafe integers in rects', () => {
    const snapshot = baseSnapshot();
    (snapshot['nodes'] as Record<string, unknown>[])[1]!['bounds'] = {
      row: Number.MAX_SAFE_INTEGER,
      column: 0,
      width: 1,
      height: 4,
    };
    expect(codeOf(snapshot)).toBe('bad-rect');
  });

  it('rejects negative rect extents', () => {
    const snapshot = baseSnapshot();
    (snapshot['nodes'] as Record<string, unknown>[])[1]!['bounds'] = {
      row: 0,
      column: 0,
      width: -5,
      height: 1,
    };
    expect(codeOf(snapshot)).toBe('bad-rect');
  });

  it('rejects visible bounds entirely outside the viewport', () => {
    const snapshot = baseSnapshot();
    (snapshot['nodes'] as Record<string, unknown>[])[1]!['bounds'] = {
      row: 900,
      column: 900,
      width: 4,
      height: 1,
    };
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
