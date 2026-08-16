/**
 * Shared zod schemas for tree data. **Internal**: not re-exported from
 * `index.ts`.
 *
 * Snapshots and tree deltas describe the same nodes, so they must agree on
 * what a node is down to the last byte bound. Keeping one definition here is
 * what stops a delta from accepting a node a snapshot would reject.
 *
 * Schemas depend on the active limits, so they are built per limits object and
 * memoised. Limits are frozen singletons in practice, which keeps schema
 * construction off the per-message path.
 */

import { Buffer } from 'node:buffer';
import { z } from 'zod';
import type { ProtocolLimits } from './limits.js';
import { SEMANTIC_ACTIONS, SEMANTIC_ROLES } from './roles.js';
import { PROVENANCE_SOURCES } from './probe/ir.js';

export function safeInt(): z.ZodType<number> {
  return z.number().refine(Number.isSafeInteger, 'expected a safe integer');
}

export function nonNegativeInt(): z.ZodType<number> {
  return z
    .number()
    .refine((n) => Number.isSafeInteger(n) && n >= 0, 'expected a non-negative safe integer');
}

export function positiveInt(): z.ZodType<number> {
  return z
    .number()
    .refine((n) => Number.isSafeInteger(n) && n > 0, 'expected a positive safe integer');
}

export function boundedString(maxStringBytes: number): z.ZodType<string> {
  return z
    .string()
    .refine(
      (s) => Buffer.byteLength(s, 'utf8') <= maxStringBytes,
      `expected at most ${maxStringBytes} UTF-8 bytes`,
    );
}

/** The schema family for one set of limits. */
export interface TreeSchemas {
  readonly text: z.ZodType<string>;
  readonly node: z.ZodType;
  readonly cursor: z.ZodType;
  readonly snapshot: z.ZodType;
  /** Field names of `SemanticNode`, read off the schema itself. */
  readonly nodeKeys: readonly string[];
  /** Field names of `SemanticState`, read off the schema itself. */
  readonly stateKeys: readonly string[];
}

const cache = new WeakMap<ProtocolLimits, TreeSchemas>();

function build(limits: ProtocolLimits): TreeSchemas {
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
    offscreen: z.boolean().optional(),
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
    frameworkType: text.optional(),
    occlusion: z.enum(['known', 'unknown']).optional(),
    p: z.enum(PROVENANCE_SOURCES).optional(),
    px: z.record(text, z.enum(PROVENANCE_SOURCES)).optional(),
  });

  const cursor = z.strictObject({
    row: nonNegativeInt(),
    column: nonNegativeInt(),
    visible: z.boolean(),
    shape: z.union([z.literal('block'), z.literal('underline'), z.literal('bar')]).optional(),
  });

  const snapshot = z.strictObject({
    v: z.literal(1),
    sessionId: text.refine((s) => s.length > 0, 'sessionId must not be empty'),
    revision: positiveInt(),
    columns: positiveInt(),
    rows: positiveInt(),
    cursor: cursor.optional(),
    rootIds: z.array(text).max(limits.maxNodes),
    nodes: z.array(node).max(limits.maxNodes),
  });

  return {
    text,
    node,
    cursor,
    snapshot,
    nodeKeys: Object.freeze(Object.keys(node.shape)),
    stateKeys: Object.freeze(Object.keys(state.shape)),
  };
}

/** Memoised schema family for the given limits. */
export function treeSchemas(limits: ProtocolLimits): TreeSchemas {
  const cached = cache.get(limits);
  if (cached !== undefined) return cached;
  const built = build(limits);
  cache.set(limits, built);
  return built;
}
