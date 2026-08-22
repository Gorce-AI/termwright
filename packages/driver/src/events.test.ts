import { describe, expect, it, vi } from 'vitest';
import { SessionEventEmitter } from './events.js';

describe('SessionEventEmitter journal', () => {
  it('replays startup events in one source order before switching live', () => {
    const events = new SessionEventEmitter();
    events.emit('output', { data: new TextEncoder().encode('boot'), timeMs: 1 });
    events.emit('diagnostic', { code: 'adapter-attached', detail: 'ready', timeMs: 2 });

    const seen: number[] = [];
    const off = events.subscribe({ fromSequence: 1 }, (record) => {
      seen.push(record.sequence);
      if (record.sequence === 1) {
        // A replay callback can synchronously cause a new event. It belongs
        // after the complete retained prefix, never in the middle of it.
        events.emit('input', { data: new Uint8Array([13]), kind: 'key', timeMs: 3 });
      }
    });
    events.emit('resize', { columns: 100, rows: 30, timeMs: 4 });

    expect(seen).toEqual([1, 2, 3, 4]);
    off();
  });

  it('reports an explicit gap when a late observer exceeded the bound', () => {
    const events = new SessionEventEmitter();
    for (let index = 0; index < 8_193; index += 1) {
      events.emit('screen-revision', { revision: index + 1, timeMs: index });
    }
    const onGap = vi.fn();
    const seen: number[] = [];

    events.subscribe({ fromSequence: 1, onGap }, (record) => seen.push(record.sequence))();

    expect(onGap).toHaveBeenCalledOnce();
    expect(onGap).toHaveBeenCalledWith(expect.objectContaining({
      requestedSequence: 1,
      firstAvailableSequence: 2,
      lastLostSequence: 1,
      lostEvents: 1,
    }));
    expect(seen).toHaveLength(8_192);
    expect(seen[0]).toBe(2);
    expect(seen.at(-1)).toBe(8_193);
  });

  it('fails closed when an authoritative subscriber does not accept gaps', () => {
    const events = new SessionEventEmitter();
    for (let index = 0; index < 8_193; index += 1) {
      events.emit('screen-revision', { revision: index + 1, timeMs: index });
    }

    expect(() => events.subscribe({ fromSequence: 1 }, () => undefined)).toThrowError(
      expect.objectContaining({ code: 'capacity' }),
    );
  });
});
