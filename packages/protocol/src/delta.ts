/**
 * Tree deltas: incremental semantic updates bound to an exact base revision.
 *
 * A delta is only ever applied to the revision it names. There is no
 * speculative patching and no fuzzy rebasing: if the receiver does not hold
 * exactly `baseRevision`, it asks for a full snapshot with `get-tree` and
 * throws the delta away (origin spec §8.3). A wrong tree is far more expensive
 * than a redundant snapshot, because every assertion downstream inherits the
 * error silently.
 *
 * ## Composition semantics
 *
 * The semantic tree is a flat node list joined by `parentId`, so a delta is a
 * set of upserts plus a set of removals:
 *
 * - **`changed`** upserts by id: a node absent from the base is inserted, and
 *   a node already present is **replaced wholesale**, never field-merged.
 *   Merging would need a third state meaning "unset this optional field",
 *   which the wire has no way to express.
 * - **`removed`** removes each id **together with its whole subtree**. Cascade
 *   is what keeps a delta small — dropping a dialog is one id, not one id per
 *   descendant — and it is the only rule that cannot leave orphans behind.
 * - **`rootIds`**, when present, replaces the root list outright. When absent
 *   the base roots carry over, minus anything the removals took.
 * - **`cursor`**, when present, replaces the cursor. When absent it is
 *   unchanged. Everything else about the viewport — columns, rows, session id
 *   — is inherited and cannot be changed by a delta.
 *
 * Order matters: removals are applied first, then upserts. That lets one delta
 * move a node out of a removed subtree by re-adding it in `changed`.
 */

import { Buffer } from 'node:buffer';
import { z } from 'zod';
import type { ProtocolLimits } from './limits.js';
import type { CursorInfo, SemanticNode, SemanticSnapshot } from './tree.js';
import type { ValidationErrorCode, ValidationResult } from './validate.js';
import { validateSnapshot } from './validate.js';
import { ProtocolViolation } from './errors.js';
import { projectDto } from './framing.js';
import { treeSchemas } from './node-schema.js';

/**
 * An incremental update to a semantic tree.
 *
 * Carries no viewport or session id: those belong to the snapshot the delta is
 * composed onto, and a change to them requires a full snapshot. The cursor is
 * the exception — it moves far too often to be worth a snapshot each time.
 */
export interface TreeDelta {
  /** The revision this delta is composed onto. Must match exactly. */
  readonly baseRevision: number;
  /** The revision produced by applying it. Strictly greater than the base. */
  readonly revision: number;
  /** Nodes to insert or replace, keyed by `id`. */
  readonly changed: readonly SemanticNode[];
  /** Node ids to remove, each together with its subtree. */
  readonly removed: readonly string[];
  /** Replacement root list; absent means the base roots carry over. */
  readonly rootIds?: readonly string[];
  /**
   * Replacement cursor; **absent means unchanged**.
   *
   * Without this a diffs-only session could never move the cursor, which in a
   * TUI moves on nearly every keystroke — the mode would be useless for
   * exactly the interactive applications it exists to make cheap.
   *
   * A delta can set the cursor but **cannot clear it**, and the two are not
   * the same thing: `{ visible: false }` says there is a cursor and it is
   * hidden, while an absent `SemanticSnapshot.cursor` says there is no cursor
   * information at all. `cursor` is the only optional field on a snapshot, so
   * it is the only one with this asymmetry.
   *
   * **Producer obligation:** a producer whose tree transitions from having a
   * cursor to having none MUST send a full snapshot rather than a delta.
   * Emitting a delta there would leave the receiver holding a cursor the
   * application has stopped reporting — stale state that looks live. The same
   * rule already applies to `columns`/`rows`, which a delta also cannot change.
   */
  readonly cursor?: CursorInfo;
}

/** Structured result: never throws hostile data onward. */
export type DeltaValidationResult =
  | { readonly ok: true; readonly delta: TreeDelta }
  | { readonly ok: false; readonly code: ValidationErrorCode; readonly detail: string };

