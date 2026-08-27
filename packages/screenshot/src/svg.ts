/**
 * {@link renderSvg} — a terminal cell grid as a standalone SVG.
 *
 * Geometry comes from the grid: cell `(row, column)` is drawn at
 * `padding + column × cellWidth`, whatever the character is. That is what keeps
 * emoji, CJK and Nerd Font icons aligned — a double-width cell occupies exactly
 * two columns because the emulator said so, not because a font said so.
 */

import type { CellSnapshot } from '@termwright/driver';
import { loadFonts, type FontSet, type Glyph } from './font.js';
import { DEFAULT_THEME, buildPalette, resolveColor } from './theme.js';
import type { ScreenFrame, ScreenshotOptions, ScreenshotSvg } from './types.js';

const DEFAULT_FONT_FAMILY =
  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace";

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fill: string;
  readonly opacity?: number;
}

interface GlyphUse {
  readonly href: string;
  readonly x: number;
  readonly y: number;
  readonly fill: string;
  readonly opacity: number;
  /** Synthesis flags: only set when no real face supplied the style. */
  readonly bold: boolean;
  readonly italic: boolean;
  /** Colour glyphs carry their own paint and ignore the cell foreground. */
  readonly painted: boolean;
}

interface TextRun {
  xs: number[];
  chars: string;
  readonly y: number;
  readonly fill: string;
  readonly opacity: number;
  readonly bold: boolean;
  readonly italic: boolean;
}

interface CellStyle {
  readonly fg: string;
  readonly bg: string;
  readonly opacity: number;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly strikethrough: boolean;
}

/**
 * Renders a frame to SVG.
 *
 * @example
 * ```ts
 * const shot = renderSvg(harness.screen(), { fontSize: 15 });
 * if (!shot.selfContained) {
 *   console.warn('no outline for', shot.fallbackCharacters.join(''));
 * }
 * await writeFile('screen.svg', shot.svg);
 * ```
 */
