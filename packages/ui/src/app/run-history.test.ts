import { describe, expect, it } from 'vitest';
import { asTestRow, formatWhen } from './run-history.js';

describe('formatWhen', () => {
  const now = Date.parse('2026-08-16T15:00:00');

  it('says today and yesterday rather than making you read a date', () => {
    expect(formatWhen(Date.parse('2026-08-16T09:04:00'), now)).toMatch(/^today /);
    expect(formatWhen(Date.parse('2026-08-15T09:04:00'), now)).toMatch(/^yesterday /);
  });

  it('falls back to a date for anything older', () => {
    const older = formatWhen(Date.parse('2026-08-12T09:04:00'), now);
    expect(older).not.toMatch(/today|yesterday/);
    expect(older).toMatch(/12/);
  });
});

describe('asTestRow', () => {
  it('is a rename, not a translation: a run’s test is the list’s test', () => {
    expect(
      asTestRow({
        id: 't1',
        title: 'logs in',
        file: '/repo/a.test.ts',
        status: 'failed',
        durationMs: 500,
        flaky: true,
        lostLogRecords: 4,
        traceRef: '/out/t1.twtrace',
        error: 'nope',
      }),
    ).toEqual({
      id: 't1',
      title: 'logs in',
      file: '/repo/a.test.ts',
      status: 'failed',
      durationMs: 500,
      flaky: true,
      lostLogRecords: 4,
      traceRef: '/out/t1.twtrace',
      error: 'nope',
    });
  });

  it('drops a file the manifest left empty rather than inventing one', () => {
    const row = asTestRow({
      id: 't1',
      title: 'x',
      file: '',
      status: 'passed',
      durationMs: 1,
      flaky: false,
      lostLogRecords: 0,
    });
    expect(row.file).toBeUndefined();
    expect(row.traceRef).toBeUndefined();
  });
});
