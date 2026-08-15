/**
 * Snapshot collection: Ink's live DOM + Yoga layout → a protocol
 * {@link SemanticSnapshot}.
 *
 * Collection runs *after* a committed frame, never during render:
 * `measureElement` returns zeros while layout is still being computed. It is
 * synchronous and allocation-bounded — every ceiling in {@link ProtocolLimits}
 * is honoured here, so a hostile or runaway tree degrades into a truncated but
 * structurally valid snapshot instead of an unbounded frame.
 */

import { measureElement, type DOMElement } from 'ink';
import type {
  ProtocolLimits,
  Rect,
  SemanticNode,
  SemanticSnapshot,
  SemanticState,
} from '@termwright/protocol';
import { defaultActionsForRole, mapInkAriaRole } from './roles.js';
import type { SemanticRegistry } from './registry.js';

/** Everything the collector needs that is not derivable from the tree itself. */
export interface CollectOptions {
  readonly sessionId: string;
  readonly revision: number;
  readonly columns: number;
  readonly rows: number;
  /**
   * Whether cell coordinates may be published. `false` when the adapter cannot
   * prove that Ink's live layout region starts at the top-left of the viewport
   * (see {@link canPublishAbsoluteBounds}); `bounds` is optional in the
   * protocol precisely for this case.
   */
  readonly includeBounds: boolean;
}

/** A node that Ink's reconciler produced but that carries text rather than layout. */
type InkTextNode = { readonly nodeName: '#text'; readonly nodeValue: string };
type InkNode = DOMElement | InkTextNode;

const isElement = (node: InkNode): node is DOMElement => node.nodeName !== '#text';

const isHidden = (node: DOMElement): boolean => node.style?.display === 'none';

/**
 * Collects snapshots from one Ink tree, keeping node identity stable across
 * revisions so the driver can hold a ref to a node that survives a re-render.
 */
export class SnapshotCollector {
  readonly #registry: SemanticRegistry;
  readonly #limits: ProtocolLimits;
  readonly #ids = new WeakMap<DOMElement, string>();
  #nextId = 0;

  constructor(registry: SemanticRegistry, limits: ProtocolLimits) {
    this.#registry = registry;
    this.#limits = limits;
  }

  /**
   * Walk a committed Ink tree and produce a snapshot.
   *
   * @param root - Ink's `ink-root` element.
   * @returns a snapshot whose `nodes` are ordered parents-before-children.
   */
  collect(root: DOMElement, options: CollectOptions): SemanticSnapshot {
    const nodes: SemanticNode[] = [];
    const rootId = this.#idFor(root);

    nodes.push({
      id: rootId,
      role: 'application',
      name: '',
      ...(options.includeBounds
        ? withBounds(root, this.#viewportRect(options))
        : {}),
    });

    for (const child of root.childNodes) {
      if (isElement(child)) this.#visit(child, rootId, 1, nodes, options);
    }

    return {
      v: 1,
      sessionId: options.sessionId,
      revision: options.revision,
      columns: options.columns,
      rows: options.rows,
      rootIds: [rootId],
      nodes,
    };
  }

  #viewportRect(options: CollectOptions): Rect {
    return { row: 0, column: 0, width: options.columns, height: options.rows };
  }

