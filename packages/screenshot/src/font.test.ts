import { describe, expect, it } from 'vitest';
import { loadFonts, systemCandidates } from './font.js';

const fonts = loadFonts();
const hasSystemFont = fonts.available;

describe('systemCandidates', () => {
  it('offers platform monospace fonts', () => {
    expect(systemCandidates('darwin').some((path) => path.includes('Menlo'))).toBe(true);
    expect(systemCandidates('linux').some((path) => path.includes('DejaVuSansMono'))).toBe(true);
    expect(systemCandidates('win32').some((path) => path.includes('consola'))).toBe(true);
  });

  it('has no candidates for an unknown platform', () => {
    expect(systemCandidates('aix' as NodeJS.Platform)).toEqual([]);
  });
});

describe('loadFonts', () => {
  it('skips files it cannot open instead of throwing', () => {
    const set = loadFonts({ files: ['/definitely/not/a.ttf'], system: false });
    expect(set.available).toBe(false);
    expect(set.metrics).toBeNull();
    expect(set.outlineFor('a')).toBeNull();
    expect(set.used).toEqual([]);
  });

  it.runIf(hasSystemFont)('reports metrics in font units', () => {
    const metrics = fonts.metrics;
    expect(metrics).not.toBeNull();
    expect(metrics?.unitsPerEm).toBeGreaterThan(0);
    expect(metrics?.ascent).toBeGreaterThan(0);
    expect(metrics?.descent).toBeLessThan(0);
    expect(metrics?.advanceWidth).toBeGreaterThan(0);
  });

  it.runIf(hasSystemFont)('returns outline path data for a covered character', () => {
    const outline = fonts.outlineFor('A');
    expect(outline).not.toBeNull();
    expect(outline?.path.startsWith('M')).toBe(true);
    expect(outline?.advanceWidth).toBeGreaterThan(0);
    expect(fonts.used.length).toBe(1);
  });

  it.runIf(hasSystemFont)('gives the same character the same id twice', () => {
    expect(fonts.outlineFor('A')?.id).toBe(fonts.outlineFor('A')?.id);
    expect(fonts.outlineFor('A')?.id).not.toBe(fonts.outlineFor('B')?.id);
  });

  it.runIf(hasSystemFont)('treats an uncovered character as uncovered, not as .notdef', () => {
    // A private-use plane character: mapped to glyph 0 by every real font.
    expect(fonts.outlineFor('\u{F0000}')).toBeNull();
  });

  it('handles an empty string without throwing', () => {
    expect(fonts.outlineFor('')).toBeNull();
  });
});