function fail(code: ValidationErrorCode, detail: string): DeltaValidationResult {
  return { ok: false, code, detail };
}

const DELTA_KEYS = ['baseRevision', 'revision', 'changed', 'removed', 'rootIds', 'cursor'];

/**
 * Validate the **shape** of an untrusted delta.
 *
 * This checks everything that can be known without the base tree: bounded
 * sizes, well-formed nodes, unique ids, and a base/revision pair that moves
 * forward. It deliberately cannot check parent existence, acyclicity, depth or
 * whether bounds fall inside the viewport — all of those are properties of the
 * *composed* tree, and {@link applyTreeDelta} checks them there.
 *
 * @param value - Untrusted candidate delta (without the message `type` field).
 * @param limits - Active limits.
 * @returns `{ ok: true, delta }` with a deep-frozen delta, or a typed failure.
 * Never throws.
 */
export function validateTreeDelta(value: unknown, limits: ProtocolLimits): DeltaValidationResult {
  let projected: unknown;
  try {
    projected = projectDto<unknown>(value, limits.maxDepth);
  } catch (error) {
    if (error instanceof ProtocolViolation) {
      return fail(error.code === 'dto-depth' ? 'depth' : 'schema', error.message);
    }
    return fail('schema', 'value could not be projected into a plain DTO');
  }

  const serialised = JSON.stringify(projected);
  if (serialised === undefined) {
    return fail('schema', 'delta is not a JSON object');
  }
  const bytes = Buffer.byteLength(serialised, 'utf8');
  if (bytes > limits.maxSnapshotBytes) {
    return fail('bytes', `delta is ${bytes} bytes, ceiling is ${limits.maxSnapshotBytes}`);
  }

  if (typeof projected !== 'object' || projected === null || Array.isArray(projected)) {
    return fail('schema', 'delta must be an object');
  }
  const delta = projected as Record<string, unknown>;
  for (const key of Object.keys(delta)) {
    if (!DELTA_KEYS.includes(key)) return fail('schema', `unknown delta property "${key}"`);
  }

  const { text, node, cursor } = treeSchemas(limits);
  const parsed = deltaSchema(text, node, cursor, limits).safeParse(delta);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const path = issue.path.map(String);
    const where = path.length > 0 ? path.join('.') : '<root>';
    const code: ValidationErrorCode = path.includes('role')
      ? 'unknown-role'
      : path.includes('revision') || path.includes('baseRevision')
        ? 'revision'
        : path.includes('bounds') || path.includes('rect')
          ? 'bad-rect'
          : issue.code === 'too_big'
            ? 'count'
            : 'schema';
    return fail(code, `${where}: ${issue.message}`);
  }

  const typed = delta as unknown as TreeDelta;

  if (typed.revision <= typed.baseRevision) {
    return fail(
      'revision',
      `revision ${typed.revision} must be greater than baseRevision ${typed.baseRevision}`,
    );
  }

  const total = typed.changed.length + typed.removed.length;
  if (total > limits.maxNodes) {
    return fail('count', `delta touches ${total} nodes, ceiling is ${limits.maxNodes}`);
  }

  const changedIds = new Set<string>();
  for (const entry of typed.changed) {
    if (changedIds.has(entry.id)) {
      return fail('duplicate-id', `node id ${entry.id} appears twice in changed`);
    }
    changedIds.add(entry.id);
    if (entry.parentId === entry.id) {
      return fail('cycle', `node ${entry.id} is its own parent`);
    }
  }

  const removedIds = new Set<string>();
  for (const id of typed.removed) {
    if (removedIds.has(id)) return fail('duplicate-id', `node id ${id} appears twice in removed`);
    removedIds.add(id);
    if (changedIds.has(id)) {
      return fail('schema', `node id ${id} is both changed and removed`);
    }
  }

  if (typed.rootIds !== undefined) {
    const seen = new Set<string>();
    for (const id of typed.rootIds) {
      if (seen.has(id)) return fail('duplicate-id', `root id ${id} appears twice`);
      seen.add(id);
    }
  }

  return { ok: true, delta: typed };
}

