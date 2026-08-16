import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from './limits.js';
import { encodeFrame, createFrameDecoder } from './framing.js';
import { parseAdapterMessage, parseDriverMessage } from './messages.js';

const LIMITS = DEFAULT_LIMITS;

function validSnapshot(): Record<string, unknown> {
  return {
    v: 1,
    sessionId: 's1',
    revision: 3,
    columns: 80,
    rows: 24,
    rootIds: ['root'],
    nodes: [{ id: 'root', role: 'region', name: 'main' }],
  };
}

function hello(): Record<string, unknown> {
  return {
    type: 'hello',
    protocol: 'termwright/1',
    token: 'deadbeef',
    adapter: { name: '@termwright/ink', version: '0.1.0' },
    capabilities: ['tree', 'bounds'],
  };
}

function helloAck(): Record<string, unknown> {
  return {
    type: 'hello-ack',
    protocol: 'termwright/1',
    sessionId: 's1',
    limits: { ...LIMITS },
    subscribe: 'snapshots',
    marker: { enabled: true },
  };
}

/** Failure code, or 'ok' when the message parsed. */
function adapterCode(value: unknown): string {
  const result = parseAdapterMessage(value, LIMITS);
  return result.ok ? 'ok' : result.code;
}

function driverCode(value: unknown): string {
  const result = parseDriverMessage(value, LIMITS);
  return result.ok ? 'ok' : result.code;
}

describe('parseAdapterMessage', () => {
  it('accepts each adapter → driver message', () => {
    expect(adapterCode(hello())).toBe('ok');
    expect(adapterCode({ type: 'revision-commit', revision: 7 })).toBe('ok');
    expect(adapterCode({ type: 'snapshot', snapshot: validSnapshot() })).toBe('ok');
    expect(adapterCode({ type: 'get-tree-result', requestId: 1, snapshot: validSnapshot() })).toBe(
      'ok',
    );
    expect(adapterCode({ type: 'get-tree-result', requestId: 1, error: 'no such revision' })).toBe(
      'ok',
    );
    expect(adapterCode({ type: 'error', code: 'malformed', message: 'bad frame' })).toBe('ok');
  });

  it('returns a frozen message', () => {
    const result = parseAdapterMessage(hello(), LIMITS);
    if (!result.ok) throw new Error(result.detail);
    expect(Object.isFrozen(result.message)).toBe(true);
  });

  it('flags a foreign protocol version distinctly from malformed input', () => {
    expect(adapterCode({ ...hello(), protocol: 'termwright/2' })).toBe('bad-version');
    expect(driverCode({ ...helloAck(), protocol: 'termwright/99' })).toBe('bad-version');
  });

  it('rejects unknown or missing message types', () => {
    expect(adapterCode({ type: 'exec', cmd: 'rm -rf /' })).toBe('malformed');
    expect(adapterCode({})).toBe('malformed');
    expect(adapterCode({ type: 42 })).toBe('malformed');
    expect(adapterCode(null)).toBe('malformed');
  });

  it('rejects unknown properties on a known message', () => {
    expect(adapterCode({ ...hello(), extra: true })).toBe('malformed');
  });

  it('rejects a hello with missing or empty fields', () => {
    const { token: _token, ...withoutToken } = hello();
    expect(adapterCode(withoutToken)).toBe('malformed');
    expect(adapterCode({ ...hello(), token: '' })).toBe('malformed');
    expect(adapterCode({ ...hello(), adapter: { name: 'x' } })).toBe('malformed');
  });

  it('rejects an unknown capability rather than ignoring it', () => {
    expect(adapterCode({ ...hello(), capabilities: ['tree', 'root-shell'] })).toBe('malformed');
  });

  it('rejects a non-positive revision commit', () => {
    expect(adapterCode({ type: 'revision-commit', revision: 0 })).toBe('malformed');
    expect(adapterCode({ type: 'revision-commit', revision: -1 })).toBe('malformed');
    expect(adapterCode({ type: 'revision-commit', revision: 1.5 })).toBe('malformed');
  });

  it('requires exactly one of snapshot or error on get-tree-result', () => {
    expect(adapterCode({ type: 'get-tree-result', requestId: 1 })).toBe('malformed');
    expect(
      adapterCode({ type: 'get-tree-result', requestId: 1, snapshot: validSnapshot(), error: 'x' }),
    ).toBe('malformed');
  });

  it('validates the embedded snapshot and separates limits from malformation', () => {
    const broken = { ...validSnapshot(), nodes: [{ id: 'a', role: 'wat', name: 'a' }] };
    expect(adapterCode({ type: 'snapshot', snapshot: broken })).toBe('malformed');

    const heavy = {
      ...validSnapshot(),
      nodes: [
        { id: 'root', role: 'region', name: 'main' },
        ...Array.from({ length: 50 }, (_, i) => ({
          id: `n${i}`,
          parentId: 'root',
          role: 'text',
          name: `n${i}`,
        })),
      ],
    };
    const result = parseAdapterMessage(
      { type: 'snapshot', snapshot: heavy },
      { ...LIMITS, maxNodes: 4 },
    );
    expect(result.ok ? 'ok' : result.code).toBe('limit-exceeded');
  });

  it('rejects hostile payloads without executing them', () => {
    let invoked = false;
    const hostile = {
      type: 'revision-commit',
      get revision(): number {
        invoked = true;
        return 1;
      },
    };
    expect(adapterCode(hostile)).toBe('malformed');
    expect(invoked).toBe(false);

    const cyclic: Record<string, unknown> = { type: 'revision-commit', revision: 1 };
    cyclic['self'] = cyclic;
    expect(adapterCode(cyclic)).toBe('malformed');

    expect(adapterCode(JSON.parse('{"__proto__":{"x":1},"type":"error"}'))).toBe('malformed');
    expect(({} as Record<string, unknown>)['x']).toBeUndefined();
  });

  it('never throws, whatever it is handed', () => {
    for (const value of [undefined, Symbol('s'), () => 1, new Map(), 1n, new Proxy({}, {})]) {
      expect(() => parseAdapterMessage(value, LIMITS)).not.toThrow();
      expect(adapterCode(value)).not.toBe('ok');
    }
  });
});

