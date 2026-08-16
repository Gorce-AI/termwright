/**
 * Validation for Probe IR frames.
 *
 * Same discipline as the semantic tree: project into a frozen plain DTO first
 * so a getter on hostile input is rejected without running, then measure
 * against the byte ceiling, then check the shape. A probe runs inside the
 * process under test, which may be broken or malicious, so this is a hostile
 * boundary in exactly the way the adapter channel is.
 */

import { Buffer } from 'node:buffer';
import { z } from 'zod';
import type { ProtocolLimits } from '../limits.js';
import type { ValidationErrorCode } from '../validate.js';
import { ProtocolViolation } from '../errors.js';
import { projectDto } from '../framing.js';
import {
  PROBE_CAPABILITIES,
  PROBE_UNOBSERVABLE_FIELDS,
  type ProbeFrame,
  type ProbeInfo,
} from './ir.js';

/** Structured result: never throws hostile data onward. */
export type ProbeValidationResult =
  | { readonly ok: true; readonly frame: ProbeFrame }
  | { readonly ok: false; readonly code: ValidationErrorCode; readonly detail: string };

function fail(code: ValidationErrorCode, detail: string): ProbeValidationResult {
  return { ok: false, code, detail };
}

const safeInt = z.number().refine(Number.isSafeInteger, 'expected a safe integer');
const nonNegative = z
  .number()
  .refine((n) => Number.isSafeInteger(n) && n >= 0, 'expected a non-negative safe integer');
const positive = z
  .number()
  .refine((n) => Number.isSafeInteger(n) && n > 0, 'expected a positive safe integer');

const cache = new WeakMap<ProtocolLimits, z.ZodType>();

function buildFrameSchema(limits: ProtocolLimits): z.ZodType {
  const text = z
    .string()
    .refine(
      (s) => Buffer.byteLength(s, 'utf8') <= limits.maxStringBytes,
      `expected at most ${limits.maxStringBytes} UTF-8 bytes`,
    );

  const rect = z.strictObject({
    row: safeInt,
    column: safeInt,
    width: nonNegative,
    height: nonNegative,
  });

  const identity = z.strictObject({
    kind: z.enum(['stable', 'frame-local']),
    value: text.min(1),
  });

  const state = z.strictObject({
    focused: z.boolean().optional(),
    disabled: z.boolean().optional(),
    checked: z.union([z.boolean(), z.literal('mixed')]).optional(),
    expanded: z.boolean().optional(),
    readonly: z.boolean().optional(),
    displayed: z.boolean().optional(),
    value: text.optional(),
    selectedIndex: nonNegative.optional(),
    textSelection: z.strictObject({ start: nonNegative, end: nonNegative }).optional(),
    scroll: z.strictObject({ row: nonNegative, column: nonNegative }).optional(),
    scrollExtent: z.strictObject({ rows: nonNegative, columns: nonNegative }).optional(),
  });

  const object = z.strictObject({
    identity,
    frameworkType: text.min(1),
    parent: text.optional(),
    geometry: z
      .strictObject({ intendedRect: rect.optional(), visibleRect: rect.optional() })
      .optional(),
    state: state.optional(),
    text: text.optional(),
    annotations: z
      .strictObject({
        role: text.optional(),
        name: text.optional(),
        testId: text.optional(),
        description: text.optional(),
      })
      .optional(),
    paintOrder: safeInt.optional(),
    unobservable: z
      .array(z.enum(PROBE_UNOBSERVABLE_FIELDS))
      .max(PROBE_UNOBSERVABLE_FIELDS.length)
      .optional(),
  });

  const operation = z.strictObject({
    kind: z.enum(['render', 'layout']),
    ordinal: nonNegative,
    target: identity.optional(),
    frameworkType: text.optional(),
    intendedRect: rect.optional(),
  });

  return z.strictObject({
    frame: positive,
    objects: z.array(object).max(limits.maxNodes),
    operations: z.array(operation).max(limits.maxNodes).optional(),
  });
}

function frameSchema(limits: ProtocolLimits): z.ZodType {
  const cached = cache.get(limits);
  if (cached !== undefined) return cached;
  const built = buildFrameSchema(limits);
  cache.set(limits, built);
  return built;
}

/** Schema for the handshake block a probe sends about itself. */
export const probeInfoSchema = z.strictObject({
  framework: z.string().min(1).max(128),
  frameworkVersion: z.string().max(128).optional(),
  probeVersion: z.string().min(1).max(128),
  identityKind: z.enum(['stable', 'frame-local']),
  capabilities: z.array(z.enum(PROBE_CAPABILITIES)).max(PROBE_CAPABILITIES.length),
});

