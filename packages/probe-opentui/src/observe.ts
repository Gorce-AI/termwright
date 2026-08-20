/**
 * Turning a live OpenTUI tree into Probe IR — facts only, no interpretation.
 *
 * This module deliberately never imports `@opentui/core`. It reads a
 * structural shape, which keeps the whole observation layer testable without a
 * renderer, a terminal or the native library — and keeps the probe honest about
 * what it actually touches: a handful of public getters and one protected field
 * it degrades without.
 *
 * What the Phase 0 audit established, and what this encodes:
 *
 * - **Identity is stable.** `num` comes from a monotonic counter, is `readonly`,
 *   and survives re-render and even removal from the tree. `id` is not identity:
 *   it defaults to `renderable-<num>` but is mutable at runtime and updates no
 *   index.
 * - **Coordinates are real terminal cells.** `screenX`/`screenY` accumulate from
 *   the parent during layout, so unlike Ink there is no live-region caveat.
 * - **There is no accessibility layer at all.** No roles, no `checked`, no
 *   `disabled`. Those are reported as unobservable rather than as absent, which
 *   is the distinction the IR exists to preserve.
 */

import type {
  ProbeFrame,
  ProbeObject,
  ProbeObservedState,
  ProbeRect,
  ProbeUnobservableField,
  ProtocolLimits,
} from '@termwright/protocol';
import { DEFAULT_LIMITS } from '@termwright/protocol';
import { annotationForRenderable } from './annotations.js';

/**
 * The shape this module reads off a Renderable.
 *
 * Everything is optional because the probe must survive a framework version
 * that moved a getter, and because most fields exist on only a few widget
 * classes.
 */
export interface ObservableNode {
  readonly num: number;
  readonly id?: string;
  readonly visible?: boolean;
  readonly focused?: boolean;
  readonly screenX?: number;
  readonly screenY?: number;
  readonly width?: number;
  readonly height?: number;
  getChildren?: () => readonly ObservableNode[];
  /** Z-order siblings; protected upstream, so its absence is expected. */
  readonly _childrenInZIndexOrder?: readonly ObservableNode[];
  /** `InputRenderable`. */
  readonly value?: string;
  /** `EditBufferRenderable` and its subclasses. */
  readonly plainText?: string;
  /** `TextRenderable`. */
  readonly chunks?: readonly { readonly text?: string }[];
  /** `CodeRenderable`, `MarkdownRenderable`. */
  readonly content?: unknown;
  /** `SelectRenderable`, `TabSelectRenderable`. */
  getSelectedIndex?: () => number;
  /** `EditBufferRenderable`. */
  getSelection?: () => { readonly start: number; readonly end: number } | null;
  /** `ScrollBoxRenderable`. */
  readonly scrollTop?: number;
  readonly scrollLeft?: number;
  readonly scrollWidth?: number;
  readonly scrollHeight?: number;
  readonly constructor: { readonly name: string };
}

/** Settings for {@link observeTree}. */
export interface ObserveOptions {
  /** Monotonic frame number; the caller owns the counter. */
  readonly frame: number;
  /** Ceiling on objects per frame, so a runaway tree degrades rather than floods. */
  readonly maxObjects?: number;
  /** Limits negotiated with the driver, also applied to optional annotations. */
  readonly limits?: ProtocolLimits;
}

/** What an observation produced, plus what it could not do. */
export interface Observation {
  readonly frame: ProbeFrame;
  /** True when the z-order list was readable for every visited node. */
  readonly paintOrderKnown: boolean;
  /** True when the object ceiling cut the walk short. */
  readonly truncated: boolean;
}

/**
 * Facts OpenTUI has no concept of, for any widget.
 *
 * From the audit: a grep for `aria`, `role` and `checked` across every `.d.ts`
 * in the package returns nothing. Reporting these as unobservable is what lets
 * a consumer tell "this checkbox is unchecked" from "this framework has no
 * checkboxes".
 */
const NEVER_OBSERVABLE: readonly ProbeUnobservableField[] = ['checked', 'expanded', 'readonly'];

/**
 * `visibleRect` is not among them by default: OpenTUI clips through scissor
 * rects at render time and exposes no per-node computed visible rectangle, so
 * the probe reports the intended rectangle and says the visible one is
 * unknowable.
 */
const NO_VISIBLE_RECT: ProbeUnobservableField = 'visibleRect';

function rectOf(node: ObservableNode): ProbeRect | undefined {
  const { screenX, screenY, width, height } = node;
  if (
    typeof screenX !== 'number' ||
    typeof screenY !== 'number' ||
    typeof width !== 'number' ||
    typeof height !== 'number'
  ) {
    return undefined;
  }
  return { row: screenY, column: screenX, width, height };
}

function textOf(node: ObservableNode): string | undefined {
  if (Array.isArray(node.chunks)) {
    const joined = node.chunks.map((chunk) => chunk.text ?? '').join('');
    return joined.length > 0 ? joined : undefined;
  }
  if (typeof node.content === 'string' && node.content.length > 0) return node.content;
  return undefined;
}