describe('parseAdapterMessage — log records', () => {
  function logMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      type: 'log',
      record: { ts: 1_755_300_000_000, level: 'warn', message: 'slow query', seq: 3, ...overrides },
    };
  }

  it('accepts a log message', () => {
    expect(adapterCode(logMessage())).toBe('ok');
  });

  it('carries the record through frozen', () => {
    const result = parseAdapterMessage(logMessage(), LIMITS);
    if (!result.ok) throw new Error(result.detail);
    if (result.message.type !== 'log') throw new Error('expected a log message');
    expect(result.message.record.level).toBe('warn');
    expect(Object.isFrozen(result.message.record)).toBe(true);
  });

  it('rejects a malformed record as malformed, not as a limit', () => {
    expect(adapterCode(logMessage({ level: 'verbose' }))).toBe('malformed');
  });

  it('reports an oversized record as limit-exceeded', () => {
    const result = parseAdapterMessage(logMessage({ message: 'A'.repeat(2048) }), {
      ...LIMITS,
      maxLogRecordBytes: 256,
    });
    expect(result.ok ? 'ok' : result.code).toBe('limit-exceeded');
  });

  it('rejects unknown properties on the envelope', () => {
    expect(adapterCode({ ...logMessage(), urgent: true })).toBe('malformed');
  });

  it('rejects a log message arriving on the driver side', () => {
    expect(driverCode(logMessage())).toBe('malformed');
  });
});

