import { describe, expect, it } from 'vitest';
import { cell, gridFrame, textFrame } from './__fixtures__/grid.js';
import { loadFonts } from './font.js';
import { renderSvg } from './svg.js';
import { LIGHT_THEME } from './theme.js';

/** Text mode never touches a font, so its output is identical everywhere. */
const TEXT_MODE = { glyphs: 'text' } as const;

const hasSystemFont = loadFonts().available;

describe('renderSvg geometry', () => {
  it('sizes the canvas from the grid, not from the content', () => {
    const shot = renderSvg(textFrame('hi', { columns: 10 }), {
      ...TEXT_MODE,
      fontSize: 10,
      cellWidth: 6,
      lineHeight: 12,
      padding: 4,
    });
    expect(shot.width).toBe(4 * 2 + 10 * 6);
    expect(shot.height).toBe(4 * 2 + 1 * 12);
    expect(shot.svg).toContain('viewBox="0 0 68 20"');
  });

  it('places every cell on the column grid', () => {
    const shot = renderSvg(textFrame('abc'), {
      ...TEXT_MODE,
      cellWidth: 10,
      padding: 0,
      fontSize: 10,
    });
    // text-anchor is middle, so each character sits at its cell's centre.
    expect(shot.svg).toContain('x="5 15 25"');
  });

  it('gives a double-width cell two columns and skips its continuation', () => {
    const frame = gridFrame([
      [cell({ char: '漢', width: 2 }), cell({ char: '', width: 0 }), cell({ char: 'a' })],
    ]);
    const shot = renderSvg(frame, { ...TEXT_MODE, cellWidth: 10, padding: 0, fontSize: 10 });
    // 漢 centred across columns 0–1 (x=10), 'a' centred in column 2 (x=25):
    // the continuation cell consumes a column but never a glyph.
    expect(shot.svg).toContain('x="10 25"');
    expect(shot.svg).toContain('>漢a<');
    expect(shot.width).toBe(30);
  });

  it('keeps an emoji on the two columns the emulator gave it', () => {
    const frame = gridFrame([
      [cell({ char: '🚀', width: 2 }), cell({ char: '', width: 0 }), cell({ char: 'x' })],
    ]);
    const shot = renderSvg(frame, { ...TEXT_MODE, cellWidth: 8, padding: 0, fontSize: 10 });
    expect(shot.svg).toContain('>🚀x<');
    expect(shot.svg).toContain('x="8 20"');
    expect(shot.width).toBe(24);
  });
});

describe('renderSvg colours', () => {
  it('resolves palette and rgb colours', () => {
    const frame = gridFrame([
      [
        cell({ char: 'a', fg: { kind: 'palette', index: 1 } }),
        cell({ char: 'b', fg: { kind: 'rgb', r: 18, g: 52, b: 86 } }),
      ],
    ]);
    const shot = renderSvg(frame, TEXT_MODE);
    expect(shot.svg).toContain('fill="#cd3131"');
    expect(shot.svg).toContain('fill="#123456"');
  });

  it('paints background runs as one rect per run', () => {
    const red: import('@termwright/driver').CellColor = { kind: 'palette', index: 1 };
    const frame = gridFrame([
      [
        cell({ char: 'a', bg: red }),
        cell({ char: 'b', bg: red }),
        cell({ char: 'c' }),
        cell({ char: 'd', bg: red }),
      ],
    ]);
    const shot = renderSvg(frame, { ...TEXT_MODE, cellWidth: 10, padding: 0, lineHeight: 12 });
    const rects = [...shot.svg.matchAll(/<rect [^>]*fill="#cd3131"[^>]*\/>/g)];
    expect(rects).toHaveLength(2);
    expect(rects[0]?.[0]).toContain('width="20"');
    expect(rects[1]?.[0]).toContain('x="30"');
  });

  it('swaps foreground and background for inverse cells', () => {
    const frame = gridFrame([[cell({ char: 'a', attributes: { inverse: true } })]]);
    const shot = renderSvg(frame, TEXT_MODE);
    // Default fg on default bg, inverted: dark glyph on a light block.
    expect(shot.svg).toContain('fill="#d4d4d4"');
    expect(shot.svg).toContain('fill="#141414"');
  });

  it('honours a supplied theme', () => {
    const shot = renderSvg(textFrame('a'), { ...TEXT_MODE, theme: LIGHT_THEME });
    expect(shot.svg).toContain(`fill="${LIGHT_THEME.background}"`);
    expect(shot.svg).toContain(`fill="${LIGHT_THEME.foreground}"`);
  });
});

