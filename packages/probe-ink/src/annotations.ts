import type {
  ProbeAnnotations,
  ProtocolLimits,
} from '@termwright/protocol';
import { validateProbeAnnotations } from '@termwright/protocol';

const REGISTRY = Symbol.for('termwright.annotation.ink.v1');

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

interface AnnotationSlot {
  readonly current?: StoredAnnotation;
}

interface AnnotationChannel {
  readonly entries: WeakMap<object, AnnotationSlot>;
  readonly listeners: Set<() => void>;
}

function channel(): AnnotationChannel {
  const scope = globalThis as Record<PropertyKey, unknown>;
  const present = scope[REGISTRY] as Partial<AnnotationChannel> | undefined;
  if (present?.entries instanceof WeakMap && present.listeners instanceof Set) {
    return present as AnnotationChannel;
  }
  const created: AnnotationChannel = {
    entries: new WeakMap<object, AnnotationSlot>(),
    listeners: new Set<() => void>(),
  };
  Object.defineProperty(scope, REGISTRY, { configurable: true, value: created });
  return created;
}

/** Re-capture after an annotation attaches to a newly reconciled host. */
export function onInkAnnotationChange(handler: () => void): () => void {
  const listeners = channel().listeners;
  listeners.add(handler);
  return () => listeners.delete(handler);
}

function strings(
  refs: unknown,
  idFor: (node: object) => string,
  maxTargets: number,
): string[] | null | undefined {
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
      const target = WeakRef.prototype.deref.call(ref) as object | undefined;
      if (target !== undefined) ids.push(idFor(target));
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

/** Read author intent without taking a runtime dependency on the optional SDK. */
export function annotationForInkNode(
  node: object,
  idFor: (node: object) => string,
  limits: ProtocolLimits,
): ProbeAnnotations | undefined {
  try {
    const slot = channel().entries.get(node);
    const value = slot?.current;
    if (value === undefined) return undefined;
    const role = ownData(value, 'role');
    const name = ownData(value, 'name');
    const description = ownData(value, 'description');
    const testId = ownData(value, 'testId');
    const extended = ownData(value, 'extended');
    const actions = ownData(value, 'actions');
    const labelledBy = strings(ownData(value, 'labelledBy'), idFor, limits.maxRelationTargets);
    const describedBy = strings(ownData(value, 'describedBy'), idFor, limits.maxRelationTargets);
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
