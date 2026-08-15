import { Buffer } from 'node:buffer';
import { z } from 'zod';
import type { SemanticNode, SemanticSnapshot } from './tree.js';
import type { ProtocolLimits } from './limits.js';
import { SEMANTIC_ACTIONS, SEMANTIC_ROLES } from './roles.js';
import { ProtocolViolation } from './errors.js';
import { projectDto } from './framing.js';

/** Structured result: never throws hostile data onward. */
export type ValidationResult =
  | { readonly ok: true; readonly snapshot: SemanticSnapshot }
  | { readonly ok: false; readonly code: ValidationErrorCode; readonly detail: string };

export type ValidationErrorCode =
  | 'schema'
  | 'unknown-role'
  | 'duplicate-id'
  | 'missing-parent'
  | 'cycle'
  | 'depth'
  | 'count'
  | 'string-bytes'
  | 'bad-rect'
  | 'revision'
  | 'bytes';

function fail(code: ValidationErrorCode, detail: string): ValidationResult {
  return { ok: false, code, detail };
}

/**
 * Snapshot schemas depend on the active limits, so they are built per limits
 * object and memoised. Limits are frozen singletons in practice, so this keeps
 * schema construction off the per-snapshot path.
 */
const schemaCache = new WeakMap<ProtocolLimits, z.ZodType>();

function safeInt(): z.ZodType<number> {
  return z.number().refine(Number.isSafeInteger, 'expected a safe integer');
}

function nonNegativeInt(): z.ZodType<number> {
  return z
    .number()
    .refine((n) => Number.isSafeInteger(n) && n >= 0, 'expected a non-negative safe integer');
}

function positiveInt(): z.ZodType<number> {
  return z
    .number()
    .refine((n) => Number.isSafeInteger(n) && n > 0, 'expected a positive safe integer');
}

function boundedString(maxStringBytes: number): z.ZodType<string> {
  return z
    .string()
    .refine(
      (s) => Buffer.byteLength(s, 'utf8') <= maxStringBytes,
      `expected at most ${maxStringBytes} UTF-8 bytes`,
    );
}

function buildSnapshotSchema(limits: ProtocolLimits): z.ZodType {
  const text = boundedString(limits.maxStringBytes);
  const relations = z.array(text).max(limits.maxRelationTargets);

  const rect = z.strictObject({
    row: safeInt(),
    column: safeInt(),
    width: nonNegativeInt(),
    height: nonNegativeInt(),
  });

  const state = z.strictObject({
    disabled: z.boolean().optional(),
    focused: z.boolean().optional(),
    selected: z.boolean().optional(),
    checked: z.union([z.boolean(), z.literal('mixed')]).optional(),
    expanded: z.boolean().optional(),
    modal: z.boolean().optional(),
    busy: z.boolean().optional(),
    hidden: z.boolean().optional(),
    readonly: z.boolean().optional(),
    multiline: z.boolean().optional(),
    orientation: z.union([z.literal('horizontal'), z.literal('vertical')]).optional(),
    level: positiveInt().optional(),
    positionInSet: positiveInt().optional(),
    setSize: nonNegativeInt().optional(),
    scrollOffset: nonNegativeInt().optional(),
    scrollExtent: nonNegativeInt().optional(),
  });

  const textRange = z.strictObject({
    startOffset: nonNegativeInt(),
    endOffset: nonNegativeInt(),
    rect,
  });

  const node = z.strictObject({
    id: text.refine((s) => s.length > 0, 'node id must not be empty'),
    parentId: text.optional(),
    role: z.enum(SEMANTIC_ROLES),
    name: text,
    description: text.optional(),
    value: text.optional(),
    bounds: rect.optional(),
    state: state.optional(),
    actions: z.array(z.enum(SEMANTIC_ACTIONS)).max(SEMANTIC_ACTIONS.length).optional(),
    labelledBy: relations.optional(),
    describedBy: relations.optional(),
    textRanges: z.array(textRange).max(limits.maxRelationTargets).optional(),
    testId: text.optional(),
  });

  const cursor = z.strictObject({
    row: nonNegativeInt(),
    column: nonNegativeInt(),
    visible: z.boolean(),
    shape: z.union([z.literal('block'), z.literal('underline'), z.literal('bar')]).optional(),
  });

  return z.strictObject({
    v: z.literal(1),
    sessionId: text.refine((s) => s.length > 0, 'sessionId must not be empty'),
    revision: positiveInt(),
    columns: positiveInt(),
    rows: positiveInt(),
    cursor: cursor.optional(),
    rootIds: z.array(text).max(limits.maxNodes),
    nodes: z.array(node).max(limits.maxNodes),
  });
}

