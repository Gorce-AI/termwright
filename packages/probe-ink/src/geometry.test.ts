import { describe, expect, it } from 'vitest';
import { canPublishInkGeometry } from './geometry.js';

describe('canPublishInkGeometry', () => {
  it('never claims viewport coordinates on a non-TTY, even when interactive is forced', () => {
    expect(canPublishInkGeometry({
      alternateScreen: true,
      interactive: true,
      stdoutIsTTY: false,
    })).toBe(false);
  });

  it('accepts explicit interactive alternate-screen rendering on a TTY', () => {
    expect(canPublishInkGeometry({
      alternateScreen: true,
      interactive: true,
      stdoutIsTTY: true,
    })).toBe(true);
  });

  it('matches Ink default interactivity in and outside CI', () => {
    expect(canPublishInkGeometry({
      alternateScreen: true,
      stdoutIsTTY: true,
      inCi: false,
    })).toBe(true);
    expect(canPublishInkGeometry({
      alternateScreen: true,
      stdoutIsTTY: true,
      inCi: true,
    })).toBe(false);
  });
});
