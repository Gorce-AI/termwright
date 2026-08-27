/**
 * Serializes a {@link SemanticSnapshot} into the YAML snapshot format that is
 * normative in `/CONTRACTS.md` §YAML snapshots:
 *
 * ```yaml
 * - dialog "Permission" [modal]:
 *     - text "Allow bash to run?"
 *     - button "Approve" [focused]
 * ```
 *
 * The output is meant to be pasted straight back into a test as an expected
 * pattern, so it only ever emits constructs the matcher understands.
 */

import type { SemanticNode, SemanticSnapshot, SemanticState } from '@termwright/protocol';

/** Which state keys a serialized node carries. */
export type StateSelection = 'stable' | 'all' | readonly (keyof SemanticState)[];

/** Options for {@link serializeSemanticSnapshot}. */
export interface SerializeOptions {
  /**
   * State keys to emit.
   *
   * `stable` (default) skips positional and scroll states, which change on
   * every repaint and would make snapshots churn; `all` emits every key set by
   * the adapter; an explicit list pins exactly what the test cares about.
   */
  readonly states?: StateSelection;
  /** Indentation per level, in spaces. Default 4, matching the contract. */
  readonly indent?: number;
  /** Serialize this node and its descendants instead of the whole tree. */
  readonly rootId?: string;
  /**
   * With `rootId`, whether that node is itself the top level (default) or only
   * the parent of it — `false` serializes what is *inside* the node, which is
   * what scoping to a container is normally for.
   */
  readonly includeRoot?: boolean;
  /** Drop nodes carrying `state.hidden`. Default false. */
  readonly skipHidden?: boolean;
}

/** State keys emitted by the `stable` selection, in a fixed order. */
export const STABLE_STATE_KEYS: readonly (keyof SemanticState)[] = Object.freeze([
  'modal',
  'disabled',
  'readonly',
  'focused',
  'selected',
  'checked',
  'expanded',
  'busy',
  'hidden',
  'multiline',
  'orientation',
  'level',
]);

/** Every state key, in a fixed order. Used by the `all` selection. */
export const ALL_STATE_KEYS: readonly (keyof SemanticState)[] = Object.freeze([
  ...STABLE_STATE_KEYS,
  'positionInSet',
  'setSize',
]);

/**
 * Renders the snapshot as YAML.
 *
 * @returns the tree, one node per line, newline-terminated; `''` for a tree
 * with no visible nodes.
 *
 * @example
 * ```ts
 * const yaml = serializeSemanticSnapshot(terminal.semanticTree()!);
 * // - dialog "Permission" [modal]:
 * //     - button "Approve" [focused]
 * ```
 */
export function serializeSemanticSnapshot(
  snapshot: SemanticSnapshot,
  options: SerializeOptions = {},
): string {
  const indent = options.indent ?? 4;
  const keys = stateKeys(options.states ?? 'stable');
  const children = childIndex(snapshot);
  const roots = topLevel(snapshot, children, options.rootId, options.includeRoot);

  const lines: string[] = [];
  const emit = (nodes: readonly SemanticNode[], depth: number): void => {
    for (const node of nodes) {
      if (options.skipHidden === true && node.state?.hidden === true) continue;
      const kids = (children.get(node.id) ?? []).filter(
        (child) => options.skipHidden !== true || child.state?.hidden !== true,
      );
      const pad = ' '.repeat(depth * indent);
      const head = quoteWhenNeeded(describeNode(node, keys));
      lines.push(kids.length === 0 ? `${pad}- ${head}` : `${pad}- ${head}:`);
      emit(kids, depth + 1);
    }
  };
  emit(roots, 0);
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

/** Renders one node without its children, e.g. `button "Approve" [focused]`. */
export function describeNode(
  node: SemanticNode,
  keys: readonly (keyof SemanticState)[] = STABLE_STATE_KEYS,
): string {
  const parts: string[] = [node.role];
  const name = normalizeName(node.name);
  if (name.length > 0) parts.push(JSON.stringify(name));
  const flags = describeState(node.state, keys);
  if (flags.length > 0) parts.push(`[${flags.join(',')}]`);
  return parts.join(' ');
}

/** Renders the `[…]` flag list for a state object, without the brackets. */
export function describeState(
  state: SemanticState | undefined,
  keys: readonly (keyof SemanticState)[] = STABLE_STATE_KEYS,
): readonly string[] {
  if (state === undefined) return [];
  const flags: string[] = [];
  for (const key of keys) {
    const value = state[key];
    if (value === undefined || value === false) continue;
    flags.push(value === true ? key : `${key}=${String(value)}`);
  }
  return flags;
}

/**
 * Collapses runs of whitespace and trims, the way the matcher compares names.
 *
 * Terminal frameworks pad labels for layout; `"  Approve "` and `"Approve"` are
 * the same name to a reader, so they are the same name to a snapshot.
 */
export function normalizeName(name: string): string {
  return name.replace(/\s+/gu, ' ').trim();
}

/**
 * The nodes a snapshot starts at: the tree's roots, a named node, or that
 * node's children when the caller scoped *into* it.
 */
export function topLevel(
  snapshot: SemanticSnapshot,
  children: ReadonlyMap<string, SemanticNode[]>,
  rootId: string | undefined,
  includeRoot = true,
): readonly SemanticNode[] {
  if (rootId === undefined)
    return snapshot.nodes.filter((node) => snapshot.rootIds.includes(node.id));
  if (!includeRoot) return children.get(rootId) ?? [];
  return snapshot.nodes.filter((node) => node.id === rootId);
}

/** Indexes nodes by their parent, preserving the order the adapter published. */
export function childIndex(snapshot: SemanticSnapshot): Map<string, SemanticNode[]> {
  const children = new Map<string, SemanticNode[]>();
  for (const node of snapshot.nodes) {
    if (node.parentId === undefined) continue;
    const bucket = children.get(node.parentId);
    if (bucket === undefined) children.set(node.parentId, [node]);
    else bucket.push(node);
  }
  return children;
}

function stateKeys(selection: StateSelection): readonly (keyof SemanticState)[] {
  if (selection === 'stable') return STABLE_STATE_KEYS;
  if (selection === 'all') return ALL_STATE_KEYS;
  return selection;
}

/**
 * Wraps a node head in single quotes when leaving it bare would change how YAML
 * reads the line — a `#` starting a comment being the common case with names
 * like `Issue #12`.
 */
function quoteWhenNeeded(head: string): string {
  const risky =
    /^[-?:,[\]{}#&*!|>'"%@`]/u.test(head) ||
    /\s#/u.test(head) ||
    /:(\s|$)/u.test(head) ||
    /\s$/u.test(head);
  return risky ? `'${head.replace(/'/gu, "''")}'` : head;
}
