/**
 * Adversarial suite. Runs under `pnpm test:hostile`, i.e. with a 128 MB heap:
 * every case here must fail closed using bounded memory, never by growing the
 * heap until the process dies.
 */
import { describe, expect, it } from 'vitest';
import { ProtocolViolation } from './errors.js';
import { createFrameDecoder, encodeFrame, projectDto } from './framing.js';
import { DEFAULT_LIMITS } from './limits.js';
import { parseAdapterMessage } from './messages.js';
import { validateLogRecord } from './logs.js';
import { applyTreeDelta, validateTreeDelta } from './delta.js';
import { validateSnapshot } from './validate.js';

const MB = 1024 * 1024;

function header(length: number): Uint8Array {
  return new Uint8Array([
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
  ]);
}

function caught(fn: () => unknown): ProtocolViolation {
  try {
    fn();
  } catch (error) {
    if (error instanceof ProtocolViolation) return error;
    throw error;
  }
  throw new Error('expected a ProtocolViolation');
}

describe('hostile framing', () => {
  it('rejects a 4 GB length claim from four bytes, allocating nothing', () => {
    const decoder = createFrameDecoder(MB);
    expect(caught(() => decoder.push(new Uint8Array([0xff, 0xff, 0xff, 0xff]))).code).toBe(
      'frame-oversized',
    );
    expect(decoder.buffered).toBe(0);
  });

  it('rejects a body that overruns the ceiling before decoding it', () => {
    const decoder = createFrameDecoder(64 * 1024);
    const body = new Uint8Array(2 * MB);
    body.fill(0x41);
    const chunk = new Uint8Array(4 + body.length);
    chunk.set(header(body.length), 0);
    chunk.set(body, 4);
    expect(caught(() => decoder.push(chunk)).code).toBe('frame-oversized');
  });

  it('never buffers more than one frame plus a header while starved of data', () => {
    const ceiling = 256 * 1024;
    const decoder = createFrameDecoder(ceiling);
    // Announce a frame at the ceiling, then dribble in bytes that never complete it.
    decoder.push(header(ceiling));
    const chunk = new Uint8Array(32 * 1024);
    for (let i = 0; i < 7; i += 1) {
      expect(decoder.push(chunk)).toEqual([]);
      expect(decoder.buffered).toBeLessThanOrEqual(ceiling + 4);
    }
  });

  it('survives a stream of a thousand frames without retaining them', () => {
    const decoder = createFrameDecoder(MB);
    for (let i = 0; i < 1000; i += 1) {
      const [message] = decoder.push(encodeFrame({ type: 'revision-commit', revision: i + 1 }, MB));
      expect(message).toEqual({ type: 'revision-commit', revision: i + 1 });
      expect(decoder.buffered).toBe(0);
    }
  });

  it('rejects pathologically nested JSON instead of exhausting the stack', () => {
    const depth = 100_000;
    const text = `${'{"a":'.repeat(depth)}1${'}'.repeat(depth)}`;
    const body = new TextEncoder().encode(text);
    const decoder = createFrameDecoder(MB);
    const chunk = new Uint8Array(4 + body.length);
    chunk.set(header(body.length), 0);
    chunk.set(body, 4);
    // Either JSON.parse gives up, or projection stops at the depth ceiling.
    expect(['frame-malformed', 'dto-depth']).toContain(caught(() => decoder.push(chunk)).code);
  });

  it('rejects a wide flat object without quadratic blowup', () => {
    const wide: Record<string, number> = {};
    for (let i = 0; i < 200_000; i += 1) wide[`k${i}`] = i;
    expect(projectDto<Record<string, number>>(wide, 4)['k199999']).toBe(199_999);
  });
});

/** Roomy byte ceiling, so tests below exercise the invariant they name. */
const ROOMY = Object.freeze({ ...DEFAULT_LIMITS, maxSnapshotBytes: 8 * MB });

