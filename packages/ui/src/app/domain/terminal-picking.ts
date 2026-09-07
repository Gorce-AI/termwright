import type { Rect, SemanticNode, SemanticSnapshot } from '@termwright/protocol';

export type TerminalPick =
  | { readonly node: SemanticNode; readonly reason?: never }
  | { readonly node: null; readonly reason: string };

/** Inspect semantic geometry; do not infer an element from rendered text. */
export function pickTerminalNode(
  snapshot: SemanticSnapshot,
  column: number,
  row: number,
): TerminalPick {
  const missing = (reason: string): TerminalPick => ({ node: null, reason });
  if (
    !Number.isFinite(column) ||
    !Number.isFinite(row) ||
    column < 0 ||
    row < 0 ||
    column >= snapshot.columns ||
    row >= snapshot.rows
  )
    return missing('Point inside the terminal grid to inspect an element.');
  const contains = (rect: Rect) =>
    column >= rect.column &&
    row >= rect.row &&
    column < rect.column + rect.width &&
    row < rect.row + rect.height;
  const candidates = snapshot.nodes.filter(
    (node) =>
      node.geometry.visibleRect.status === 'known' &&
      !(node.geometry.displayed.status === 'known' && !node.geometry.displayed.value) &&
      contains(node.geometry.visibleRect.value),
  );
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const isAncestor = (parent: SemanticNode, child: SemanticNode) => {
    const visited = new Set<string>();
    let id = child.parentId;
    while (id !== undefined && !visited.has(id)) {
      if (id === parent.id) return true;
      visited.add(id);
      id = byId.get(id)?.parentId;
    }
    return false;
  };
  const deepest = candidates.filter((node) => !candidates.some((other) => isAncestor(node, other)));
  if (deepest.length === 1) return { node: deepest[0]! };
  if (deepest.length > 1 && snapshot.hitGrid.status === 'known') {
    const owner = snapshot.hitGrid.value.regions.find((region) =>
      contains(region.rect),
    )?.recipientId;
    const target = deepest.find((node) => node.id === owner);
    if (target !== undefined) return { node: target };
  }
  return missing(
    deepest.length > 1
      ? 'Overlapping elements have no unique recorded target here. Choose one in the tree.'
      : 'No element with recorded visible bounds at this position.',
  );
}
