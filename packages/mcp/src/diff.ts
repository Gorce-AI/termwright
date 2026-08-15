/**
 * The incremental view behind `terminal.capture_since`: which screen rows and
 * which semantic subtrees changed since a cursor the agent was handed earlier.
 *
 * The diff is local to this package on purpose — see NOTES.md: `@termwright/mcp`
 * may depend on the driver only, and the shape needed here (changed rows plus
 * minimal changed subtree roots, rendered in the compact ref format) is a
 * projection for agents rather than a trace-archive concern.
 */
import { formatNodeLine, formatRef, toRefEntry, walkSnapshot } from './format.js';
import type { RefEntry } from './format.js';
import type { SemanticNode, SemanticSnapshot } from './model.js';

/** A screen row whose text differs from the baseline. */
export interface RowChange {
  readonly row: number;
  readonly text: string;
}

/** A changed semantic subtree, identified by the ref of its root. */
export interface SubtreeChange {
  readonly change: 'added' | 'removed' | 'updated';
  readonly ref: string;
  readonly role: string;
  readonly name: string;
  /** The subtree in compact ref format, one node per line, indented. */
  readonly compact: string;
}

/** Rows present in `after` but different (or absent) in `before`. */
export function diffRows(before: readonly string[], after: readonly string[]): readonly RowChange[] {
  const changes: RowChange[] = [];
  for (let row = 0; row < after.length; row += 1) {
    const next = after[row] ?? '';
    if (before[row] !== next) changes.push({ row, text: next });
  }
  // Rows that disappeared because the terminal shrank are reported as empty.
  for (let row = after.length; row < before.length; row += 1) {
    changes.push({ row, text: '' });
  }
  return changes;
}

/** True when two nodes differ in anything an agent could act on. */
function nodeChanged(before: SemanticNode, after: SemanticNode): boolean {
  return (
    before.role !== after.role ||
    before.name !== after.name ||
    before.value !== after.value ||
    before.testId !== after.testId ||
    before.description !== after.description ||
    before.parentId !== after.parentId ||
    JSON.stringify(before.bounds ?? null) !== JSON.stringify(after.bounds ?? null) ||
    JSON.stringify(before.state ?? null) !== JSON.stringify(after.state ?? null)
  );
}

function indexById(snapshot: SemanticSnapshot | null): Map<string, SemanticNode> {
  const index = new Map<string, SemanticNode>();
  for (const node of snapshot?.nodes ?? []) index.set(node.id, node);
  return index;
}

/** Renders `entry` and its descendants, re-based so the root sits at column 0. */
function renderSubtree(
  snapshot: SemanticSnapshot,
  rootId: string,
  walked: readonly { node: SemanticNode; depth: number }[],
): { readonly root: RefEntry; readonly compact: string } {
  const rootIndex = walked.findIndex(({ node }) => node.id === rootId);
  const rootEntry = walked[rootIndex];
  if (rootEntry === undefined) throw new Error(`node ${rootId} vanished mid-diff`);
  const lines: string[] = [];
  let root: RefEntry | undefined;
  for (let i = rootIndex; i < walked.length; i += 1) {
    const current = walked[i];
    if (current === undefined) break;
    if (i > rootIndex && current.depth <= rootEntry.depth) break;
    const entry = toRefEntry(current.node, snapshot.revision, current.depth - rootEntry.depth);
    root ??= entry;
    lines.push(`${'  '.repeat(entry.depth)}${formatNodeLine(entry)}`);
  }
  return { root: root ?? toRefEntry(rootEntry.node, snapshot.revision), compact: lines.join('\n') };
}

/**
 * Changed subtrees between two semantic snapshots, matched by node id.
 *
 * Only *minimal roots* are reported: when a node and its parent both changed,
 * the parent's subtree already contains the child, so the child is folded in.
 * Removals are reported with the ref they had in the baseline.
 */
export function diffSemantic(
  before: SemanticSnapshot | null,
  after: SemanticSnapshot | null,
): readonly SubtreeChange[] {
  if (after === null) {
    if (before === null) return [];
    return before.nodes.map((node) => ({
      change: 'removed' as const,
      ref: formatRef(node.id, before.revision),
      role: node.role,
      name: node.name,
      compact: formatNodeLine(toRefEntry(node, before.revision)),
    }));
  }

  const beforeIndex = indexById(before);
  const afterIndex = indexById(after);
  const walked = walkSnapshot(after);

  const changedIds = new Set<string>();
  for (const node of after.nodes) {
    const previous = beforeIndex.get(node.id);
    if (previous === undefined || nodeChanged(previous, node)) changedIds.add(node.id);
  }

  const changes: SubtreeChange[] = [];
  for (const { node } of walked) {
    if (!changedIds.has(node.id)) continue;
    const parentId = node.parentId;
    // Folded into the ancestor's subtree when the ancestor changed as well.
    if (parentId !== undefined && changedIds.has(parentId) && afterIndex.has(parentId)) continue;
    const rendered = renderSubtree(after, node.id, walked);
    changes.push({
      change: beforeIndex.has(node.id) ? 'updated' : 'added',
      ref: rendered.root.ref,
      role: node.role,
      name: node.name,
      compact: rendered.compact,
    });
  }

  for (const node of before?.nodes ?? []) {
    if (afterIndex.has(node.id)) continue;
    const parentId = node.parentId;
    if (parentId !== undefined && !afterIndex.has(parentId)) continue; // parent already reported
    changes.push({
      change: 'removed',
      ref: formatRef(node.id, before?.revision ?? 0),
      role: node.role,
      name: node.name,
      compact: formatNodeLine(toRefEntry(node, before?.revision ?? 0)),
    });
  }

  return changes;
}