export function renderSvg(frame: ScreenFrame, options: ScreenshotOptions = {}): ScreenshotSvg {
  const theme = options.theme ?? DEFAULT_THEME;
  const palette = buildPalette(theme);
  const fontSize = options.fontSize ?? 16;
  const padding = options.padding ?? 8;
  const family = options.font?.family ?? DEFAULT_FONT_FAMILY;
  const wantsOutlines = options.glyphs !== 'text';

  const fonts: FontSet | null = wantsOutlines
    ? loadFonts({
        ...(options.font?.files === undefined ? {} : { files: options.font.files }),
        ...(options.font?.system === undefined ? {} : { system: options.font.system }),
      })
    : null;
  const metrics = fonts?.metrics ?? null;

  const scale = metrics === null ? 0 : fontSize / metrics.unitsPerEm;
  const cellWidth =
    options.cellWidth ?? (metrics === null ? fontSize * 0.6 : metrics.advanceWidth * scale);
  const lineHeight = options.lineHeight ?? fontSize * 1.2;
  const ascent = metrics === null ? fontSize * 0.8 : metrics.ascent * scale;
  const descent = metrics === null ? -fontSize * 0.2 : metrics.descent * scale;
  const baselineOffset = (lineHeight - (ascent - descent)) / 2 + ascent;

  const width = padding * 2 + frame.columns * cellWidth;
  const height = padding * 2 + frame.rows * lineHeight;

  const backgrounds: Rect[] = [];
  const decorations: Rect[] = [];
  const uses: GlyphUse[] = [];
  const textRuns: TextRun[] = [];
  const defs = new Map<string, Glyph>();
  const images = new Map<string, { glyph: Glyph; width: number; height: number }>();
  const fallback = new Set<string>();

  const cursor = resolveCursor(frame, options, theme, {
    padding,
    cellWidth,
    lineHeight,
    fontSize,
  });

  for (let row = 0; row < frame.rows; row += 1) {
    const rowY = padding + row * lineHeight;
    const baseline = rowY + baselineOffset;
    let backgroundRun: { start: number; end: number; fill: string } | null = null;
    let textRun: TextRun | null = null;

    const flushBackground = (): void => {
      if (backgroundRun === null) return;
      backgrounds.push({
        x: padding + backgroundRun.start * cellWidth,
        y: rowY,
        width: (backgroundRun.end - backgroundRun.start) * cellWidth,
        height: lineHeight,
        fill: backgroundRun.fill,
      });
      backgroundRun = null;
    };
    const flushText = (): void => {
      if (textRun !== null && textRun.chars !== '') textRuns.push(textRun);
      textRun = null;
    };

    for (let column = 0; column < frame.columns; column += 1) {
      const cell = safeCell(frame, row, column);
      if (cell === null || cell.width === 0) continue;
      const span = cell.width === 2 ? 2 : 1;
      const style = styleOf(cell, palette, theme);
      const x = padding + column * cellWidth;

      if (style.bg === theme.background) {
        flushBackground();
      } else if (backgroundRun !== null && backgroundRun.fill === style.bg) {
        backgroundRun.end = column + span;
      } else {
        flushBackground();
        backgroundRun = { start: column, end: column + span, fill: style.bg };
      }

      const onCursor = cursor !== null && cursor.row === row && cursor.column === column;
      const fill = onCursor && cursor.solid ? theme.background : style.fg;

      if (style.underline) {
        decorations.push({
          x,
          y: baseline + Math.max(1, fontSize / 14),
          width: cellWidth * span,
          height: Math.max(1, fontSize / 16),
          fill,
          opacity: style.opacity,
        });
      }
      if (style.strikethrough) {
        decorations.push({
          x,
          y: baseline - ascent * 0.3,
          width: cellWidth * span,
          height: Math.max(1, fontSize / 16),
          fill,
          opacity: style.opacity,
        });
      }

      const char = cell.char;
      if (char === '' || char === ' ') {
        flushText();
        continue;
      }

      const glyph = fonts?.glyphFor(char, { bold: style.bold, italic: style.italic }) ?? null;
      if (glyph !== null) {
        flushText();
        // A real face already carries the style; only synthesise what the
        // loaded faces could not supply.
        const synthesise = fonts !== null && !fonts.hasFace(style);
        if (glyph.kind === 'image') {
          const boxWidth = cellWidth * span;
          const key = `${glyph.id}@${n(boxWidth)}x${n(lineHeight)}`;
          images.set(key, { glyph, width: boxWidth, height: lineHeight });
          uses.push({
            href: key,
            x,
            y: rowY,
            fill,
            opacity: style.opacity,
            bold: false,
            italic: false,
            painted: true,
          });
          continue;
        }
        defs.set(glyph.id, glyph);
        const advance = glyph.advanceWidth * (fontSize / glyph.unitsPerEm);
        uses.push({
          href: glyph.id,
          x: x + (cellWidth * span - advance) / 2,
          y: baseline,
          fill,
          opacity: style.opacity,
          bold: synthesise && style.bold,
          italic: synthesise && style.italic,
          painted: glyph.kind === 'layers',
        });
        continue;
      }

      fallback.add(char);
      if (
        textRun === null ||
        textRun.fill !== fill ||
        textRun.opacity !== style.opacity ||
        textRun.bold !== style.bold ||
        textRun.italic !== style.italic
      ) {
        flushText();
        textRun = {
          xs: [],
          chars: '',
          y: baseline,
          fill,
          opacity: style.opacity,
          bold: style.bold,
          italic: style.italic,
        };
      }
      textRun.xs.push(x + (cellWidth * span) / 2);
      textRun.chars += char;
    }
    flushBackground();
    flushText();
  }

  const svg = assemble({
    width,
    height,
    theme,
    fontSize,
    family,
    defs,
    images,
    backgrounds,
    decorations,
    uses,
    textRuns,
    cursor,
  });

  return {
    svg,
    width,
    height,
    selfContained: fallback.size === 0,
    fallbackCharacters: [...fallback].sort(),
    fontsUsed: fonts?.used ?? [],
  };
}

