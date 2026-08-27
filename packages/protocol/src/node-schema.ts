/**
 * Shared zod schemas for tree data. **Internal**: not re-exported from
 * `index.ts`.
 *
 * This is the canonical wire shape for every semantic node.
 *
 * Schemas depend on the active limits, so they are built per limits object and
 * memoised. Limits are frozen singletons in practice, which keeps schema
 * construction off the per-message path.
 */

import { Buffer } from "node:buffer";
import { z } from "zod";
import type { ProtocolLimits } from "./limits.js";
import type { SemanticExtendedValue } from "./tree.js";
import {
  PHYSICAL_INPUT_RECIPE_ACTIONS,
  SEMANTIC_ACTIONS,
  SEMANTIC_ROLES,
} from "./roles.js";
import { PROVENANCE_SOURCES } from "./probe/ir.js";

export function safeInt(): z.ZodType<number> {
  return z.number().refine(Number.isSafeInteger, "expected a safe integer");
}

export function nonNegativeInt(): z.ZodType<number> {
  return z
    .number()
    .refine(
      (n) => Number.isSafeInteger(n) && n >= 0,
      "expected a non-negative safe integer",
    );
}

export function positiveInt(): z.ZodType<number> {
  return z
    .number()
    .refine(
      (n) => Number.isSafeInteger(n) && n > 0,
      "expected a positive safe integer",
    );
}