/**
 * Validate a probe's self-description.
 *
 * Enforces the one consistency rule the pair has: a probe may not claim the
 * `stable-identity` capability while declaring `identityKind: 'frame-local'`.
 * Those two together would tell a consumer it is safe to correlate objects
 * across frames in a framework where nothing survives the frame.
 */
export function validateProbeInfo(
  value: unknown,
): { readonly ok: true; readonly info: ProbeInfo } | { readonly ok: false; readonly detail: string } {
  const parsed = probeInfoSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const where = issue.path.length > 0 ? issue.path.map(String).join('.') : '<root>';
    return { ok: false, detail: `${where}: ${issue.message}` };
  }
  const info = parsed.data as ProbeInfo;
  if (info.identityKind === 'frame-local' && info.capabilities.includes('stable-identity')) {
    return {
      ok: false,
      detail:
        "a probe declaring identityKind 'frame-local' must not claim the 'stable-identity' " +
        'capability: nothing in an immediate-mode frame survives to be correlated',
    };
  }
  return { ok: true, info: Object.freeze(info) };
}

/**
 * Validate an untrusted probe frame.
 *
 * Beyond the shape, three cross-object rules are checked, each of them a way an
 * IR frame can be internally inconsistent rather than merely malformed:
 * identities must be unique within the frame, a declared parent must exist in
 * the same frame, and a field cannot be both reported and declared
 * unobservable.
 *
 * @param value - Untrusted candidate frame.
 * @param limits - Active limits; `maxNodes`, `maxStringBytes` and
 * `maxSnapshotBytes` apply.
 * @returns `{ ok: true, frame }` deep-frozen, or a typed failure. Never throws.
 */
export function validateProbeFrame(
  value: unknown,
  limits: ProtocolLimits,
): ProbeValidationResult {
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
  if (serialised === undefined) return fail('schema', 'probe frame is not a JSON object');
  const bytes = Buffer.byteLength(serialised, 'utf8');
  if (bytes > limits.maxSnapshotBytes) {
    return fail('bytes', `probe frame is ${bytes} bytes, ceiling is ${limits.maxSnapshotBytes}`);
  }

  const parsed = frameSchema(limits).safeParse(projected);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const path = issue.path.map(String);
    const where = path.length > 0 ? path.join('.') : '<root>';
    const code: ValidationErrorCode = path.includes('intendedRect') || path.includes('visibleRect')
      ? 'bad-rect'
      : path.includes('frame')
        ? 'revision'
        : issue.code === 'too_big'
          ? 'count'
          : 'schema';
    return fail(code, `${where}: ${issue.message}`);
  }

  const frame = projected as ProbeFrame;

  const seen = new Set<string>();
  for (const object of frame.objects) {
    if (seen.has(object.identity.value)) {
      return fail('duplicate-id', `identity ${object.identity.value} appears twice in the frame`);
    }
    seen.add(object.identity.value);
  }

  for (const object of frame.objects) {
    if (object.parent !== undefined && !seen.has(object.parent)) {
      return fail(
        'missing-parent',
        `object ${object.identity.value} names parent ${object.parent}, which is not in the frame`,
      );
    }
    if (object.parent === object.identity.value) {
      return fail('cycle', `object ${object.identity.value} is its own parent`);
    }

    const unobservable = object.unobservable;
    if (unobservable === undefined) continue;
    const declared = new Set<string>(unobservable);
    if (declared.size !== unobservable.length) {
      return fail('duplicate-id', `object ${object.identity.value} repeats an unobservable field`);
    }
    // Reporting a value while calling the field unobservable is a contradiction,
    // and the whole point of the three-valued model is that it cannot happen.
    for (const [field, present] of [
      ['text', object.text !== undefined],
      ['parent', object.parent !== undefined],
      ['intendedRect', object.geometry?.intendedRect !== undefined],
      ['visibleRect', object.geometry?.visibleRect !== undefined],
      ['paintOrder', object.paintOrder !== undefined],
    ] as const) {
      if (declared.has(field) && present) {
        return fail(
          'schema',
          `object ${object.identity.value} reports ${field} and also declares it unobservable`,
        );
      }
    }
    for (const [field, value_] of Object.entries(object.state ?? {})) {
      if (declared.has(field) && value_ !== undefined) {
        return fail(
          'schema',
          `object ${object.identity.value} reports state.${field} and also declares it unobservable`,
        );
      }
    }
  }

  return { ok: true, frame };
}
