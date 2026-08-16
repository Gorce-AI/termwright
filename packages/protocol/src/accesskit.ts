/**
 * AccessKit export: `SemanticSnapshot` → an AccessKit `TreeUpdate`.
 *
 * A pure transformation into AccessKit's serde JSON shape. This module takes
 * **no dependency** on AccessKit — the protocol package depends on `zod` only —
 * so the output is data a bridge can hand to a real adapter, not a binding.
 *
 * ## Why there is no native bridge in 1.0
 *
 * AccessKit's platform adapters attach an accessibility tree to a **native
 * window**: an `NSView` on macOS, an `HWND` on Windows, a toplevel on AT-SPI.
 * A terminal application has none of those. The terminal emulator owns the
 * window, and the application under test is a child process writing bytes to a
 * pseudo-terminal. There is nothing for an adapter to attach to, and nothing an
 * assistive technology could route back to us.
 *
 * The geometry gap is the same problem seen from the other side. Our `bounds`
 * are **terminal cells** — row 3, column 12 — while AccessKit's `Rect` is in
 * physical pixels relative to the window origin. Converting requires the cell
 * size and window position, which live in the emulator, not in the process
 * being tested. Guessing a cell size would produce coordinates that look
 * authoritative and point nowhere.
 *
 * So the export is *bridge-ready*, not a bridge: it is the half of the problem
 * that can be solved correctly without a window. An embedder that does own one
 * (a GUI terminal emulator embedding termwright) can supply {@link
 * AccessKitExportOptions.cellSize} and get real geometry.
 *
 * ## Schema provenance
 *
 * Shapes verified against `accesskit` 0.24.1 (docs.rs, August 2026):
 * `TreeUpdate { nodes, tree, tree_id, focus }`, `Tree { root, toolkit_name,
 * toolkit_version }`, `NodeId(u64)`, `Rect { x0, y0, x1, y1 }`, and
 * `#[serde(rename_all = "camelCase")]` on `Role`, `Action` and `Node`.
 * `TreeId` is a UUID, with the nil UUID reserved for the root tree.
 */

import { createHash } from 'node:crypto';
import type { SemanticNode, SemanticSnapshot, Rect } from './tree.js';
import type { SemanticAction, SemanticRole } from './roles.js';
import { ProtocolViolation } from './errors.js';

/** The nil UUID, which AccessKit reserves for the root tree (`TreeId::ROOT`). */
export const ACCESSKIT_ROOT_TREE_ID = '00000000-0000-0000-0000-000000000000';

/** AccessKit's `Rect`: minimum and maximum coordinates, not origin plus size. */
export interface AccessKitRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** AccessKit's `Toggled`, used for tri-state checkboxes. */
export type AccessKitToggled = 'false' | 'true' | 'mixed';

/**
 * An AccessKit `Node` in its serde JSON form. Only the properties this export
 * can populate faithfully are modelled.
 */
export interface AccessKitNode {
  readonly role: string;
  readonly label?: string;
  readonly description?: string;
  readonly value?: string;
  readonly children?: readonly number[];
  readonly bounds?: AccessKitRect;
  readonly actions?: readonly string[];
  readonly labelledBy?: readonly number[];
  readonly describedBy?: readonly number[];
  readonly disabled?: boolean;
  readonly selected?: boolean;
  readonly expanded?: boolean;
  readonly busy?: boolean;
  readonly modal?: boolean;
  readonly hidden?: boolean;
  readonly readOnly?: boolean;
  readonly toggled?: AccessKitToggled;
}

/** AccessKit's `Tree`. */
export interface AccessKitTree {
  readonly root: number;
  readonly toolkitName?: string;
  readonly toolkitVersion?: string;
}

/** AccessKit's `TreeUpdate`. */
export interface AccessKitTreeUpdate {
  readonly nodes: readonly (readonly [number, AccessKitNode])[];
  readonly tree?: AccessKitTree;
  readonly treeId: string;
  readonly focus: number;
}

/** Settings for {@link toAccessKitTreeUpdate}. */
export interface AccessKitExportOptions {
  /** Tree identity; defaults to the nil UUID AccessKit reserves for the root. */
  readonly treeId?: string;
  readonly toolkitName?: string;
  readonly toolkitVersion?: string;
  /**
   * Pixel size of one terminal cell. Supply it only if you genuinely know it —
   * an embedder that owns the window does; a headless test run does not.
   * Without it `bounds` is omitted and cell rects are reported separately.
   */
  readonly cellSize?: { readonly width: number; readonly height: number };
}