function snapshotSchema(limits: ProtocolLimits): z.ZodType {
  const cached = schemaCache.get(limits);
  if (cached !== undefined) return cached;
  const built = buildSnapshotSchema(limits);
  schemaCache.set(limits, built);
  return built;
}

/**
 * Map a zod issue onto the contract's error taxonomy so callers get a stable
 * code rather than having to interpret schema internals.
 */
function codeForIssue(issue: z.core.$ZodIssue): ValidationErrorCode {
  const path = issue.path.map(String);
  if (path.includes('role')) return 'unknown-role';
  if (path.includes('revision')) return 'revision';
  if (path.includes('bounds') || path.includes('rect')) return 'bad-rect';
  if (issue.code === 'too_big' && (path.includes('nodes') || path.includes('rootIds'))) {
    return 'count';
  }
  if (issue.code === 'custom' && typeof issue.message === 'string' && issue.message.includes('UTF-8 bytes')) {
    return 'string-bytes';
  }
  return 'schema';
}

function describeIssue(issue: z.core.$ZodIssue): string {
  const where = issue.path.length > 0 ? issue.path.map(String).join('.') : '<root>';
  return `${where}: ${issue.message}`;
}

function rectIntersectsViewport(
  rect: { row: number; column: number; width: number; height: number },
  columns: number,
  rows: number,
): boolean {
  if (rect.width === 0 || rect.height === 0) return false;
  return (
    rect.column < columns &&
    rect.row < rows &&
    rect.column + rect.width > 0 &&
    rect.row + rect.height > 0
  );
}

function checkNodeShape(
  node: SemanticNode,
  snapshot: SemanticSnapshot,
  ids: ReadonlySet<string>,
  limits: ProtocolLimits,
): ValidationResult | null {
  if (node.bounds !== undefined) {
    const { width, height, row, column } = node.bounds;
    if (
      !Number.isSafeInteger(row + height) ||
      !Number.isSafeInteger(column + width)
    ) {
      return fail('bad-rect', `node ${node.id}: bounds overflow the safe-integer range`);
    }
    if (node.state?.hidden !== true && !rectIntersectsViewport(node.bounds, snapshot.columns, snapshot.rows)) {
      return fail(
        'bad-rect',
        `node ${node.id}: bounds do not intersect the ${snapshot.columns}x${snapshot.rows} viewport and the node is not hidden`,
      );
    }
  }

  for (const range of node.textRanges ?? []) {
    if (range.endOffset < range.startOffset) {
      return fail('bad-rect', `node ${node.id}: text range ends before it starts`);
    }
    if (!Number.isSafeInteger(range.rect.row + range.rect.height)) {
      return fail('bad-rect', `node ${node.id}: text range rect overflows the safe-integer range`);
    }
  }

  for (const [field, targets] of [
    ['labelledBy', node.labelledBy],
    ['describedBy', node.describedBy],
  ] as const) {
    if (targets === undefined) continue;
    if (targets.length > limits.maxRelationTargets) {
      return fail('count', `node ${node.id}: ${field} exceeds ${limits.maxRelationTargets} targets`);
    }
    for (const target of targets) {
      if (!ids.has(target)) {
        return fail('missing-parent', `node ${node.id}: ${field} references unknown node ${target}`);
      }
    }
  }

  return null;
}

/**
 * Depth of every node, or the id at which a parent chain closes on itself.
 * Roots sit at depth 1.
 */
function computeDepths(
  nodes: readonly SemanticNode[],
  byId: ReadonlyMap<string, SemanticNode>,
): { readonly depths: ReadonlyMap<string, number> } | { readonly cycleAt: string } {
  const depths = new Map<string, number>();

  for (const start of nodes) {
    if (depths.has(start.id)) continue;
    const chain: string[] = [];
    const onChain = new Set<string>();
    let current: SemanticNode | undefined = start;

    while (current !== undefined && !depths.has(current.id)) {
      if (onChain.has(current.id)) return { cycleAt: current.id };
      onChain.add(current.id);
      chain.push(current.id);
      current = current.parentId === undefined ? undefined : byId.get(current.parentId);
    }

    let depth = current === undefined ? 0 : depths.get(current.id)!;
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      depth += 1;
      depths.set(chain[i]!, depth);
    }
  }

  return { depths };
}

