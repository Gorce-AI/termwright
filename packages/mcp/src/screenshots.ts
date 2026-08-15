/**
 * PNG screenshots as MCP `ImageContent`.
 *
 * Rendering belongs to `@termwright/screenshot`: a cell grid becomes an SVG with
 * the glyph outlines embedded, and resvg rasterises it — no browser, and no
 * dependency on the agent's machine having the right font. This module only
 * decides *when* an image is worth sending and refuses it loudly otherwise.
 */
import { LIGHT_THEME, renderPng } from '@termwright/screenshot';
import type { ScreenFrame } from '@termwright/screenshot';
import { McpError } from './errors.js';

/** Ceilings for images leaving the server. */
export const SCREENSHOT_LIMITS = Object.freeze({
  /**
   * Refusal threshold for one PNG, in bytes.
   *
   * An MCP result travels inside a JSON-RPC message, and base64 inflates it by
   * a third: a screenshot larger than this is more likely to blow a context
   * window than to answer a question, so it fails with a suggestion instead.
   */
  maxPngBytes: 3 * 1024 * 1024,
  /** Pixel density multiplier ceiling. */
  maxScale: 3,
});

/** An image ready to be attached to a tool result. */
export interface ScreenshotImage {
  /** Base64 PNG, as `ImageContent.data` requires. */
  readonly data: string;
  readonly mimeType: 'image/png';
  readonly width: number;
  readonly height: number;
  /** False when a character had no embedded outline; see `fallbackCharacters`. */
  readonly selfContained: boolean;
  readonly fallbackCharacters: readonly string[];
}

/** How a caller asks for an image. */
export interface ScreenshotRequest {
  readonly scale?: number | undefined;
  /** Light background instead of the default dark one. */
  readonly theme?: 'dark' | 'light' | undefined;
}

/**
 * Renders `frame` to a PNG.
 *
 * Failures are typed rather than thrown as raw errors: a scale out of range is
 * `usage`, an image over the ceiling is `capacity`, and a renderer that cannot
 * run at all (no font, no rasteriser) is `unsupported-action` — each with the
 * next thing to try.
 */
export function renderScreenshot(frame: ScreenFrame, request: ScreenshotRequest = {}): ScreenshotImage {
  const scale = request.scale ?? 1;
  if (!Number.isFinite(scale) || scale <= 0 || scale > SCREENSHOT_LIMITS.maxScale) {
    throw new McpError(
      'usage',
      `screenshotScale must be between 0 and ${SCREENSHOT_LIMITS.maxScale}, got ${scale}`,
      'omit it for 1, or pass 2 for a retina-sharp image',
    );
  }

  let rendered;
  try {
    rendered = renderPng(frame, {
      scale,
      ...(request.theme === 'light' ? { theme: LIGHT_THEME } : {}),
    });
  } catch (error) {
    throw new McpError(
      'unsupported-action',
      `the screenshot renderer failed: ${error instanceof Error ? error.message : String(error)}`,
      'omit screenshot — the tool still returns the screen as text and the compact tree',
    );
  }

  if (rendered.png.byteLength > SCREENSHOT_LIMITS.maxPngBytes) {
    throw new McpError(
      'capacity',
      `the PNG is ${rendered.png.byteLength} bytes; the ceiling is ${SCREENSHOT_LIMITS.maxPngBytes}`,
      'lower screenshotScale, or resize the terminal before taking the screenshot',
    );
  }

  return {
    data: Buffer.from(rendered.png).toString('base64'),
    mimeType: 'image/png',
    width: rendered.width,
    height: rendered.height,
    selfContained: rendered.selfContained,
    fallbackCharacters: [...rendered.fallbackCharacters],
  };
}
