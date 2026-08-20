import { describe, expect, it } from 'vitest';
import type { TraceReader } from '@termwright/trace';
import { readTraceLogs } from './trace-logs.js';

/** A reader over an archive that recorded logs, yielding what the test hands it. */
function readerWith(
  records: readonly unknown[],
  options: {
    throwAfter?: number;
    dropped?: number;
    sources?: readonly unknown[];
    levels?: Record<string, unknown>;
  } = {},
): TraceReader {
  return {
    meta: {
      logs: {
        count: records.length,
        dropped: options.dropped ?? 0,
        sources: options.sources ?? [{ label: 'server.log' }],
        levels: options.levels ?? {},
      },
    },
    async *logs(): AsyncIterable<unknown> {
      let index = 0;
      for (const record of records) {
        if (options.throwAfter !== undefined && index >= options.throwAfter) {
          throw new Error('log file truncated mid-line');
        }
        index += 1;
        yield record;
      }
    },
  } as unknown as TraceReader;
}

const record = (partial: Record<string, unknown> = {}): Record<string, unknown> => ({
  t: 100,
  castOffset: 90,
  source: 'adapter',
  level: 'info',
  message: 'listening',
  ...partial,
});

describe('readTraceLogs', () => {
  it('reports an archive that recorded no logs as unavailable, not empty', async () => {
    const logs = await readTraceLogs({ meta: {} } as TraceReader);
    expect(logs.available).toBe(false);
    expect(logs.records).toEqual([]);
  });

  it('shows what the file holds when the summary is missing', async () => {
    // `meta.logs` is absent exactly when nothing was logged, so this archive is
    // damaged — hand-edited, or written by something else. The records are
    // evidence; the missing summary is not a reason to hide them.
    const reader = {
      meta: {},
      async *logs(): AsyncIterable<unknown> {
        yield record({ message: 'still here' });
      },
    } as unknown as TraceReader;

    const logs = await readTraceLogs(reader);
    expect(logs.available).toBe(true);
    expect(logs.records.map((entry) => entry.message)).toEqual(['still here']);
    expect(logs.total).toBe(1);
  });

  it('does not call the list complete when the summary and the file disagree', async () => {
    const reader = {
      meta: { logs: { count: 9, dropped: 0, sources: [], levels: {} } },
      async *logs(): AsyncIterable<unknown> {
        yield record();
      },
    } as unknown as TraceReader;

    const logs = await readTraceLogs(reader);
    expect(logs.truncated).toBe(true);
    // The count is a claim about the file; the file is the evidence.
    expect(logs.total).toBe(9);
    expect(logs.records).toHaveLength(1);
  });

  it('reports what the writer evicted as missing, not as all there is', async () => {
    const logs = await readTraceLogs(
      readerWith([record()], { dropped: 42, sources: [{ label: 'app.log', path: '/var/log/app.log' }] }),
    );
    expect(logs.dropped).toBe(42);
    expect(logs.truncated).toBe(true);
    expect(logs.sources).toEqual([{ label: 'app.log', path: '/var/log/app.log' }]);
  });

  it('carries the writer’s per-level counts, ignoring levels it does not know', async () => {
    const logs = await readTraceLogs(
      readerWith([record()], { levels: { error: 2, warn: 1, trace: 0, critical: 9, info: 'lots' } }),
    );
    expect(logs.levels).toEqual({ error: 2, warn: 1 });
  });

  it('positions records on the cast timeline', async () => {
    const logs = await readTraceLogs(readerWith([record()]));
    expect(logs.available).toBe(true);
    expect(logs.records[0]?.t).toBe(90);
  });

  it('returns a window of the size asked for, and says what is outside it', async () => {
    const many = Array.from({ length: 50 }, (_, index) => record({ castOffset: index * 10 }));
    const latest = await readTraceLogs(readerWith(many), { limit: 10 });
    expect(latest.records.map((entry) => entry.t)).toEqual([400, 410, 420, 430, 440, 450, 460, 470, 480, 490]);
    expect(latest.hasMoreBefore).toBe(true);
    expect(latest.hasMoreAfter).toBe(false);
    expect(latest.total).toBe(50);
  });

  it('reads backwards from a cursor, keeping the entries closest to it', async () => {
    const many = Array.from({ length: 50 }, (_, index) => record({ castOffset: index * 10 }));
    const older = await readTraceLogs(readerWith(many), { before: 200, limit: 5 });
    expect(older.records.map((entry) => entry.t)).toEqual([150, 160, 170, 180, 190]);
    expect(older.hasMoreBefore).toBe(true);
    expect(older.hasMoreAfter).toBe(true);
  });

  it('reads forwards from a cursor', async () => {
    const many = Array.from({ length: 50 }, (_, index) => record({ castOffset: index * 10 }));
    const newer = await readTraceLogs(readerWith(many), { after: 480, limit: 10 });
    expect(newer.records.map((entry) => entry.t)).toEqual([480, 490]);
    expect(newer.hasMoreBefore).toBe(true);
    expect(newer.hasMoreAfter).toBe(false);
  });

  it('bounds the window a caller can ask for', async () => {
    const many = Array.from({ length: 2_000 }, (_, index) => record({ castOffset: index }));
    const huge = await readTraceLogs(readerWith(many), { limit: 10_000 });
    expect(huge.records).toHaveLength(500);
    expect(huge.hasMoreBefore).toBe(true);
  });

  it('skips a line it cannot read, and keeps the rest', async () => {
    const logs = await readTraceLogs(
      readerWith([record(), 'not a record', { t: 1 }, record({ message: 'second' })]),
    );
    expect(logs.records.map((entry) => entry.message)).toEqual(['listening', 'second']);
  });

  it('reads entries in file order, which the writer appends chronologically', async () => {
    // A window cannot sort what it never holds, so the reader trusts the order
    // `logs.jsonl` was written in. Out-of-order lines stay out of order rather
    // than being silently rearranged into something that looks fine.
    const logs = await readTraceLogs(
      readerWith([
        record({ castOffset: 100, message: 'first' }),
        record({ castOffset: 200, message: 'second' }),
        record({ castOffset: 300, message: 'third' }),
      ]),
    );
    expect(logs.records.map((entry) => entry.message)).toEqual(['first', 'second', 'third']);
  });

  it('keeps what it read when the stream dies mid-file', async () => {
    const logs = await readTraceLogs(readerWith([record(), record({ message: 'second' })], { throwAfter: 1 }));
    expect(logs.records.map((entry) => entry.message)).toEqual(['listening']);
    expect(logs.truncated).toBe(true);
    expect(logs.available).toBe(true);
  });

  it('never holds a whole flood in memory', async () => {
    const many = Array.from({ length: 6_000 }, (_, index) => record({ castOffset: index }));
    const logs = await readTraceLogs(readerWith(many));
    expect(logs.records).toHaveLength(200);
    expect(logs.hasMoreBefore).toBe(true);
  });
});