/** The export, plus the cell geometry AccessKit has nowhere to put. */
export interface AccessKitExport {
  readonly update: AccessKitTreeUpdate;
  /**
   * Cell-space rects keyed by AccessKit node id, for every node that had
   * `bounds`. AccessKit's `Node` has no extension point for foreign
   * coordinates, so carrying them alongside is the honest option: a consumer
   * that understands terminal cells can use them, and one that does not is
   * not misled by pixel coordinates that were never measured.
   */
  readonly cellBounds: Readonly<Record<string, Rect>>;
}

/**
 * ARIA-aligned protocol roles to AccessKit roles.
 *
 * Every target is a real `accesskit::Role` variant in its camelCase serde
 * spelling. `textbox` is resolved per node rather than here, because a
 * multiline textbox maps to a different AccessKit role.
 */
export const ACCESSKIT_ROLE_BY_SEMANTIC_ROLE: Readonly<Record<SemanticRole, string>> =
  Object.freeze({
    application: 'application',
    region: 'region',
    dialog: 'dialog',
    alert: 'alert',
    status: 'status',
    list: 'list',
    listitem: 'listItem',
    menu: 'menu',
    menuitem: 'menuItem',
    button: 'button',
    checkbox: 'checkBox',
    radio: 'radioButton',
    tab: 'tab',
    textbox: 'textInput',
    heading: 'heading',
    text: 'label',
    progressbar: 'progressIndicator',
    separator: 'splitter',
    scrollbar: 'scrollBar',
    table: 'table',
    row: 'row',
    cell: 'cell',
    generic: 'genericContainer',
  });

/**
 * Protocol actions to AccessKit actions.
 *
 * `select` is deliberately absent: AccessKit has no selection action, and
 * mapping it onto `click` would claim a behaviour the adapter never described.
 * `toggle` maps to `click` because that is how AccessKit expresses toggling.
 */
const ACCESSKIT_ACTION_BY_SEMANTIC_ACTION: Readonly<Partial<Record<SemanticAction, string>>> =
  Object.freeze({
    focus: 'focus',
    activate: 'click',
    toggle: 'click',
    setValue: 'setValue',
    expand: 'expand',
    scroll: 'scrollIntoView',
  });

/**
 * Bits of the digest used for a node id.
 *
 * AccessKit's `NodeId` is a `u64`, but JSON numbers are IEEE doubles and this
 * export is JSON. Staying inside 53 bits keeps every id exactly representable
 * on both sides; the alternative silently rounds ids above 2^53 and produces
 * collisions that look like duplicate nodes.
 */
const NODE_ID_BITS = 53n;
const NODE_ID_MASK = (1n << NODE_ID_BITS) - 1n;

/**
 * Map a protocol node id (a string) onto an AccessKit node id (a number).
 *
 * Stable across processes and languages: SHA-256 of the UTF-8 id, truncated to
 * 53 bits. At the protocol's 5 000-node ceiling the collision probability is
 * about 1.4e-9, and {@link toAccessKitTreeUpdate} detects a collision rather
 * than silently merging two nodes.
 *
 * @param id - Protocol node id.
 */
export function accessKitNodeId(id: string): number {
  const digest = createHash('sha256').update(id, 'utf8').digest();
  const value = digest.readBigUInt64BE(0) & NODE_ID_MASK;
  // 0 is a legal NodeId, but reserving it keeps "unset" unambiguous for
  // consumers that treat 0 as absent.
  return value === 0n ? 1 : Number(value);
}

function toggledFor(checked: boolean | 'mixed' | undefined): AccessKitToggled | undefined {
  if (checked === undefined) return undefined;
  if (checked === 'mixed') return 'mixed';
  return checked ? 'true' : 'false';
}

function accessKitRoleFor(node: SemanticNode): string {
  if (node.role === 'textbox' && node.state?.multiline === true) return 'multilineTextInput';
  return ACCESSKIT_ROLE_BY_SEMANTIC_ROLE[node.role];
}

function actionsFor(actions: readonly SemanticAction[] | undefined): readonly string[] | undefined {
  if (actions === undefined || actions.length === 0) return undefined;
  const mapped = new Set<string>();
  for (const action of actions) {
    const target = ACCESSKIT_ACTION_BY_SEMANTIC_ACTION[action];
    if (target !== undefined) mapped.add(target);
  }
  return mapped.size === 0 ? undefined : [...mapped];
}

function boundsFor(
  rect: Rect,
  cellSize: { readonly width: number; readonly height: number },
): AccessKitRect {
  return {
    x0: rect.column * cellSize.width,
    y0: rect.row * cellSize.height,
    x1: (rect.column + rect.width) * cellSize.width,
    y1: (rect.row + rect.height) * cellSize.height,
  };
}

