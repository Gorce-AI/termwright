import { describe, expect, it } from 'vitest';
import type { TraceReader } from '@termwright/trace';
import { readCommandLog } from './trace-playback.js';

/** A reader whose event stream fails partway, the way an old archive does. */
function readerThatFails(events: readonly unknown[], after: number): TraceReader {
  return {
    async *events(): AsyncIterable<unknown> {
      let index = 0;
      for (const event of events) {
        if (index >= after) throw new Error('events.jsonl:2 has no castOffset');
        index += 1;
        yield event;
      }
    },
  } as unknown as TraceReader;
}

describe('readCommandLog', () => {
  it('keeps what it read and says the rest is missing', async () => {
    const result = await readCommandLog(
      readerThatFails(
        [
          { kind: 'action', t: 10, castOffset: 10, api: 'locator.click', ok: true },
          { kind: 'action', t: 20, castOffset: 20, api: 'locator.press', ok: true },
        ],
        1,
      ),
    );
    expect(result.commands.map((row) => row.label)).toEqual(['locator.click']);
    expect(result.incomplete).toBe(true);
    expect(result.error).toContain('castOffset');
  });

  it('reports a complete log as complete', async () => {
    const result = await readCommandLog(
      readerThatFails(
        [{ kind: 'action', t: 10, castOffset: 10, api: 'locator.click', ok: true }],
        99,
      ),
    );
    expect(result.incomplete).toBe(false);
    expect(result.error).toBeUndefined();
  });
});
