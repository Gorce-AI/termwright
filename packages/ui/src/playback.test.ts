import { describe, expect, it } from 'vitest';
import {
  advance,
  framesUpTo,
  initialPlayback,
  nextSpeed,
  revisionAt,
  type PlaybackFrame,
} from './playback.js';

const frames: PlaybackFrame[] = [
  { t: 0, kind: 'output', dataB64: 'YQ==' },
  { t: 100, kind: 'output', dataB64: 'Yg==' },
  { t: 250, kind: 'resize', columns: 100, rows: 30 },
  { t: 400, kind: 'output', dataB64: 'Yw==' },
];

describe('advance', () => {
  it('does nothing while paused', () => {
    const state = initialPlayback();
    expect(advance(state, 500, 1_000)).toBe(state);
  });

  it('moves by wall time scaled by the speed', () => {
    const state = { ...initialPlayback(), playing: true, speed: 2 as const };
    expect(advance(state, 250, 10_000).timeMs).toBe(500);
  });

  it('stops at the end instead of running past it', () => {
    const state = { ...initialPlayback(), playing: true, timeMs: 900 };
    const next = advance(state, 500, 1_000);
    expect(next.timeMs).toBe(1_000);
    expect(next.playing).toBe(false);
  });
});

describe('framesUpTo', () => {
  it('returns only what is new when moving forward', () => {
    const first = framesUpTo(frames, initialPlayback(), 100);
    expect(first.frames).toHaveLength(2);
    expect(first.rewind).toBe(false);

    const second = framesUpTo(frames, { ...initialPlayback(), cursor: first.cursor }, 400);
    expect(second.frames.map((frame) => frame.t)).toEqual([250, 400]);
    expect(second.cursor).toBe(4);
  });

  it('replays from the start when moving backwards, because a terminal cannot un-write', () => {
    const played = framesUpTo(frames, initialPlayback(), 400);
    const back = framesUpTo(frames, { ...initialPlayback(), cursor: played.cursor }, 100);
    expect(back.rewind).toBe(true);
    expect(back.frames.map((frame) => frame.t)).toEqual([0, 100]);
    expect(back.cursor).toBe(2);
  });

  it('returns nothing when the position has not reached the next frame', () => {
    const state = { ...initialPlayback(), cursor: 2 };
    expect(framesUpTo(frames, state, 200).frames).toHaveLength(0);
  });

  it('handles an empty recording', () => {
    expect(framesUpTo([], initialPlayback(), 1_000).frames).toHaveLength(0);
  });
});

describe('nextSpeed', () => {
  it('cycles through the ladder and wraps', () => {
    expect(nextSpeed(0.5)).toBe(1);
    expect(nextSpeed(1)).toBe(2);
    expect(nextSpeed(2)).toBe(4);
    expect(nextSpeed(4)).toBe(0.5);
  });
});

describe('revisionAt', () => {
  const revisions = [
    { t: 0, revision: 1 },
    { t: 500, revision: 2 },
    { t: 900, revision: 3 },
  ];

  it('is the newest revision at or before the moment', () => {
    expect(revisionAt(revisions, 0)).toBe(1);
    expect(revisionAt(revisions, 499)).toBe(1);
    expect(revisionAt(revisions, 500)).toBe(2);
    expect(revisionAt(revisions, 10_000)).toBe(3);
  });

  it('is null before the first tree', () => {
    expect(revisionAt([{ t: 100, revision: 1 }], 50)).toBeNull();
    expect(revisionAt([], 50)).toBeNull();
  });
});
