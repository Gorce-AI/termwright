import { Buffer } from 'node:buffer';
import type { ProtocolLimits } from './limits.js';
import { SEMANTIC_NODE_KEYS } from './node-keys.js';
import type {
  SemanticDelta,
  SemanticNode,
  SemanticNodePatchField,
  SemanticSnapshot,
  SemanticSnapshotClearField,
} from './tree.js';
import { projectDto } from './framing.js';
import { validateSnapshot, type ValidationErrorCode } from './validate.js';
import { ProtocolViolation } from './errors.js';

export type SemanticDeltaApplyResult =
  | {
      readonly ok: true;
      readonly snapshot: SemanticSnapshot;
      readonly changedNodeIds: ReadonlySet<string>;
      readonly changedNodes: ReadonlyMap<string, SemanticNode | undefined>;
    }
  | {
      readonly ok: false;
      readonly code: ValidationErrorCode | 'base-revision';
      readonly detail: string;
      readonly resyncRequired: boolean;
    };

type SemanticDeltaErrorCode = ValidationErrorCode | 'base-revision';

const NODE_FIELDS = new Set<string>(SEMANTIC_NODE_KEYS);
const REQUIRED_NODE_FIELDS = new Set<SemanticNodePatchField>(['role', 'name', 'geometry']);
const SNAPSHOT_CLEAR_FIELDS = new Set<SemanticSnapshotClearField>(['cursor', 'providerEvidence']);
const NODE_PATCH_FIELDS = Object.freeze(
  [...new Set<string>([...SEMANTIC_NODE_KEYS, 'geometry'])].filter((field) => field !== 'id'),
) as readonly SemanticNodePatchField[];

function fail(
  code: SemanticDeltaErrorCode,
  detail: string,
  resyncRequired = false,
): SemanticDeltaApplyResult {
  return { ok: false, code, detail, resyncRequired };
}

function positiveRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function ownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function duplicate(values: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return null;
}

function valueEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => valueEqual(value, right[index]));
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(right, key) &&
      valueEqual(
        (left as Readonly<Record<string, unknown>>)[key],
        (right as Readonly<Record<string, unknown>>)[key],
      ),
  );
}

/** Deterministically derive the smallest field-level patch between two validated revisions. */
export function diffSemanticSnapshots(
  previous: SemanticSnapshot,
  next: SemanticSnapshot,
): SemanticDelta {
  if (previous.sessionId !== next.sessionId) {
    throw new TypeError('cannot diff semantic snapshots from different sessions');
  }
  if (next.revision <= previous.revision) {
    throw new TypeError('semantic diff target revision must be newer than its base');
  }

  const before = new Map(previous.nodes.map((node) => [node.id, node]));
  const after = new Map(next.nodes.map((node) => [node.id, node]));
  const addNodes = next.nodes.filter((node) => !before.has(node.id));
  const removeNodeIds = previous.nodes.filter((node) => !after.has(node.id)).map(({ id }) => id);
  const updateNodes = [];
  for (const node of next.nodes) {
    const old = before.get(node.id);
    if (old === undefined) continue;
    const set: Record<string, unknown> = {};
    const clear: SemanticNodePatchField[] = [];
    for (const field of NODE_PATCH_FIELDS) {
      const oldValue = old[field];
      const newValue = node[field];
      if (valueEqual(oldValue, newValue)) continue;
      if (newValue === undefined) clear.push(field);
      else set[field] = newValue;
    }
    if (Object.keys(set).length > 0 || clear.length > 0) {
      updateNodes.push({
        id: node.id,
        ...(Object.keys(set).length === 0 ? {} : { set }),
        ...(clear.length === 0 ? {} : { clear }),
      });
    }
  }

  const snapshot: Record<string, unknown> = {};
  const snapshotClear: SemanticSnapshotClearField[] = [];
  for (const field of [
    'columns',
    'rows',
    'cursor',
    'rootIds',
    'coordinateSpace',
    'hitGrid',
    'providerEvidence',
  ] as const) {
    if (valueEqual(previous[field], next[field])) continue;
    if (next[field] === undefined) snapshotClear.push(field as SemanticSnapshotClearField);
    else snapshot[field] = next[field];
  }
  if (snapshotClear.length > 0) snapshot['clear'] = snapshotClear;

  return Object.freeze({
    v: 3,
    sessionId: next.sessionId,
    revision: next.revision,
    baseRevision: previous.revision,
    ...(addNodes.length === 0 ? {} : { addNodes: Object.freeze(addNodes) }),
    ...(updateNodes.length === 0 ? {} : { updateNodes: Object.freeze(updateNodes) }),
    ...(removeNodeIds.length === 0 ? {} : { removeNodeIds: Object.freeze(removeNodeIds) }),
    ...(Object.keys(snapshot).length === 0 ? {} : { snapshot: Object.freeze(snapshot) }),
  }) as SemanticDelta;
}

