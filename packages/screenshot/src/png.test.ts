import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it } from 'vitest';
import { cell, gridFrame, textFrame } from './__fixtures__/grid.js';
import { loadFonts } from './font.js';
import { renderPng } from './png.js';
import { renderSvg } from './svg.js';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const hasSystemFont = loadFonts().available;

/** Reads width and height out of a PNG's IHDR chunk. */
function pngHeader(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Fraction of pixels that differ from the image's top-left (background) pixel. */
function inkCoverage(svg: string): number {
  const image = new Resvg(svg, { font: { loadSystemFonts: false } }).render();
  const pixels = image.pixels;
  const base = pixels.subarray(0, 3).join(',');
  let different = 0;
  for (let offset = 0; offset + 3 < pixels.length; offset += 4) {
    if (pixels.subarray(offset, offset + 3).join(',') !== base) different += 1;
  }
  return different / (pixels.length / 4);
}

/**
 * Rasterising text that fell back to `<text>` makes resvg enumerate the system
 * fonts, and it does that **per call** — around 0.8 s on macOS and several
 * seconds on a Windows runner, which is what timed this file out in CI.
 *
 * Tests that are not about the fallback path therefore render in outline mode,
 * where `loadSystemFonts` stays off and a raster costs tens of milliseconds.
 * Explicit `cellWidth`/`lineHeight` keep the geometry independent of whichever
 * font the machine happens to have, so the assertions stay exact.
 */
const GEOMETRY = { fontSize: 10, cellWidth: 6, lineHeight: 12, padding: 4 } as const;

/**
 * Budget for the one test that must pay font enumeration. A complete Windows
 * font scan takes about 37 seconds on a GitHub-hosted Node 24 runner while the
 * same work is sub-second on macOS. Keep the real end-to-end render, but give
 * the platform operation enough room to finish under normal CI contention.
 */
const FONT_SCAN_TIMEOUT_MS = 90_000;

describe('renderPng', () => {
  it('produces a decodable PNG whose header matches the SVG size', () => {
    const shot = renderPng(textFrame('hello', { columns: 10 }), GEOMETRY);
    expect([...shot.png.slice(0, 8)]).toEqual(PNG_SIGNATURE);
    const header = pngHeader(shot.png);
    expect(header.width).toBe(68);
    expect(header.height).toBe(20);
    expect(shot.width).toBe(68);
    expect(shot.height).toBe(20);
  });

  it('scales the raster without changing the layout', () => {
    const single = renderPng(textFrame('hello', { columns: 10 }), GEOMETRY);
    const double = renderPng(textFrame('hello', { columns: 10 }), { ...GEOMETRY, scale: 2 });
    expect(double.width).toBe(single.width * 2);
    expect(double.height).toBe(single.height * 2);
    expect(pngHeader(double.png).width).toBe(single.width * 2);
  });

  it('rejects a non-positive scale', () => {
    expect(() => renderPng(textFrame('x'), { scale: 0 })).toThrow(RangeError);
    expect(() => renderPng(textFrame('x'), { scale: Number.NaN })).toThrow(/scale/);
  });

  it(
    'really rasterises the fallback path, scan and all',
    () => {
      // The one render in this file that deliberately pays resvg's font scan,
      // kept because the mocked suite in png-options.test.ts never touches the
      // real rasteriser. What the *decision* is gets asserted there; this
      // proves the whole thing still produces an image.
      const shot = renderPng(textFrame('a\u{F0000}'), { fontSize: 12 });
      expect(shot.selfContained).toBe(false);
      expect(shot.fallbackCharacters).toContain('\u{F0000}');
      expect(shot.systemFontsLoaded).toBe(true);
      expect([...shot.png.slice(0, 8)]).toEqual(PNG_SIGNATURE);
    },
    FONT_SCAN_TIMEOUT_MS,
  );

  it('can decline the system-font scan a fallback would trigger', () => {
    const shot = renderPng(textFrame('a\u{F0000}'), {
      ...GEOMETRY,
      systemFontFallback: false,
    });

    // Still an honest report of what could not be embedded...
    expect(shot.selfContained).toBe(false);
    expect(shot.fallbackCharacters).toContain('\u{F0000}');
    // ...and the claim itself, as a fact rather than as a stopwatch reading:
    // "no scan happened" is what the escape hatch promises, and a wall-clock
    // threshold turns a loaded CI runner into a failing build.
    expect(shot.systemFontsLoaded).toBe(false);
    expect([...shot.png.slice(0, 8)]).toEqual(PNG_SIGNATURE);
  });
});

describe('rasterising embedded outlines', () => {
  it.runIf(hasSystemFont)('draws glyphs with no fonts available to the rasteriser', () => {
    const filled = renderSvg(textFrame('WWWW'), { fontSize: 24, padding: 0 });
    expect(filled.selfContained).toBe(true);

    const blank = renderSvg(gridFrame([[cell(), cell(), cell(), cell()]]), {
      fontSize: 24,
      padding: 0,
    });

    // resvg is given no fonts at all here, so anything it draws came from the
    // embedded <defs>/<use> outlines.
    expect(inkCoverage(blank.svg)).toBe(0);
    expect(inkCoverage(filled.svg)).toBeGreaterThan(0.05);
  });

  it.runIf(hasSystemFont)('paints background runs', () => {
    const frame = gridFrame([
      [cell({ char: ' ', bg: { kind: 'palette', index: 1 } }), cell({ char: ' ' })],
    ]);
    const shot = renderSvg(frame, { fontSize: 20, padding: 0, cellWidth: 20, lineHeight: 20 });
    // Half the canvas is the red run; the other half stays the theme background.
    expect(inkCoverage(shot.svg)).toBeCloseTo(0.5, 1);
  });
});

describe('reporting what a render cost', () => {
  it('says when a render did not need the system fonts', () => {
    const shot = renderPng(textFrame('ok'), GEOMETRY);
    if (!shot.selfContained) return; // no font on this machine
    expect(shot.systemFontsLoaded).toBe(false);
  });

  it('says when the caller declined them, fallbacks or not', () => {
    const shot = renderPng(textFrame('a\u{F0000}'), {
      ...GEOMETRY,
      systemFontFallback: false,
    });
    // Still honest about what could not be embedded...
    expect(shot.fallbackCharacters).toContain('\u{F0000}');
    // ...and explicit that nothing went looking for a font to cover it.
    expect(shot.systemFontsLoaded).toBe(false);
  });
});
