import { describe, expect, it } from 'vitest';
import type { TraceReader } from '@termwright/trace';
import { readTraceLogs } from './trace-logs.js';

/** A reader over an archive that recorded logs, yielding what the test hands it. */
function readerWith(
  records: readonly unknown[],
  options: { throwAfter?: number; dropped?: number; sources?: readonly string[] } = {},
): TraceReader {
  return {
    meta: {
      logs: {
        count: records.length,
        dropped: options.dropped ?? 0,
        sources: options.sources ?? ['server.log'],
        levels: {},
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

  it('reports what the writer evicted as missing, not as all there is', async () => {
    const logs = await readTraceLogs(readerWith([record()], { dropped: 42, sources: ['app.log'] }));
    expect(logs.dropped).toBe(42);
    expect(logs.truncated).toBe(true);
    expect(logs.sources).toEqual(['app.log']);
  });

  it('positions records on the cast timeline', async () => {
    const logs = await readTraceLogs(readerWith([record()]));
    expect(logs.available).toBe(true);
    expect(logs.records[0]?.t).toBe(90);
  });

  it('falls back to the session clock when there is no cast offset', async () => {
    const logs = await readTraceLogs(readerWith([record({ castOffset: undefined })]));
    expect(logs.records[0]?.t).toBe(100);
  });

  it('skips a line it cannot read, and keeps the rest', async () => {
    const logs = await readTraceLogs(
      readerWith([record(), 'not a record', { t: 1 }, record({ message: 'second' })]),
    );
    expect(logs.records.map((entry) => entry.message)).toEqual(['listening', 'second']);
  });

  it('orders records by time', async () => {
    const logs = await readTraceLogs(
      readerWith([
        record({ castOffset: 300, message: 'third' }),
        record({ castOffset: 100, message: 'first' }),
        record({ castOffset: 200, message: 'second' }),
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

  it('bounds a log stream that never ends', async () => {
    const many = Array.from({ length: 6_000 }, (_, index) => record({ castOffset: index }));
    const logs = await readTraceLogs(readerWith(many));
    expect(logs.records).toHaveLength(5_000);
    expect(logs.truncated).toBe(true);
  });
});
