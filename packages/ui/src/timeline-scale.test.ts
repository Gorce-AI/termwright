import { describe, expect, it } from 'vitest';
import { fractionFor, percentFor, timeAt } from './timeline-scale.js';

describe('fractionFor', () => {
  it('maps a moment onto the track', () => {
    expect(fractionFor(0, 1_000)).toBe(0);
    expect(fractionFor(500, 1_000)).toBe(0.5);
    expect(fractionFor(1_000, 1_000)).toBe(1);
  });

  it('clamps rather than running off either end', () => {
    expect(fractionFor(-50, 1_000)).toBe(0);
    expect(fractionFor(5_000, 1_000)).toBe(1);
  });

  it('puts everything at the start when there is no recording to divide by', () => {
    expect(fractionFor(100, 0)).toBe(0);
    expect(fractionFor(100, -5)).toBe(0);
    expect(fractionFor(Number.NaN, 1_000)).toBe(0);
    expect(fractionFor(100, Number.NaN)).toBe(0);
  });
});

describe('percentFor', () => {
  it('is the fraction as CSS', () => {
    expect(percentFor(250, 1_000)).toBe('25%');
    expect(percentFor(1_000, 1_000)).toBe('100%');
  });
});

describe('timeAt', () => {
  const track = { left: 100, width: 400 };

  it('reads a pointer back to a moment', () => {
    expect(timeAt(100, track, 1_000)).toBe(0);
    expect(timeAt(300, track, 1_000)).toBe(500);
    expect(timeAt(500, track, 1_000)).toBe(1_000);
  });

  it('clamps a pointer dragged past either edge', () => {
    expect(timeAt(0, track, 1_000)).toBe(0);
    expect(timeAt(9_999, track, 1_000)).toBe(1_000);
  });

  it('survives a track that has not been laid out yet', () => {
    expect(timeAt(50, { left: 0, width: 0 }, 1_000)).toBe(0);
    expect(timeAt(50, track, 0)).toBe(0);
  });
});

describe('the two directions agree', () => {
  const track = { left: 12, width: 640 };
  const duration = 931;

  it('round-trips every position, including both edges', () => {
    // This is the property the bug broke: a marker drawn at `fractionFor` and a
    // pointer read by `timeAt` must land on the same millisecond, and the error
    // must not grow towards the right.
    for (const timeMs of [0, 1, 100, 465.5, 800, 930, 931]) {
      const x = track.left + fractionFor(timeMs, duration) * track.width;
      expect(timeAt(x, track, duration)).toBeCloseTo(timeMs, 6);
    }
  });

  it('places the end of the recording at the end of the track, not before it', () => {
    expect(fractionFor(duration, duration)).toBe(1);
    expect(timeAt(track.left + track.width, track, duration)).toBe(duration);
  });
});
