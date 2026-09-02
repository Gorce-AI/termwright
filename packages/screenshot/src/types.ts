/**
 * Public shapes of `@termwright/screenshot`.
 *
 * The renderer takes a **cell grid**, not a pixel buffer and not a string of
 * ANSI: layout comes from the grid (column × cell width), never from font
 * metrics, so a screenshot of a screen with emoji, CJK or Nerd Font icons lines
 * up exactly the way the terminal laid it out.
 */

import type { CellSnapshot } from '@termwright/driver';
import type { CursorInfo } from '@termwright/protocol';
import type { Rect } from '@termwright/protocol';

/**
 * The slice of the driver's `ScreenSnapshot` a screenshot needs.
 *
 * A real `ScreenSnapshot` satisfies it structurally, and so does the frame
 * `frameAt()` in `@termwright/trace` reconstructs from a recording.
 */
export interface ScreenFrame {
  readonly columns: number;
  readonly rows: number;
  readonly cursor?: CursorInfo;
  cell(row: number, column: number): CellSnapshot;
}

/** Colours used for cells that do not carry an explicit colour. */
export interface ScreenshotTheme {
  readonly background: string;
  readonly foreground: string;
  readonly cursor: string;
  /** The 16 ANSI colours. Indices 16–255 are derived from the xterm cube. */
  readonly ansi: readonly string[];
}

/** How glyphs are put into the SVG. */
export type GlyphMode =
  /** Embed outlines as `<path>`; fall back to `<text>` per character. */
  | 'outline'
  /** Always emit `<text>`; the renderer supplies the font. */
  | 'text';

/** Font selection for {@link renderSvg}. */
export interface FontOptions {
  /**
   * Font files to embed outlines from, in priority order. The first file
   * containing a given character wins; characters missing from all of them fall
   * back to `<text>`.
   */
  readonly files?: readonly string[];
  /**
   * Look for a platform monospace font when {@link FontOptions.files} is empty
   * or yields nothing. Default `true`.
   */
  readonly system?: boolean;
  /** `font-family` used by `<text>` runs. Default a monospace stack. */
  readonly family?: string;
}

/** Options shared by SVG and PNG rendering. */
export interface ScreenshotOptions {
  readonly theme?: ScreenshotTheme;
  readonly font?: FontOptions;
  /** Em size in SVG user units. Default 16. */
  readonly fontSize?: number;
  /** Cell advance. Default: the embedded font's advance, else `0.6 × fontSize`. */
  readonly cellWidth?: number;
  /** Cell height. Default `1.2 × fontSize`. */
  readonly lineHeight?: number;
  /** Padding around the grid, in user units. Default 8. */
  readonly padding?: number;
  /** Draw the cursor when `frame.cursor.visible`. Default `true`. */
  readonly cursor?: boolean;
  /** `'outline'` (default) embeds glyph outlines; `'text'` never does. */
  readonly glyphs?: GlyphMode;
  /** Cell rectangles replaced before rasterisation; their original glyphs never enter the SVG. */
  readonly maskRects?: readonly Rect[];
}

/** Result of {@link renderSvg}. */
export interface ScreenshotSvg {
  readonly svg: string;
  readonly width: number;
  readonly height: number;
  /**
   * `true` when every character was drawn from an embedded outline, so the SVG
   * renders identically everywhere with no fonts installed.
   */
  readonly selfContained: boolean;
  /**
   * Characters drawn as `<text>` because no configured font could supply a
   * glyph, deduplicated and sorted.
   *
   * "Not embedded" is not "not drawn". A viewer with a suitable font renders
   * them normally, and {@link renderPng} loads system fonts on their behalf by
   * default — what the list actually means is that the output depends on the
   * machine that displays (or rasterises) it. They come out blank only where
   * no font covers them, which for PNG means
   * {@link PngOptions.systemFontFallback} was turned off.
   */
  readonly fallbackCharacters: readonly string[];
  /** Font files whose outlines were embedded, in the order they were used. */
  readonly fontsUsed: readonly string[];
}

/** Options for {@link renderPng}. */
export interface PngOptions extends ScreenshotOptions {
  /** Pixel density multiplier. Default 1; use 2 for retina-sharp thumbnails. */
  readonly scale?: number;
  /**
   * Let the rasteriser fall back to system fonts for characters no embedded
   * glyph covers. Default `true`.
   *
   * It is not free: resvg enumerates the installed fonts on **every** call that
   * needs them — roughly a second on macOS, several on Windows — and there is
   * no cache to amortise it across renders. A screenshot whose glyphs were all
   * embedded never pays this, so the cost only appears when
   * {@link ScreenshotSvg.fallbackCharacters} is non-empty.
   *
   * Turn it off when rendering many frames and missing glyphs are acceptable:
   * those characters come out blank, and the raster gets ~20× faster.
   */
  readonly systemFontFallback?: boolean;
}

/** Result of {@link renderPng}. */
export interface ScreenshotPng {
  readonly png: Uint8Array;
  /** Pixel dimensions, i.e. SVG units × `scale`. */
  readonly width: number;
  readonly height: number;
  readonly selfContained: boolean;
  /** See {@link ScreenshotSvg.fallbackCharacters}. */
  readonly fallbackCharacters: readonly string[];
  /**
   * Whether this render made the rasteriser enumerate the system fonts — the
   * expensive path, roughly a second on macOS and several on Windows, paid per
   * call.
   *
   * Reported rather than left to be derived from `selfContained` and the
   * options, so a caller rendering in bulk can see which frames cost what
   * instead of inferring the rule from documentation.
   */
  readonly systemFontsLoaded: boolean;
}
