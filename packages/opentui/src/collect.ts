/**
 * Snapshot collection: OpenTUI's live renderable tree → a protocol
 * {@link SemanticSnapshot}.
 *
 * Collection runs *after* a committed frame, when `screenX`/`screenY` hold the
 * positions the frame was drawn at. It is synchronous and allocation-bounded —
 * every ceiling in `ProtocolLimits` is honoured here, so a hostile or runaway
 * tree degrades into a truncated but structurally valid snapshot instead of an
 * unbounded frame.
 */

import type {
  ProtocolLimits,
  Rect,
  SemanticNode,
  SemanticRole,
  SemanticSnapshot,
  SemanticState,
} from '@termwright/protocol';
import type { SemanticRegistry } from './registry.js';
import { asSemanticRole, defaultActionsFor, mapRenderableClass } from './roles.js';
import type { RenderableConvention, RenderableLike, SemanticMeta } from './types.js';

/** Everything the collector needs that is not derivable from the tree itself. */
export interface CollectOptions {
  readonly sessionId: string;
  readonly revision: number;
  readonly columns: number;
  readonly rows: number;
  /**
   * Whether cell coordinates may be published. `false` when the renderer does
   * not provably own the whole viewport (see {@link canPublishAbsoluteBounds});
   * `bounds` is optional in the protocol precisely for this case.
   */
  readonly includeBounds: boolean;
}

/**
 * Whether `screenX`/`screenY` can be trusted as viewport coordinates.
 *
 * They are the renderer's own coordinates, and they coincide with the
 * terminal's only when the renderer owns the whole screen. In `main-screen`
 * mode OpenTUI draws below whatever the shell already printed, and in
 * `split-footer` mode the live region is pinned to the bottom rows — in both,
 * a node's `screenY` is an offset into a region whose origin the process
 * cannot observe.
 */
export function canPublishAbsoluteBounds(screenMode: string): boolean {
  return screenMode === 'alternate-screen';
}

/**
 * Collects snapshots from one renderable tree.
 *
 * Node identity comes from OpenTUI's own `num` counter, which is assigned per
 * instance at construction and never reused, so a ref the driver holds keeps
 * pointing at the same widget across revisions for as long as it is mounted.
 */
export class SnapshotCollector {
  readonly #registry: SemanticRegistry;
  readonly #limits: ProtocolLimits;

  constructor(registry: SemanticRegistry, limits: ProtocolLimits) {
    this.#registry = registry;
    this.#limits = limits;
  }

