/**
 * Turning two consecutive snapshots into a tree delta.
 *
 * The wire format is a set of whole-node upserts plus a set of removals that
 * cascade over the *base* tree's parent links. Cascade is what keeps a delta
 * small — dropping a dialog costs one id, not one per descendant — but it is
 * also the one rule that makes a naive diff wrong, so it is worth stating the
 * trap plainly:
 *
 * Removing an id kills everything under it **in the base tree**. A node that
 * survived the re-render but happened to sit inside a removed subtree is
 * therefore killed too, and must be re-listed in `changed` even when nothing
 * about it changed. Upserts are applied after removals precisely so that this
 * resurrection works.
 *
 * `applyTreeDelta` from the protocol is the oracle this module is tested
 * against: base plus delta must reproduce the new snapshot exactly.
 */

import type { SemanticNode, SemanticSnapshot, TreeDelta } from '@termwright/protocol';

/** Stable structural identity of a node, used to detect "unchanged". */
function fingerprint(node: SemanticNode): string {
  return JSON.stringify(node);
}

/**
 * Every base id that removing `roots` would take with it, including the roots.
 *
 * Walks the base tree's parent links, so it describes what the *receiver* will
 * delete when it applies the delta — not what the new tree looks like.
 */
function cascade(base: SemanticSnapshot, roots: ReadonlySet<string>): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const node of base.nodes) {
    if (node.parentId === undefined) continue;
    const siblings = childrenOf.get(node.parentId);
    if (siblings === undefined) childrenOf.set(node.parentId, [node.id]);
    else siblings.push(node.id);
  }

  const killed = new Set<string>();
  const stack = [...roots];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (killed.has(id)) continue;
    killed.add(id);
    for (const child of childrenOf.get(id) ?? []) stack.push(child);
  }
  return killed;
}

/**
 * Compute the delta carrying `base` to `next`.
 *
 * @param base - The tree the receiver currently holds.
 * @param next - The tree it should hold afterwards.
 * @returns a delta bound to `base.revision`; applying it to `base` yields
 * `next` exactly.
 */
export function computeTreeDelta(base: SemanticSnapshot, next: SemanticSnapshot): TreeDelta {
  const baseById = new Map(base.nodes.map((node) => [node.id, node]));
  const nextById = new Map(next.nodes.map((node) => [node.id, node]));

  // Gone entirely. Only the topmost of each removed subtree is listed; the
  // cascade covers the rest.
  const gone = new Set<string>();
  for (const node of base.nodes) if (!nextById.has(node.id)) gone.add(node.id);

  const removed: string[] = [];
  for (const id of gone) {
    const parentId = baseById.get(id)?.parentId;
    if (parentId === undefined || !gone.has(parentId)) removed.push(id);
  }

  // What the receiver will actually delete — a superset of `gone` whenever a
  // surviving node sat under something that disappeared.
  const collateral = cascade(base, new Set(removed));

  const changed: SemanticNode[] = [];
  for (const node of next.nodes) {
    const previous = baseById.get(node.id);
    const isNew = previous === undefined;
    const isDifferent = !isNew && fingerprint(previous) !== fingerprint(node);
    // The third case is the cascade trap: unchanged, but about to be deleted.
    if (isNew || isDifferent || collateral.has(node.id)) changed.push(node);
  }

  const rootsDiffer =
    base.rootIds.length !== next.rootIds.length ||
    base.rootIds.some((id, index) => id !== next.rootIds[index]);

  return {
    baseRevision: base.revision,
    revision: next.revision,
    changed,
    removed,
    ...(rootsDiffer ? { rootIds: next.rootIds } : {}),
    ...(cursorChanged(base.cursor, next.cursor) && next.cursor !== undefined
      ? { cursor: next.cursor }
      : {}),
  };
}

function cursorChanged(
  before: SemanticSnapshot['cursor'],
  after: SemanticSnapshot['cursor'],
): boolean {
  if (before === after) return false;
  if (before === undefined || after === undefined) return true;
  return JSON.stringify(before) !== JSON.stringify(after);
}

/**
 * Whether a delta is worth sending instead of the snapshot it describes.
 *
 * `subscribe: 'diffs'` does not forbid snapshots, so the cheaper of the two
 * always wins. Once a delta approaches the size of the whole tree it is pure
 * overhead: the receiver pays composition cost on top of the same bytes, and a
 * fresh snapshot additionally re-anchors the session.
 *
 * @param ratio - Fraction of the snapshot's size above which the delta loses.
 */
export function deltaIsWorthSending(
  delta: TreeDelta,
  snapshot: SemanticSnapshot,
  ratio = 0.5,
): boolean {
  const deltaBytes = JSON.stringify(delta).length;
  const snapshotBytes = JSON.stringify(snapshot).length;
  return deltaBytes <= snapshotBytes * ratio;
}