describe('renderSvg attributes', () => {
  it('emits weight, style and decorations', () => {
    const frame = gridFrame([
      [
        cell({ char: 'b', attributes: { bold: true } }),
        cell({ char: 'i', attributes: { italic: true } }),
        cell({ char: 'u', attributes: { underline: true } }),
        cell({ char: 's', attributes: { strikethrough: true } }),
        cell({ char: 'd', attributes: { dim: true } }),
      ],
    ]);
    const shot = renderSvg(frame, TEXT_MODE);
    expect(shot.svg).toContain('font-weight="bold"');
    expect(shot.svg).toContain('font-style="italic"');
    expect(shot.svg).toContain('opacity="0.6"');
    // One rect for the underline and one for the strikethrough.
    expect([...shot.svg.matchAll(/<rect [^>]*height="1"/g)]).toHaveLength(2);
  });
});

describe('renderSvg cursor', () => {
  it('draws a block cursor and inverts the glyph under it', () => {
    const frame = gridFrame([[cell({ char: 'a' })]], {
      cursor: { row: 0, column: 0, visible: true, shape: 'block' },
    });
    const shot = renderSvg(frame, { ...TEXT_MODE, cellWidth: 10, lineHeight: 12, padding: 0 });
    expect(shot.svg).toContain('<rect x="0" y="0" width="10" height="12" fill="#d4d4d4"/>');
    expect(shot.svg).toContain('fill="#141414"');
  });

  it('draws bar and underline cursors as thin rects', () => {
    const bar = renderSvg(
      gridFrame([[cell({ char: 'a' })]], {
        cursor: { row: 0, column: 0, visible: true, shape: 'bar' },
      }),
      { ...TEXT_MODE, cellWidth: 10, lineHeight: 12, padding: 0, fontSize: 16 },
    );
    expect(bar.svg).toContain('<rect x="0" y="0" width="2" height="12"');

    const underline = renderSvg(
      gridFrame([[cell({ char: 'a' })]], {
        cursor: { row: 0, column: 0, visible: true, shape: 'underline' },
      }),
      { ...TEXT_MODE, cellWidth: 10, lineHeight: 12, padding: 0, fontSize: 16 },
    );
    expect(underline.svg).toContain('<rect x="0" y="10" width="10" height="2"');
  });

  it('skips a hidden cursor and obeys cursor: false', () => {
    const hidden = renderSvg(
      gridFrame([[cell({ char: 'a' })]], {
        cursor: { row: 0, column: 0, visible: false },
      }),
      TEXT_MODE,
    );
    expect(hidden.svg).not.toContain('fill="#d4d4d4"/>');

    const disabled = renderSvg(
      gridFrame([[cell({ char: 'a' })]], {
        cursor: { row: 0, column: 0, visible: true },
      }),
      { ...TEXT_MODE, cursor: false },
    );
    expect(disabled.svg).not.toContain('height="19.2" fill="#d4d4d4"');
  });
});