interface CursorRender {
  readonly row: number;
  readonly column: number;
  /** A block cursor covers the cell, so its glyph is drawn in the background colour. */
  readonly solid: boolean;
  readonly rect: Rect;
}

function resolveCursor(
  frame: ScreenFrame,
  options: ScreenshotOptions,
  theme: { cursor: string },
  layout: { padding: number; cellWidth: number; lineHeight: number; fontSize: number },
): CursorRender | null {
  const cursor = frame.cursor;
  if (options.cursor === false || cursor === undefined || !cursor.visible) return null;
  if (cursor.row < 0 || cursor.row >= frame.rows) return null;
  if (cursor.column < 0 || cursor.column >= frame.columns) return null;

  const cell = safeCell(frame, cursor.row, cursor.column);
  const span = cell?.width === 2 ? 2 : 1;
  const x = layout.padding + cursor.column * layout.cellWidth;
  const y = layout.padding + cursor.row * layout.lineHeight;
  const thickness = Math.max(1, layout.fontSize / 8);

  switch (cursor.shape) {
    case 'underline':
      return {
        row: cursor.row,
        column: cursor.column,
        solid: false,
        rect: {
          x,
          y: y + layout.lineHeight - thickness,
          width: layout.cellWidth * span,
          height: thickness,
          fill: theme.cursor,
        },
      };
    case 'bar':
      return {
        row: cursor.row,
        column: cursor.column,
        solid: false,
        rect: { x, y, width: thickness, height: layout.lineHeight, fill: theme.cursor },
      };
    default:
      return {
        row: cursor.row,
        column: cursor.column,
        solid: true,
        rect: {
          x,
          y,
          width: layout.cellWidth * span,
          height: layout.lineHeight,
          fill: theme.cursor,
        },
      };
  }
}

function safeCell(frame: ScreenFrame, row: number, column: number): CellSnapshot | null {
  try {
    return frame.cell(row, column);
  } catch {
    return null;
  }
}

function styleOf(
  cell: CellSnapshot,
  palette: readonly string[],
  theme: { foreground: string; background: string },
): CellStyle {
  let fg = resolveColor(cell.fg, palette, theme.foreground);
  let bg = resolveColor(cell.bg, palette, theme.background);
  if (cell.attributes.inverse) {
    const swap = fg;
    fg = bg;
    bg = swap;
  }
  return {
    fg,
    bg,
    opacity: cell.attributes.dim ? 0.6 : 1,
    bold: cell.attributes.bold,
    italic: cell.attributes.italic,
    underline: cell.attributes.underline,
    strikethrough: cell.attributes.strikethrough,
  };
}

interface AssembleInput {
  readonly width: number;
  readonly height: number;
  readonly theme: { background: string };
  readonly fontSize: number;
  readonly family: string;
  readonly defs: ReadonlyMap<string, Glyph>;
  readonly images: ReadonlyMap<string, { glyph: Glyph; width: number; height: number }>;
  readonly backgrounds: readonly Rect[];
  readonly decorations: readonly Rect[];
  readonly uses: readonly GlyphUse[];
  readonly textRuns: readonly TextRun[];
  readonly cursor: CursorRender | null;
}

