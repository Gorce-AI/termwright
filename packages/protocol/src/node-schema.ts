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
import type { SemanticExtendedValue } from './tree.js';
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
  readonly snapshotV1: z.ZodType;
  readonly snapshotV2: z.ZodType;
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

  const observation = <T extends z.ZodType>(value: T): z.ZodType =>
    z.discriminatedUnion('status', [
      z.strictObject({ status: z.literal('known'), value, evidence: z.enum(['adapter', 'probe', 'terminal-grid', 'viewport-clip', 'paint-order', 'hit-grid', 'legacy-v1']) }),
      z.strictObject({ status: z.literal('absent'), reason: z.enum(['detached', 'not-displayed', 'not-laid-out']) }),
      z.strictObject({ status: z.literal('unknown'), reason: z.enum(['not-reported', 'temporary', 'clip-unobservable', 'legacy-unqualified']) }),
      z.strictObject({ status: z.literal('unsupported'), capability: text, reason: z.enum(['capability', 'framework-unobservable', 'not-negotiated']) }),
    ]);

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

  const extendedValue: z.ZodType<SemanticExtendedValue> = z.lazy(() =>
    z.union([
      z.null(),
      z.boolean(),
      z.number().finite().refine(
        (value) => Math.abs(value) <= Number.MAX_SAFE_INTEGER,
        'expected a finite JSON number in the safe range',
      ),
      text,
      z.array(extendedValue).max(limits.maxRelationTargets),
      z
        .record(text, extendedValue)
        .refine(
          (value) => Object.keys(value).length <= limits.maxRelationTargets,
          `expected at most ${limits.maxRelationTargets} properties`,
        ),
    ]),
  );
  const extended = z
    .record(text, extendedValue)
    .refine(
      (value) => Object.keys(value).length <= limits.maxRelationTargets,
      `expected at most ${limits.maxRelationTargets} properties`,
    );

  const nodeFields = {
    id: text.refine((s) => s.length > 0, 'node id must not be empty'),
    parentId: text.optional(),
    role: z.enum(SEMANTIC_ROLES),
    name: text,
    description: text.optional(),
    value: text.optional(),
    bounds: rect.optional(),
    state: state.optional(),
    extended: extended.optional(),
    actions: z.array(z.enum(SEMANTIC_ACTIONS)).max(SEMANTIC_ACTIONS.length).optional(),
    labelledBy: relations.optional(),
    describedBy: relations.optional(),
    textRanges: z.array(textRange).max(limits.maxRelationTargets).optional(),
    testId: text.optional(),
    frameworkType: text.optional(),
    occlusion: z.enum(['known', 'unknown']).optional(),
    p: z.enum(PROVENANCE_SOURCES).optional(),
    px: z.record(text, z.enum(PROVENANCE_SOURCES)).optional(),
  } as const;
  const node = z.strictObject(nodeFields);
  const geometry = z.strictObject({
    displayed: observation(z.boolean()),
    intendedRect: observation(rect),
    visibleRect: observation(rect),
  });
  const nodeV2 = z.strictObject({
    ...nodeFields,
    bounds: z.never().optional(),
    occlusion: z.never().optional(),
    geometry,
  });

  const cursor = z.strictObject({
    row: nonNegativeInt(),
    column: nonNegativeInt(),
    visible: z.boolean(),
    shape: z.union([z.literal('block'), z.literal('underline'), z.literal('bar')]).optional(),
  });

  const snapshotV1 = z.strictObject({
    v: z.literal(1),
    sessionId: text.refine((s) => s.length > 0, 'sessionId must not be empty'),
    revision: positiveInt(),
    columns: positiveInt(),
    rows: positiveInt(),
    cursor: cursor.optional(),
    rootIds: z.array(text).max(limits.maxNodes),
    nodes: z.array(node).max(limits.maxNodes),
  });
  const hitRun = z.strictObject({
    rect: z.strictObject({
      row: nonNegativeInt(),
      column: nonNegativeInt(),
      width: positiveInt(),
      height: z.literal(1),
    }),
    recipientId: text,
  });
  const hitGrid = z.strictObject({
    // Canonical row runs make ambiguity validation linear and keep hostile
    // snapshots from forcing an O(n²) rectangle-overlap check.
    regions: z.array(hitRun).max(limits.maxNodes).superRefine((regions, ctx) => {
      let previous: (typeof regions)[number] | undefined;
      for (let index = 0; index < regions.length; index += 1) {
        const current = regions[index]!;
        if (
          previous !== undefined &&
          (current.rect.row < previous.rect.row ||
            (current.rect.row === previous.rect.row &&
              current.rect.column < previous.rect.column + previous.rect.width))
        ) {
          ctx.addIssue({
            code: 'custom',
            path: [index, 'rect'],
            message: 'hit regions must be non-overlapping row-major runs',
          });
          return;
        }
        previous = current;
      }
    }),
  });
  const snapshotV2 = z.strictObject({
    v: z.literal(2),
    sessionId: text.refine((s) => s.length > 0, 'sessionId must not be empty'),
    revision: positiveInt(),
    columns: positiveInt(),
    rows: positiveInt(),
    cursor: cursor.optional(),
    rootIds: z.array(text).max(limits.maxNodes),
    nodes: z.array(nodeV2).max(limits.maxNodes),
    coordinateSpace: observation(z.enum(['viewport-cells', 'framework-local-cells'])),
    hitGrid: observation(hitGrid),
  });
  const snapshot = z.discriminatedUnion('v', [snapshotV1, snapshotV2]);

  return {
    text,
    node,
    cursor,
    snapshot,
    snapshotV1,
    snapshotV2,
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
