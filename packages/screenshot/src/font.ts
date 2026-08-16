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

/** Shared by every glyph representation. */
interface GlyphBase {
  /** Stable id for `<defs>` deduplication. */
  readonly id: string;
  readonly advanceWidth: number;
  readonly unitsPerEm: number;
}

/** A monochrome outline, in font units with the Y axis pointing up. */
export interface GlyphOutline extends GlyphBase {
  readonly kind: 'outline';
  /** SVG path data in font units. */
  readonly path: string;
}

/**
 * A colour glyph built from `COLR`/`CPAL` layers: stacked outlines, each with
 * its own palette colour. The colours come from the font, so a layered glyph
 * ignores the cell's foreground.
 */
export interface GlyphLayers extends GlyphBase {
  readonly kind: 'layers';
  readonly layers: readonly { readonly path: string; readonly color: string }[];
}

/**
 * A bitmap glyph lifted out of an `sbix`/`CBDT` strike — how Apple Color Emoji
 * and Noto's bitmap builds store their artwork. Embedded as a data URI, which
 * keeps the SVG self-contained.
 */
export interface GlyphImage extends GlyphBase {
  readonly kind: 'image';
  readonly mediaType: string;
  /** Base64 image bytes, ready for a `data:` URI. */
  readonly base64: string;
}

/** What a font can give us for one character. */
export type Glyph = GlyphOutline | GlyphLayers | GlyphImage;

/** Which face to draw a cell with. */
export interface FaceRequest {
  readonly bold?: boolean;
  readonly italic?: boolean;
}

/** Pixel size requested from a bitmap strike. */
const BITMAP_STRIKE_PPEM = 96;

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
 * coverage: a Latin monospace font has no CJK and no emoji, and falling
 * through to `<text>` for a screen of Japanese would give up self-containment
 * for a whole column of the output. The colour emoji font comes last, since it
 * covers nothing else and its glyphs are bitmaps.
 */
const SYSTEM_FONTS: Readonly<Record<string, readonly string[]>> = {
  darwin: [
    '/System/Library/Fonts/Menlo.ttc',
    '/System/Library/Fonts/SFNSMono.ttf',
    '/System/Library/Fonts/Courier.ttc',
    '/System/Library/Fonts/PingFang.ttc',
    '/System/Library/Fonts/Hiragino Sans GB.ttc',
    '/System/Library/Fonts/Apple Symbols.ttf',
    '/System/Library/Fonts/Apple Color Emoji.ttc',
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
    '/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf',
    '/usr/share/fonts/noto/NotoColorEmoji.ttf',
    '/usr/share/fonts/google-noto-emoji/NotoColorEmoji.ttf',
  ],
  win32: [
    'C:\\Windows\\Fonts\\consola.ttf',
    'C:\\Windows\\Fonts\\cour.ttf',
    'C:\\Windows\\Fonts\\msgothic.ttc',
    'C:\\Windows\\Fonts\\seguiemj.ttf',
  ],
};

/**
 * A prioritised set of fonts, queried per character.
 *
 * Glyph lookups are cached, which matters: a 100×30 screen asks for 3000
 * glyphs drawn from a few dozen distinct characters.
 */
export class FontSet {
  readonly #fonts: readonly LoadedFace[];
  readonly #cache = new Map<string, Glyph | null>();
  readonly #used = new Set<string>();

