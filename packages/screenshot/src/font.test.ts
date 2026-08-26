import { describe, expect, it } from 'vitest';
import {
  FontSet,
  MAX_PARSED_FONT_CACHE_ENTRIES,
  loadFontCandidates,
  loadFonts,
  systemCandidates,
  type FontCandidateSource,
} from './font.js';

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

describe('lazy candidate loading', () => {
  it('does not open fallback collections when the primary face covers ASCII', () => {
    const fixture = candidateFixture({
      primary: fakeFont({ A: 'outline' }),
      cjk: fakeFont({ '界': 'outline' }),
      emoji: fakeFont({ '⚠️': 'image' }),
    });
    const set = loadFontCandidates(['primary', 'cjk', 'emoji'], fixture.source);

    expect(set.metrics).not.toBeNull();
    expect(set.glyphFor('A')?.kind).toBe('outline');
    expect(fixture.opened).toEqual(['primary']);
  });

  it('opens fallback faces in order only until a missing glyph is found', () => {
    const fixture = candidateFixture({
      primary: fakeFont({ A: 'outline' }),
      cjk: fakeFont({ '界': 'outline' }),
      emoji: fakeFont({ '⚠️': 'image' }),
    });
    const set = loadFontCandidates(['primary', 'cjk', 'emoji'], fixture.source);

    expect(set.glyphFor('界')?.kind).toBe('outline');
    expect(set.used).toEqual(['cjk']);
    expect(fixture.opened).toEqual(['primary', 'cjk']);
  });

  it('keeps scanning past a monochrome variation glyph for colour artwork', () => {
    const fixture = candidateFixture({
      primary: fakeFont({ '⚠️': 'outline' }),
      emoji: fakeFont({ '⚠️': 'image' }),
    });
    const set = loadFontCandidates(['primary', 'emoji'], fixture.source);

    expect(set.glyphFor('⚠️')?.kind).toBe('image');
    expect(set.used).toEqual(['emoji']);
    expect(fixture.opened).toEqual(['primary', 'emoji']);
  });

  it('reuses parsed faces until the candidate file identity changes', () => {
    let identity = 'font:v1';
    const opened: string[] = [];
    const source: FontCandidateSource = {
      identity: () => identity,
      open(file) {
        opened.push(`${file}:${identity}`);
        return [fakeFont({ A: 'outline' })];
      },
    };

    const first = loadFontCandidates(['primary'], source);
    const second = loadFontCandidates(['primary'], source);
    expect(first.glyphFor('A')).not.toBeNull();
    expect(second.glyphFor('A')).not.toBeNull();
    expect(opened).toEqual(['primary:font:v1']);
    expect(first.used).toEqual(['primary']);
    expect(second.used).toEqual(['primary']);

    identity = 'font:v2';
    expect(loadFontCandidates(['primary'], source).glyphFor('A')).not.toBeNull();
    expect(opened).toEqual(['primary:font:v1', 'primary:font:v2']);
  });

  it('bounds parsed faces with LRU eviction and does not retain empty parses', () => {
    const opened: string[] = [];
    const source: FontCandidateSource = {
      identity: (file) => `${file}:v1`,
      open(file) {
        opened.push(file);
        return file === 'empty' ? [] : [fakeFont({ A: 'outline' })];
      },
    };

    for (let index = 0; index <= MAX_PARSED_FONT_CACHE_ENTRIES; index += 1) {
      expect(loadFontCandidates([`font-${index}`], source).glyphFor('A')).not.toBeNull();
    }
    expect(opened).toHaveLength(MAX_PARSED_FONT_CACHE_ENTRIES + 1);
    expect(loadFontCandidates(['font-0'], source).glyphFor('A')).not.toBeNull();
    expect(opened.filter((file) => file === 'font-0')).toHaveLength(2);

    expect(loadFontCandidates(['empty'], source).available).toBe(false);
    expect(loadFontCandidates(['empty'], source).available).toBe(false);
    expect(opened.filter((file) => file === 'empty')).toHaveLength(2);
  });

  it('prefers a later exact-style face over an earlier non-exact glyph', () => {
    const fixture = candidateFixture({
      regular: fakeFont({ A: 'outline' }),
      bold: fakeFont({ A: 'outline' }, { bold: true }),
    });
    const set = loadFontCandidates(['regular', 'bold'], fixture.source);

    expect(set.glyphFor('A', { bold: true })?.kind).toBe('outline');
    expect(set.used).toEqual(['bold']);
    expect(fixture.opened).toEqual(['regular', 'bold']);
  });

  it('prefers later non-exact colour artwork over an exact monochrome variation glyph', () => {
    const fixture = candidateFixture({
      bold: fakeFont({ '⚠️': 'outline' }, { bold: true }),
      colour: fakeFont({ '⚠️': 'image' }),
    });
    const set = loadFontCandidates(['bold', 'colour'], fixture.source);

    expect(set.glyphFor('⚠️', { bold: true })?.kind).toBe('image');
    expect(set.used).toEqual(['colour']);
    expect(fixture.opened).toEqual(['bold', 'colour']);
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

type FakeGlyphKind = 'outline' | 'image';

function fakeFont(
  glyphs: Readonly<Record<string, FakeGlyphKind>>,
  face: { readonly bold?: boolean; readonly italic?: boolean } = {},
): never {
  const glyph = (cluster: string) => {
    const kind = glyphs[cluster];
    if (kind === undefined) return { id: 0, advanceWidth: 600 };
    const id = [...cluster].reduce((sum, char) => sum + (char.codePointAt(0) ?? 0), 1);
    return kind === 'image'
      ? {
          id,
          advanceWidth: 600,
          getImageForSize: () => ({ type: 'png ', data: new Uint8Array([1]) }),
        }
      : {
          id,
          advanceWidth: 600,
          path: { toSVG: () => `M${id} 0Z` },
        };
  };
  return {
    unitsPerEm: 1_000,
    ascent: 800,
    descent: -200,
    'OS/2': { fsSelection: { bold: face.bold ?? false, italic: face.italic ?? false } },
    post: { italicAngle: face.italic === true ? -12 : 0 },
    glyphForCodePoint: (codePoint: number) => glyph(String.fromCodePoint(codePoint)),
    layout: (cluster: string) => ({ glyphs: [glyph(cluster)] }),
  } as never;
}

function candidateFixture(fonts: Readonly<Record<string, never>>): {
  readonly opened: string[];
  readonly source: FontCandidateSource;
} {
  const opened: string[] = [];
  return {
    opened,
    source: {
      identity: (file) => `${file}:v1`,
      open(file) {
        opened.push(file);
        const font = fonts[file];
        return font === undefined ? [] : [font];
      },
    },
  };
}