export function boundedString(maxStringBytes: number): z.ZodType<string> {
  return z
    .string()
    .refine(
      (s) => Buffer.byteLength(s, "utf8") <= maxStringBytes,
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

  const evidence = z.strictObject({
    source: z.enum([
      "framework",
      "application",
      "terminal",
      "recognizer",
      "driver",
    ]),
    method: z.enum([
      "native",
      "instrumented",
      "declared",
      "correlated",
      "measured",
      "derived",
      "heuristic",
    ]),
    strength: z.enum(["authoritative", "diagnostic"]),
    providerId: z.string().min(1).max(256),
  });
  const authoritativeEvidence = evidence.extend({
    strength: z.literal("authoritative"),
  });

  const observation = <T extends z.ZodType>(value: T): z.ZodType =>
    z.discriminatedUnion("status", [
      z.strictObject({
        status: z.literal("known"),
        value,
        evidence,
      }),
      z.strictObject({
        status: z.literal("absent"),
        reason: z.enum(["detached", "not-displayed", "not-laid-out"]),
        evidence: authoritativeEvidence,
      }),
      z.strictObject({
        status: z.literal("unknown"),
        reason: z.enum([
          "awaiting-revision-pair",
          "provider-refresh",
          "stale-revision",
        ]),
      }),
      z.strictObject({
        status: z.literal("unsupported"),
        capability: text,
        reason: z.enum([
          "capability",
          "framework-unobservable",
          "not-negotiated",
        ]),
      }),
    ]);
  const semanticValue = z.discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("known"),
      value: text,
      sensitivity: z.enum(["public", "sensitive"]),
      evidence,
    }),
    z.strictObject({
      status: z.literal("absent"),
      reason: z.enum(["detached", "not-displayed", "not-laid-out", "no-value"]),
      evidence: authoritativeEvidence,
    }),
    z.strictObject({
      status: z.literal("unknown"),
      reason: z.enum([
        "awaiting-revision-pair",
        "provider-refresh",
        "stale-revision",
      ]),
    }),
    z.strictObject({
      status: z.literal("unsupported"),
      capability: z.literal("semantic-value"),
      reason: z.enum([
        "capability",
        "framework-unobservable",
        "not-negotiated",
      ]),
    }),
    z.strictObject({
      status: z.literal("withheld"),
      reason: z.enum(["sensitive", "artifact-policy", "provider-policy"]),
      sensitivity: z.enum(["public", "sensitive"]),
    }),
  ]);

  const state = z.strictObject({
    disabled: z.boolean().optional(),
    focused: z.boolean().optional(),
    selected: z.boolean().optional(),
    checked: z.union([z.boolean(), z.literal("mixed")]).optional(),
    expanded: z.boolean().optional(),
    modal: z.boolean().optional(),
    busy: z.boolean().optional(),
    hidden: z.boolean().optional(),
    offscreen: z.boolean().optional(),
    readonly: z.boolean().optional(),
    multiline: z.boolean().optional(),
    required: z.boolean().optional(),
    multiselectable: z.boolean().optional(),
    orientation: z
      .union([z.literal("horizontal"), z.literal("vertical")])
      .optional(),
    level: positiveInt().optional(),
    positionInSet: positiveInt().optional(),
    setSize: nonNegativeInt().optional(),
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
      z
        .number()
        .finite()
        .refine(
          (value) => Math.abs(value) <= Number.MAX_SAFE_INTEGER,
          "expected a finite JSON number in the safe range",
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

  const inputRecipe = z
    .strictObject({
      action: z.enum(PHYSICAL_INPUT_RECIPE_ACTIONS),
      requiresFocus: z.boolean(),
      steps: z
        .array(
          z.union([
            z.strictObject({
              kind: z.literal("press"),
              key: text.refine((s) => s.length > 0, "key must not be empty"),
            }),
            z.strictObject({ kind: z.literal("insert-action-value") }),
          ]),
        )
        .min(1)
        .max(limits.maxRelationTargets),
    })
    .superRefine((recipe, context) => {
      const inserts = recipe.steps.filter(
        ({ kind }) => kind === "insert-action-value",
      ).length;
      if (
        (recipe.action === "setValue" && inserts !== 1) ||
        (recipe.action !== "setValue" && inserts !== 0)
      ) {
        context.addIssue({
          code: "custom",
          message: "setValue requires exactly one insert-action-value step",
        });
      }
      if (recipe.action === "focus" && recipe.requiresFocus) {
        context.addIssue({
          code: "custom",
          message: "focus recipe cannot require focus",
        });
      }
    });
  const inputRecipes = z
    .array(inputRecipe)
    .max(PHYSICAL_INPUT_RECIPE_ACTIONS.length)
    .superRefine((recipes, context) => {
      if (
        new Set(recipes.map(({ action }) => action)).size !== recipes.length
      ) {
        context.addIssue({
          code: "custom",
          message: "input recipe actions must be unique",
        });
      }
    });

  const regionSpan = z
    .strictObject({
      row: nonNegativeInt(),
      from: nonNegativeInt(),
      to: positiveInt(),
    })
    .refine((span) => span.to > span.from, "region span must be non-empty");
  const regionSpans = z
    .array(regionSpan)
    .max(limits.maxNodes)
    .superRefine((spans, ctx) => {
      let previous: (typeof spans)[number] | undefined;
      for (let index = 0; index < spans.length; index += 1) {
        const current = spans[index]!;
        if (
          previous !== undefined &&
          (current.row < previous.row ||
            (current.row === previous.row && current.from < previous.to))
        ) {
          ctx.addIssue({
            code: "custom",
            path: [index],
            message: "region spans must be non-overlapping row-major runs",
          });
          return;
        }
        previous = current;
      }
    });

  const nodeFields = {
    id: text.refine((s) => s.length > 0, "node id must not be empty"),
    parentId: text.optional(),
    role: z.enum(SEMANTIC_ROLES),
    name: text,
    description: text.optional(),
    value: semanticValue.optional(),
    state: state.optional(),
    extended: extended.optional(),
    actions: z
      .array(z.enum(SEMANTIC_ACTIONS))
      .max(SEMANTIC_ACTIONS.length)
      .optional(),
    inputRecipes: inputRecipes.optional(),
    labelledBy: relations.optional(),
    describedBy: relations.optional(),
    textRanges: z.array(textRange).max(limits.maxRelationTargets).optional(),
    testId: text.optional(),
    frameworkType: text.optional(),
    opaqueChildren: z.boolean().optional(),
    p: z.enum(PROVENANCE_SOURCES).optional(),
    px: z.record(text, z.enum(PROVENANCE_SOURCES)).optional(),
  } as const;
  const geometry = z.strictObject({
    displayed: observation(z.boolean()),
    intendedRect: observation(rect),
    visibleRect: observation(rect),
  });
  const nodeV2 = z
    .strictObject({
      ...nodeFields,
      geometry,
      scroll: observation(z.strictObject({
        axis: z.enum(["vertical", "horizontal"]),
        offset: nonNegativeInt(),
        viewport: nonNegativeInt(),
        extent: nonNegativeInt(),
      })).optional(),
      paintedRegion: observation(z.strictObject({
        regionBounds: rect,
        spans: regionSpans,
      })).optional(),
    })
    .superRefine((node, context) => {
      const intents = new Set(node.actions ?? []);
      for (const [index, recipe] of (node.inputRecipes ?? []).entries()) {
        if (!intents.has(recipe.action)) {
          context.addIssue({
            code: "custom",
            path: ["inputRecipes", index, "action"],
            message: `input recipe '${recipe.action}' requires the matching semantic action intent`,
          });
        }
      }
    });

  const cursor = z.strictObject({
    row: nonNegativeInt(),
    column: nonNegativeInt(),
    visible: z.boolean(),
    shape: z
      .union([z.literal("block"), z.literal("underline"), z.literal("bar")])
      .optional(),
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
    regions: z
      .array(hitRun)
      .max(limits.maxNodes)
      .superRefine((regions, ctx) => {
        let previous: (typeof regions)[number] | undefined;
        for (let index = 0; index < regions.length; index += 1) {
          const current = regions[index]!;
          if (
            previous !== undefined &&
            (current.rect.row < previous.rect.row ||
              (current.rect.row === previous.rect.row &&
                current.rect.column <
                  previous.rect.column + previous.rect.width))
          ) {
            ctx.addIssue({
              code: "custom",
              path: [index, "rect"],
              message: "hit regions must be non-overlapping row-major runs",
            });
            return;
          }
          previous = current;
        }
      }),
  });
  const providerPointerRegion = z.strictObject({
    recipientId: text.refine(
      (value) => value.length > 0,
      "recipient id must not be empty",
    ),
    regionBounds: rect,
    spans: regionSpans,
  });
  const providerActionRecipes = z.strictObject({
    recipientId: text.refine(
      (value) => value.length > 0,
      "recipient id must not be empty",
    ),
    recipes: inputRecipes,
  });
  const providerScrollState = z.strictObject({
    recipientId: text.refine(
      (value) => value.length > 0,
      "recipient id must not be empty",
    ),
    axis: z.enum(["vertical", "horizontal"]),
    offset: nonNegativeInt(),
    viewport: nonNegativeInt(),
    extent: nonNegativeInt(),
  }).superRefine((state, context) => {
    if (state.offset > state.extent || state.viewport > state.extent || state.offset + state.viewport > state.extent) {
      context.addIssue({
        code: "custom",
        message: "scroll state must fit inside its extent",
      });
    }
  });
  const providerEvidence = z.discriminatedUnion("status", [
    z.strictObject({
      providerId: text.refine(
        (value) => value.length > 0,
        "provider id must not be empty",
      ),
      sessionId: text.refine(
        (value) => value.length > 0,
        "provider session id must not be empty",
      ),
      revision: positiveInt(),
      status: z.literal("available"),
      evidence: z.strictObject({
        source: z.literal("application"),
        method: z.enum(["native", "instrumented", "declared"]),
        strength: z.literal("authoritative"),
        providerId: text.refine(
          (value) => value.length > 0,
          "evidence provider id must not be empty",
        ),
      }),
      pointerRegions: z.array(providerPointerRegion).max(limits.maxNodes),
      paintedRegions: z.array(providerPointerRegion).max(limits.maxNodes).optional(),
      inputModes: z.strictObject({
        mouseTracking: z.enum(['none', 'x10', 'vt200', 'drag', 'any']),
        mouseEncoding: z.enum(['default', 'sgr', 'urxvt', 'utf8']),
        focusReporting: z.enum(['on', 'off']),
      }).optional(),
      focusState: z
        .discriminatedUnion("status", [
          z.strictObject({
            status: z.literal("focused"),
            recipientId: text.refine(
              (value) => value.length > 0,
              "focused recipient id must not be empty",
            ),
          }),
          z.strictObject({ status: z.literal("none") }),
        ])
        .optional(),
      actionRecipes: z
        .array(providerActionRecipes)
        .max(limits.maxNodes)
        .superRefine((entries, context) => {
          const seen = new Set<string>();
          for (const [index, entry] of entries.entries()) {
            if (seen.has(entry.recipientId)) {
              context.addIssue({
                code: "custom",
                path: [index, "recipientId"],
                message: "provider action recipe recipients must be unique",
              });
            }
            seen.add(entry.recipientId);
          }
        })
        .optional(),
      scrollStates: z
        .array(providerScrollState)
        .max(limits.maxNodes)
        .superRefine((entries, context) => {
          const seen = new Set<string>();
          for (const [index, entry] of entries.entries()) {
            if (seen.has(entry.recipientId)) {
              context.addIssue({
                code: "custom",
                path: [index, "recipientId"],
                message: "provider scroll recipients must be unique",
              });
            }
            seen.add(entry.recipientId);
          }
        })
        .optional(),
      hitGrid: hitGrid.optional(),
    }),
    z.strictObject({
      providerId: text.refine(
        (value) => value.length > 0,
        "provider id must not be empty",
      ),
      sessionId: text.refine(
        (value) => value.length > 0,
        "provider session id must not be empty",
      ),
      revision: positiveInt(),
      status: z.literal("lost"),
      reason: text.refine(
        (value) => value.length > 0,
        "provider loss reason must not be empty",
      ),
    }),
    z.strictObject({
      providerId: text.refine(
        (value) => value.length > 0,
        "provider id must not be empty",
      ),
      sessionId: text.refine(
        (value) => value.length > 0,
        "provider session id must not be empty",
      ),
      revision: positiveInt(),
      status: z.literal("violation"),
      reason: text.refine(
        (value) => value.length > 0,
        "provider violation reason must not be empty",
      ),
    }),
  ]);
  const snapshotV2 = z.strictObject({
    v: z.literal(2),
    sessionId: text.refine((s) => s.length > 0, "sessionId must not be empty"),
    revision: positiveInt(),
    columns: positiveInt(),
    rows: positiveInt(),
    cursor: cursor.optional(),
    rootIds: z.array(text).max(limits.maxNodes),
    nodes: z.array(nodeV2).max(limits.maxNodes),
    coordinateSpace: observation(
      z.enum(["viewport-cells", "framework-local-cells"]),
    ),
    hitGrid: observation(hitGrid),
    providerEvidence: z.array(providerEvidence).max(64).optional(),
  });
  const snapshot = snapshotV2;

  return {
    text,
    node: nodeV2,
    cursor,
    snapshot,
    nodeKeys: Object.freeze(Object.keys(nodeV2.shape)),
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
