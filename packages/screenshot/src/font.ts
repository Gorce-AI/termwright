/**
 * Font loading and glyph-outline extraction.
 *
 * Outlines are what make a screenshot trustworthy: a `<path>` renders the same
 * on a machine that has never heard of the font, which is the whole point when
 * the screen is full of Nerd Font icons. Characters no configured font covers
 * fall back to `<text>`, and the caller is told which ones so it knows the file
 * is not fully self-contained.
 */

import { openSync, type Font, type FontCollection } from 'fontkit';

/** Metrics of the primary font, in font units. */
export interface FontMetrics {
  readonly unitsPerEm: number;
  readonly ascent: number;
  readonly descent: number;
  /** Advance of a representative glyph; the cell width in a monospace font. */
  readonly advanceWidth: number;
}

/** One glyph outline, in font units with the Y axis pointing up. */
export interface GlyphOutline {
  /** Stable id for `<defs>` deduplication. */
  readonly id: string;
  /** SVG path data in font units. */
  readonly path: string;
  readonly advanceWidth: number;
  readonly unitsPerEm: number;
}

/** Font files to consider, in priority order. */
export interface FontSetOptions {
  readonly files?: readonly string[];
  readonly system?: boolean;
}

/**
 * Platform fonts tried when no file is configured.
 *
 * The monospace face comes first — it sets the cell advance and covers Latin,
 * box drawing and most Nerd Font ranges. The faces after it exist only for
 * coverage: a Latin monospace font has no CJK, and falling through to `<text>`
 * for a screen of Japanese would give up self-containment for a whole column of
 * the output.
 */
const SYSTEM_FONTS: Readonly<Record<string, readonly string[]>> = {
  darwin: [
    '/System/Library/Fonts/Menlo.ttc',
    '/System/Library/Fonts/SFNSMono.ttf',
    '/System/Library/Fonts/Courier.ttc',
    '/System/Library/Fonts/PingFang.ttc',
    '/System/Library/Fonts/Hiragino Sans GB.ttc',
    '/System/Library/Fonts/Apple Symbols.ttf',
  ],
  linux: [
    '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
    '/usr/share/fonts/TTF/DejaVuSansMono.ttf',
    '/usr/share/fonts/dejavu/DejaVuSansMono.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf',
    '/usr/share/fonts/liberation-mono/LiberationMono-Regular.ttf',
    '/usr/share/fonts/truetype/freefont/FreeMono.ttf',
    '/usr/share/fonts/gnu-free/FreeMono.ttf',
    '/usr/share/fonts/truetype/noto/NotoSansMono-Regular.ttf',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
  ],
  win32: [
    'C:\\Windows\\Fonts\\consola.ttf',
    'C:\\Windows\\Fonts\\cour.ttf',
    'C:\\Windows\\Fonts\\msgothic.ttc',
  ],
};

/**
 * A prioritised set of fonts, queried per character.
 *
 * Glyph lookups are cached, which matters: a 100×30 screen asks for 3000
 * glyphs drawn from a few dozen distinct characters.
 */
export class FontSet {
  readonly #fonts: readonly { font: Font; file: string }[];
  readonly #cache = new Map<number, GlyphOutline | null>();
  readonly #used = new Set<string>();

  /** @internal Use {@link loadFonts}. */
  constructor(fonts: readonly { font: Font; file: string }[]) {
    this.#fonts = fonts;
  }

  /** `true` when at least one font loaded and outlines can be embedded. */
  get available(): boolean {
    return this.#fonts.length > 0;
  }

  /** Files whose glyphs actually ended up in the output. */
  get used(): readonly string[] {
    return [...this.#used];
  }

  /** Metrics of the first loaded font, or `null` when none loaded. */
  get metrics(): FontMetrics | null {
    const primary = this.#fonts[0]?.font;
    if (primary === undefined) return null;
    return {
      unitsPerEm: primary.unitsPerEm,
      ascent: primary.ascent,
      descent: primary.descent,
      advanceWidth: representativeAdvance(primary),
    };
  }

  /**
   * The outline for a character, or `null` when no font covers it.
   *
   * A font that maps the character to `.notdef` (glyph 0) counts as not
   * covering it — otherwise CJK on a Latin-only font would render as a row of
   * identical empty boxes that look like a rendering bug.
   */
  outlineFor(char: string): GlyphOutline | null {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) return null;
    const cached = this.#cache.get(codePoint);
    if (cached !== undefined) return cached;

    let outline: GlyphOutline | null = null;
    for (const [index, entry] of this.#fonts.entries()) {
      const glyph = safeGlyph(entry.font, codePoint);
      if (glyph === null || glyph.id === 0) continue;
      outline = {
        id: `g${index}-${glyph.id}`,
        path: glyph.path.toSVG(),
        advanceWidth: glyph.advanceWidth,
        unitsPerEm: entry.font.unitsPerEm,
      };
      this.#used.add(entry.file);
      break;
    }
    this.#cache.set(codePoint, outline);
    return outline;
  }
}

/**
 * Loads fonts from explicit paths, then from platform defaults.
 *
 * Unreadable or unsupported files are skipped rather than thrown: a missing
 * font degrades a screenshot to `<text>`, it does not fail a test run.
 */
export function loadFonts(options: FontSetOptions = {}): FontSet {
  const candidates = [
    ...(options.files ?? []),
    ...(options.system === false ? [] : systemCandidates()),
  ];
  const loaded: { font: Font; file: string }[] = [];
  for (const file of candidates) {
    const font = openFont(file);
    if (font !== null) loaded.push({ font, file });
  }
  return new FontSet(loaded);
}

/** Platform default font paths, plus the `TERMWRIGHT_FONT` override. */
export function systemCandidates(platform: NodeJS.Platform = process.platform): readonly string[] {
  const override = process.env['TERMWRIGHT_FONT'];
  const defaults = SYSTEM_FONTS[platform] ?? [];
  return override === undefined || override === '' ? defaults : [override, ...defaults];
}

function openFont(file: string): Font | null {
  let opened: Font | FontCollection;
  try {
    opened = openSync(file);
  } catch {
    return null;
  }
  if (isCollection(opened)) {
    // TrueType collections hold a family; the first face is the regular one.
    const first = opened.fonts[0];
    return first ?? null;
  }
  return opened;
}

function isCollection(value: Font | FontCollection): value is FontCollection {
  return Array.isArray((value as FontCollection).fonts);
}

function safeGlyph(font: Font, codePoint: number): ReturnType<Font['glyphForCodePoint']> | null {
  try {
    return font.glyphForCodePoint(codePoint);
  } catch {
    return null;
  }
}

/** Advance of `M`, falling back to the font's own maximum advance. */
function representativeAdvance(font: Font): number {
  const glyph = safeGlyph(font, 0x4d);
  if (glyph !== null && glyph.advanceWidth > 0) return glyph.advanceWidth;
  return font.unitsPerEm * 0.6;
}
