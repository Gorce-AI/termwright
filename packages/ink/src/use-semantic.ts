import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { DOMElement } from 'ink';
import { freezeInkAnnotation, registerInkAnnotation } from './registry.js';
import type { InkAnnotationSlot, InkSemanticAnnotation } from './types.js';

/** Attach developer intent to the Ink host element held by `ref`. */
export function useSemantic(
  ref: RefObject<DOMElement | null>,
  annotation: InkSemanticAnnotation,
): void {
  const slot = useRef<InkAnnotationSlot>({ current: Object.freeze({}) });
  const registration = useRef<{
    node: DOMElement;
    dispose: () => void;
  } | null>(null);
  try {
    // The probe's onRender callback precedes React layout effects on an update.
    // Updating a stable slot during render makes the already-registered host
    // expose the same intent as the commit that is about to be observed.
    slot.current.current = freezeInkAnnotation(annotation);
  } catch {
    slot.current.current = Object.freeze({});
  }
  // Layout effects run after refs attach and before the instrumented commit is
  // observed. Re-registering each commit also makes an object-literal annotation
  // update atomically with React reconciliation, without requiring useMemo.
  useLayoutEffect(() => {
    const node = ref.current;
    if (node === null) return undefined;
    try {
      // On the first mount relationship refs become available only after the
      // host refs attach, so refresh once more before publishing the slot.
      slot.current.current = freezeInkAnnotation(annotation);
      if (registration.current?.node !== node) {
        registration.current?.dispose();
        registration.current = {
          node,
          dispose: registerInkAnnotation(node, slot.current),
        };
      }
    } catch {
      // An optional annotation can never be allowed to break the application.
      registration.current = null;
    }
  });

  // Cleanup belongs to unmount, not every update. React runs the cleanup of an
  // un-deped layout effect before the next onRender; deleting there creates a
  // one-commit hole exactly when the probe freezes the updated host tree.
  useEffect(
    () => () => {
      registration.current?.dispose();
      registration.current = null;
    },
    [],
  );
}
