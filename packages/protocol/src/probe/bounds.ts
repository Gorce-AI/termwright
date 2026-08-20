/**
 * Resolving IR geometry into the single rectangle a semantic node publishes.
 *
 * The IR keeps `intendedRect` and `visibleRect` apart because they are
 * different facts. `SemanticNode.bounds` is one rectangle, so somewhere the two
 * have to collapse — and that collapse is a decision, not a formatting step.
 *
 * The decision: **`bounds` is always the best known *visible* geometry.** A
 * consumer never has to ask which of the two it is holding, because the answer
 * is always the same one. Publishing both rectangles instead would push "which
 * of these did you mean" onto every consumer of the tree — the same one-field-
 * two-jobs problem, moved rather than solved.
 *
 * What a consumer still cannot know from `bounds` alone is whether something
 * else was painted on top. That is what {@link ResolvedBounds.occlusion}
 * carries, and it is why the two are resolved together here rather than in five
 * independent implementations.
 */

import type { Rect } from '../tree.js';
import type { ProbeGeometry, ProbeRect } from './ir.js';

/** Whether occlusion is knowable for this node. */
export type OcclusionKnowledge = 'known' | 'unknown';

/** Which of the IR rectangles the published bounds came from. */
export type BoundsSource = 'visible' | 'clipped' | 'intended';

/** The rectangle a node publishes, plus what is known about it. */
export interface ResolvedBounds {
  readonly rect: Rect;
  /**
   * `known` only when the probe reports paint order. Without it, a rectangle
   * says where a widget is, not whether a pointer aimed there reaches it.
   */
  readonly occlusion: OcclusionKnowledge;
  readonly source: BoundsSource;
  /**
   * True when the clip removed the rectangle entirely — the node exists and is
   * scrolled out of view.
   *
   * A normalizer maps this to **`state.hidden: true` plus
   * `state.offscreen: true`**. Both are needed and they say different things:
   * `hidden` because a zero-area rectangle cannot intersect the viewport and
   * validation refuses it otherwise, and `offscreen` because scrolled-away is
   * not the same state as never-displayed, and a consumer reading the tree has
   * no other way to tell them apart.
   */
  readonly clippedAway: boolean;
}

/** Settings for {@link resolveNodeBounds}. */
export interface ResolveBoundsOptions {
  /**
   * The clip imposed by ancestors, where the framework exposes one and has not
   * already applied it to `visibleRect`.
   */
  readonly clip?: ProbeRect;
  /** Whether the probe reports paint order for this object. */
  readonly paintOrderKnown?: boolean;
}

function intersect(a: ProbeRect, b: ProbeRect): { rect: Rect; empty: boolean } {
  const row = Math.max(a.row, b.row);
  const column = Math.max(a.column, b.column);
  const bottom = Math.min(a.row + a.height, b.row + b.height);
  const right = Math.min(a.column + a.width, b.column + b.width);
  const height = Math.max(0, bottom - row);
  const width = Math.max(0, right - column);
  return { rect: { row, column, width, height }, empty: width === 0 || height === 0 };
}

/**
 * Collapse IR geometry into the rectangle a semantic node publishes.
 *
 * Three tiers, best first:
 * 1. `visibleRect`, where the framework computed the clip intersection itself;
 * 2. `intendedRect ∩ clip`, where a clip is known but not pre-applied;
 * 3. `intendedRect` alone, as a last resort — it is where the widget *asked* to
 *    draw, which is the only thing left when nothing knows about clipping.
 *
 * @param geometry - IR geometry for the object, if it reported any.
 * @param options - Clip and paint-order knowledge.
 * @returns The resolved bounds, or `undefined` when the object reported no
 * geometry at all. A bounds-free node is a legal, expected state — one audited
 * framework hands over a rendered string with no coordinates anywhere — and
 * inventing a rectangle for it would be worse than having none.
 */
export function resolveNodeBounds(
  geometry: ProbeGeometry | undefined,
  options: ResolveBoundsOptions = {},
): ResolvedBounds | undefined {
  const occlusion: OcclusionKnowledge = options.paintOrderKnown === true ? 'known' : 'unknown';

  if (geometry?.visibleRect !== undefined) {
    const rect = geometry.visibleRect;
    return {
      rect,
      occlusion,
      source: 'visible',
      clippedAway: rect.width === 0 || rect.height === 0,
    };
  }

  if (geometry?.intendedRect === undefined) return undefined;

  if (options.clip !== undefined) {
    const { rect, empty } = intersect(geometry.intendedRect, options.clip);
    // A widget whose intended rectangle was already empty was not made
    // offscreen by this clip. Conflating the two would claim that scrolling
    // can reveal a node that never occupied a cell in the first place.
    const occupiedCells = geometry.intendedRect.width > 0 && geometry.intendedRect.height > 0;
    return { rect, occlusion, source: 'clipped', clippedAway: empty && occupiedCells };
  }

  return {
    rect: geometry.intendedRect,
    occlusion,
    source: 'intended',
    clippedAway: false,
  };
}
