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
import type { Rect, SemanticSnapshot } from '@termwright/protocol';
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
  /** Exact cells masked in the returned image, with provenance but no secret value. */
  readonly redactions: readonly ScreenshotRedaction[];
}

export interface ScreenshotRedaction {
  readonly rect: Rect;
  readonly nodeId: string;
  readonly reason: 'sensitive-value';
}

/** How a caller asks for an image. */
export interface ScreenshotRequest {
  readonly scale?: number | undefined;
  /** Light background instead of the default dark one. */
  readonly theme?: 'dark' | 'light' | undefined;
  /** Paired semantics used to mask known-sensitive cells before rasterisation. */
  readonly semantic?: SemanticSnapshot | null | undefined;
}

/**
 * Renders `frame` to a PNG.
 *
 * Failures are typed rather than thrown as raw errors: a scale out of range is
 * `usage`, an image over the ceiling is `capacity`, and a renderer that cannot
 * run at all (no font, no rasteriser) is `capability-unavailable` — each with the
 * next thing to try.
 */
export function renderScreenshot(
  frame: ScreenFrame,
  request: ScreenshotRequest = {},
): ScreenshotImage {
  const scale = request.scale ?? 1;
  if (!Number.isFinite(scale) || scale <= 0 || scale > SCREENSHOT_LIMITS.maxScale) {
    throw new McpError(
      'usage',
      `screenshotScale must be between 0 and ${SCREENSHOT_LIMITS.maxScale}, got ${scale}`,
      'omit it for 1, or pass 2 for a retina-sharp image',
    );
  }

  let rendered;
  const redactions = sensitiveRects(frame, request.semantic);
  try {
    rendered = renderPng(frame, {
      scale,
      maskRects: redactions.map((entry) => entry.rect),
      ...(request.theme === 'light' ? { theme: LIGHT_THEME } : {}),
    });
  } catch (error) {
    throw new McpError(
      'capability-unavailable',
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
    redactions,
  };
}

function sensitiveRects(
  frame: ScreenFrame,
  snapshot: SemanticSnapshot | null | undefined,
): readonly ScreenshotRedaction[] {
  if (snapshot === null || snapshot === undefined) return [];
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const owners =
    snapshot.columns === frame.columns &&
    snapshot.rows === frame.rows &&
    snapshot.hitGrid.status === 'known' &&
    snapshot.hitGrid.evidence.strength === 'authoritative'
      ? snapshot.hitGrid.value.regions
      : [];
  const safePublicCells = new Set<string>();
  // Layout is not paint visibility. Only a public text node inside a modal can
  // clear a mask, and only where its literal text matches the paired cell grid.
  // Unknown coverage remains masked, even when a modal's layout overlaps it.
  for (const node of snapshot.nodes) {
    if (
      node.role !== 'text' ||
      node.value?.status !== 'known' ||
      node.value.sensitivity !== 'public'
    )
      continue;
    let parent = node.parentId === undefined ? undefined : byId.get(node.parentId);
    let modal = false;
    const seen = new Set<string>();
    while (parent !== undefined && !seen.has(parent.id)) {
      seen.add(parent.id);
      if (parent.state?.modal === true) {
        modal = true;
        break;
      }
      parent = parent.parentId === undefined ? undefined : byId.get(parent.parentId);
    }
    if (!modal || node.geometry.visibleRect.status !== 'known') continue;
    const rect = node.geometry.visibleRect.value;
    if (rect.height !== 1 || rect.row < 0 || rect.row >= frame.rows) continue;
    const chars = [...node.value.value];
    if (chars.length === 0) continue;
    for (let start = rect.column; start + chars.length <= rect.column + rect.width; start += 1) {
      if (start < 0 || start + chars.length > frame.columns) continue;
      if (
        chars.every((char, offset) => {
          const column = start + offset;
          return (
            frame.cell(rect.row, column).width === 1 &&
            frame.cell(rect.row, column).char === char &&
            owners.some(
              (owner) =>
                owner.recipientId === node.id &&
                owner.rect.row === rect.row &&
                column >= owner.rect.column &&
                column < owner.rect.column + owner.rect.width,
            )
          );
        })
      ) {
        for (let offset = 0; offset < chars.length; offset += 1)
          safePublicCells.add(`${rect.row}:${start + offset}`);
        break;
      }
    }
  }
  const rectangles: {
    rect: { row: number; column: number; width: number; height: number };
    nodeId: string;
    reason: 'sensitive-value';
  }[] = [];
  for (const node of snapshot.nodes) {
    if (
      node.value === undefined ||
      !('sensitivity' in node.value) ||
      node.value.sensitivity !== 'sensitive'
    )
      continue;
    const visible = node.geometry.visibleRect;
    if (visible.status !== 'known') continue;
    const rect = visible.value;
    let previous = new Map<string, (typeof rectangles)[number]>();
    for (
      let row = Math.max(0, rect.row);
      row < Math.min(frame.rows, rect.row + rect.height);
      row += 1
    ) {
      let start = -1;
      const current = new Map<string, (typeof rectangles)[number]>();
      const recordRun = (column: number): void => {
        const width = column - start;
        const key = `${start}:${width}`;
        const old = previous.get(key);
        if (old !== undefined && old.rect.row + old.rect.height === row) {
          old.rect.height += 1;
          current.set(key, old);
        } else {
          const redaction = {
            rect: { row, column: start, width, height: 1 },
            nodeId: node.id,
            reason: 'sensitive-value' as const,
          };
          rectangles.push(redaction);
          current.set(key, redaction);
        }
        start = -1;
      };
      for (
        let column = Math.max(0, rect.column);
        column <= Math.min(frame.columns, rect.column + rect.width);
        column += 1
      ) {
        const masked =
          column < Math.min(frame.columns, rect.column + rect.width) &&
          !safePublicCells.has(`${row}:${column}`);
        if (masked && start < 0) start = column;
        if (!masked && start >= 0) recordRun(column);
      }
      previous = current;
    }
  }
  return rectangles;
}