  #visit(
    node: DOMElement,
    parentId: string,
    depth: number,
    nodes: SemanticNode[],
    options: CollectOptions,
  ): void {
    if (isHidden(node)) return;
    if (depth > this.#limits.maxDepth) return;
    if (nodes.length >= this.#limits.maxNodes) return;

    const published = this.#build(node, parentId, options);
    if (published !== undefined) nodes.push(published);

    const childParentId = published?.id ?? parentId;
    for (const child of node.childNodes) {
      if (isElement(child)) this.#visit(child, childParentId, depth + 1, nodes, options);
    }
  }

  /**
   * Decide whether an element earns a semantic node, and build it.
   *
   * Published are: annotated elements, elements carrying Ink accessibility
   * props, and text-bearing `ink-text` elements. Plain layout boxes are not —
   * they would triple the node count without adding a single addressable thing.
   */
  #build(node: DOMElement, parentId: string, options: CollectOptions): SemanticNode | undefined {
    const meta = this.#registry.get(node);
    const accessibility = node.internal_accessibility;
    const ariaRole = mapInkAriaRole(accessibility?.role);
    const ariaState = mapAriaState(accessibility?.state);
    const isText = node.nodeName === 'ink-text';

    const text = isText || meta !== undefined || ariaRole !== undefined ? this.#textOf(node) : '';
    if (meta === undefined && ariaRole === undefined && ariaState === undefined) {
      if (!isText || text.length === 0) return undefined;
    }

    const role = meta?.role ?? ariaRole ?? (isText ? 'text' : 'generic');
    const name = this.#clamp(meta?.name ?? text);
    const state: SemanticState | undefined =
      ariaState === undefined && meta?.state === undefined
        ? undefined
        : { ...ariaState, ...meta?.state };
    const actions = meta?.actions ?? defaultActionsForRole(role);

    return {
      id: this.#idFor(node),
      parentId,
      role,
      name,
      ...(meta?.description === undefined ? {} : { description: this.#clamp(meta.description) }),
      ...(meta?.value === undefined ? {} : { value: this.#clamp(meta.value) }),
      ...(options.includeBounds ? withBounds(node) : {}),
      ...(state === undefined ? {} : { state }),
      // Copied, never referenced. `defaultActionsForRole` hands out one shared
      // frozen array per role, and an author can just as easily hoist a single
      // `actions` const across many `useSemantic` calls. Either way two nodes
      // would point at the same array, and the protocol's DTO projection
      // rejects any value reachable more than once ("value is reachable more
      // than once at $.nodes[N].actions").
      ...(actions === undefined ? {} : { actions: [...actions] }),
      ...(meta?.testId === undefined ? {} : { testId: this.#clamp(meta.testId) }),
    };
  }

  /** Concatenated text of an element's subtree, bounded by `maxStringBytes`. */
  #textOf(node: DOMElement): string {
    const parts: string[] = [];
    let budget = this.#limits.maxStringBytes;

    const walk = (current: DOMElement): void => {
      if (budget <= 0 || isHidden(current)) return;
      for (const child of current.childNodes) {
        if (budget <= 0) return;
        if (isElement(child)) {
          walk(child);
        } else {
          const value = child.nodeValue;
          parts.push(value);
          budget -= Buffer.byteLength(value, 'utf8');
        }
      }
    };

    walk(node);
    return parts.join('').replace(/\s+/gu, ' ').trim();
  }

  /** Truncate on a code-point boundary so the wire never carries a broken pair. */
  #clamp(value: string): string {
    const max = this.#limits.maxStringBytes;
    if (Buffer.byteLength(value, 'utf8') <= max) return value;
    const chars = [...value];
    let bytes = 0;
    let end = 0;
    while (end < chars.length) {
      const next = bytes + Buffer.byteLength(chars[end] as string, 'utf8');
      if (next > max) break;
      bytes = next;
      end += 1;
    }
    return chars.slice(0, end).join('');
  }

  #idFor(node: DOMElement): string {
    const existing = this.#ids.get(node);
    if (existing !== undefined) return existing;
    this.#nextId += 1;
    const id = `n${this.#nextId}`;
    this.#ids.set(node, id);
    return id;
  }
}

/**
 * Whether the tree contains `<Static>` output.
 *
 * `<Static>` is written above Ink's live region and scrolls with the terminal,
 * which makes the live region's viewport row unknowable from inside the
 * process. Bounds are suppressed for such trees rather than published wrong.
 */
export function hasStaticContent(root: DOMElement): boolean {
  const stack: DOMElement[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as DOMElement;
    if (node.internal_static === true || node.staticNode !== undefined) return true;
    for (const child of node.childNodes) if (isElement(child)) stack.push(child);
  }
  return false;
}

/**
 * Whether cell coordinates from `measureElement` can be trusted as viewport
 * coordinates.
 *
 * `measureElement` reports positions inside Ink's *live layout region*, not the
 * terminal. Those coincide only when Ink owns the whole screen: interactive
 * mode, alternate screen buffer, and no `<Static>` content above the region.
 */
export function canPublishAbsoluteBounds(options: {
  readonly alternateScreen: boolean;
  readonly interactive: boolean;
}): boolean {
  return options.alternateScreen && options.interactive;
}

function withBounds(node: DOMElement, fallback?: Rect): { bounds: Rect } | Record<string, never> {
  const measured = measureElement(node);
  if (measured.width <= 0 || measured.height <= 0) {
    return fallback === undefined ? {} : { bounds: fallback };
  }
  return {
    bounds: {
      row: measured.y,
      column: measured.x,
      width: measured.width,
      height: measured.height,
    },
  };
}

function mapAriaState(
  state: NonNullable<DOMElement['internal_accessibility']>['state'],
): SemanticState | undefined {
  if (state === undefined) return undefined;
  const mapped: SemanticState = {
    ...(state.busy === undefined ? {} : { busy: state.busy }),
    ...(state.checked === undefined ? {} : { checked: state.checked }),
    ...(state.disabled === undefined ? {} : { disabled: state.disabled }),
    ...(state.expanded === undefined ? {} : { expanded: state.expanded }),
    ...(state.multiline === undefined ? {} : { multiline: state.multiline }),
    ...(state.readonly === undefined ? {} : { readonly: state.readonly }),
    ...(state.selected === undefined ? {} : { selected: state.selected }),
  };
  return Object.keys(mapped).length === 0 ? undefined : mapped;
}
