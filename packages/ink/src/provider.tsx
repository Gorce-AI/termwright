/**
 * The provider mounted around an instrumented app.
 *
 * Besides carrying the registry, it solves a concrete problem: Ink exposes no
 * public handle on its root element, and the adapter needs one to walk the
 * tree. The provider renders a `display: none` probe `<Box>` whose ref gives
 * access to `parentNode` — Ink's root. A hidden box is excluded from Yoga
 * layout and produces no output bytes, which the test suite asserts against a
 * dormant baseline.
 */

import type { ReactNode, RefObject } from 'react';
import { Box, useFocusManager, type DOMElement } from 'ink';
import { RegistryContext } from './context.js';
import type { SemanticRegistry } from './registry.js';

/** @internal */
export interface SemanticProviderProps {
  readonly registry: SemanticRegistry;
  /** Receives the probe element; its `parentNode` is Ink's root. */
  readonly probeRef: RefObject<DOMElement | null>;
  readonly children?: ReactNode;
}

/** @internal Mounted by {@link semanticRender}; never rendered in a dormant process. */
export function SemanticProvider({
  registry,
  probeRef,
  children,
}: SemanticProviderProps): ReactNode {
  // Reading the active focusable is what lets the collector resolve `focusId`
  // annotations into `state.focused`. Unlike `useFocus`, this registers nothing
  // and cannot disturb the application's Tab order — it only reads context.
  registry.activeFocusId = useFocusManager().activeId;

  return (
    <RegistryContext.Provider value={registry}>
      <Box ref={probeRef} display="none" />
      {children}
    </RegistryContext.Provider>
  );
}
