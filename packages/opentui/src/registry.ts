import type {
  OpenTuiRenderable,
  OpenTuiSemanticAnnotation,
  StoredOpenTuiAnnotation,
} from './types.js';

/** Duplicated by the injected probe so this SDK remains optional. */
const REGISTRY = Symbol.for('termwright.annotation.opentui.v1');
type Scope = typeof globalThis & { [REGISTRY]?: WeakMap<object, StoredOpenTuiAnnotation> };

function registry(): WeakMap<object, StoredOpenTuiAnnotation> {
  const scope = globalThis as Scope;
  let current = scope[REGISTRY];
  if (current !== undefined) return current;
  current = new WeakMap<object, StoredOpenTuiAnnotation>();
  Object.defineProperty(scope, REGISTRY, { configurable: true, value: current });
  return current;
}

function weakTargets(targets: readonly OpenTuiRenderable[] | undefined): readonly WeakRef<object>[] | undefined {
  if (targets === undefined || targets.length === 0) return undefined;
  return Object.freeze(targets.map((target) => new WeakRef<object>(target)));
}

function freezeAnnotation(meta: OpenTuiSemanticAnnotation): StoredOpenTuiAnnotation {
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

/** Store developer intent without taking ownership of the renderer. */
export function describeRenderable(
  renderable: OpenTuiRenderable,
  annotation: OpenTuiSemanticAnnotation,
): () => void {
  try {
    const entries = registry();
    const stored = freezeAnnotation(annotation);
    entries.set(renderable, stored);
    return () => {
      if (entries.get(renderable) === stored) entries.delete(renderable);
    };
  } catch {
    return () => undefined;
  }
}