/**
 * Full snapshot validation per spec §8.2: unique ids, existing+acyclic parent
 * relations, dense bounded arrays, Unicode scalar strings within byte bounds,
 * safe-integer rects intersecting the viewport unless state.hidden, strictly
 * increasing revisions (checked by caller against session state), deep
 * immutability of the returned value.
 *
 * The value is first projected with {@link projectDto}, so getters on hostile
 * input are rejected without being invoked and the returned snapshot is a
 * deep-frozen plain copy that shares no references with the input.
 *
 * @param value - Untrusted candidate snapshot.
 * @param limits - Active limits; callers may tighten but never widen these.
 * @returns `{ ok: true, snapshot }` with a deep-frozen snapshot, or
 * `{ ok: false, code, detail }`. Never throws.
 */
export function validateSnapshot(value: unknown, limits: ProtocolLimits): ValidationResult {
  let projected: unknown;
  try {
    projected = projectDto<unknown>(value, limits.maxDepth);
  } catch (error) {
    if (error instanceof ProtocolViolation) {
      return fail(error.code === 'dto-depth' ? 'depth' : 'schema', error.message);
    }
    return fail('schema', 'value could not be projected into a plain DTO');
  }

  // Projection guarantees JSON-representability, so stringify cannot throw.
  const serialised = JSON.stringify(projected);
  if (serialised === undefined) {
    return fail('schema', 'snapshot is not a JSON object');
  }
  const bytes = Buffer.byteLength(serialised, 'utf8');
  if (bytes > limits.maxSnapshotBytes) {
    return fail('bytes', `snapshot is ${bytes} bytes, ceiling is ${limits.maxSnapshotBytes}`);
  }

  const parsed = snapshotSchema(limits).safeParse(projected);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    return fail(codeForIssue(issue), describeIssue(issue));
  }

  const snapshot = projected as SemanticSnapshot;

  if (snapshot.nodes.length > limits.maxNodes) {
    return fail('count', `snapshot carries ${snapshot.nodes.length} nodes, ceiling is ${limits.maxNodes}`);
  }

  const byId = new Map<string, SemanticNode>();
  for (const node of snapshot.nodes) {
    if (byId.has(node.id)) {
      return fail('duplicate-id', `node id ${node.id} appears more than once`);
    }
    byId.set(node.id, node);
  }

  const rootIds = new Set<string>();
  for (const id of snapshot.rootIds) {
    if (rootIds.has(id)) {
      return fail('duplicate-id', `root id ${id} appears more than once`);
    }
    rootIds.add(id);
    const node = byId.get(id);
    if (node === undefined) {
      return fail('missing-parent', `rootIds references unknown node ${id}`);
    }
    if (node.parentId !== undefined) {
      return fail('schema', `root node ${id} declares a parent`);
    }
  }

  const ids: ReadonlySet<string> = new Set(byId.keys());

  for (const node of snapshot.nodes) {
    if (node.parentId === undefined) {
      if (!rootIds.has(node.id)) {
        return fail('schema', `parentless node ${node.id} is missing from rootIds`);
      }
    } else if (!byId.has(node.parentId)) {
      return fail('missing-parent', `node ${node.id} references unknown parent ${node.parentId}`);
    } else if (node.parentId === node.id) {
      return fail('cycle', `node ${node.id} is its own parent`);
    }

    const problem = checkNodeShape(node, snapshot, ids, limits);
    if (problem !== null) return problem;
  }

  const depthResult = computeDepths(snapshot.nodes, byId);
  if ('cycleAt' in depthResult) {
    return fail('cycle', `parent chain through node ${depthResult.cycleAt} is cyclic`);
  }
  for (const [id, depth] of depthResult.depths) {
    if (depth > limits.maxDepth) {
      return fail('depth', `node ${id} sits at depth ${depth}, ceiling is ${limits.maxDepth}`);
    }
  }

  if (snapshot.cursor !== undefined) {
    const { row, column } = snapshot.cursor;
    if (row >= snapshot.rows || column >= snapshot.columns) {
      return fail('bad-rect', `cursor (${row}, ${column}) lies outside the viewport`);
    }
  }

  return { ok: true, snapshot };
}
