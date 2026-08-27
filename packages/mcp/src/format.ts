/**
 * The compact snapshot format from CONTRACTS.md §MCP. It is normative, so this
 * module is deliberately small and covered by a golden test:
 *
 * ```
 * Terminal t1 100x30 revision 42
 * semanticTree: available
 * dialog "Permission" ref=semantic:n7@42 bounds=(8,20,40,9) modal
 *   button "Approve" ref=semantic:n8@42 bounds=(14,23,11,1) focused
 * visible text:
 * <grid text>
 * ```
 *
 * `bounds` is `(row,column,width,height)` — the field order of the protocol's
 * `Rect`. Refs are `semantic:<nodeId>@<semanticRevision>`, byte-identical to the refs the
 * driver puts on `ResolvedTarget`, so a ref can be quoted back to any tool.
 */
import type { Rect, SemanticNode, SemanticSnapshot, SemanticState } from './model.js';
import type { SemanticLocatorRef } from '@termwright/driver';

/** One line of the ref list, plus the structured fields behind it. */
export interface RefEntry {
  readonly ref: SemanticLocatorRef;
  readonly role: string;
  readonly name: string;
  readonly depth: number;
  readonly bounds?: Rect;
  readonly flags: readonly string[];
  readonly testId?: string;
  readonly value?: string;
  readonly applicationScroll?: string;
  readonly paintedRegion?: string;
}

/** Formats an explicitly semantic ref for a node observed at `revision`. */
export function formatRef(nodeId: string, revision: number): SemanticLocatorRef {
  return `semantic:${nodeId}@${revision}`;
}

/** Splits a semantic ref back into its parts; screen refs are rejected. */
export function parseRef(
  ref: string,
): { readonly nodeId: string; readonly revision: number } | null {
  const match = /^semantic:([^@\s]+)@(\d+)$/u.exec(ref);
  if (match === null) return null;
  const nodeId = match[1];
  const revision = Number(match[2]);
  if (nodeId === undefined) return null;
  if (!Number.isInteger(revision) || revision < 0) return null;
  return { nodeId, revision };
}

/** Renders a rect as `(row,column,width,height)`. */
export function formatBounds(bounds: Rect): string {
  return `(${bounds.row},${bounds.column},${bounds.width},${bounds.height})`;
}

/**
 * The trailing flag list of a node line: every asserted state, in the closed
 * order of the protocol's state set. Booleans render as bare names (`modal`),
 * everything else as `name=value` (`checked=mixed`, `level=2`).
 */
export function stateFlags(state: SemanticState | undefined): readonly string[] {
  if (state === undefined) return [];
  const flags: string[] = [];
  for (const [key, value] of Object.entries(state)) {
    if (value === undefined) continue;
    if (value === true) flags.push(key);
    else if (value === false) continue;
    else flags.push(`${key}=${String(value)}`);
  }
  return flags;
}

/** Renders one node line (without indentation). */
export function formatNodeLine(entry: RefEntry): string {
  const parts = [`${entry.role} ${JSON.stringify(entry.name)}`, `ref=${entry.ref}`];
  if (entry.bounds !== undefined) parts.push(`bounds=${formatBounds(entry.bounds)}`);
  if (entry.applicationScroll !== undefined) parts.push(`app-scroll=${entry.applicationScroll}`);
  if (entry.paintedRegion !== undefined) parts.push(`painted=${entry.paintedRegion}`);
  return [...parts, ...entry.flags].join(' ');
}