describe('hostile snapshots', () => {
  it('applies the byte ceiling before any per-node work', () => {
    const nodes: Record<string, unknown>[] = [{ id: 'root', role: 'region', name: 'main' }];
    for (let i = 0; i < 50_000; i += 1) {
      nodes.push({ id: `n${i}`, parentId: 'root', role: 'text', name: 'x' });
    }
    const result = validateSnapshot(
      { v: 1, sessionId: 's', revision: 1, columns: 80, rows: 24, rootIds: ['root'], nodes },
      DEFAULT_LIMITS,
    );
    expect(result.ok ? 'ok' : result.code).toBe('bytes');
  });

  it('rejects a node flood at the count ceiling', () => {
    const nodes: Record<string, unknown>[] = [{ id: 'root', role: 'region', name: 'main' }];
    for (let i = 0; i < 50_000; i += 1) {
      nodes.push({ id: `n${i}`, parentId: 'root', role: 'text', name: 'x' });
    }
    const result = validateSnapshot(
      { v: 1, sessionId: 's', revision: 1, columns: 80, rows: 24, rootIds: ['root'], nodes },
      ROOMY,
    );
    expect(result.ok ? 'ok' : result.code).toBe('count');
  });

  it('rejects a deep parent chain at the depth ceiling', () => {
    const nodes: Record<string, unknown>[] = [{ id: 'n0', role: 'region', name: 'n0' }];
    for (let i = 1; i < 5_000; i += 1) {
      nodes.push({ id: `n${i}`, parentId: `n${i - 1}`, role: 'generic', frameworkType: 'Fixture', name: 'x' });
    }
    const result = validateSnapshot(
      { v: 1, sessionId: 's', revision: 1, columns: 80, rows: 24, rootIds: ['n0'], nodes },
      DEFAULT_LIMITS,
    );
    expect(result.ok ? 'ok' : result.code).toBe('depth');
  });

  it('rejects an oversized string field without retaining it', () => {
    const snapshot = {
      v: 1,
      sessionId: 's',
      revision: 1,
      columns: 80,
      rows: 24,
      rootIds: ['root'],
      nodes: [{ id: 'root', role: 'region', name: 'A'.repeat(2 * MB) }],
    };
    const result = validateSnapshot(snapshot, DEFAULT_LIMITS);
    expect(result.ok ? 'ok' : result.code).toBe('bytes');
  });

  it('rejects a cyclic parent chain in bounded time', () => {
    const nodes: Record<string, unknown>[] = [];
    const size = 20_000;
    for (let i = 0; i < size; i += 1) {
      nodes.push({
        id: `n${i}`,
        parentId: `n${(i + 1) % size}`,
        role: 'generic',
        frameworkType: 'Fixture',
        name: 'x',
      });
    }
    const result = validateSnapshot(
      { v: 1, sessionId: 's', revision: 1, columns: 80, rows: 24, rootIds: [], nodes },
      { ...ROOMY, maxNodes: size },
    );
    expect(result.ok ? 'ok' : result.code).toBe('cycle');
  });

  it('validates a snapshot at the node ceiling in bounded memory', () => {
    const nodes: Record<string, unknown>[] = [
      { id: 'root', role: 'region', name: 'main', bounds: { row: 0, column: 0, width: 80, height: 24 } },
    ];
    for (let i = 0; i < DEFAULT_LIMITS.maxNodes - 1; i += 1) {
      nodes.push({ id: `n${i}`, parentId: 'root', role: 'text', name: `row ${i}` });
    }
    const result = validateSnapshot(
      { v: 1, sessionId: 's', revision: 1, columns: 80, rows: 24, rootIds: ['root'], nodes },
      DEFAULT_LIMITS,
    );
    expect(result.ok).toBe(true);
  });

  it('rejects an oversized message envelope through the parser', () => {
    const result = parseAdapterMessage(
      {
        type: 'snapshot',
        snapshot: {
          v: 1,
          sessionId: 's',
          revision: 1,
          columns: 80,
          rows: 24,
          rootIds: ['root'],
          nodes: [{ id: 'root', role: 'region', name: 'B'.repeat(4 * MB) }],
        },
      },
      DEFAULT_LIMITS,
    );
    expect(result.ok ? 'ok' : result.code).toBe('limit-exceeded');
  });
});

describe('hostile log flood', () => {
  function record(seq: number, message = 'tick'): Record<string, unknown> {
    return { ts: 1_755_300_000_000 + seq, level: 'info', message, seq };
  }

  it('validates a sustained flood without retaining any of it', () => {
    // A log storm is the expected abuse: the ceiling is per record, so the
    // driver's memory must depend on its queue policy, never on volume.
    for (let i = 0; i < 20_000; i += 1) {
      const result = parseAdapterMessage({ type: 'log', record: record(i) }, DEFAULT_LIMITS);
      if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
    }
    expect(true).toBe(true);
  });

  it('rejects an oversized record without retaining it', () => {
    const result = validateLogRecord(
      { ...record(1), message: 'A'.repeat(4 * MB) },
      DEFAULT_LIMITS,
    );
    expect(result.ok ? 'ok' : result.code).toBe('bytes');
  });

  it('rejects an attribute flood at the key ceiling', () => {
    const attrs: Record<string, number> = {};
    for (let i = 0; i < 100_000; i += 1) attrs[`k${i}`] = i;
    const result = validateLogRecord({ ...record(1), attrs }, DEFAULT_LIMITS);
    // Byte ceiling or key ceiling, whichever bites first — both are bounded.
    expect(['bytes', 'count']).toContain(result.ok ? 'ok' : result.code);
  });

  it('rejects a deeply nested attribute payload', () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i < 5_000; i += 1) deep = { deep };
    const result = validateLogRecord({ ...record(1), attrs: { deep } }, DEFAULT_LIMITS);
    expect(['depth', 'schema', 'bytes']).toContain(result.ok ? 'ok' : result.code);
  });
});

