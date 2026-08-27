/**
 * Keyboard navigation for the semantic tree, following the ARIA tree pattern.
 *
 * Up and Down walk the rows that are actually visible; Right opens a closed
 * node and then steps into it; Left closes an open node and otherwise steps out
 * to the parent. Selection and DOM focus move together, which is what makes a
 * `role="tree"` behave the way a screen-reader user expects rather than merely
 * being labelled as one.
 *
 * @packageDocumentation
 */

/** A row as navigation sees it: flattened, collapsed subtrees already removed. */
export interface TreeRow {
  readonly id: string;
  readonly hasChildren: boolean;
  readonly parentId?: string;
}

/** Which key was pressed. */
export type TreeKey = 'up' | 'down' | 'left' | 'right' | 'home' | 'end';

/** What navigation changes. */
export interface TreeNavState {
  readonly selectedId: string | null;
  /** Ids whose children are hidden. */
  readonly collapsed: ReadonlySet<string>;
}

/**
 * Applies one key press.
 *
 * @param rows - visible rows, in display order.
 * @returns the new selection and collapsed set. Returns the input unchanged
 * when there is nothing to move to, so a held arrow key at the end of the tree
 * is a no-op rather than a wrap-around.
 */
export function navigateTree(
  rows: readonly TreeRow[],
  state: TreeNavState,
  key: TreeKey,
): TreeNavState {
  if (rows.length === 0) return state;
  const index = rows.findIndex((row) => row.id === state.selectedId);
  // Nothing selected yet: the first key press lands on the first row.
  if (index === -1) return { ...state, selectedId: rows[0]?.id ?? null };
  const current = rows[index] as TreeRow;

  switch (key) {
    case 'home':
      return { ...state, selectedId: rows[0]?.id ?? state.selectedId };
    case 'end':
      return { ...state, selectedId: rows.at(-1)?.id ?? state.selectedId };
    case 'down':
      return {
        ...state,
        selectedId: rows[Math.min(index + 1, rows.length - 1)]?.id ?? state.selectedId,
      };
    case 'up':
      return { ...state, selectedId: rows[Math.max(index - 1, 0)]?.id ?? state.selectedId };
    case 'right': {
      if (!current.hasChildren) return state;
      if (state.collapsed.has(current.id))
        return { ...state, collapsed: without(state.collapsed, current.id) };
      return { ...state, selectedId: rows[index + 1]?.id ?? state.selectedId };
    }
    case 'left': {
      if (current.hasChildren && !state.collapsed.has(current.id)) {
        return { ...state, collapsed: with_(state.collapsed, current.id) };
      }
      return current.parentId === undefined ? state : { ...state, selectedId: current.parentId };
    }
  }
}

function with_(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);
  next.add(id);
  return next;
}

function without(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);
  next.delete(id);
  return next;
}
