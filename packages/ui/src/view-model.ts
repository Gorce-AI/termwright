/**
 * The panes' logic, separated from their rendering: tree shaping, the pick-mode
 * hit test, marker navigation and time formatting.
 *
 * These functions are the part of the browser app worth testing, and they are
 * kept out of `src/app/` precisely so they can be — importing a pane would drag
 * in xterm.js and a DOM.
 *
 * @packageDocumentation
 */

import type { SemanticNode, SemanticSnapshot } from '@termwright/protocol';

/** Children of every node, in snapshot order, keyed by parent id. */
export function childrenOf(snapshot: SemanticSnapshot): Map<string, SemanticNode[]> {
  const children = new Map<string, SemanticNode[]>();
  for (const node of snapshot.nodes) {
    const key = node.parentId ?? '';
    const list = children.get(key) ?? [];
    list.push(node);
    children.set(key, list);
  }
  return children;
}

/**
 * Root nodes, honouring `rootIds` and falling back to parentless nodes.
 *
 * The fallback exists for robustness in the viewer, not permissiveness in the
 * protocol: a tree that reaches the UI has already been validated, and a viewer
 * that renders nothing is a worse failure than one that renders what it got.
 */
export function rootsOf(snapshot: SemanticSnapshot): SemanticNode[] {
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const roots = snapshot.rootIds
    .map((id) => byId.get(id))
    .filter((node): node is SemanticNode => node !== undefined);
  if (roots.length > 0) return roots;
  return snapshot.nodes.filter((node) => node.parentId === undefined);
}

/** A node's set flags, in the form the YAML snapshot format writes them. */
export function statesOf(node: SemanticNode): string[] {
  const state = node.state;
  if (state === undefined) return [];
  return Object.entries(state)
    .filter(([, value]) => value !== undefined && value !== false)
    .map(([key, value]) => (value === true ? key : `${key}=${String(value)}`));
}

/**
 * The innermost node whose bounds contain a cell — the pick-mode hit test.
 *
 * Innermost wins by area, so pointing at a button inside a dialog selects the
 * button. Nodes without bounds are not pickable: a framework that publishes no
 * measurements cannot be pointed at, and guessing would put the overlay
 * somewhere the node is not.
 */
export function nodeAt(
  nodes: readonly SemanticNode[],
  position: { row: number; column: number },
): SemanticNode | undefined {
  let best: SemanticNode | undefined;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const node of nodes) {
    const rect = node.bounds;
    if (rect === undefined) continue;
    if (
      position.row < rect.row ||
      position.row >= rect.row + rect.height ||
      position.column < rect.column ||
      position.column >= rect.column + rect.width
    ) {
      continue;
    }
    const area = rect.width * rect.height;
    if (area < bestArea) {
      best = node;
      bestArea = area;
    }
  }
  return best;
}

/** The next marker strictly after (or before) `timeMs`, for the jump buttons. */
export function nextMarker(
  markers: readonly { t: number }[],
  timeMs: number,
  direction: -1 | 1,
): number | undefined {
  const sorted = [...markers].sort((left, right) => left.t - right.t);
  if (direction === 1) return sorted.find((marker) => marker.t > timeMs + 1)?.t;
  return [...sorted].reverse().find((marker) => marker.t < timeMs - 1)?.t;
}

/**
 * The glyph that marks a status.
 *
 * Status is never carried by colour alone: a red dot and a green dot are the
 * same dot to a colourblind reader, and the panel is full of them.
 */
export function statusGlyph(status: string): string {
  switch (status) {
    case 'passed':
      return '✓';
    case 'failed':
      return '✕';
    case 'running':
      return '◍';
    case 'cancelled':
      return '■';
    case 'skipped':
      return '–';
    case 'not-run':
      return '○';
    default:
      return '•';
  }
}

/** `320ms`, `1.5s`, `1m 04s`. */
export function formatMs(value: number): string {
  if (value < 1_000) return `${Math.round(value)}ms`;
  if (value < 60_000) return `${(value / 1_000).toFixed(1)}s`;
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.floor((value % 60_000) / 1_000);
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}
