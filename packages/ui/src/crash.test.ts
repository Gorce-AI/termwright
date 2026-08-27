import { describe, expect, it } from 'vitest';
import { CRASH_TAIL_WARNING, describeCrashCause, parseCrash } from './crash.js';

const valid = {
  t: 2_000,
  castOffset: 1_800,
  exit: { code: null, signal: 'SIGSEGV' },
  screenTail: ['panic: runtime error', 'goroutine 1 [running]:'],
  lastSemanticRevision: 7,
  recentInputs: [
    { timeMs: 1_700, kind: 'key', bytes: 1, preview: '\\r' },
    { timeMs: 1_750, kind: 'paste', bytes: 64 },
  ],
  diagnosticsTail: [
    { code: 'protocol-violation', detail: 'frame too large', revision: 7, timeMs: 1_790 },
  ],
};

describe('parseCrash', () => {
  it('keeps a well-formed section verbatim', () => {
    const crash = parseCrash(valid);
    expect(crash?.cause).toBe('signal SIGSEGV');
    expect(crash?.castOffset).toBe(1_800);
    expect(crash?.screenTail).toEqual(['panic: runtime error', 'goroutine 1 [running]:']);
    expect(crash?.screenTailTruncated).toBe(false);
    expect(crash?.lastSemanticRevision).toBe(7);
    expect(crash?.recentInputs[1]).toEqual({ timeMs: 1_750, kind: 'paste', bytes: 64 });
    expect(crash?.diagnosticsTail[0]?.code).toBe('protocol-violation');
  });

  it('is absent for a clean run', () => {
    expect(parseCrash(undefined)).toBeNull();
    expect(parseCrash(null)).toBeNull();
  });

  it('rejects a section with no usable cause or no place on the timeline', () => {
    expect(parseCrash({ ...valid, exit: { code: null, signal: null } })).toBeNull();
    expect(parseCrash({ ...valid, exit: 'died' })).toBeNull();
    expect(parseCrash({ ...valid, castOffset: 'later' })).toBeNull();
    expect(parseCrash({ ...valid, castOffset: Number.NaN })).toBeNull();
  });

  it('rejects a section that is not an object', () => {
    expect(parseCrash('crashed')).toBeNull();
    expect(parseCrash([valid])).toBeNull();
    expect(parseCrash(42)).toBeNull();
  });

  it('degrades a broken sub-section to empty rather than failing', () => {
    const crash = parseCrash({
      ...valid,
      screenTail: 'not an array',
      recentInputs: [null, 'nope', { kind: 'key' }],
      diagnosticsTail: [{ detail: 'no code' }],
      lastSemanticRevision: 'seven',
    });
    expect(crash).not.toBeNull();
    expect(crash?.screenTail).toEqual([]);
    expect(crash?.recentInputs).toEqual([{ timeMs: 0, kind: 'key', bytes: 0 }]);
    expect(crash?.diagnosticsTail).toEqual([]);
    expect(crash?.lastSemanticRevision).toBeNull();
  });

  it('drops non-string rows out of the screen tail', () => {
    const crash = parseCrash({ ...valid, screenTail: ['ok', 5, null, 'fine'] });
    expect(crash?.screenTail).toEqual(['ok', 'fine']);
  });

  it('falls back to castOffset when the wall clock is missing', () => {
    const crash = parseCrash({ ...valid, t: undefined });
    expect(crash?.t).toBe(1_800);
  });

  it('bounds a hostile section', () => {
    const crash = parseCrash({
      ...valid,
      screenTail: Array.from({ length: 50_000 }, (_, index) => 'x'.repeat(10_000) + String(index)),
      recentInputs: Array.from({ length: 5_000 }, () => ({ timeMs: 1, kind: 'key', bytes: 1 })),
      diagnosticsTail: Array.from({ length: 5_000 }, () => ({
        code: 'noise',
        detail: 'y'.repeat(10_000),
        timeMs: 1,
      })),
    });
    expect(crash?.screenTail.length).toBe(500);
    expect(crash?.screenTail[0]?.length).toBe(4_096);
    expect(crash?.screenTailTruncated).toBe(true);
    expect(crash?.recentInputs.length).toBe(100);
    expect(crash?.diagnosticsTail.length).toBe(200);
    expect(crash?.diagnosticsTail[0]?.detail.length).toBe(4_096);
  });

  it('keeps the last rows, which are the ones the program died printing', () => {
    const crash = parseCrash({
      ...valid,
      screenTail: Array.from({ length: 600 }, (_, index) => `line ${index}`),
    });
    expect(crash?.screenTail.at(-1)).toBe('line 599');
  });
});

describe('describeCrashCause', () => {
  it('prefers the signal, then the code', () => {
    expect(describeCrashCause({ code: null, signal: 'SIGKILL' })).toBe('signal SIGKILL');
    expect(describeCrashCause({ code: 137, signal: null })).toBe('exit code 137');
    expect(describeCrashCause({ code: null, signal: null })).toBe('exit code unknown');
  });
});

describe('the not-redacted warning', () => {
  it('says what it is, in the same words as the HTML report', () => {
    expect(CRASH_TAIL_WARNING).toContain('Not redacted');
    expect(CRASH_TAIL_WARNING).toContain('secrets included');
    expect(CRASH_TAIL_WARNING).toContain('like a screenshot');
  });
});
