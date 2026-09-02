import { describe, expect, it } from 'vitest';
import {
  CHARWIDTH_EA_AMBIGUOUS,
  CHARWIDTH_SHIFT,
  CHARWIDTH_WIDE,
  GRAPHEME_BREAK_Extend,
  GRAPHEME_BREAK_ExtPic,
  GRAPHEME_BREAK_Hangul_L,
  GRAPHEME_BREAK_Hangul_LV,
  GRAPHEME_BREAK_Hangul_LVT,
  GRAPHEME_BREAK_Hangul_T,
  GRAPHEME_BREAK_Hangul_V,
  GRAPHEME_BREAK_Other,
  GRAPHEME_BREAK_Prepend,
  GRAPHEME_BREAK_Regional_Indicator,
  GRAPHEME_BREAK_SpacingMark,
  GRAPHEME_BREAK_ZWJ,
  columnToIndexInContext,
  getInfo,
  infoToWidth,
  infoToWidthInfo,
  shouldJoin,
  shouldJoinBackwards,
  strWidth,
} from './unicode-properties.js';

describe('owned Unicode grapheme properties', () => {
  it('maps normal, ambiguous, and wide encoded width classes', () => {
    const ambiguous = CHARWIDTH_EA_AMBIGUOUS << CHARWIDTH_SHIFT;
    const wide = CHARWIDTH_WIDE << CHARWIDTH_SHIFT;
    expect(infoToWidthInfo(ambiguous)).toBe(CHARWIDTH_EA_AMBIGUOUS);
    expect(infoToWidth(0)).toBe(1);
    expect(infoToWidth(ambiguous)).toBe(1);
    expect(infoToWidth(ambiguous, true)).toBe(2);
    expect(infoToWidth(wide)).toBe(2);
  });

  it('measures BMP and supplementary code points and maps columns to UTF-16 indexes', () => {
    expect(strWidth('A世😀', false)).toBe(5);
    expect(columnToIndexInContext('A世B', 0, 0, false)).toBe(0);
    expect(columnToIndexInContext('A世B', 0, 1, false)).toBe(1);
    expect(columnToIndexInContext('A世B', 0, 3, false)).toBe(2);
    expect(columnToIndexInContext('A世B', 1, 20, false)).toBe(3);
  });

  it.each([
    [GRAPHEME_BREAK_Hangul_L, GRAPHEME_BREAK_Hangul_L],
    [GRAPHEME_BREAK_Hangul_L, GRAPHEME_BREAK_Hangul_V],
    [GRAPHEME_BREAK_Hangul_L, GRAPHEME_BREAK_Hangul_LV],
    [GRAPHEME_BREAK_Hangul_L, GRAPHEME_BREAK_Hangul_LVT],
    [GRAPHEME_BREAK_Hangul_LV, GRAPHEME_BREAK_Hangul_V],
    [GRAPHEME_BREAK_Hangul_V, GRAPHEME_BREAK_Hangul_T],
    [GRAPHEME_BREAK_Hangul_LVT, GRAPHEME_BREAK_Hangul_T],
    [GRAPHEME_BREAK_Hangul_T, GRAPHEME_BREAK_Hangul_T],
    [GRAPHEME_BREAK_Other, GRAPHEME_BREAK_Extend],
    [GRAPHEME_BREAK_Other, GRAPHEME_BREAK_ZWJ],
    [GRAPHEME_BREAK_Prepend, GRAPHEME_BREAK_Other],
    [GRAPHEME_BREAK_Other, GRAPHEME_BREAK_SpacingMark],
    [GRAPHEME_BREAK_ZWJ, GRAPHEME_BREAK_ExtPic],
    [GRAPHEME_BREAK_Regional_Indicator, GRAPHEME_BREAK_Regional_Indicator],
  ])('joins grapheme class %i to %i', (before, after) => {
    expect(shouldJoin(before, after)).toBeGreaterThan(0);
    expect(shouldJoinBackwards(before, after)).toBeGreaterThan(0);
  });

  it('breaks unrelated grapheme classes and preserves trie lookup width bits', () => {
    expect(shouldJoin(GRAPHEME_BREAK_Other, GRAPHEME_BREAK_ExtPic)).toBeLessThanOrEqual(0);
    expect(shouldJoinBackwards(GRAPHEME_BREAK_Other, GRAPHEME_BREAK_ExtPic)).toBeLessThanOrEqual(0);
    expect(infoToWidthInfo(getInfo('世'.codePointAt(0)!))).toBe(CHARWIDTH_WIDE);
  });
});