  /**
   * Walk a committed tree and produce a snapshot.
   *
   * @param root - the renderer's `root` renderable
   * @returns a snapshot whose `nodes` are ordered parents-before-children.
   */
  collect(root: RenderableLike, options: CollectOptions): SemanticSnapshot {
    const nodes: SemanticNode[] = [];
    const rootId = idOf(root);

    nodes.push({
      id: rootId,
      role: 'application',
      name: '',
      ...(options.includeBounds
        ? { bounds: { row: 0, column: 0, width: options.columns, height: options.rows } }
        : {}),
    });

    for (const child of root.getChildren()) this.#visit(child, rootId, 1, nodes, options);

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

  #visit(
    node: RenderableLike,
    parentId: string,
    depth: number,
    nodes: SemanticNode[],
    options: CollectOptions,
  ): void {
    if (!node.visible) return;
    if (depth > this.#limits.maxDepth) return;
    if (nodes.length >= this.#limits.maxNodes) return;

    const published = this.#build(node, parentId, options);
    if (published !== undefined) nodes.push(published);

    // Always the nearest *published* ancestor, so dropping a layout box never
    // leaves a child pointing at a node that is not in the snapshot.
    const childParentId = published?.id ?? parentId;
    for (const child of node.getChildren()) {
      this.#visit(child, childParentId, depth + 1, nodes, options);
    }
  }

  /**
   * Decide whether a renderable earns a semantic node, and build it.
   *
   * Published are: annotated renderables, renderables whose class maps to a
   * role, focusable renderables, and anything carrying text. A plain
   * `BoxRenderable` used for layout is not — OpenTUI trees are box-heavy, and
   * publishing every one of them would multiply the node count without adding
   * a single addressable thing.
   */
  #build(
    node: RenderableLike,
    parentId: string,
    options: CollectOptions,
  ): SemanticNode | undefined {
    const meta = this.#registry.get(node);
    const convention = node as RenderableConvention;
    const conventionRole = asSemanticRole(convention.role);
    const classRole = mapRenderableClass(node.constructor?.name);
    const text = textOf(node);

    const role: SemanticRole | undefined = meta?.role ?? conventionRole ?? classRole;
    if (
      meta === undefined &&
      role === undefined &&
      !node.focusable &&
      text.length === 0
    ) {
      return undefined;
    }

    const resolvedRole = role ?? 'generic';
    const name = this.#clamp(meta?.name ?? asText(convention.semanticName) ?? asText(convention.ariaLabel) ?? text);
    const value = meta?.value ?? valueOf(node);
    const state = stateOf(node, meta);
    const actions = meta?.actions ?? defaultActionsFor(resolvedRole, node.focusable);
    const testId = meta?.testId ?? asText(convention.testId) ?? explicitId(node);

    return {
      id: idOf(node),
      parentId,
      role: resolvedRole,
      name,
      ...(meta?.description === undefined ? {} : { description: this.#clamp(meta.description) }),
      ...(value === undefined ? {} : { value: this.#clamp(value) }),
      ...(options.includeBounds ? boundsOf(node) : {}),
      ...(state === undefined ? {} : { state }),
      // Copied, not shared: the role table hands out one frozen array per role,
      // and the protocol's DTO projector rejects a value reachable twice in the
      // same snapshot.
      ...(actions === undefined ? {} : { actions: [...actions] }),
      ...(testId === undefined ? {} : { testId: this.#clamp(testId) }),
    };
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
}

/**
 * Node ids are `n<num>`, where `num` is OpenTUI's monotonic per-instance
 * counter. Nothing needs to be remembered between revisions for a ref to stay
 * valid, and two widgets can never collide.
 */
function idOf(node: RenderableLike): string {
  return `n${String(node.num)}`;
}

/**
 * OpenTUI names every unnamed renderable `renderable-<num>` (0.5.3,
 * `BaseRenderable`'s constructor). Those ids shift whenever construction order
 * shifts, so publishing them as test ids would hand tests a selector that
 * breaks on an unrelated edit. Only an author-chosen id becomes a `testId`.
 */
const GENERATED_ID = /^renderable-\d+$/u;

function explicitId(node: RenderableLike): string | undefined {
  const id = node.id;
  if (typeof id !== 'string' || id.length === 0) return undefined;
  return GENERATED_ID.test(id) ? undefined : id;
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * The renderable's own rendered text, whitespace-normalised.
 *
 * Only the node's own text is read, never its subtree's: OpenTUI's text
 * renderables are leaves, and concatenating a container's descendants would
 * give every ancestor of a label the label's name.
 */
function textOf(node: RenderableLike): string {
  const own = asText(node.plainText) ?? asText(node.title);
  if (own !== undefined) return own.replace(/\s+/gu, ' ').trim();
  const selected = node.getSelectedOption?.();
  const optionName = selected === null || selected === undefined ? undefined : asText(selected.name);
  return optionName === undefined ? '' : optionName.replace(/\s+/gu, ' ').trim();
}

/** The value of a value-bearing widget, as a string. */
function valueOf(node: RenderableLike): string | undefined {
  const value = node.value;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function boundsOf(node: RenderableLike): { bounds: Rect } | Record<string, never> {
  if (node.width <= 0 || node.height <= 0) return {};
  return {
    bounds: {
      row: node.screenY,
      column: node.screenX,
      width: node.width,
      height: node.height,
    },
  };
}

/**
 * States the adapter can derive honestly.
 *
 * `focused` is OpenTUI's own flag; `disabled` is read from the convention
 * property, because OpenTUI has no disabled concept of its own and an
 * application that has one says so.
 */
function stateOf(node: RenderableLike, meta: SemanticMeta | undefined): SemanticState | undefined {
  const derived: SemanticState = {
    ...(node.focused ? { focused: true } : {}),
    ...(node.disabled === true ? { disabled: true } : {}),
  };
  const merged: SemanticState = { ...derived, ...meta?.state };
  return Object.keys(merged).length === 0 ? undefined : merged;
}
