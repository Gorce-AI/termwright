import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
  type RefCallback,
} from 'react';
import { navigateTree, type TreeKey, type TreeRow } from '../tree-nav.js';

const keyMap: Readonly<Partial<Record<string, TreeKey>>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Home: 'home',
  End: 'end',
};

export interface RovingTreeOptions {
  readonly rows: readonly TreeRow[];
  readonly selectedId: string | null;
  readonly collapsed: ReadonlySet<string>;
  readonly onSelect: (id: string) => void;
  readonly onCollapsed: (ids: ReadonlySet<string>) => void;
}

/** Shared ARIA tree focus/selection adapter used by every Runner tree. */
export function useTreeNavigation(options: RovingTreeOptions) {
  const items = useRef(new Map<string, HTMLElement>());
  const visibleIds = useMemo(() => new Set(options.rows.map(({ id }) => id)), [options.rows]);
  const activeId =
    options.selectedId !== null && visibleIds.has(options.selectedId)
      ? options.selectedId
      : (options.rows[0]?.id ?? null);

  useEffect(() => {
    if (activeId !== null && activeId !== options.selectedId) options.onSelect(activeId);
  }, [activeId, options]);

  const focus = useCallback((id: string) => {
    requestAnimationFrame(() => items.current.get(id)?.focus());
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const key = keyMap[event.key];
      if (key === undefined) return;
      // Explicit action buttons can receive focus after a pointer click despite
      // tabIndex=-1. Their arrows must not be reinterpreted as tree navigation.
      if (
        !(event.target instanceof HTMLElement) ||
        event.target.getAttribute('role') !== 'treeitem'
      )
        return;
      event.preventDefault();
      const next = navigateTree(
        options.rows,
        {
          selectedId: activeId,
          collapsed: options.collapsed,
        },
        key,
      );
      if (next.collapsed !== options.collapsed) options.onCollapsed(next.collapsed);
      if (next.selectedId !== null) {
        options.onSelect(next.selectedId);
        focus(next.selectedId);
      }
    },
    [activeId, focus, options],
  );

  const item = useCallback(
    (
      id: string,
    ): {
      readonly tabIndex: 0 | -1;
      readonly ref: RefCallback<HTMLElement>;
      readonly onFocus: () => void;
    } => ({
      tabIndex: id === activeId ? 0 : -1,
      ref: (element) => {
        if (element === null) items.current.delete(id);
        else items.current.set(id, element);
      },
      onFocus: () => options.onSelect(id),
    }),
    [activeId, options],
  );

  return { onKeyDown, item, activeId } as const;
}