  /** @internal Use {@link loadFonts}. */
  constructor(fonts: readonly LoadedFace[]) {
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

  /** True when a real face exists for this combination of bold and italic. */
  hasFace(face: FaceRequest): boolean {
    return this.#fonts.some(
      (entry) =>
        entry.bold === (face.bold ?? false) && entry.italic === (face.italic ?? false),
    );
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
  glyphFor(char: string, face: FaceRequest = {}): Glyph | null {
    if (char === '') return null;
    const wantBold = face.bold ?? false;
    const wantItalic = face.italic ?? false;
    const key = `${char}:${wantBold ? 'b' : ''}${wantItalic ? 'i' : ''}`;
    const cached = this.#cache.get(key);
    if (cached !== undefined) return cached;

    // Faces matching the requested style first, then everything else: a bold
    // cell prefers the bold face, but a character only the regular face has
    // still beats no glyph at all.
    const ordered = [
      ...this.#fonts.filter((e) => e.bold === wantBold && e.italic === wantItalic),
      ...this.#fonts.filter((e) => e.bold !== wantBold || e.italic !== wantItalic),
    ];

    // U+FE0F is the author saying "emoji presentation, please". Several
    // monochrome fonts also cover those code points, so without this a warning
    // sign written as an emoji would come out as a thin black outline.
    const wantsColour = char.includes('\uFE0F');

    let result: Glyph | null = null;
    let monochromeFallback: { glyph: Glyph; file: string } | null = null;
    for (const entry of ordered) {
      const glyph = resolveGlyph(entry.font, char);
      if (glyph === null) continue;
      const described = describeGlyph(glyph, entry);
      if (described === null) continue;
      if (wantsColour && described.kind === 'outline') {
        monochromeFallback ??= { glyph: described, file: entry.file };
        continue;
      }
      this.#used.add(entry.file);
      result = described;
      break;
    }
    if (result === null && monochromeFallback !== null) {
      this.#used.add(monochromeFallback.file);
      result = monochromeFallback.glyph;
    }
    this.#cache.set(key, result);
    return result;
  }
}

/** One loaded face, with the style flags the font reports about itself. */
export interface LoadedFace {
  readonly font: Font;
  readonly file: string;
  readonly bold: boolean;
  readonly italic: boolean;
  /** Distinguishes ids between faces sharing a glyph id. */
  readonly index: number;
}

/**
 * Picks the richest representation a font offers for a glyph: bitmap strike,
 * then colour layers, then a plain outline.
 *
 * Bitmaps come first because a font that has both (Apple Color Emoji has only
 * `sbix`; some Noto builds ship `CBDT` beside a monochrome `glyf`) means the
 * bitmap is the artwork and the outline is the fallback, not the other way
 * round.
 */
function describeGlyph(glyph: FontkitGlyph, entry: LoadedFace): Glyph | null {
  const base = {
    id: `g${entry.index}-${glyph.id}`,
    advanceWidth: glyph.advanceWidth,
    unitsPerEm: entry.font.unitsPerEm,
  };

  const image = safeImage(glyph);
  if (image !== null) {
    return { ...base, kind: 'image', mediaType: image.mediaType, base64: image.base64 };
  }

  const layers = safeLayers(glyph);
  if (layers !== null && layers.length > 0) {
    return { ...base, kind: 'layers', layers };
  }

  const path = safePath(glyph);
  return path === null ? null : { ...base, kind: 'outline', path };
}

/** The bits of a fontkit glyph this module touches. */
interface FontkitGlyph {
  readonly id: number;
  readonly advanceWidth: number;
  readonly path?: { toSVG(): string };
  readonly layers?: readonly { glyph?: { path?: { toSVG(): string } }; color?: unknown }[];
  getImageForSize?(size: number): { type?: string; data?: Uint8Array } | null | undefined;
}

function safeImage(glyph: FontkitGlyph): { mediaType: string; base64: string } | null {
  if (typeof glyph.getImageForSize !== 'function') return null;
  try {
    const image = glyph.getImageForSize(BITMAP_STRIKE_PPEM);
    if (image?.data === undefined || image.data.length === 0) return null;
    // fontkit reports sbix types as four-byte tags: 'png ', 'jpg ', 'tiff'.
    const tag = (image.type ?? 'png').trim().toLowerCase();
    const mediaType =
      tag === 'jpg' ? 'image/jpeg' : tag === 'tiff' ? 'image/tiff' : 'image/png';
    return { mediaType, base64: Buffer.from(image.data).toString('base64') };
  } catch {
    return null;
  }
}

function safeLayers(
  glyph: FontkitGlyph,
): readonly { path: string; color: string }[] | null {
  try {
    const layers = glyph.layers;
    if (layers === undefined) return null;
    const result: { path: string; color: string }[] = [];
    for (const layer of layers) {
      const path = layer.glyph?.path?.toSVG();
      if (path === undefined || path === '') continue;
      result.push({ path, color: cssColor(layer.color) });
    }
    return result;
  } catch {
    return null;
  }
}

function safePath(glyph: FontkitGlyph): string | null {
  try {
    const path = glyph.path?.toSVG();
    return path === undefined || path === '' ? null : path;
  } catch {
    return null;
  }
}

/** fontkit reports CPAL entries as `{red, green, blue, alpha}` (0–255). */
function cssColor(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || value === null) return '#000000';
  const color = value as { red?: number; green?: number; blue?: number; alpha?: number };
  const part = (channel: number | undefined): string =>
    Math.max(0, Math.min(255, Math.round(channel ?? 0)))
      .toString(16)
      .padStart(2, '0');
  const alpha = color.alpha ?? 255;
  const rgb = `#${part(color.red)}${part(color.green)}${part(color.blue)}`;
  return alpha >= 255 ? rgb : `${rgb}${part(alpha)}`;
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
  const loaded: LoadedFace[] = [];
  for (const file of candidates) {
    for (const font of openFaces(file)) {
      loaded.push({
        font,
        file,
        bold: isBold(font),
        italic: isItalic(font),
        index: loaded.length,
      });
    }
  }
  return new FontSet(loaded);
}