/** Depth-first walk of a snapshot in document order, roots first. */
export function walkSnapshot(
  snapshot: SemanticSnapshot,
): readonly { node: SemanticNode; depth: number }[] {
  const children = new Map<string, SemanticNode[]>();
  const byId = new Map<string, SemanticNode>();
  for (const node of snapshot.nodes) {
    byId.set(node.id, node);
    const parent = node.parentId;
    if (parent === undefined) continue;
    const bucket = children.get(parent);
    if (bucket === undefined) children.set(parent, [node]);
    else bucket.push(node);
  }
  const out: { node: SemanticNode; depth: number }[] = [];
  const seen = new Set<string>();
  const visit = (node: SemanticNode, depth: number): void => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    out.push({ node, depth });
    for (const child of children.get(node.id) ?? []) visit(child, depth + 1);
  };
  for (const rootId of snapshot.rootIds) {
    const root = byId.get(rootId);
    if (root !== undefined) visit(root, 0);
  }
  // Defensive: a node whose parent was dropped still gets listed, at the root.
  for (const node of snapshot.nodes) visit(node, 0);
  return out;
}

/** Turns a snapshot into ref entries in document order. */
export function refEntries(snapshot: SemanticSnapshot): readonly RefEntry[] {
  return walkSnapshot(snapshot).map(({ node, depth }) =>
    toRefEntry(node, snapshot.revision, depth),
  );
}

/** Projects a single node into a {@link RefEntry}. */
export function toRefEntry(node: SemanticNode, revision: number, depth = 0): RefEntry {
  const visibleRect = node.geometry.visibleRect;
  return {
    ref: formatRef(node.id, revision),
    role: node.role,
    name: node.name,
    depth,
    ...(visibleRect.status === 'known' ? { bounds: visibleRect.value } : {}),
    flags: stateFlags(node.state),
    ...(node.testId === undefined ? {} : { testId: node.testId }),
    ...(node.value?.status === 'known' && node.value.sensitivity === 'public'
      ? { value: node.value.value }
      : {}),
    ...(node.scroll?.status === 'known'
      ? {
          applicationScroll: `${node.scroll.value.axis}:${node.scroll.value.offset}+${node.scroll.value.viewport}/${node.scroll.value.extent}`,
        }
      : {}),
    ...(node.paintedRegion?.status === 'known'
      ? {
          paintedRegion: `${formatBounds(node.paintedRegion.value.regionBounds)}:${node.paintedRegion.value.spans.length}-spans`,
        }
      : {}),
  };
}

/** Options for {@link formatCompactSnapshot}. */
export interface CompactSnapshotOptions {
  /** Terminal handle, e.g. `t1`. */
  readonly terminal: string;
  readonly columns: number;
  readonly rows: number;
  /** Screen revision — the cursor `terminal.capture_since` takes. */
  readonly revision: number;
  readonly semantic: SemanticSnapshot | null;
  /** Visible grid text, one entry per row. */
  readonly text: readonly string[];
  /** Cap on listed nodes; the remainder is summarised on one line. */
  readonly maxNodes?: number;
  /** Cap on rendered rows; the remainder is summarised on one line. */
  readonly maxRows?: number;
  /** Omit the `visible text:` block (the `full` variant writes it to disk). */
  readonly includeText?: boolean;
}

const DEFAULT_MAX_NODES = 500;

/** Renders the normative compact snapshot. */
export function formatCompactSnapshot(options: CompactSnapshotOptions): string {
  const lines = [
    `Terminal ${options.terminal} ${options.columns}x${options.rows} revision ${options.revision}`,
    `semanticTree: ${options.semantic === null ? 'unavailable' : 'available'}`,
  ];
  if (options.semantic !== null) {
    const entries = refEntries(options.semantic);
    const limit = options.maxNodes ?? DEFAULT_MAX_NODES;
    for (const entry of entries.slice(0, limit)) {
      lines.push(`${'  '.repeat(entry.depth)}${formatNodeLine(entry)}`);
    }
    if (entries.length > limit) {
      lines.push(`... ${entries.length - limit} more nodes (raise maxNodes or use variant="full")`);
    }
  }
  if (options.includeText !== false) {
    lines.push('visible text:');
    const maxRows = options.maxRows ?? options.text.length;
    lines.push(...options.text.slice(0, maxRows));
    if (options.text.length > maxRows) lines.push(`... ${options.text.length - maxRows} more rows`);
  }
  return lines.join('\n');
}
