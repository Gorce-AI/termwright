import type { DOMElement } from 'ink';
import type { InkAnnotationSlot, InkSemanticAnnotation, StoredInkAnnotation } from './types.js';

/** Duplicated by the injected probe so the SDK remains an optional dependency. */
const REGISTRY = Symbol.for('termwright.annotation.ink.v1');

interface AnnotationChannel {
  readonly entries: WeakMap<object, InkAnnotationSlot>;
  readonly listeners: Set<() => void>;
}

type Scope = typeof globalThis & { [REGISTRY]?: AnnotationChannel };

function channel(): AnnotationChannel {
  const scope = globalThis as Scope;
  let current = scope[REGISTRY];
  if (current !== undefined) return current;
  current = {
    entries: new WeakMap<object, InkAnnotationSlot>(),
    listeners: new Set<() => void>(),
  };
  Object.defineProperty(scope, REGISTRY, { configurable: true, value: current });
  return current;
}

function weakTargets(
  refs: InkSemanticAnnotation['labelledBy'],
): readonly WeakRef<object>[] | undefined {
  if (refs === undefined) return undefined;
  const targets = refs
    .map((ref) => ref.current)
    .filter((target): target is DOMElement => target !== null)
    .map((target) => new WeakRef<object>(target));
  return targets.length === 0 ? undefined : Object.freeze(targets);
}

/** @internal Snapshot intent during render; the slot identity stays stable. */
export function freezeInkAnnotation(meta: InkSemanticAnnotation): StoredInkAnnotation {
  const labelledBy = weakTargets(meta.labelledBy);
  const describedBy = weakTargets(meta.describedBy);
  return Object.freeze({
    ...(meta.role === undefined ? {} : { role: meta.role }),
    ...(meta.name === undefined ? {} : { name: meta.name }),
    ...(meta.description === undefined ? {} : { description: meta.description }),
    ...(meta.testId === undefined ? {} : { testId: meta.testId }),
    ...(meta.extended === undefined ? {} : { extended: meta.extended }),
    ...(meta.actions === undefined ? {} : { actions: Object.freeze([...meta.actions]) }),
    ...(labelledBy === undefined ? {} : { labelledBy }),
    ...(describedBy === undefined ? {} : { describedBy }),
  });
}

/** @internal Registration is lifecycle-owned by `useSemantic`. */
export function registerInkAnnotation(
  node: DOMElement,
  slot: InkAnnotationSlot,
): () => void {
  const { entries, listeners } = channel();
  entries.set(node, slot);
  for (const listener of [...listeners]) {
    try { listener(); } catch { /* annotation observers are best-effort */ }
  }
  return () => {
    if (entries.get(node) === slot) entries.delete(node);
  };
}
