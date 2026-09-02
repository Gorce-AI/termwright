/**
 * The locator engine. One evaluator for both dialects: semantic queries run
 * against the latest accepted tree, generic queries run against the grid and
 * yield rectangles only — a generic match never acquires a role it does not
 * have.
 */
import type {
  Rect,
  SemanticNode,
  SemanticRole,
  SemanticSnapshot,
  SemanticState,
} from '@termwright/protocol';
import type { CellAttributes, CellColor, CellSnapshot } from './api.js';
import type { CapturedRow } from './screen.js';
import {
  matchesText,
  type GenericQuery,
  type SemanticStep,
  type StylePredicates,
} from './selectors.js';

/** Node index derived once per accepted snapshot. */
export class SemanticIndex {
  #snapshot: SemanticSnapshot;
  readonly #byId = new Map<string, SemanticNode>();
  readonly #byRole = new Map<SemanticRole, Set<string>>();
  readonly #byTestId = new Map<string, Set<string>>();
  readonly #byExactName = new Map<string, Set<string>>();
  readonly #ordinal = new Map<string, number>();

  constructor(snapshot: SemanticSnapshot) {
    this.#snapshot = snapshot;
    for (const [ordinal, node] of snapshot.nodes.entries()) {
      this.#add(node);
      this.#ordinal.set(node.id, ordinal);
    }
  }

  get snapshot(): SemanticSnapshot {
    return this.#snapshot;
  }

  get nodes(): readonly SemanticNode[] {
    return this.snapshot.nodes;
  }

  node(id: string): SemanticNode | undefined {
    return this.#byId.get(id);
  }

  /** Commit an already validated delta without rebuilding unaffected indexes. */
  update(
    snapshot: SemanticSnapshot,
    changedNodes: ReadonlyMap<string, SemanticNode | undefined>,
  ): void {
    let orderChanged = false;
    for (const [id, next] of changedNodes) {
      const previous = this.#byId.get(id);
      if ((previous === undefined) !== (next === undefined)) orderChanged = true;
      if (previous !== undefined) this.#remove(previous);
      if (next !== undefined) this.#add(next);
    }
    this.#snapshot = snapshot;
    if (orderChanged) {
      this.#ordinal.clear();
      for (const [ordinal, node] of snapshot.nodes.entries()) this.#ordinal.set(node.id, ordinal);
    }
  }