function assemble(input: AssembleInput): string {
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(input.width)}" height="${n(
      input.height,
    )}" viewBox="0 0 ${n(input.width)} ${n(input.height)}">`,
  );
  parts.push(
    `<rect width="${n(input.width)}" height="${n(input.height)}" fill="${input.theme.background}"/>`,
  );

  if (input.defs.size > 0 || input.images.size > 0) {
    parts.push('<defs>');
    for (const glyph of input.defs.values()) {
      const scale = input.fontSize / glyph.unitsPerEm;
      const transform = `transform="scale(${n(scale, 6)},${n(-scale, 6)})"`;
      if (glyph.kind === 'outline') {
        parts.push(`<path id="${glyph.id}" d="${glyph.path}" ${transform}/>`);
      } else if (glyph.kind === 'layers') {
        // Colours are baked per layer, so a `<use>` fill never reaches them.
        const layers = glyph.layers
          .map((layer) => `<path d="${layer.path}" fill="${layer.color}"/>`)
          .join('');
        parts.push(`<g id="${glyph.id}" ${transform}>${layers}</g>`);
      }
    }
    for (const [key, image] of input.images) {
      if (image.glyph.kind !== 'image') continue;
      parts.push(
        `<image id="${escapeXml(key)}" width="${n(image.width)}" height="${n(
          image.height,
        )}" preserveAspectRatio="xMidYMid meet" href="data:${
          image.glyph.mediaType
        };base64,${image.glyph.base64}"/>`,
      );
    }
    parts.push('</defs>');
  }

  for (const rect of input.backgrounds) parts.push(rectTag(rect));
  if (input.cursor !== null) parts.push(rectTag(input.cursor.rect));

  // Outlines come from the regular face; bold is synthesised by stroking the
  // glyph, the same trick a terminal emulator uses when it has no bold face.
  const boldStroke = n(Math.max(0.3, input.fontSize / 24), 2);
  for (const use of input.uses) {
    const bold = use.bold ? ` stroke="${use.fill}" stroke-width="${boldStroke}"` : '';
    const paint = use.painted ? '' : ` fill="${use.fill}"`;
    const opacity = use.opacity === 1 ? '' : ` opacity="${n(use.opacity, 2)}"`;
    // Italic is a shear about the baseline, for the same reason bold is a
    // stroke: the outlines come from the regular face. `x`/`y` cannot be used
    // alongside a transform without fighting over the order they apply in, so
    // the placement moves into the transform.
    const placement = use.italic
      ? `transform="translate(${n(use.x)},${n(use.y)}) skewX(-12)"`
      : `x="${n(use.x)}" y="${n(use.y)}"`;
    parts.push(`<use href="#${escapeXml(use.href)}" ${placement}${paint}${bold}${opacity}/>`);
  }

  if (input.textRuns.length > 0) {
    parts.push(
      `<g font-family="${escapeXml(input.family)}" font-size="${n(
        input.fontSize,
      )}" text-anchor="middle" xml:space="preserve">`,
    );
    for (const run of input.textRuns) {
      const weight = run.bold ? ' font-weight="bold"' : '';
      const style = run.italic ? ' font-style="italic"' : '';
      const opacity = run.opacity === 1 ? '' : ` opacity="${n(run.opacity, 2)}"`;
      parts.push(
        `<text x="${run.xs.map((value) => n(value)).join(' ')}" y="${n(run.y)}" fill="${
          run.fill
        }"${weight}${style}${opacity}>${escapeXml(run.chars)}</text>`,
      );
    }
    parts.push('</g>');
  }

  for (const rect of input.decorations) parts.push(rectTag(rect));
  parts.push('</svg>');
  return `${parts.join('\n')}\n`;
}

function rectTag(rect: Rect): string {
  const opacity =
    rect.opacity === undefined || rect.opacity === 1 ? '' : ` opacity="${n(rect.opacity, 2)}"`;
  return `<rect x="${n(rect.x)}" y="${n(rect.y)}" width="${n(rect.width)}" height="${n(
    rect.height,
  )}" fill="${rect.fill}"${opacity}/>`;
}

/** Fixed-precision number formatting, so output is byte-stable across runs. */
function n(value: number, precision = 3): string {
  const rounded = Number(value.toFixed(precision));
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

/** Escapes text for XML content and attribute values. */
export function escapeXml(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (char === '&') out += '&amp;';
    else if (char === '<') out += '&lt;';
    else if (char === '>') out += '&gt;';
    else if (char === '"') out += '&quot;';
    else if (char === "'") out += '&apos;';
    else if (code < 0x20 && char !== '\t' && char !== '\n') out += ' ';
    else out += char;
  }
  return out;
}