function stateOf(
  node: ObservableNode,
  inheritedDisplayed: boolean,
): ProbeObservedState | undefined {
  const state: Record<string, unknown> = {};

  if (typeof node.focused === 'boolean') state['focused'] = node.focused;
  // OpenTUI's `visible` flag is local to a renderable. A visible child of a
  // hidden container is still not displayed, so publish the effective value
  // from the complete ancestor chain rather than the tempting local boolean.
  if (typeof node.visible === 'boolean' || !inheritedDisplayed) {
    state['displayed'] = inheritedDisplayed && node.visible !== false;
  }

  // `value` first, then the edit buffer's plain text: an InputRenderable has
  // both, and `value` is the one the application set.
  if (typeof node.value === 'string') state['value'] = node.value;
  else if (typeof node.plainText === 'string') state['value'] = node.plainText;

  if (typeof node.getSelectedIndex === 'function') {
    const index = node.getSelectedIndex();
    if (Number.isSafeInteger(index) && index >= 0) state['selectedIndex'] = index;
  }

  if (typeof node.getSelection === 'function') {
    const selection = node.getSelection();
    if (selection !== null && selection !== undefined) {
      state['textSelection'] = { start: selection.start, end: selection.end };
    }
  }

  if (typeof node.scrollTop === 'number' && typeof node.scrollLeft === 'number') {
    state['scroll'] = { row: node.scrollTop, column: node.scrollLeft };
  }
  if (typeof node.scrollHeight === 'number' && typeof node.scrollWidth === 'number') {
    state['scrollExtent'] = { rows: node.scrollHeight, columns: node.scrollWidth };
  }

  return Object.keys(state).length === 0 ? undefined : (state as ProbeObservedState);
}

/** Fields this node cannot report, as opposed to fields it simply has not. */
function unobservableFor(node: ObservableNode): readonly ProbeUnobservableField[] {
  const fields: ProbeUnobservableField[] = [...NEVER_OBSERVABLE, NO_VISIBLE_RECT];
  // `disabled` is not a concept either, and no widget contradicts that.
  fields.push('disabled');
  if (typeof node.value !== 'string' && typeof node.plainText !== 'string') fields.push('value');
  if (typeof node.getSelectedIndex !== 'function') fields.push('selectedIndex');
  if (typeof node.getSelection !== 'function') fields.push('textSelection');
  return fields;
}

/**
 * Walk a live tree and describe it.
 *
 * Children are visited in **z-order** where the framework exposes it, because
 * that is paint order: later means on top, which is the only fact that makes
 * "is my target the thing at this cell" answerable. Where the list is not
 * readable the walk falls back to document order and
 * {@link Observation.paintOrderKnown} goes false, so the caller can decline to
 * announce a capability it cannot honour.
 *
 * @param root - The renderer's root renderable.
 * @param options - Frame number and ceilings.
 */
export function observeTree(root: ObservableNode, options: ObserveOptions): Observation {
  const limits = options.limits ?? DEFAULT_LIMITS;
  const maxObjects = Math.min(options.maxObjects ?? limits.maxNodes, limits.maxNodes);
  const objects: ProbeObject[] = [];
  let paintOrderKnown = true;
  let truncated = false;
  let paintOrder = 0;

  const visit = (
    node: ObservableNode,
    parent: ObservableNode | undefined,
    ancestorsDisplayed: boolean,
  ): void => {
    if (objects.length >= maxObjects) {
      truncated = true;
      return;
    }

    const rect = rectOf(node);
    const text = textOf(node);
    const displayed = ancestorsDisplayed && node.visible !== false;
    const state = stateOf(node, ancestorsDisplayed);
    const annotations = annotationForRenderable(node, limits);

    objects.push({
      identity: { kind: 'stable', value: String(node.num) },
      // The framework's own name for the thing. Survives as the last line of
      // defence for a widget no recognizer knows — and does not survive
      // minification, which is recorded in the README's Deviations.
      frameworkType: node.constructor.name,
      ...(parent === undefined ? {} : { parent: String(parent.num) }),
      ...(rect === undefined ? {} : { geometry: { intendedRect: rect } }),
      ...(state === undefined ? {} : { state }),
      ...(text === undefined ? {} : { text }),
      ...(annotations === undefined ? {} : { annotations }),
      paintOrder: paintOrder,
      unobservable: unobservableFor(node),
    });
    paintOrder += 1;

    const zOrder = node._childrenInZIndexOrder;
    const documentOrder = node.getChildren?.() ?? [];
    const children = Array.isArray(zOrder) ? zOrder : documentOrder;
    // Only a node with siblings to order has an ordering question. A leaf, or
    // an only child, is unambiguous whether or not the z-order list is there —
    // counting those as "unknown" would forfeit the capability on every tree.
    if (!Array.isArray(zOrder) && documentOrder.length > 1) paintOrderKnown = false;
    for (const child of children) visit(child, node, displayed);
  };

  visit(root, undefined, true);

  // Announced as a capability, but a tree whose z-order list was unreadable
  // cannot honour it. Reporting document order as paint order would be a
  // silent lie — the receiver would gate clicks on an ordering nobody
  // computed. Absent, and listed as unobservable, is the honest report.
  const published = paintOrderKnown
    ? objects
    : objects.map(({ paintOrder: _dropped, ...rest }) => ({
        ...rest,
        unobservable: [...(rest.unobservable ?? []), 'paintOrder' as const],
      }));

  return {
    frame: { frame: options.frame, objects: published },
    paintOrderKnown,
    truncated,
  };
}
