import { describe, expect, it } from 'vitest';
import { buildCastTimeline, hiddenOverlap } from './timeline.js';

describe('hiddenOverlap', () => {
  it('returns zero without windows', () => {
    expect(hiddenOverlap(0, 100, [])).toBe(0);
  });

  it('sums the covered part of the interval', () => {
    const windows = [
      { start: 10, end: 20 },
      { start: 50, end: 200 },
    ];
    expect(hiddenOverlap(0, 100, windows)).toBe(60);
  });

  it('merges overlapping windows instead of double counting', () => {
    const windows = [
      { start: 10, end: 60 },
      { start: 30, end: 80 },
    ];
    expect(hiddenOverlap(0, 100, windows)).toBe(70);
  });
});

describe('buildCastTimeline', () => {
  it('is the identity without hiding or trimming', () => {
    const timeline = buildCastTimeline([100, 250, 900]);
    expect(timeline.castTimes()).toEqual([100, 250, 900]);
    expect(timeline.durationMs).toBe(900);
    expect(timeline.mapWall(175)).toBe(175);
  });

  it('clamps gaps longer than the idle limit', () => {
    const timeline = buildCastTimeline([100, 5_100, 5_200], { idleTimeLimitMs: 1_000 });
    expect(timeline.castTimes()).toEqual([100, 1_100, 1_200]);
  });

  it('removes hidden windows from the timeline', () => {
    const timeline = buildCastTimeline([100, 700], { hidden: [{ start: 200, end: 600 }] });
    // 600ms of wall time between the events, 400 of it hidden.
    expect(timeline.castTimes()).toEqual([100, 300]);
  });

  it('applies hiding before the idle clamp', () => {
    const timeline = buildCastTimeline([0, 10_000], {
      hidden: [{ start: 1_000, end: 9_000 }],
      idleTimeLimitMs: 5_000,
    });
    // 10s gap - 8s hidden = 2s visible, which is under the 5s limit.
    expect(timeline.castTimes()).toEqual([0, 2_000]);
  });

  it('interpolates times that fall between two events', () => {
    const timeline = buildCastTimeline([0, 10_000], { idleTimeLimitMs: 1_000 });
    // The 10s gap compresses to 1s, so the midpoint lands at 500ms.
    expect(timeline.mapWall(5_000)).toBe(500);
    expect(timeline.mapWall(10_000)).toBe(1_000);
  });

  it('extends past the last event with the same rules', () => {
    const timeline = buildCastTimeline([100], { idleTimeLimitMs: 1_000 });
    expect(timeline.mapWall(9_000)).toBe(1_100);
  });

  it('never runs backwards for out-of-order input', () => {
    const timeline = buildCastTimeline([500, 200, 700]);
    const times = timeline.castTimes();
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('reports hidden times', () => {
    const timeline = buildCastTimeline([0], { hidden: [{ start: 10, end: 20 }] });
    expect(timeline.isHidden(15)).toBe(true);
    expect(timeline.isHidden(25)).toBe(false);
  });
});