describe('parseAdapterMessage — tree deltas', () => {
  function treeDelta(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      type: 'tree-delta',
      baseRevision: 4,
      revision: 5,
      changed: [{ id: 'ok', parentId: 'root', role: 'button', name: 'Approve' }],
      removed: ['stale'],
      ...overrides,
    };
  }

  it('accepts a tree-delta message', () => {
    expect(adapterCode(treeDelta())).toBe('ok');
  });

  it('exposes the delta fields on the message itself', () => {
    const result = parseAdapterMessage(treeDelta(), LIMITS);
    if (!result.ok) throw new Error(result.detail);
    if (result.message.type !== 'tree-delta') throw new Error('expected a tree-delta');
    expect(result.message.baseRevision).toBe(4);
    expect(result.message.revision).toBe(5);
    expect(result.message.removed).toEqual(['stale']);
    expect(Object.isFrozen(result.message)).toBe(true);
  });

  it('rejects a delta that does not move the revision forward', () => {
    expect(adapterCode(treeDelta({ baseRevision: 5, revision: 5 }))).toBe('malformed');
  });

  it('rejects unknown properties on the envelope', () => {
    expect(adapterCode(treeDelta({ speculative: true }))).toBe('malformed');
  });

  it('reports an oversized delta as limit-exceeded', () => {
    const result = parseAdapterMessage(
      treeDelta({ changed: [{ id: 'a', role: 'button', name: 'A'.repeat(4096) }] }),
      { ...LIMITS, maxSnapshotBytes: 512 },
    );
    expect(result.ok ? 'ok' : result.code).toBe('limit-exceeded');
  });

  it('rejects a tree-delta arriving on the driver side', () => {
    expect(driverCode(treeDelta())).toBe('malformed');
  });
});

