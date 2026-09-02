import { Buffer } from 'node:buffer';
import { z } from 'zod';
import { treeSchemas } from './node-schema.js';
import type { SemanticNode, SemanticSnapshot } from './tree.js';
import type { ProtocolLimits } from './limits.js';
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
  | 'provider'
  | 'revision'
  | 'bytes';

function fail(code: ValidationErrorCode, detail: string): ValidationResult {
  return { ok: false, code, detail };
}

/**
 * Map a zod issue onto the contract's error taxonomy so callers get a stable
 * code rather than having to interpret schema internals.
 */
function codeForIssue(issue: z.core.$ZodIssue): ValidationErrorCode {
  const path = issue.path.map(String);
  if (path.includes('role')) return 'unknown-role';
  if (path.includes('revision')) return 'revision';
  if (path.includes('bounds') || ['row', 'column', 'width', 'height'].includes(path.at(-1) ?? ''))
    return 'bad-rect';
  if (issue.code === 'custom' && issue.message?.includes('hit regions')) return 'bad-rect';
  if (issue.code === 'too_big' && (path.includes('nodes') || path.includes('rootIds'))) {
    return 'count';
  }
  if (
    issue.code === 'custom' &&
    typeof issue.message === 'string' &&
    issue.message.includes('UTF-8 bytes')
  ) {
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

function rectContains(
  outer: { row: number; column: number; width: number; height: number },
  inner: { row: number; column: number; width: number; height: number },
): boolean {
  return (
    inner.row >= outer.row &&
    inner.column >= outer.column &&
    inner.row + inner.height <= outer.row + outer.height &&
    inner.column + inner.width <= outer.column + outer.width
  );
}

function regionProblem(
  owner: string,
  region: {
    readonly regionBounds: { row: number; column: number; width: number; height: number };
    readonly spans: readonly { row: number; from: number; to: number }[];
  },
  columns: number,
  rows: number,
): ValidationResult | null {
  for (const span of region.spans) {
    if (span.row >= rows || span.from >= columns || span.to > columns) {
      return fail('bad-rect', `${owner} span lies outside the viewport`);
    }
    if (
      span.row < region.regionBounds.row ||
      span.row >= region.regionBounds.row + region.regionBounds.height ||
      span.from < region.regionBounds.column ||
      span.to > region.regionBounds.column + region.regionBounds.width
    ) {
      return fail('bad-rect', `${owner} span lies outside regionBounds`);
    }
  }
  return null;
}

function checkNodeShape(
  node: SemanticNode,
  snapshot: SemanticSnapshot,
  ids: ReadonlySet<string>,
  limits: ProtocolLimits,
): ValidationResult | null {
  // D1: `generic` is how an unrecognised widget survives instead of being
  // dropped, but only if it says what it was. A generic node without a
  // framework type carries no more information than the drop it replaced.
  if (node.role === 'generic' && (node.frameworkType === undefined || node.frameworkType === '')) {
    return fail(
      'schema',
      `node ${node.id} has role 'generic' without a frameworkType; an unrecognised widget must ` +
        'name what the framework called it',
    );
  }

  // Every cell outside the visible area and the node still visible cannot both
  // be true. Refusing the pair keeps `offscreen` a claim about scrolling rather
  // than a second, weaker way of saying "hidden".
  if (node.state?.offscreen === true && node.state.hidden !== true) {
    return fail(
      'schema',
      `node ${node.id}: state.offscreen implies state.hidden — every cell is outside the ` +
        'visible area, so the node cannot also be visible',
    );
  }

  for (const [name, observation] of [
    ['intendedRect', node.geometry.intendedRect],
    ['visibleRect', node.geometry.visibleRect],
  ] as const) {
    if (observation.status !== 'known') continue;
    const { row, column, width, height } = observation.value;
    if (!Number.isSafeInteger(row + height) || !Number.isSafeInteger(column + width)) {
      return fail('bad-rect', `node ${node.id}: ${name} overflows the safe-integer range`);
    }
  }

  if (node.paintedRegion?.status === 'known') {
    const problem = regionProblem(
      `node ${node.id} painted region`,
      node.paintedRegion.value,
      snapshot.columns,
      snapshot.rows,
    );
    if (problem !== null) return problem;
  }

  const intended = node.geometry.intendedRect;
  const visible = node.geometry.visibleRect;
  if (visible.status === 'known' && visible.value.width > 0 && visible.value.height > 0) {
    if (
      snapshot.coordinateSpace.status === 'known' &&
      snapshot.coordinateSpace.value === 'viewport-cells' &&
      !rectIntersectsViewport(visible.value, snapshot.columns, snapshot.rows)
    ) {
      return fail('bad-rect', `node ${node.id}: visibleRect does not intersect the viewport`);
    }
    if (intended.status === 'known' && !rectContains(intended.value, visible.value)) {
      return fail('bad-rect', `node ${node.id}: visibleRect extends outside intendedRect`);
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
      return fail(
        'count',
        `node ${node.id}: ${field} exceeds ${limits.maxRelationTargets} targets`,
      );
    }
    for (const target of targets) {
      if (!ids.has(target)) {
        return fail(
          'missing-parent',
          `node ${node.id}: ${field} references unknown node ${target}`,
        );
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
export function validateSnapshot(
  value: unknown,
  limits: ProtocolLimits,
  wireBytes?: number,
): ValidationResult {
  let projected: unknown;
  try {
    projected = projectDto<unknown>(value, limits.maxDepth);
  } catch (error) {
    if (error instanceof ProtocolViolation) {
      return fail(error.code === 'dto-depth' ? 'depth' : 'schema', error.message);
    }
    return fail('schema', 'value could not be projected into a plain DTO');
  }

  // At a wire boundary the frame prefix already supplied the exact byte
  // length. Standalone callers still get the same safe size check once.
  const serialised = wireBytes === undefined ? JSON.stringify(projected) : undefined;
  if (wireBytes === undefined && serialised === undefined) {
    return fail('schema', 'snapshot is not a JSON object');
  }
  const bytes = wireBytes ?? Buffer.byteLength(serialised!, 'utf8');
  if (bytes > limits.maxSnapshotBytes) {
    return fail('bytes', `snapshot is ${bytes} bytes, ceiling is ${limits.maxSnapshotBytes}`);
  }

  const parsed = treeSchemas(limits).snapshot.safeParse(projected);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    return fail(codeForIssue(issue), describeIssue(issue));
  }

  const snapshot = projected as SemanticSnapshot;

  if (snapshot.nodes.length > limits.maxNodes) {
    return fail(
      'count',
      `snapshot carries ${snapshot.nodes.length} nodes, ceiling is ${limits.maxNodes}`,
    );
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

  if (
    snapshot.coordinateSpace.status === 'known' &&
    snapshot.coordinateSpace.value !== 'viewport-cells'
  ) {
    // Framework-local geometry is inspectable, but it cannot be addressed by
    // terminal input. Pointer ownership is independently qualified by the hit grid.
  }
  if (snapshot.hitGrid.status === 'known') {
    for (const region of snapshot.hitGrid.value.regions) {
      if (!ids.has(region.recipientId)) {
        return fail('missing-parent', `hitGrid references unknown recipient ${region.recipientId}`);
      }
      if (!rectIntersectsViewport(region.rect, snapshot.columns, snapshot.rows)) {
        return fail(
          'bad-rect',
          `hitGrid region for ${region.recipientId} does not intersect the viewport`,
        );
      }
    }
  }

  const providerIds = new Set<string>();
  for (const provider of snapshot.providerEvidence ?? []) {
    if (providerIds.has(provider.providerId)) {
      return fail('provider', `provider evidence id ${provider.providerId} appears more than once`);
    }
    providerIds.add(provider.providerId);
    if (provider.sessionId !== snapshot.sessionId) {
      return fail(
        'provider',
        `provider ${provider.providerId} evidence session ${provider.sessionId} does not match snapshot session ${snapshot.sessionId}`,
      );
    }
    if (provider.revision !== snapshot.revision) {
      return fail(
        'provider',
        `provider ${provider.providerId} evidence revision ${provider.revision} does not match snapshot revision ${snapshot.revision}`,
      );
    }
    if (provider.status !== 'available') continue;
    if (provider.evidence.providerId !== provider.providerId) {
      return fail(
        'schema',
        `provider ${provider.providerId} evidence provenance names ${provider.evidence.providerId}`,
      );
    }
    if (provider.focusState?.status === 'focused' && !ids.has(provider.focusState.recipientId)) {
      return fail(
        'missing-parent',
        `provider ${provider.providerId} focus references unknown recipient ${provider.focusState.recipientId}`,
      );
    }
    for (const region of provider.pointerRegions) {
      if (!ids.has(region.recipientId)) {
        return fail(
          'missing-parent',
          `provider ${provider.providerId} references unknown recipient ${region.recipientId}`,
        );
      }
      const problem = regionProblem(
        `provider ${provider.providerId} span for ${region.recipientId}`,
        region,
        snapshot.columns,
        snapshot.rows,
      );
      if (problem !== null) return problem;
    }
    for (const region of provider.paintedRegions ?? []) {
      if (!ids.has(region.recipientId)) {
        return fail(
          'missing-parent',
          `provider ${provider.providerId} painted region references unknown recipient ${region.recipientId}`,
        );
      }
      const problem = regionProblem(
        `provider ${provider.providerId} painted region for ${region.recipientId}`,
        region,
        snapshot.columns,
        snapshot.rows,
      );
      if (problem !== null) return problem;
    }
    for (const hit of provider.hitGrid?.regions ?? []) {
      if (!ids.has(hit.recipientId)) {
        return fail(
          'missing-parent',
          `provider ${provider.providerId} hitGrid references unknown recipient ${hit.recipientId}`,
        );
      }
      if (!rectIntersectsViewport(hit.rect, snapshot.columns, snapshot.rows)) {
        return fail(
          'bad-rect',
          `provider ${provider.providerId} hitGrid region for ${hit.recipientId} does not intersect the viewport`,
        );
      }
    }
    for (const entry of provider.actionRecipes ?? []) {
      if (!ids.has(entry.recipientId)) {
        return fail(
          'missing-parent',
          `provider ${provider.providerId} action recipes reference unknown recipient ${entry.recipientId}`,
        );
      }
      const node = snapshot.nodes.find(({ id }) => id === entry.recipientId)!;
      const intents = new Set(node.actions ?? []);
      const missingIntent = entry.recipes.find(({ action }) => !intents.has(action));
      if (missingIntent !== undefined) {
        return fail(
          'provider',
          `provider ${provider.providerId} ${missingIntent.action} recipe has no matching semantic action intent on ${entry.recipientId}`,
        );
      }
    }
    for (const state of provider.scrollStates ?? []) {
      if (!ids.has(state.recipientId)) {
        return fail(
          'missing-parent',
          `provider ${provider.providerId} scroll state references unknown recipient ${state.recipientId}`,
        );
      }
    }
  }

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
