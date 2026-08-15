/**
 * `@termwright/screenshot` — terminal screenshots without a browser.
 *
 * A cell grid becomes an SVG with the glyph outlines embedded (the trick that
 * keeps Nerd Font icons from turning into tofu on a machine that lacks the
 * font), and resvg turns that into a PNG. Nothing here starts a browser or
 * depends on one.
 *
 * The input is any {@link ScreenFrame}: the driver's `harness.screen()`, or a
 * frame reconstructed from a recording with `frameAt()` from
 * `@termwright/trace`.
 *
 * @example
 * ```ts
 * import { renderPng, renderSvg } from '@termwright/screenshot';
 * import { frameAt, openTrace } from '@termwright/trace';
 *
 * // Live session
 * await writeFile('now.svg', renderSvg(harness.screen()).svg);
 *
 * // From a recording, at the moment a step failed
 * const trace = await openTrace('out/login.twtrace');
 * const frame = await frameAt(trace, 1_500);
 * await writeFile('failure.png', renderPng(frame, { scale: 2 }).png);
 * await trace.close();
 * ```
 *
 * @packageDocumentation
 */

export { renderSvg, escapeXml } from './svg.js';
export { renderPng } from './png.js';
export {
  loadFonts,
  systemCandidates,
  FontSet,
  type FontMetrics,
  type FontSetOptions,
  type GlyphOutline,
} from './font.js';
export { DEFAULT_THEME, LIGHT_THEME, buildPalette, resolveColor } from './theme.js';
export type {
  FontOptions,
  GlyphMode,
  PngOptions,
  ScreenFrame,
  ScreenshotOptions,
  ScreenshotPng,
  ScreenshotSvg,
  ScreenshotTheme,
} from './types.js';
