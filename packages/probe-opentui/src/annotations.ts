import type { ProbeAnnotations, ProtocolLimits } from '@termwright/protocol';
import { validateProbeAnnotations } from '@termwright/protocol';

const REGISTRY = Symbol.for('termwright.annotation.opentui.v1');

interface StoredAnnotation {
  readonly role?: unknown;
  readonly name?: unknown;
  readonly description?: unknown;
  readonly testId?: unknown;
  readonly extended?: unknown;
  readonly actions?: unknown;
  readonly labelledBy?: readonly WeakRef<object>[];
  readonly describedBy?: readonly WeakRef<object>[];
}

function relationIds(refs: unknown, maxTargets: number): string[] | null | undefined {
  if (refs === undefined) return undefined;
  if (!Array.isArray(refs)) return null;
  const length = Object.getOwnPropertyDescriptor(refs, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maxTargets) return null;
  const ids: string[] = [];
  for (let index = 0; index < length; index += 1) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(refs, String(index));
      if (descriptor === undefined || !('value' in descriptor)) return null;
      const ref = descriptor.value;
      if (!(ref instanceof WeakRef)) return null;
      const target = WeakRef.prototype.deref.call(ref) as { readonly num?: unknown } | undefined;
      if (target === undefined) continue;
      const number = Object.getOwnPropertyDescriptor(target, 'num')?.value;
      if (!Number.isSafeInteger(number)) return null;
      ids.push(String(number));
    } catch {
      return null;
    }
  }
  return ids.length === 0 ? undefined : ids;
}

function ownData(value: object, key: keyof StoredAnnotation): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
}

/** Read the optional SDK's weak channel without importing the SDK. */
export function annotationForRenderable(
  node: object,
  limits: ProtocolLimits,
): ProbeAnnotations | undefined {
  try {
    const store = (globalThis as Record<PropertyKey, unknown>)[REGISTRY];
    if (!(store instanceof WeakMap)) return undefined;
    const value = store.get(node) as StoredAnnotation | undefined;
    if (value === undefined) return undefined;
    const role = ownData(value, 'role');
    const name = ownData(value, 'name');
    const description = ownData(value, 'description');
    const testId = ownData(value, 'testId');
    const extended = ownData(value, 'extended');
    const actions = ownData(value, 'actions');
    const labelledBy = relationIds(ownData(value, 'labelledBy'), limits.maxRelationTargets);
    const describedBy = relationIds(ownData(value, 'describedBy'), limits.maxRelationTargets);
    const candidate = {
      ...(role === undefined ? {} : { role }),
      ...(name === undefined ? {} : { name }),
      ...(description === undefined ? {} : { description }),
      ...(testId === undefined ? {} : { testId }),
      ...(extended === undefined ? {} : { extended }),
      ...(actions === undefined ? {} : { actions }),
      ...(labelledBy === undefined ? {} : { labelledBy }),
      ...(describedBy === undefined ? {} : { describedBy }),
    };
    if (Object.keys(candidate).length === 0) return undefined;
    const validated = validateProbeAnnotations(candidate, limits);
    return validated.ok ? validated.annotations : undefined;
  } catch {
    return undefined;
  }
}