/**
 * Convert a validated semantic snapshot into an AccessKit `TreeUpdate`.
 *
 * Two structural differences from our model are worth knowing:
 *
 * - **Focus is a tree-level property.** AccessKit puts `focus` on the
 *   `TreeUpdate`, not on a node, so the node carrying `state.focused` becomes
 *   the update's focus. If no node claims focus, the root does.
 * - **Children are explicit.** Our tree is a flat list joined by `parentId`;
 *   AccessKit nodes carry a `children` array, which is derived here in the
 *   snapshot's node order.
 *
 * @param snapshot - A snapshot that already passed `validateSnapshot`.
 * @param options - Tree identity, toolkit metadata and optional cell geometry.
 * @throws {ProtocolViolation} If two node ids collide in the 53-bit id space.
 */
export function toAccessKitTreeUpdate(
  snapshot: SemanticSnapshot,
  options: AccessKitExportOptions = {},
): AccessKitExport {
  const idOf = new Map<string, number>();
  const seen = new Map<number, string>();
  for (const node of snapshot.nodes) {
    const mapped = accessKitNodeId(node.id);
    const previous = seen.get(mapped);
    if (previous !== undefined) {
      throw new ProtocolViolation(
        'dto-key',
        `node ids "${previous}" and "${node.id}" collide in the AccessKit id space`,
      );
    }
    seen.set(mapped, node.id);
    idOf.set(node.id, mapped);
  }

  const childrenOf = new Map<string, number[]>();
  for (const node of snapshot.nodes) {
    if (node.parentId === undefined) continue;
    const siblings = childrenOf.get(node.parentId);
    if (siblings === undefined) childrenOf.set(node.parentId, [idOf.get(node.id)!]);
    else siblings.push(idOf.get(node.id)!);
  }

  const relation = (ids: readonly string[] | undefined): readonly number[] | undefined => {
    if (ids === undefined || ids.length === 0) return undefined;
    const mapped = ids.map((id) => idOf.get(id)).filter((id): id is number => id !== undefined);
    return mapped.length === 0 ? undefined : mapped;
  };

  const cellBounds: Record<string, Rect> = {};
  const nodes: (readonly [number, AccessKitNode])[] = [];
  let focus: number | undefined;

  for (const node of snapshot.nodes) {
    const id = idOf.get(node.id)!;
    const state = node.state;
    if (state?.focused === true && focus === undefined) focus = id;
    if (node.bounds !== undefined) cellBounds[String(id)] = node.bounds;

    const accessKitNode: AccessKitNode = {
      role: accessKitRoleFor(node),
      ...(node.name === '' ? {} : { label: node.name }),
      ...(node.description === undefined ? {} : { description: node.description }),
      ...(node.value === undefined ? {} : { value: node.value }),
      ...(childrenOf.has(node.id) ? { children: childrenOf.get(node.id)! } : {}),
      ...(node.bounds !== undefined && options.cellSize !== undefined
        ? { bounds: boundsFor(node.bounds, options.cellSize) }
        : {}),
      ...(actionsFor(node.actions) === undefined ? {} : { actions: actionsFor(node.actions)! }),
      ...(relation(node.labelledBy) === undefined ? {} : { labelledBy: relation(node.labelledBy)! }),
      ...(relation(node.describedBy) === undefined
        ? {}
        : { describedBy: relation(node.describedBy)! }),
      ...(state?.disabled === undefined ? {} : { disabled: state.disabled }),
      ...(state?.selected === undefined ? {} : { selected: state.selected }),
      ...(state?.expanded === undefined ? {} : { expanded: state.expanded }),
      ...(state?.busy === undefined ? {} : { busy: state.busy }),
      ...(state?.modal === undefined ? {} : { modal: state.modal }),
      ...(state?.hidden === undefined ? {} : { hidden: state.hidden }),
      ...(state?.readonly === undefined ? {} : { readOnly: state.readonly }),
      ...(toggledFor(state?.checked) === undefined
        ? {}
        : { toggled: toggledFor(state?.checked)! }),
    };
    nodes.push(Object.freeze([id, Object.freeze(accessKitNode)] as const));
  }

  const rootId = snapshot.rootIds[0];
  const root = rootId === undefined ? undefined : idOf.get(rootId);

  const update: AccessKitTreeUpdate = {
    nodes: Object.freeze(nodes),
    ...(root === undefined
      ? {}
      : {
          tree: Object.freeze({
            root,
            ...(options.toolkitName === undefined ? {} : { toolkitName: options.toolkitName }),
            ...(options.toolkitVersion === undefined
              ? {}
              : { toolkitVersion: options.toolkitVersion }),
          }),
        }),
    treeId: options.treeId ?? ACCESSKIT_ROOT_TREE_ID,
    focus: focus ?? root ?? 0,
  };

  return Object.freeze({ update: Object.freeze(update), cellBounds: Object.freeze(cellBounds) });
}
