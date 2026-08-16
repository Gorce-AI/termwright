import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, MAX_LOG_ATTRS, validateLogRecord } from '@termwright/protocol';
import { normalizeLogRecord, toLogLevel, truncateToBytes } from './normalize.js';
import { resolveRedaction } from './redact.js';

const options = { seq: 7, now: () => 1_755_300_000_000 };

function normalize(input: Record<string, unknown>): ReturnType<typeof normalizeLogRecord> {
  return normalizeLogRecord(input, options);
}

describe('toLogLevel', () => {
  it('passes protocol levels through', () => {
    expect(toLogLevel('warn')).toBe('warn');
    expect(toLogLevel('  ERROR ')).toBe('error');
  });

  it('maps ecosystem aliases', () => {
    expect(toLogLevel('silly')).toBe('trace');
    expect(toLogLevel('verbose')).toBe('trace');
    expect(toLogLevel('http')).toBe('debug');
    expect(toLogLevel('warning')).toBe('warn');
    expect(toLogLevel('critical')).toBe('fatal');
    expect(toLogLevel('emerg')).toBe('fatal');
  });

  it('maps pino-style numbers', () => {
    expect(toLogLevel(10)).toBe('trace');
    expect(toLogLevel(20)).toBe('debug');
    expect(toLogLevel(30)).toBe('info');
    expect(toLogLevel(40)).toBe('warn');
    expect(toLogLevel(50)).toBe('error');
    expect(toLogLevel(60)).toBe('fatal');
    expect(toLogLevel(35)).toBe('info');
  });

  it('falls back for anything unrecognised', () => {
    expect(toLogLevel(undefined)).toBe('info');
    expect(toLogLevel({}, 'debug')).toBe('debug');
    expect(toLogLevel('nonsense', 'warn')).toBe('warn');
  });
});

describe('truncateToBytes', () => {
  it('leaves short text alone', () => {
    expect(truncateToBytes('short', 100)).toBe('short');
  });

  it('respects a UTF-8 byte budget, not a character count', () => {
    const result = truncateToBytes('ż'.repeat(50), 20);
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(20);
  });

  it('never splits an astral character', () => {
    const result = truncateToBytes('👍'.repeat(20), 15);
    expect(result).toBe(result.normalize());
    expect([...result].every((ch) => ch.codePointAt(0) !== 0xfffd)).toBe(true);
  });
});

describe('normalizeLogRecord', () => {
  it('always produces a protocol-valid record', () => {
    const record = normalize({ level: 'warn', message: 'hi' });
    expect(validateLogRecord(record, DEFAULT_LIMITS).ok).toBe(true);
    expect(record.ts).toBe(1_755_300_000_000);
    expect(record.seq).toBe(7);
  });

  it('accepts pino and winston spellings of message and logger', () => {
    expect(normalize({ msg: 'from pino' }).message).toBe('from pino');
    expect(normalize({ name: 'http' }).logger).toBe('http');
    expect(normalize({ message: 'wins', msg: 'loses' }).message).toBe('wins');
  });

  it('accepts a Date, an epoch number and an ISO string as the timestamp', () => {
    const iso = '2026-08-16T10:00:00.000Z';
    expect(normalize({ time: new Date(iso) }).ts).toBe(Date.parse(iso));
    expect(normalize({ timestamp: iso }).ts).toBe(Date.parse(iso));
    expect(normalize({ ts: 1_700_000_000_000 }).ts).toBe(1_700_000_000_000);
  });

  it('falls back to the clock for an unusable timestamp', () => {
    expect(normalize({ time: 'not a date' }).ts).toBe(1_755_300_000_000);
    expect(normalize({ time: -5 }).ts).toBe(1_755_300_000_000);
  });

  it('flattens nested attributes with dot notation', () => {
    const record = normalize({ message: 'x', attrs: { db: { host: 'localhost', port: 5432 } } });
    expect(record.attrs).toEqual({ 'db.host': 'localhost', 'db.port': 5432 });
  });

  it('joins scalar arrays rather than exploding them', () => {
    const record = normalize({ message: 'x', attrs: { tags: ['a', 'b', 'c'] } });
    expect(record.attrs?.['tags']).toBe('a,b,c');
  });

  it('keeps the useful parts of an Error', () => {
    const record = normalize({ message: 'failed', attrs: { err: new TypeError('bad input') } });
    expect(record.attrs?.['err.name']).toBe('TypeError');
    expect(record.attrs?.['err.message']).toBe('bad input');
    expect(typeof record.attrs?.['err.stack']).toBe('string');
  });

  it('promotes unrecognised top-level keys to attributes', () => {
    const record = normalize({ message: 'x', requestId: 'abc', durationMs: 12 });
    expect(record.attrs).toEqual({ requestId: 'abc', durationMs: 12 });
  });

  it('does not turn protocol fields into attributes', () => {
    const record = normalize({ message: 'x', seq: 99, revision: 3, level: 'warn' });
    expect(record.attrs).toBeUndefined();
    expect(record.seq).toBe(7);
    expect(record.revision).toBe(3);
  });

  it('coerces a non-string message', () => {
    expect(normalize({ message: { a: 1 } }).message).toBe('{"a":1}');
    expect(normalize({ message: 42 }).message).toBe('42');
    expect(normalize({ message: new Error('boom') }).message).toBe('Error: boom');
    expect(normalize({}).message).toBe('');
  });

  it('redacts at normalisation time', () => {
    const record = normalize({ message: 'Bearer abcdef1234567890abcdef', attrs: { token: 'x' } });
    expect(record.message).not.toContain('abcdef1234567890');
    expect(record.attrs?.['token']).toBe('[redacted]');
  });

  it('drops attributes beyond the ceiling instead of failing', () => {
    const attrs: Record<string, number> = {};
    for (let i = 0; i < MAX_LOG_ATTRS * 3; i += 1) attrs[`k${i}`] = i;
    const record = normalize({ message: 'x', attrs });

    expect(Object.keys(record.attrs ?? {}).length).toBeLessThanOrEqual(MAX_LOG_ATTRS);
    expect(validateLogRecord(record, DEFAULT_LIMITS).ok).toBe(true);
  });

  it('truncates an over-long message instead of failing', () => {
    const record = normalize({ message: 'A'.repeat(200_000) });
    expect(validateLogRecord(record, DEFAULT_LIMITS).ok).toBe(true);
    expect(record.message.length).toBeLessThan(200_000);
  });

  it('fits a record that is over the byte ceiling by shedding attributes', () => {
    const attrs: Record<string, string> = {};
    for (let i = 0; i < 40; i += 1) attrs[`k${i}`] = 'v'.repeat(2000);
    const record = normalizeLogRecord(
      { message: 'big', attrs },
      { ...options, limits: { ...DEFAULT_LIMITS, maxLogRecordBytes: 4096 } },
    );
    const result = validateLogRecord(record, { ...DEFAULT_LIMITS, maxLogRecordBytes: 4096 });
    expect(result.ok).toBe(true);
  });

  it('returns a frozen record', () => {
    expect(Object.isFrozen(normalize({ message: 'x' }))).toBe(true);
  });

  it('can run with redaction disabled', () => {
    const record = normalizeLogRecord(
      { message: 'x', attrs: { password: 'hunter2' } },
      { ...options, redaction: resolveRedaction({ enabled: false }) },
    );
    expect(record.attrs?.['password']).toBe('hunter2');
  });
});