describe('parseDriverMessage', () => {
  it('accepts each driver → adapter message', () => {
    expect(driverCode(helloAck())).toBe('ok');
    expect(driverCode({ type: 'get-tree', requestId: 0 })).toBe('ok');
    expect(driverCode({ type: 'get-tree', requestId: 1, revision: 12 })).toBe('ok');
    expect(driverCode({ type: 'error', code: 'bad-token', message: 'nope' })).toBe('ok');
  });

  it('rejects adapter messages arriving on the driver side and vice versa', () => {
    expect(driverCode(hello())).toBe('malformed');
    expect(adapterCode(helloAck())).toBe('malformed');
  });

  it('rejects a hello-ack carrying malformed limits', () => {
    expect(driverCode({ ...helloAck(), limits: { ...LIMITS, maxNodes: -1 } })).toBe('malformed');
    expect(driverCode({ ...helloAck(), limits: { maxNodes: 1 } })).toBe('malformed');
  });

  it('accepts subscribe: diffs', () => {
    expect(driverCode({ ...helloAck(), subscribe: 'diffs' })).toBe('ok');
  });

  it('accepts a hello-ack with a log budget, and one without', () => {
    expect(driverCode(helloAck())).toBe('ok');
    expect(
      driverCode({
        ...helloAck(),
        logs: { enabled: true, maxRecordsPerSecond: 200, burst: 500 },
      }),
    ).toBe('ok');
  });

  it('accepts a hello-ack whose limits carry an unknown key', () => {
    // Limits are additive: a newer driver announcing a ceiling this build has
    // never heard of must not break the handshake. This is what let the log
    // limits ship without invalidating already published clients.
    const result = parseDriverMessage(
      { ...helloAck(), limits: { ...LIMITS, maxFutureThing: 7 } },
      LIMITS,
    );
    expect(result.ok ? 'ok' : result.code).toBe('ok');
    if (!result.ok) return;
    if (result.message.type !== 'hello-ack') throw new Error('expected hello-ack');
    // The unknown key is carried through rather than silently dropped, so a
    // consumer that does understand it still can.
    expect((result.message.limits as unknown as Record<string, unknown>)['maxFutureThing']).toBe(7);
    expect(result.message.limits.maxNodes).toBe(LIMITS.maxNodes);
  });

  it('still rejects a known limits key of the wrong type', () => {
    expect(driverCode({ ...helloAck(), limits: { ...LIMITS, maxNodes: 'lots' } })).toBe('malformed');
  });

  it('keeps closed sets strict even though limits are lenient', () => {
    expect(driverCode({ ...helloAck(), subscribe: 'everything' })).toBe('malformed');
    expect(adapterCode({ ...hello(), capabilities: ['tree', 'not-a-capability'] })).toBe(
      'malformed',
    );
  });

  it('ignores unknown envelope fields on any driver message', () => {
    // The driver is the trusted party: a newer one may add an optional field,
    // and every already published adapter must keep working.
    expect(driverCode({ ...helloAck(), futureField: { nested: true } })).toBe('ok');
    expect(driverCode({ type: 'get-tree', requestId: 1, futureField: 'x' })).toBe('ok');
    expect(driverCode({ type: 'error', code: 'internal', message: 'x', detail: 'extra' })).toBe(
      'ok',
    );
  });

  it('carries unknown envelope fields through to the caller', () => {
    const result = parseDriverMessage({ ...helloAck(), futureField: 42 }, LIMITS);
    if (!result.ok) throw new Error(result.detail);
    expect((result.message as unknown as Record<string, unknown>)['futureField']).toBe(42);
  });

  it('tolerates unknown fields in nested driver objects too', () => {
    expect(driverCode({ ...helloAck(), marker: { enabled: true, style: 'dcs' } })).toBe('ok');
    expect(
      driverCode({
        ...helloAck(),
        logs: { enabled: true, maxRecordsPerSecond: 10, burst: 5, sampling: 0.5 },
      }),
    ).toBe('ok');
  });

  it('keeps known driver fields strictly type-checked', () => {
    expect(driverCode({ ...helloAck(), sessionId: 42 })).toBe('malformed');
    expect(driverCode({ ...helloAck(), marker: { enabled: 'yes' } })).toBe('malformed');
    expect(driverCode({ type: 'get-tree', requestId: -1 })).toBe('malformed');
  });

  it('keeps closed sets closed even on the tolerant side', () => {
    expect(driverCode({ ...helloAck(), subscribe: 'everything' })).toBe('malformed');
    expect(driverCode({ type: 'error', code: 'not-a-code', message: 'x' })).toBe('malformed');
    expect(driverCode({ type: 'unheard-of', requestId: 1 })).toBe('malformed');
  });

  it('stays strict in the adapter → driver direction', () => {
    // Same message type, opposite direction: this one crosses the hostile
    // boundary, so an unknown field is a rejection.
    expect(adapterCode({ type: 'error', code: 'internal', message: 'x', detail: 'extra' })).toBe(
      'malformed',
    );
    expect(adapterCode({ ...hello(), futureField: 1 })).toBe('malformed');
  });

  it('rejects a malformed log budget', () => {
    expect(driverCode({ ...helloAck(), logs: { enabled: true } })).toBe('malformed');
    expect(
      driverCode({ ...helloAck(), logs: { enabled: true, maxRecordsPerSecond: 0, burst: 1 } }),
    ).toBe('malformed');
  });

  it('rejects an unknown subscription mode', () => {
    expect(driverCode({ ...helloAck(), subscribe: 'everything' })).toBe('malformed');
  });

  it('rejects a get-tree with an invalid revision', () => {
    expect(driverCode({ type: 'get-tree', requestId: 1, revision: 0 })).toBe('malformed');
  });
});

describe('framing and parsing together', () => {
  it('round-trips a snapshot message across the wire', () => {
    const message = { type: 'snapshot', snapshot: validSnapshot() };
    const decoder = createFrameDecoder(LIMITS.maxFrameBytes);
    const [decoded] = decoder.push(encodeFrame(message, LIMITS.maxFrameBytes));

    const result = parseAdapterMessage(decoded, LIMITS);
    if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
    expect(result.message).toEqual(message);
  });
});
