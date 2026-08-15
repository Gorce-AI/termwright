import { describe, expect, it } from 'vitest';
import { formatCastEvent, formatCastHeader, parseCast, parseCastHeader } from './cast.js';
import { TraceError } from './errors.js';

describe('asciicast v3', () => {
  it('writes a v3 header with a term object', () => {
    const line = formatCastHeader({ version: 3, term: { cols: 100, rows: 30 } });
    expect(JSON.parse(line)).toEqual({ version: 3, term: { cols: 100, rows: 30 } });
  });

  it('writes intervals, not absolute timestamps', () => {
    expect(formatCastEvent(1.5, 'o', 'hi')).toBe('[1.5,"o","hi"]');
    expect(formatCastEvent(-3, 'o', 'hi')).toBe('[0,"o","hi"]');
  });

  it('resolves intervals back into absolute offsets', () => {
    const text = [
      formatCastHeader({ version: 3, term: { cols: 80, rows: 24 } }),
      formatCastEvent(0.5, 'o', 'a'),
      formatCastEvent(0.25, 'm', 'step one'),
      formatCastEvent(1, 'r', '80x30'),
      formatCastEvent(0, 'x', '0'),
    ].join('\n');

    const { header, events } = parseCast(text);
    expect(header.term).toEqual({ cols: 80, rows: 24 });
    expect(events.map((event) => [event.code, event.timeMs])).toEqual([
      ['o', 500],
      ['m', 750],
      ['r', 1750],
      ['x', 1750],
    ]);
    expect(events[1]?.data).toBe('step one');
  });

  it('rejects asciicast v2', () => {
    expect(() => parseCastHeader('{"version":2,"width":80,"height":24}')).toThrowError(TraceError);
  });

  it('rejects a header without term dimensions', () => {
    expect(() => parseCastHeader('{"version":3}')).toThrowError(/term/);
  });

  it('rejects an empty file', () => {
    expect(() => parseCast('')).toThrowError(/empty/);
  });
});