/**
 * Validate and atomically apply an untrusted semantic delta.
 *
 * The committed input is never mutated. A complete staging snapshot is built,
 * then the ordinary full-tree invariant validator acts as the independent
 * oracle. No partial state escapes on failure.
 */
export function applySemanticDelta(
  committed: SemanticSnapshot,
  value: unknown,
  limits: ProtocolLimits,
  wireBytes?: number,
): SemanticDeltaApplyResult {
  let projected: unknown;
  try {
    projected = projectDto(value, limits.maxDepth);
  } catch (error) {
    return fail(
      error instanceof ProtocolViolation && error.code === 'dto-depth' ? 'depth' : 'schema',
      error instanceof Error ? error.message : 'delta could not be projected into a plain DTO',
    );
  }
  if (!ownRecord(projected)) return fail('schema', 'semantic delta is not an object');

  const bytes = wireBytes ?? Buffer.byteLength(JSON.stringify(projected), 'utf8');
  if (bytes > limits.maxSnapshotBytes) {
    return fail('bytes', `semantic delta is ${bytes} bytes, ceiling is ${limits.maxSnapshotBytes}`);
  }

  const allowedTop = new Set([
    'v',
    'sessionId',
    'revision',
    'baseRevision',
    'addNodes',
    'updateNodes',
    'removeNodeIds',
    'snapshot',
  ]);
  for (const key of Object.keys(projected)) {
    if (!allowedTop.has(key)) return fail('schema', `semantic delta contains unknown field ${key}`);
  }
  if (projected['v'] !== 3) return fail('schema', 'semantic delta v must be 3');
  if (projected['sessionId'] !== committed.sessionId) {
    return fail('schema', 'semantic delta carries a foreign sessionId');
  }
  if (!positiveRevision(projected['revision']) || !positiveRevision(projected['baseRevision'])) {
    return fail('revision', 'semantic delta revisions must be positive safe integers');
  }
  if (projected['baseRevision'] !== committed.revision) {
    return fail(
      'base-revision',
      `semantic delta base ${projected['baseRevision']} does not match committed revision ${committed.revision}`,
      true,
    );
  }
  if (projected['revision'] <= committed.revision) {
    return fail('revision', 'semantic delta revision must be newer than its base');
  }

  const delta = projected as unknown as SemanticDelta;
  const addNodes = delta.addNodes ?? [];
  const updateNodes = delta.updateNodes ?? [];
  const removeNodeIds = delta.removeNodeIds ?? [];
  if (!Array.isArray(addNodes) || !Array.isArray(updateNodes) || !Array.isArray(removeNodeIds)) {
    return fail('schema', 'semantic delta node operations must be arrays');
  }
  if (addNodes.length + updateNodes.length + removeNodeIds.length > limits.maxNodes) {
    return fail('count', 'semantic delta carries more node operations than the node ceiling');
  }

  const operationIds = [
    ...addNodes.map((node) => node?.id),
    ...updateNodes.map((update) => update?.id),
    ...removeNodeIds,
  ];
  if (operationIds.some((id) => typeof id !== 'string' || id.length === 0)) {
    return fail('schema', 'every semantic delta node operation requires a non-empty id');
  }
  const repeatedOperation = duplicate(operationIds as string[]);
  if (repeatedOperation !== null) {
    return fail('duplicate-id', `node ${repeatedOperation} appears in multiple delta operations`);
  }

  const staged = new Map(committed.nodes.map((node) => [node.id, node]));
  const changed = new Set<string>();
  for (const id of removeNodeIds) {
    if (!staged.delete(id)) return fail('schema', `cannot remove unknown node ${id}`);
    changed.add(id);
  }
  for (const node of addNodes) {
    if (staged.has(node.id)) return fail('duplicate-id', `cannot add existing node ${node.id}`);
    staged.set(node.id, node);
    changed.add(node.id);
  }
  for (const update of updateNodes) {
    const updateId = update.id;
    const previous = staged.get(updateId);
    if (previous === undefined) return fail('schema', `cannot update unknown node ${updateId}`);
    if (
      !ownRecord(update) ||
      Object.keys(update).some((key) => !['id', 'set', 'clear'].includes(key))
    ) {
      return fail('schema', `node update ${updateId} has an invalid envelope`);
    }
    const set = update.set ?? {};
    const clear = update.clear ?? [];
    if (
      !ownRecord(set) ||
      !Array.isArray(clear) ||
      (Object.keys(set).length === 0 && clear.length === 0)
    ) {
      return fail('schema', `node update ${updateId} must set or clear at least one field`);
    }
    if (clear.some((field) => typeof field !== 'string')) {
      return fail('schema', `node update ${updateId} clear fields must be strings`);
    }
    const clearFields = clear as SemanticNodePatchField[];
    const repeatedClear = duplicate(clearFields);
    if (repeatedClear !== null) {
      return fail('duplicate-id', `node update ${updateId} clears ${repeatedClear} more than once`);
    }
    for (const field of Object.keys(set)) {
      if (!NODE_FIELDS.has(field) || field === 'id') {
        return fail('schema', `node update ${updateId} sets unknown field ${field}`);
      }
      if (clearFields.includes(field as SemanticNodePatchField)) {
        return fail('schema', `node update ${updateId} both sets and clears ${field}`);
      }
    }
    for (const field of clearFields) {
      if (!NODE_FIELDS.has(field)) {
        return fail('schema', `node update ${updateId} clears unknown field ${String(field)}`);
      }
      if (REQUIRED_NODE_FIELDS.has(field)) {
        return fail('schema', `node update ${updateId} cannot clear required field ${field}`);
      }
    }
    const next: Record<string, unknown> = { ...previous, ...set };
    for (const field of clearFields) delete next[field];
    staged.set(updateId, next as unknown as SemanticNode);
    changed.add(updateId);
  }

  const update = delta.snapshot ?? {};
  if (!ownRecord(update)) return fail('schema', 'semantic delta snapshot update must be an object');
  const allowedSnapshot = new Set([
    'columns',
    'rows',
    'cursor',
    'rootIds',
    'coordinateSpace',
    'hitGrid',
    'providerEvidence',
    'clear',
  ]);
  for (const key of Object.keys(update)) {
    if (!allowedSnapshot.has(key))
      return fail('schema', `snapshot update contains unknown field ${key}`);
  }
  const clear = update.clear ?? [];
  if (!Array.isArray(clear)) return fail('schema', 'snapshot clear must be an array');
  if (clear.some((field) => typeof field !== 'string')) {
    return fail('schema', 'snapshot clear fields must be strings');
  }
  const clearFields = clear as SemanticSnapshotClearField[];
  const repeatedClear = duplicate(clearFields);
  if (repeatedClear !== null) return fail('duplicate-id', `snapshot clears ${repeatedClear} twice`);
  for (const field of clearFields) {
    if (!SNAPSHOT_CLEAR_FIELDS.has(field)) {
      return fail('schema', `snapshot cannot clear field ${String(field)}`);
    }
    if (update[field] !== undefined) {
      return fail('schema', `snapshot both sets and clears ${field}`);
    }
  }

  const next: Record<string, unknown> = {
    ...committed,
    ...update,
    v: 3,
    revision: delta.revision,
    nodes: [...staged.values()],
  };
  delete next['clear'];
  for (const field of clearFields) delete next[field];
  const checked = validateSnapshot(next, limits);
  if (!checked.ok) return fail(checked.code, checked.detail);
  const validatedById = new Map(checked.snapshot.nodes.map((node) => [node.id, node]));
  return {
    ok: true,
    snapshot: checked.snapshot,
    changedNodeIds: Object.freeze(changed),
    changedNodes: Object.freeze(new Map([...changed].map((id) => [id, validatedById.get(id)]))),
  };
}
