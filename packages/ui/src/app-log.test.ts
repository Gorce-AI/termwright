import { describe, expect, it } from 'vitest';
import { LOG_LEVELS } from '@termwright/protocol';
import { isMarked, parseAppLog, passesLevel, UI_LOG_LEVELS, type AppLogView } from './app-log.js';

const row = (partial: Partial<AppLogView> = {}): AppLogView => ({
  t: 0,
  source: 'adapter',
  level: 'info',
  message: 'hello',
  ...partial,
});

describe('the level ladder', () => {
  it('is identical to the protocol’s, which it is not allowed to fork', () => {
    // The browser bundle cannot import the protocol (it is Node-only), so the
    // ladder is declared locally. This is the check that keeps it honest.
    expect([...UI_LOG_LEVELS]).toEqual([...LOG_LEVELS]);
  });
});

describe('parseAppLog', () => {
  it('reads a followed file line, and gives it no level', () => {
    expect(parseAppLog({ source: 'file', label: 'server.log', line: 'ERROR boom', timeMs: 120 })).toEqual({
      t: 120,
      source: 'file',
      level: null,
      message: 'ERROR boom',
      label: 'server.log',
    });
  });

  it('reads an adapter record with its structure intact', () => {
    expect(
      parseAppLog({
        source: 'adapter',
        timeMs: 300,
        record: {
          ts: 1_700_000_000_000,
          level: 'warn',
          message: 'pool exhausted',
          logger: 'db.pool',
          seq: 12,
          revision: 4,
          attrs: { size: 10, blocking: true, note: null },
        },
      }),
    ).toEqual({
      t: 300,
      source: 'adapter',
      level: 'warn',
      message: 'pool exhausted',
      logger: 'db.pool',
      seq: 12,
      revision: 4,
      attrs: { size: 10, blocking: true, note: null },
    });
  });

  it('accepts the flattened wire and archive form', () => {
    expect(parseAppLog({ t: 5, source: 'adapter', level: 'error', message: 'nope' })?.level).toBe('error');
  });

  it('rejects a row with no time or no message', () => {
    expect(parseAppLog({ source: 'file', line: 'orphan' })).toBeNull();
    expect(parseAppLog({ t: 1, source: 'file' })).toBeNull();
    expect(parseAppLog({ t: Number.NaN, message: 'x' })).toBeNull();
    expect(parseAppLog('a line')).toBeNull();
    expect(parseAppLog(null)).toBeNull();
  });

  it('drops an unknown level rather than inventing one', () => {
    expect(parseAppLog({ t: 1, source: 'adapter', level: 'critical', message: 'x' })?.level).toBeNull();
  });

  it('never infers severity from the text of a file line', () => {
    for (const line of ['ERROR: disk full', 'WARN something', 'fatal: nope']) {
      expect(parseAppLog({ t: 1, source: 'file', line })?.level, line).toBeNull();
    }
  });

  it('bounds hostile rows', () => {
    const attrs: Record<string, unknown> = {};
    for (let index = 0; index < 500; index += 1) attrs[`k${index}`] = index;
    const parsed = parseAppLog({
      t: 1,
      source: 'adapter',
      level: 'info',
      message: 'x'.repeat(50_000),
      attrs,
    });
    expect(parsed?.message.length).toBe(4_096);
    expect(Object.keys(parsed?.attrs ?? {}).length).toBe(64);
  });

  it('drops attribute values that are not flat scalars', () => {
    const parsed = parseAppLog({
      t: 1,
      source: 'adapter',
      message: 'x',
      attrs: { good: 1, nested: { a: 1 }, list: [1, 2], bad: Number.NaN },
    });
    expect(parsed?.attrs).toEqual({ good: 1 });
  });
});

describe('marking and filtering', () => {
  it('marks only warn and worse', () => {
    expect(isMarked(row({ level: 'info' }))).toBe(false);
    expect(isMarked(row({ level: 'warn' }))).toBe(true);
    expect(isMarked(row({ level: 'error' }))).toBe(true);
    expect(isMarked(row({ level: 'fatal' }))).toBe(true);
    expect(isMarked(row({ level: null, source: 'file' }))).toBe(false);
  });

  it('filters by severity threshold', () => {
    expect(passesLevel(row({ level: 'debug' }), 'info')).toBe(false);
    expect(passesLevel(row({ level: 'info' }), 'info')).toBe(true);
    expect(passesLevel(row({ level: 'error' }), 'info')).toBe(true);
    expect(passesLevel(row({ level: 'debug' }), 'all')).toBe(true);
  });

  it('always shows unleveled file lines, whatever the threshold', () => {
    expect(passesLevel(row({ level: null, source: 'file' }), 'error')).toBe(true);
  });
});
