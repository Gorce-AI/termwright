import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, type ProtocolLimits } from './limits.js';
import {
  LOG_LEVELS,
  LOG_LEVEL_SEVERITY,
  MAX_LOG_ATTRS,
  type LogRecord,
  validateLogRecord,
} from './logs.js';

function baseRecord(): Record<string, unknown> {
  return {
    ts: 1_755_300_000_000,
    level: 'info',
    message: 'server listening',
    seq: 0,
  };
}

function withLimits(overrides: Partial<ProtocolLimits>): ProtocolLimits {
  return Object.freeze({ ...DEFAULT_LIMITS, ...overrides });
}

function codeOf(value: unknown, limits: ProtocolLimits = DEFAULT_LIMITS): string {
  const result = validateLogRecord(value, limits);
  return result.ok ? 'ok' : result.code;
}

describe('log levels', () => {
  it('orders severity from trace to fatal', () => {
    const ordered = [...LOG_LEVELS].map((level) => LOG_LEVEL_SEVERITY[level]);
    expect(ordered).toEqual([...ordered].sort((a, b) => a - b));
    expect(LOG_LEVEL_SEVERITY.error).toBeGreaterThan(LOG_LEVEL_SEVERITY.warn);
  });
});

describe('validateLogRecord — happy path', () => {
  it('accepts a minimal record', () => {
    expect(codeOf(baseRecord())).toBe('ok');
  });

  it('accepts every level', () => {
    for (const level of LOG_LEVELS) {
      expect(codeOf({ ...baseRecord(), level })).toBe('ok');
    }
  });

  it('accepts optional logger, revision and flat scalar attrs', () => {
    const record = {
      ...baseRecord(),
      logger: 'db.pool',
      revision: 12,
      attrs: { port: 8080, ready: true, host: 'localhost', detail: null },
    };
    expect(codeOf(record)).toBe('ok');
  });

  it('returns a deep-frozen record sharing nothing with the input', () => {
    const input = { ...baseRecord(), attrs: { a: 1 } };
    const result = validateLogRecord(input, DEFAULT_LIMITS);
    if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);

    const record: LogRecord = result.record;
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.attrs)).toBe(true);
    expect(record.attrs).not.toBe(input.attrs);
  });

  it('accepts seq 0 so a first record is representable', () => {
    expect(codeOf({ ...baseRecord(), seq: 0 })).toBe('ok');
  });
});

describe('validateLogRecord — rejections', () => {
  it('rejects an unknown level', () => {
    expect(codeOf({ ...baseRecord(), level: 'verbose' })).toBe('schema');
    expect(codeOf({ ...baseRecord(), level: 'INFO' })).toBe('schema');
  });

  it('rejects unknown properties rather than ignoring them', () => {
    expect(codeOf({ ...baseRecord(), stack: 'rm -rf /' })).toBe('schema');
  });

  it('rejects a missing or non-positive timestamp', () => {
    const { ts: _ts, ...withoutTs } = baseRecord();
    expect(codeOf(withoutTs)).toBe('schema');
    expect(codeOf({ ...baseRecord(), ts: 0 })).toBe('schema');
    expect(codeOf({ ...baseRecord(), ts: -1 })).toBe('schema');
    expect(codeOf({ ...baseRecord(), ts: 1.5 })).toBe('schema');
  });

  it('rejects a missing or negative seq', () => {
    const { seq: _seq, ...withoutSeq } = baseRecord();
    expect(codeOf(withoutSeq)).toBe('schema');
    expect(codeOf({ ...baseRecord(), seq: -1 })).toBe('schema');
  });

  it('rejects a non-positive revision', () => {
    expect(codeOf({ ...baseRecord(), revision: 0 })).toBe('revision');
    expect(codeOf({ ...baseRecord(), revision: -3 })).toBe('revision');
  });

  it('rejects a message over the string ceiling, counting UTF-8 bytes', () => {
    const record = { ...baseRecord(), message: 'ż'.repeat(6) };
    expect(codeOf(record, withLimits({ maxStringBytes: 10 }))).toBe('string-bytes');
    expect(codeOf(record, withLimits({ maxStringBytes: 12 }))).toBe('ok');
  });

  it('rejects a record over the byte ceiling', () => {
    const record = { ...baseRecord(), message: 'A'.repeat(4096) };
    expect(codeOf(record, withLimits({ maxLogRecordBytes: 512 }))).toBe('bytes');
  });

  it('rejects nested attrs — bridges must flatten', () => {
    expect(codeOf({ ...baseRecord(), attrs: { nested: { a: 1 } } })).toBe('schema');
    expect(codeOf({ ...baseRecord(), attrs: { list: [1, 2] } })).toBe('schema');
  });

  it('rejects non-finite numeric attrs', () => {
    expect(codeOf({ ...baseRecord(), attrs: { n: Number.NaN } })).toBe('schema');
  });

  it('rejects more attrs than the ceiling allows', () => {
    const attrs: Record<string, number> = {};
    for (let i = 0; i <= MAX_LOG_ATTRS; i += 1) attrs[`k${i}`] = i;
    expect(codeOf({ ...baseRecord(), attrs })).toBe('count');
  });

  it('rejects attrs that are not an object', () => {
    expect(codeOf({ ...baseRecord(), attrs: 'nope' })).toBe('schema');
    expect(codeOf({ ...baseRecord(), attrs: [1, 2] })).toBe('schema');
  });

  it('rejects non-object records', () => {
    for (const value of [null, 42, 'log', [], true]) {
      expect(codeOf(value)).toBe('schema');
    }
  });
});

describe('validateLogRecord — hostile input', () => {
  it('rejects a getter-backed record without invoking it', () => {
    let invoked = false;
    const hostile = {
      ...baseRecord(),
      get message(): string {
        invoked = true;
        return 'boom';
      },
    };
    expect(codeOf(hostile)).toBe('schema');
    expect(invoked).toBe(false);
  });

  it('rejects a cyclic record instead of hanging', () => {
    const hostile = baseRecord();
    hostile['attrs'] = hostile;
    expect(codeOf(hostile)).toBe('schema');
  });

  it('rejects a __proto__ payload without polluting Object.prototype', () => {
    expect(codeOf(JSON.parse('{"__proto__":{"tainted":true},"ts":1}'))).toBe('schema');
    expect(({} as Record<string, unknown>)['tainted']).toBeUndefined();
  });

  it('rejects unpaired surrogates in the message', () => {
    expect(codeOf({ ...baseRecord(), message: 'oops\uD800' })).toBe('schema');
  });

  it('never throws, whatever it is handed', () => {
    for (const value of [undefined, Symbol('s'), () => 1, new Map(), new Proxy({}, {})]) {
      expect(() => validateLogRecord(value, DEFAULT_LIMITS)).not.toThrow();
      expect(codeOf(value)).not.toBe('ok');
    }
  });
});