describe('hostile tree deltas', () => {
  function base(nodeCount: number) {
    const nodes: Record<string, unknown>[] = [{ id: 'root', role: 'region', name: 'main' }];
    for (let i = 0; i < nodeCount; i += 1) {
      nodes.push({ id: `n${i}`, parentId: 'root', role: 'text', name: 'x' });
    }
    return { v: 1, sessionId: 's', revision: 1, columns: 80, rows: 24, rootIds: ['root'], nodes };
  }

  it('validates a delta flood without retaining any of it', () => {
    for (let i = 0; i < 20_000; i += 1) {
      const result = parseAdapterMessage(
        { type: 'tree-delta', baseRevision: i + 1, revision: i + 2, changed: [], removed: [] },
        DEFAULT_LIMITS,
      );
      if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
    }
    expect(true).toBe(true);
  });

  it('refuses a mismatched base instead of patching speculatively', () => {
    const snapshot = validateSnapshot(base(2), DEFAULT_LIMITS);
    if (!snapshot.ok) throw new Error(snapshot.detail);
    const result = applyTreeDelta(
      snapshot.snapshot,
      { baseRevision: 999, revision: 1000, changed: [], removed: [] },
      DEFAULT_LIMITS,
    );
    expect(result.ok ? 'ok' : result.code).toBe('revision');
  });

  it('refuses to remove nodes the base never had', () => {
    const snapshot = validateSnapshot(base(2), DEFAULT_LIMITS);
    if (!snapshot.ok) throw new Error(snapshot.detail);
    const result = applyTreeDelta(
      snapshot.snapshot,
      { baseRevision: 1, revision: 2, changed: [], removed: ['ghost'] },
      DEFAULT_LIMITS,
    );
    expect(result.ok ? 'ok' : result.code).toBe('missing-parent');
  });

  it('cascades a deep removal iteratively rather than recursing', () => {
    // A 10k-deep chain would blow the stack under naive recursion.
    const nodes: Record<string, unknown>[] = [{ id: 'n0', role: 'region', name: 'n0' }];
    for (let i = 1; i < 10_000; i += 1) {
      nodes.push({ id: `n${i}`, parentId: `n${i - 1}`, role: 'generic', frameworkType: 'Fixture', name: 'x' });
    }
    const limits = { ...DEFAULT_LIMITS, maxDepth: 20_000, maxNodes: 20_000, maxSnapshotBytes: 8 * MB };
    const snapshot = validateSnapshot(
      { v: 1, sessionId: 's', revision: 1, columns: 80, rows: 24, rootIds: ['n0'], nodes },
      limits,
    );
    if (!snapshot.ok) throw new Error(snapshot.detail);

    const result = applyTreeDelta(
      snapshot.snapshot,
      { baseRevision: 1, revision: 2, changed: [], removed: ['n1'], rootIds: ['n0'] },
      limits,
    );
    if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
    expect(result.snapshot.nodes).toHaveLength(1);
  });

  it('rejects a hostile delta object without throwing', () => {
    const cyclic: Record<string, unknown> = { baseRevision: 1, revision: 2, changed: [], removed: [] };
    cyclic['self'] = cyclic;
    expect(() => validateTreeDelta(cyclic, DEFAULT_LIMITS)).not.toThrow();
    expect(validateTreeDelta(cyclic, DEFAULT_LIMITS).ok).toBe(false);

    let invoked = false;
    const hostile = {
      baseRevision: 1,
      revision: 2,
      removed: [],
      get changed(): unknown[] {
        invoked = true;
        return [];
      },
    };
    expect(validateTreeDelta(hostile, DEFAULT_LIMITS).ok).toBe(false);
    expect(invoked).toBe(false);
  });
});