/** Platform default font paths, plus the `TERMWRIGHT_FONT` override. */
export function systemCandidates(platform: NodeJS.Platform = process.platform): readonly string[] {
  const override = process.env['TERMWRIGHT_FONT'];
  const defaults = SYSTEM_FONTS[platform] ?? [];
  return override === undefined || override === '' ? defaults : [override, ...defaults];
}

/**
 * Every face in a file, regular first.
 *
 * A TrueType collection holds a whole family, so `Menlo.ttc` yields the bold
 * and italic faces too — real ones, which beats shearing and stroking the
 * regular face. Ordering puts regular first so it stays the metric source.
 */
function openFaces(file: string): readonly Font[] {
  let opened: Font | FontCollection;
  try {
    opened = openSync(file);
  } catch {
    return [];
  }
  const faces = isCollection(opened) ? [...opened.fonts] : [opened];
  return faces.sort(
    (a, b) => Number(isBold(a) || isItalic(a)) - Number(isBold(b) || isItalic(b)),
  );
}

/** The font's own opinion about its weight, not a guess from its name. */
function isBold(font: Font): boolean {
  const selection = (font as unknown as { 'OS/2'?: { fsSelection?: { bold?: boolean } } })[
    'OS/2'
  ];
  return selection?.fsSelection?.bold === true;
}

function isItalic(font: Font): boolean {
  const selection = (font as unknown as { 'OS/2'?: { fsSelection?: { italic?: boolean } } })[
    'OS/2'
  ];
  if (selection?.fsSelection?.italic === true) return true;
  const post = (font as unknown as { post?: { italicAngle?: number } }).post;
  return typeof post?.italicAngle === 'number' && post.italicAngle !== 0;
}

function isCollection(value: Font | FontCollection): value is FontCollection {
  return Array.isArray((value as FontCollection).fonts);
}

/**
 * The glyph a font draws for one terminal cell.
 *
 * A cell holds a grapheme cluster, which can be several code points: an emoji
 * with a variation selector, a ZWJ family, a base letter with a combining
 * mark. Those are shaped, not looked up — `layout()` applies the font's own
 * substitutions, so `👨‍👩‍👧` resolves to the family glyph instead of the first
 * person in it. Single code points skip shaping entirely.
 */
function resolveGlyph(font: Font, cluster: string): FontkitGlyph | null {
  if ([...cluster].length > 1) {
    try {
      const run = (font as unknown as { layout(text: string): { glyphs?: FontkitGlyph[] } }).layout(
        cluster,
      );
      const glyphs = run.glyphs ?? [];
      const only = glyphs.length === 1 ? glyphs[0] : undefined;
      if (only !== undefined && only.id !== 0) return only;
    } catch {
      // Fall through to the plain lookup below.
    }
  }
  const codePoint = cluster.codePointAt(0);
  if (codePoint === undefined) return null;
  const glyph = safeGlyph(font, codePoint);
  return glyph === null || glyph.id === 0 ? null : glyph;
}

function safeGlyph(font: Font, codePoint: number): FontkitGlyph | null {
  try {
    return font.glyphForCodePoint(codePoint) as unknown as FontkitGlyph;
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