  candidates(step: SemanticStep): readonly SemanticNode[] {
    const sets: Set<string>[] = [];
    if (step.role !== undefined) sets.push(this.#byRole.get(step.role) ?? new Set());
    if (step.testId !== undefined) sets.push(this.#byTestId.get(step.testId) ?? new Set());
    if (step.name?.kind === 'exact') sets.push(this.#byExactName.get(step.name.text) ?? new Set());
    if (sets.length === 0) return this.nodes;
    sets.sort((left, right) => left.size - right.size);
    return [...sets[0]!]
      .filter((id) => sets.slice(1).every((set) => set.has(id)))
      .map((id) => this.#byId.get(id))
      .filter((node): node is SemanticNode => node !== undefined)
      .sort(
        (left, right) => (this.#ordinal.get(left.id) ?? 0) - (this.#ordinal.get(right.id) ?? 0),
      );
  }

  #add(node: SemanticNode): void {
    this.#byId.set(node.id, node);
    addIndex(this.#byRole, node.role, node.id);
    addIndex(this.#byExactName, node.name, node.id);
    if (node.testId !== undefined) addIndex(this.#byTestId, node.testId, node.id);
  }

  #remove(node: SemanticNode): void {
    this.#byId.delete(node.id);
    removeIndex(this.#byRole, node.role, node.id);
    removeIndex(this.#byExactName, node.name, node.id);
    if (node.testId !== undefined) removeIndex(this.#byTestId, node.testId, node.id);
  }

  /** Ancestors from the immediate parent upwards; bounded by the tree depth. */
  ancestors(node: SemanticNode): SemanticNode[] {
    const out: SemanticNode[] = [];
    const seen = new Set<string>([node.id]);
    let current = node;
    while (current.parentId !== undefined) {
      const parent = this.#byId.get(current.parentId);
      if (parent === undefined || seen.has(parent.id)) break;
      seen.add(parent.id);
      out.push(parent);
      current = parent;
    }
    return out;
  }

  /** True when `node` is a strict descendant of `ancestorId`. */
  isDescendantOf(node: SemanticNode, ancestorId: string): boolean {
    return this.ancestors(node).some((ancestor) => ancestor.id === ancestorId);
  }

  /**
   * The node's computed label: the concatenated names of the nodes it is
   * labelled by, falling back to its own name.
   */
  label(node: SemanticNode): string {
    if (node.labelledBy === undefined || node.labelledBy.length === 0) return node.name;
    const parts = node.labelledBy
      .map((id) => this.#byId.get(id)?.name)
      .filter((name): name is string => name !== undefined && name.length > 0);
    return parts.length === 0 ? node.name : parts.join(' ');
  }
}

function addIndex<K>(index: Map<K, Set<string>>, key: K, id: string): void {
  const ids = index.get(key) ?? new Set<string>();
  ids.add(id);
  index.set(key, ids);
}

function removeIndex<K>(index: Map<K, Set<string>>, key: K, id: string): void {
  const ids = index.get(key);
  if (ids === undefined) return;
  ids.delete(id);
  if (ids.size === 0) index.delete(key);
}

function stateMatches(node: SemanticNode, expected: Readonly<Partial<SemanticState>>): boolean {
  const actual: Partial<SemanticState> = node.state ?? {};
  for (const [key, want] of Object.entries(expected)) {
    if (want === undefined) continue;
    const have = (actual as Record<string, unknown>)[key];
    if (have !== want) return false;
  }
  return true;
}

function classMatches(node: SemanticNode, className: string): boolean {
  const testIdTokens = (node.testId ?? '').split(/[\s.]+/u).filter((token) => token.length > 0);
  if (testIdTokens.includes(className)) return true;
  const nameTokens = node.name.split(/\s+/u).filter((token) => token.length > 0);
  return nameTokens.includes(className);
}

function stepMatches(index: SemanticIndex, node: SemanticNode, step: SemanticStep): boolean {
  if (step.role !== undefined && node.role !== step.role) return false;
  if (step.testId !== undefined && node.testId !== step.testId) return false;
  if (step.classes.some((className) => !classMatches(node, className))) return false;
  if (step.name !== undefined && !matchesText(node.name, step.name)) return false;
  if (step.label !== undefined && !matchesText(index.label(node), step.label)) return false;
  if (step.frameworkType !== undefined && !matchesText(node.frameworkType, step.frameworkType)) {
    return false;
  }
  if (step.text !== undefined) {
    const matched =
      matchesText(node.name, step.text) ||
      matchesText(node.value?.status === 'known' ? node.value.value : undefined, step.text) ||
      matchesText(index.label(node), step.text);
    if (!matched) return false;
  }
  return stateMatches(node, step.state);
}

/**
 * Evaluates a descendant chain. `steps` is ordered outermost-first, so the last
 * step selects the result and the preceding ones must match ancestors in order.
 */
export function matchSemantic(
  index: SemanticIndex,
  steps: readonly SemanticStep[],
  scopeId?: string,
): SemanticNode[] {
  const last = steps[steps.length - 1];
  if (last === undefined) return [];
  const out: SemanticNode[] = [];
  for (const node of index.candidates(last)) {
    if (scopeId !== undefined && !index.isDescendantOf(node, scopeId)) continue;
    if (!stepMatches(index, node, last)) continue;
    if (!ancestorsMatch(index, node, steps.slice(0, -1))) continue;
    out.push(node);
  }
  return out;
}

function ancestorsMatch(
  index: SemanticIndex,
  node: SemanticNode,
  steps: readonly SemanticStep[],
): boolean {
  if (steps.length === 0) return true;
  const chain = index.ancestors(node);
  let stepIndex = steps.length - 1;
  for (const ancestor of chain) {
    const step = steps[stepIndex];
    if (step === undefined) break;
    if (stepMatches(index, ancestor, step)) {
      if (stepIndex === 0) return true;
      stepIndex -= 1;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Generic (grid) matching

interface RowText {
  /** Row text built from cells, so wide characters occupy one entry. */
  readonly text: string;
  /** Column of the cell that produced each character of {@link text}. */
  readonly columns: readonly number[];
}

/** Builds the text of a row together with a character→column mapping. */
export function rowText(row: CapturedRow): RowText {
  let text = '';
  const columns: number[] = [];
  for (let column = 0; column < row.cells.length; column += 1) {
    const cell = row.cells[column];
    if (cell === undefined) continue;
    if (cell.width === 0) continue; // right half of a wide character
    const chars = cell.char === '' ? ' ' : cell.char;
    // One entry per UTF-16 unit: string indices from indexOf/RegExp are unit
    // based, and a grapheme can span several units (emoji, combining marks).
    for (let unit = 0; unit < chars.length; unit += 1) columns.push(column);
    text += chars;
  }
  return { text, columns };
}

const NAMED_COLORS: Readonly<Record<string, number>> = Object.freeze({
  black: 0,
  red: 1,
  green: 2,
  yellow: 3,
  blue: 4,
  magenta: 5,
  cyan: 6,
  white: 7,
  brightblack: 8,
  brightred: 9,
  brightgreen: 10,
  brightyellow: 11,
  brightblue: 12,
  brightmagenta: 13,
  brightcyan: 14,
  brightwhite: 15,
});

/**
 * Compares a cell color against a predicate string: `'default'`, a named
 * ANSI color (`'red'`, `'brightRed'`), a palette index (`'196'`) or `'#rrggbb'`.
 */
export function colorMatches(color: CellColor, spec: string): boolean {
  const normalized = spec.trim().toLowerCase();
  if (normalized === 'default') return color.kind === 'default';
  if (normalized.startsWith('#')) {
    if (color.kind !== 'rgb') return false;
    const hex = normalized.slice(1);
    if (hex.length !== 6) return false;
    const value = Number.parseInt(hex, 16);
    if (Number.isNaN(value)) return false;
    return (
      color.r === ((value >> 16) & 0xff) &&
      color.g === ((value >> 8) & 0xff) &&
      color.b === (value & 0xff)
    );
  }
  const named = NAMED_COLORS[normalized];
  const index = named ?? (/^\d+$/u.test(normalized) ? Number(normalized) : undefined);
  if (index === undefined) return false;
  return color.kind === 'palette' && color.index === index;
}

function attributesMatch(cell: CellSnapshot, expected: Readonly<Partial<CellAttributes>>): boolean {
  for (const [key, want] of Object.entries(expected)) {
    if (want === undefined) continue;
    if (cell.attributes[key as keyof CellAttributes] !== want) return false;
  }
  return true;
}

function styleMatches(cells: readonly CellSnapshot[], style: StylePredicates): boolean {
  return cells.every((cell) => {
    if (style.fg !== undefined && !colorMatches(cell.fg, style.fg)) return false;
    if (style.bg !== undefined && !colorMatches(cell.bg, style.bg)) return false;
    if (style.attributes !== undefined && !attributesMatch(cell, style.attributes)) return false;
    return true;
  });
}

function findRanges(text: string, query: GenericQuery): [number, number][] {
  const ranges: [number, number][] = [];
  const matcher = query.text;
  if (matcher.kind === 'regex') {
    const flags = matcher.source.flags.includes('g')
      ? matcher.source.flags
      : `${matcher.source.flags}g`;
    const regex = new RegExp(matcher.source.source, flags);
    for (;;) {
      const match = regex.exec(text);
      if (match === null) break;
      if (match[0].length === 0) {
        regex.lastIndex += 1;
        continue;
      }
      ranges.push([match.index, match.index + match[0].length]);
    }
    return ranges;
  }
  const needle = matcher.kind === 'exact' ? matcher.text : matcher.text.toLowerCase();
  if (needle.length === 0) return ranges;
  const haystack = matcher.kind === 'exact' ? text : text.toLowerCase();
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    ranges.push([at, at + needle.length]);
    from = at + needle.length;
  }
  return ranges;
}

/**
 * Evaluates a grid query over captured rows, returning one rectangle per match
 * in reading order. `scope` restricts matching to rows and columns inside it.
 */
export function matchGrid(
  rows: readonly CapturedRow[],
  query: GenericQuery,
  scope?: Rect | null,
): Rect[] {
  const out: Rect[] = [];
  const firstRow = scope != null ? Math.max(0, scope.row) : 0;
  const lastRow = scope != null ? Math.min(rows.length, scope.row + scope.height) : rows.length;

  for (let index = firstRow; index < lastRow; index += 1) {
    const row = rows[index];
    if (row === undefined) continue;
    const { text, columns } = rowText(row);
    for (const [start, end] of findRanges(text, query)) {
      const startColumn = columns[start];
      const endColumnCell = columns[end - 1];
      if (startColumn === undefined || endColumnCell === undefined) continue;
      const endCell = row.cells[endColumnCell];
      const width = endColumnCell + (endCell?.width === 2 ? 2 : 1) - startColumn;
      if (
        scope != null &&
        (startColumn < scope.column || startColumn + width > scope.column + scope.width)
      ) {
        continue;
      }
      if (query.style !== undefined) {
        const cells = row.cells.slice(startColumn, startColumn + width);
        if (!styleMatches(cells, query.style)) continue;
      }
      out.push(Object.freeze({ row: index, column: startColumn, width, height: 1 }));
    }
  }

  if (query.occurrence !== undefined) {
    const picked = out[query.occurrence - 1];
    return picked === undefined ? [] : [picked];
  }
  return out;
}

/** Extracts the text covered by a rectangle, for `textContent()` on grid matches. */
export function textInRect(rows: readonly CapturedRow[], rect: Rect): string {
  const lines: string[] = [];
  for (let index = rect.row; index < rect.row + rect.height; index += 1) {
    const row = rows[index];
    if (row === undefined) continue;
    const { text, columns } = rowText(row);
    let line = '';
    for (let offset = 0; offset < text.length; offset += 1) {
      const column = columns[offset];
      if (column === undefined) continue;
      if (column >= rect.column && column < rect.column + rect.width) line += text[offset];
    }
    lines.push(line);
  }
  return lines.join('\n');
}