describe('renderSvg escaping', () => {
  it('escapes XML metacharacters in cell content', () => {
    const shot = renderSvg(textFrame('<&">'), TEXT_MODE);
    expect(shot.svg).toContain('&lt;&amp;&quot;&gt;');
    expect(shot.svg).not.toMatch(/>[^<]*<&/);
  });

  it('produces a single well-formed root element', () => {
    const shot = renderSvg(textFrame('ok'), TEXT_MODE);
    expect(shot.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(shot.svg.trimEnd().endsWith('</svg>')).toBe(true);
    expect([...shot.svg.matchAll(/<svg/g)]).toHaveLength(1);
  });
});

describe('renderSvg golden output', () => {
  it('renders a known grid byte-for-byte', () => {
    const frame = gridFrame(
      [
        [
          cell({ char: 'o', fg: { kind: 'palette', index: 2 } }),
          cell({ char: 'k', fg: { kind: 'palette', index: 2 } }),
        ],
        [cell({ char: '!', attributes: { bold: true } })],
      ],
      { columns: 3 },
    );
    const shot = renderSvg(frame, {
      ...TEXT_MODE,
      fontSize: 10,
      cellWidth: 6,
      lineHeight: 12,
      padding: 2,
    });
    expect(shot.svg).toBe(
      [
        '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="28" viewBox="0 0 22 28">',
        '<rect width="22" height="28" fill="#141414"/>',
        '<g font-family="ui-monospace, SFMono-Regular, &apos;SF Mono&apos;, Menlo, Consolas, &apos;DejaVu Sans Mono&apos;, monospace" font-size="10" text-anchor="middle" xml:space="preserve">',
        '<text x="5 11" y="11" fill="#0dbc79">ok</text>',
        '<text x="5" y="23" fill="#d4d4d4" font-weight="bold">!</text>',
        '</g>',
        '</svg>',
        '',
      ].join('\n'),
    );
  });
});

describe('renderSvg outline mode', () => {
  it.runIf(hasSystemFont)('embeds glyph outlines and reuses them across cells', () => {
    const shot = renderSvg(textFrame('aa b'), { fontSize: 16 });
    expect(shot.selfContained).toBe(true);
    expect(shot.fallbackCharacters).toEqual([]);
    expect(shot.fontsUsed.length).toBeGreaterThan(0);
    expect(shot.svg).toContain('<defs>');
    // Two 'a' cells, one 'b': three uses but only two path definitions.
    expect([...shot.svg.matchAll(/<path id=/g)]).toHaveLength(2);
    expect([...shot.svg.matchAll(/<use /g)]).toHaveLength(3);
    expect(shot.svg).not.toContain('<text');
  });

  it.runIf(hasSystemFont)('derives the cell width from the font advance', () => {
    const shot = renderSvg(textFrame('aaaa'), { fontSize: 16, padding: 0 });
    // A monospace advance is around 0.6em; the canvas must be a clean multiple.
    expect(shot.width / 4).toBeGreaterThan(16 * 0.4);
    expect(shot.width / 4).toBeLessThan(16 * 0.8);
  });

  it.runIf(hasSystemFont)('falls back to text for characters the font lacks', () => {
    // U+F0000 is a private-use plane character no system font covers.
    const shot = renderSvg(textFrame(`a\u{F0000}`), { fontSize: 16 });
    expect(shot.selfContained).toBe(false);
    expect(shot.fallbackCharacters).toEqual(['\u{F0000}']);
    expect(shot.svg).toContain('<use ');
    expect(shot.svg).toContain('<text ');
  });

  it.runIf(hasSystemFont)('uses a real italic face when the system has one', () => {
    const frame = gridFrame([
      [cell({ char: 'a' }), cell({ char: 'b', attributes: { italic: true } })],
    ]);
    const shot = renderSvg(frame, { fontSize: 16, padding: 0 });
    expect(shot.svg).toMatch(/<use href="#[^"]+" x="[\d.]+" y="[\d.]+"/);

    if (loadFonts().hasFace({ italic: true })) {
      // A real face carries the slant; shearing it too would double it.
      expect(shot.svg).not.toContain('skewX');
    } else {
      expect(shot.svg).toContain('skewX(-12)');
    }
  });

  it.runIf(hasSystemFont)('synthesises bold only when no bold face is available', () => {
    const frame = gridFrame([[cell({ char: 'a', attributes: { bold: true } })]]);
    const shot = renderSvg(frame, { fontSize: 24, padding: 0 });

    if (loadFonts().hasFace({ bold: true })) {
      expect(shot.svg).not.toContain('stroke-width');
    } else {
      expect(shot.svg).toContain('stroke-width="1"');
    }
  });

  it.runIf(hasSystemFont)('draws a colour emoji as an embedded image, not text', () => {
    const frame = gridFrame([[cell({ char: '🚀', width: 2 }), cell({ char: '', width: 0 })]]);
    const shot = renderSvg(frame, { fontSize: 16, padding: 0 });
    if (loadFonts().glyphFor('🚀')?.kind !== 'image') return;

    expect(shot.selfContained).toBe(true);
    expect(shot.fallbackCharacters).toEqual([]);
    expect(shot.svg).toContain('<image id=');
    expect(shot.svg).toContain('href="data:image/png;base64,');
    expect(shot.svg).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(shot.svg).not.toContain('<text');
    // The image box is the two columns the emulator gave the emoji, by one
    // line — the cell advance comes from the font, so compare, do not hardcode.
    const box = /<image id="[^"]*" width="([\d.]+)" height="([\d.]+)"/.exec(shot.svg);
    expect(Number(box?.[1])).toBeCloseTo(shot.width, 3);
    expect(Number(box?.[2])).toBeCloseTo(16 * 1.2, 3);
  });

  it.runIf(hasSystemFont)('never paints over a colour glyph with the cell foreground', () => {
    const frame = gridFrame([
      [
        cell({ char: '🚀', width: 2, fg: { kind: 'palette', index: 1 } }),
        cell({ char: '', width: 0 }),
      ],
    ]);
    const shot = renderSvg(frame, { fontSize: 16, padding: 0 });
    if (loadFonts().glyphFor('🚀')?.kind !== 'image') return;
    const use = /<use [^>]*>/.exec(shot.svg)?.[0] ?? '';
    expect(use).not.toContain('fill=');
  });

  it('degrades to text mode when no font can be loaded', () => {
    const shot = renderSvg(textFrame('hi'), { font: { files: ['/nope.ttf'], system: false } });
    expect(shot.selfContained).toBe(false);
    expect(shot.fontsUsed).toEqual([]);
    expect(shot.svg).toContain('<text ');
    expect(shot.svg).not.toContain('<defs>');
  });
});