const deltaCache = new WeakMap<ProtocolLimits, z.ZodType>();

function deltaSchema(
  text: z.ZodType<string>,
  node: z.ZodType,
  cursor: z.ZodType,
  limits: ProtocolLimits,
): z.ZodType {
  const cached = deltaCache.get(limits);
  if (cached !== undefined) return cached;
  const built = z.strictObject({
    baseRevision: z.number().refine((n) => Number.isSafeInteger(n) && n > 0, 'expected a positive safe integer'),
    revision: z.number().refine((n) => Number.isSafeInteger(n) && n > 0, 'expected a positive safe integer'),
    changed: z.array(node).max(limits.maxNodes),
    removed: z.array(text).max(limits.maxNodes),
    rootIds: z.array(text).max(limits.maxNodes).optional(),
    cursor: cursor.optional(),
  });
  deltaCache.set(limits, built);
  return built;
}

/**
 * Compose a delta onto the snapshot it names, then validate the result.
 *
 * The base revision must match **exactly**; a mismatch is reported rather than
 * patched around, so the caller can fall back to `get-tree` per origin §8.3.
 *
 * All the invariants a delta cannot check on its own — parents exist, the tree
 * is acyclic, depth and counts are within limits, bounds intersect the viewport
 * — are checked here against the composed tree, by running the composed result
 * through {@link validateSnapshot}. A delta is therefore never trusted to
 * produce a valid tree; it is only trusted to describe one.
 *
 * @param base - The snapshot the delta is composed onto.
 * @param delta - A delta that already passed {@link validateTreeDelta}.
 * @param limits - Active limits.
 * @returns The composed, deep-frozen snapshot, or a typed failure. Never throws.
 */
export function applyTreeDelta(
  base: SemanticSnapshot,
  delta: TreeDelta,
  limits: ProtocolLimits,
): ValidationResult {
  if (delta.baseRevision !== base.revision) {
    return {
      ok: false,
      code: 'revision',
      detail:
        `delta is based on revision ${delta.baseRevision} but the held snapshot is ` +
        `revision ${base.revision}; request a full snapshot instead of patching`,
    };
  }

  const byId = new Map<string, SemanticNode>();
  for (const node of base.nodes) byId.set(node.id, node);

  // Removals cascade, so collect children once rather than rescanning per id.
  const childrenOf = new Map<string, string[]>();
  for (const node of base.nodes) {
    if (node.parentId === undefined) continue;
    const siblings = childrenOf.get(node.parentId);
    if (siblings === undefined) childrenOf.set(node.parentId, [node.id]);
    else siblings.push(node.id);
  }

  for (const id of delta.removed) {
    if (!byId.has(id)) {
      return {
        ok: false,
        code: 'missing-parent',
        detail:
          `delta removes unknown node ${id}; the producer's base disagrees with ours, ` +
          'so the tree must be resynchronised rather than patched',
      };
    }
    // Iterative descent: a hostile delta must not be able to blow the stack.
    const pending = [id];
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (!byId.delete(current)) continue;
      const children = childrenOf.get(current);
      if (children !== undefined) pending.push(...children);
    }
  }

  for (const node of delta.changed) byId.set(node.id, node);

  // Roots that survived the removals. Adding a NEW root therefore requires
  // sending `rootIds`: a parentless node absent from the root list is exactly
  // what validateSnapshot rejects, so the omission fails loudly.
  const rootIds = delta.rootIds ?? base.rootIds.filter((id) => byId.has(id));

  const composed = {
    v: 1 as const,
    sessionId: base.sessionId,
    revision: delta.revision,
    columns: base.columns,
    rows: base.rows,
    // Absent cursor means unchanged, so the base's carries over.
    ...(delta.cursor ?? base.cursor) === undefined
      ? {}
      : { cursor: delta.cursor ?? base.cursor },
    rootIds,
    nodes: [...byId.values()],
  };

  return validateSnapshot(composed, limits);
}
