/**
 * {@link renderPng} — rasterises the SVG with resvg, a Rust renderer with no
 * browser behind it. No Chromium in the dependency tree, and no headless
 * browser starting up in the middle of a test run.
 */

import { Resvg } from '@resvg/resvg-js';
import { renderSvg } from './svg.js';
import type { PngOptions, ScreenFrame, ScreenshotPng } from './types.js';

/**
 * Renders a frame straight to PNG bytes.
 *
 * When every glyph came from an embedded outline the rasteriser needs no fonts
 * at all, so the PNG is identical on a developer laptop and a bare CI
 * container. Characters that fell back to `<text>` are rendered with whatever
 * system fonts resvg can find; `selfContained` tells you which case you got.
 *
 * @example
 * ```ts
 * const shot = renderPng(harness.screen(), { scale: 2 });
 * await writeFile('screen.png', shot.png);
 * ```
 */
export function renderPng(frame: ScreenFrame, options: PngOptions = {}): ScreenshotPng {
  const scale = options.scale ?? 1;
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new RangeError(`renderPng: scale must be > 0, got ${scale}`);
  }

  const rendered = renderSvg(frame, options);
  const needsSystemFonts = !rendered.selfContained;
  const resvg = new Resvg(rendered.svg, {
    fitTo: { mode: 'width', value: Math.max(1, Math.round(rendered.width * scale)) },
    font: {
      loadSystemFonts: needsSystemFonts,
      ...(options.font?.files === undefined ? {} : { fontFiles: [...options.font.files] }),
      defaultFontFamily: 'monospace',
    },
  });
  const image = resvg.render();
  const png = image.asPng();

  return {
    png: new Uint8Array(png),
    width: image.width,
    height: image.height,
    selfContained: rendered.selfContained,
    fallbackCharacters: rendered.fallbackCharacters,
  };
}
