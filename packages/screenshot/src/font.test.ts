import { describe, expect, it } from 'vitest';
import { FontSet, loadFonts, systemCandidates } from './font.js';

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
    expect(set.glyphFor('a')).toBeNull();
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
    const outline = fonts.glyphFor('A');
    expect(outline?.kind).toBe('outline');
    expect(outline?.kind === 'outline' && outline.path.startsWith('M')).toBe(true);
    expect(outline?.advanceWidth).toBeGreaterThan(0);
    expect(fonts.used.length).toBe(1);
  });

  it.runIf(hasSystemFont)('gives the same character the same id twice', () => {
    expect(fonts.glyphFor('A')?.id).toBe(fonts.glyphFor('A')?.id);
    expect(fonts.glyphFor('A')?.id).not.toBe(fonts.glyphFor('B')?.id);
  });

  it.runIf(hasSystemFont)('treats an uncovered character as uncovered, not as .notdef', () => {
    // A private-use plane character: mapped to glyph 0 by every real font.
    expect(fonts.glyphFor('\u{F0000}')).toBeNull();
  });

  it('handles an empty string without throwing', () => {
    expect(fonts.glyphFor('')).toBeNull();
  });
});

describe('colour glyphs', () => {
  const emoji = loadFonts();
  const emojiGlyph = emoji.glyphFor('🚀');

  it.runIf(emojiGlyph !== null)('lifts a bitmap strike out of a colour emoji font', () => {
    expect(emojiGlyph?.kind).toBe('image');
    if (emojiGlyph?.kind !== 'image') return;
    expect(emojiGlyph.mediaType).toBe('image/png');
    // Real PNG bytes, not an empty strike.
    expect(Buffer.from(emojiGlyph.base64, 'base64').subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });

  it('reads COLR/CPAL layers when a font has them', () => {
    // No COLR font is guaranteed on any CI image, so the layer path is driven
    // through a stand-in shaped like the fontkit surface this module touches.
    const layered = new FontSet([
      {
        file: '/fake/colr.ttf',
        bold: false,
        italic: false,
        index: 0,
        font: {
          unitsPerEm: 1000,
          ascent: 800,
          descent: -200,
          glyphForCodePoint: () => ({
            id: 7,
            advanceWidth: 1000,
            layers: [
              { glyph: { path: { toSVG: () => 'M0 0L10 0Z' } }, color: { red: 255, green: 0, blue: 0, alpha: 255 } },
              { glyph: { path: { toSVG: () => 'M0 0L5 5Z' } }, color: { red: 0, green: 128, blue: 255, alpha: 128 } },
            ],
          }),
        } as never,
      },
    ]);

    const glyph = layered.glyphFor('x');
    expect(glyph?.kind).toBe('layers');
    if (glyph?.kind !== 'layers') return;
    expect(glyph.layers).toEqual([
      { path: 'M0 0L10 0Z', color: '#ff0000' },
      { path: 'M0 0L5 5Z', color: '#0080ff80' },
    ]);
  });
});

describe('real faces', () => {
  const fontsWithFaces = loadFonts();

  it.runIf(hasSystemFont)('reports which styles a real face exists for', () => {
    expect(fontsWithFaces.hasFace({})).toBe(true);
    // Menlo.ttc carries bold, italic and bold-italic; a single-face font would
    // report false and fall back to synthesis.
    expect(typeof fontsWithFaces.hasFace({ bold: true })).toBe('boolean');
  });

  it.runIf(hasSystemFont)('prefers the face matching the requested style', () => {
    const regular = fontsWithFaces.glyphFor('A');
    const bold = fontsWithFaces.glyphFor('A', { bold: true });
    expect(regular).not.toBeNull();
    expect(bold).not.toBeNull();
    if (!fontsWithFaces.hasFace({ bold: true })) return;
    // Different faces mean different ids, and a genuinely different outline.
    expect(bold?.id).not.toBe(regular?.id);
    expect(bold?.kind === 'outline' && regular?.kind === 'outline'
      ? bold.path !== regular.path
      : true).toBe(true);
  });
});

describe('grapheme clusters', () => {
  const set = loadFonts();
  const colourEmoji = set.glyphFor('🚀')?.kind === 'image';

  it.runIf(colourEmoji)('honours an emoji variation selector over a monochrome font', () => {
    // U+26A0 exists in monochrome symbol fonts too; with U+FE0F the author
    // asked for the emoji presentation.
    expect(set.glyphFor('⚠️')?.kind).toBe('image');
  });

  it.runIf(colourEmoji)('shapes a ZWJ sequence into one glyph', () => {
    const family = set.glyphFor('👨‍👩‍👧');
    const man = set.glyphFor('👨');
    expect(family?.kind).toBe('image');
    // Not just the first person in the sequence.
    expect(family?.id).not.toBe(man?.id);
  });

  it.runIf(hasSystemFont)('still resolves a plain single code point', () => {
    expect(set.glyphFor('A')?.kind).toBe('outline');
  });

  it('returns null for an empty cluster', () => {
    expect(set.glyphFor('')).toBeNull();
  });
});
