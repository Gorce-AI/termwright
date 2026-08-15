/**
 * The author-facing annotation hook.
 */

import { useContext, useEffect, type RefObject } from 'react';
import type { DOMElement } from 'ink';
import { RegistryContext } from './context.js';
import type { SemanticMeta } from './types.js';

/**
 * Annotate an Ink `<Box>` with semantics the driver can address.
 *
 * Outside a semantic session — which is every uninstrumented run — this is a
 * no-op: nothing is registered, nothing is retained, and the component behaves
 * exactly as it would without the hook. Attach the ref to a `<Box>`; `<Text>`
 * does not forward refs, so wrap text you need to address.
 *
 * @param ref - ref attached to the `<Box>` being described.
 * @param meta - role, name, state, actions and test id; all optional.
 *
 * @example
 * ```tsx
 * const ref = useRef<DOMElement>(null);
 * useSemantic(ref, {role: 'button', name: 'Approve', state: {focused: isFocused}});
 * return <Box ref={ref}><Text>Approve</Text></Box>;
 * ```
 */
export function useSemantic(ref: RefObject<DOMElement | null>, meta: SemanticMeta): void {
  const registry = useContext(RegistryContext);

  // No dependency array on purpose: `meta` is normally an object literal, so a
  // dependency list would either be wrong or force callers to memoise. The
  // effect body is a single weak-map write.
  useEffect(() => {
    if (registry === null) return undefined;
    const node = ref.current;
    if (node === null || node === undefined) return undefined;
    return registry.register(node, meta);
  });
}
