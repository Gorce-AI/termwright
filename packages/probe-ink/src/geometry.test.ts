import { afterEach, describe, expect, it, vi } from 'vitest';
import { canPublishInkGeometry } from './geometry.js';

afterEach(() => vi.unstubAllEnvs());

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

  it('reads the same CI flags when no override is supplied', () => {
    vi.stubEnv('CI', '1');
    vi.stubEnv('CONTINUOUS_INTEGRATION', '0');
    expect(canPublishInkGeometry({ alternateScreen: true, stdoutIsTTY: true })).toBe(false);

    vi.stubEnv('CI', 'false');
    expect(canPublishInkGeometry({ alternateScreen: true, stdoutIsTTY: true })).toBe(true);
  });
});
