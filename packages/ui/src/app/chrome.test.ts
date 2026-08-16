import { describe, expect, it } from 'vitest';
import { clampSplit, nextTheme } from './chrome.js';

describe('clampSplit', () => {
  it('keeps both sides of a split reachable', () => {
    expect(clampSplit(0.5)).toBe(0.5);
    expect(clampSplit(0)).toBe(0.15);
    expect(clampSplit(1)).toBe(0.85);
    expect(clampSplit(Number.NaN)).toBe(0.15);
  });
});

describe('nextTheme', () => {
  it('cycles system → dark → light → system', () => {
    expect(nextTheme('system')).toBe('dark');
    expect(nextTheme('dark')).toBe('light');
    expect(nextTheme('light')).toBe('system');
  });
});
