import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What `renderPng` asks the rasteriser for, asserted directly.
 *
 * The property that matters — "declining the fallback means no font scan" — was
 * originally checked with a stopwatch, and a stopwatch on a shared CI runner
 * measures the runner, not the code: the same assertion failed once by 6 ms and
 * once because a starved macOS box took 2.7 s to do 60 ms of work.
 *
 * The scan is resvg's reaction to one boolean we hand it, so the honest
 * assertion is on that boolean. It is deterministic, it costs no render at all,
 * and it is *stronger* than the timing was: `systemFontsLoaded` only reports
 * what this package decided, while these tests prove the decision reached the
 * rasteriser. The performance numbers themselves are recorded in NOTES.md,
 * where a measurement belongs.
 */

const constructed: { svg: string; options: ResvgOptions }[] = [];

interface ResvgOptions {
  readonly font?: {
    readonly loadSystemFonts?: boolean;
    readonly fontFiles?: readonly string[];
    readonly defaultFontFamily?: string;
  };
  readonly fitTo?: { readonly mode: string; readonly value: number };
}

vi.mock('@resvg/resvg-js', () => ({
  Resvg: class {
    constructor(svg: string, options: ResvgOptions) {
      constructed.push({ svg, options });
    }
    render(): { asPng(): Buffer; width: number; height: number } {
      return { asPng: () => Buffer.from([0x89, 0x50, 0x4e, 0x47]), width: 10, height: 10 };
    }
  },
}));

const { renderPng } = await import('./png.js');
const { renderSvg } = await import('./svg.js');
const { textFrame } = await import('./__fixtures__/grid.js');

/** Options handed to resvg by the last render. */
function lastOptions(): ResvgOptions {
  const last = constructed[constructed.length - 1];
  if (last === undefined) throw new Error('nothing was rendered');
  return last.options;
}

const GEOMETRY = { fontSize: 10, cellWidth: 6, lineHeight: 12, padding: 4 } as const;
/** No font covers the private-use planes, so this always needs a fallback. */
const UNCOVERABLE = 'a\u{F0000}';

beforeEach(() => {
  constructed.length = 0;
});

describe('what renderPng asks the rasteriser for', () => {
  it('does not ask for system fonts when every glyph is embedded', () => {
    const shot = renderPng(textFrame('ok'), GEOMETRY);
    // Skip on a machine with no fonts at all, where even ASCII falls back.
    if (!shot.selfContained) return;
    expect(lastOptions().font?.loadSystemFonts).toBe(false);
    expect(shot.systemFontsLoaded).toBe(false);
  });

  it('asks for them when a character could not be embedded', () => {
    const shot = renderPng(textFrame(UNCOVERABLE), GEOMETRY);
    expect(shot.fallbackCharacters).toContain('\u{F0000}');
    expect(lastOptions().font?.loadSystemFonts).toBe(true);
    expect(shot.systemFontsLoaded).toBe(true);
  });

  it('does not ask for them when the caller declined, fallback or not', () => {
    const shot = renderPng(textFrame(UNCOVERABLE), {
      ...GEOMETRY,
      systemFontFallback: false,
    });
    // The escape hatch is exactly this: the flag reaches resvg as `false`
    // even though the SVG contains characters that would benefit from a scan.
    expect(shot.fallbackCharacters).toContain('\u{F0000}');
    expect(lastOptions().font?.loadSystemFonts).toBe(false);
    expect(shot.systemFontsLoaded).toBe(false);
  });

  it('reports the same decision it passed on', () => {
    for (const declined of [true, false]) {
      const shot = renderPng(textFrame(UNCOVERABLE), {
        ...GEOMETRY,
        systemFontFallback: !declined,
      });
      expect(shot.systemFontsLoaded).toBe(lastOptions().font?.loadSystemFonts);
    }
  });

  it('passes explicit font files through', () => {
    renderPng(textFrame('ok'), { ...GEOMETRY, font: { files: ['/fonts/a.ttf'] } });
    expect(lastOptions().font?.fontFiles).toEqual(['/fonts/a.ttf']);
  });

  it('rasterises at the requested scale', () => {
    const frame = textFrame('hello', { columns: 10 });
    // Compared against the SVG's own width: the result's `width` comes back
    // from the rasteriser, which is mocked here.
    const svgWidth = renderSvg(frame, GEOMETRY).width;
    renderPng(frame, { ...GEOMETRY, scale: 3 });
    expect(lastOptions().fitTo).toEqual({ mode: 'width', value: svgWidth * 3 });
  });
});
