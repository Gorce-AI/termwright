/** Tiny object helpers shared by the modules that build driver option objects. */

/**
 * Drops keys whose value is `undefined`.
 *
 * zod hands back objects where an absent optional key is present-and-undefined,
 * while the driver's option types are declared under
 * `exactOptionalPropertyTypes`. This is the one conversion between the two.
 */
export function definedOnly<T extends object>(value: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) out[key] = item;
  }
  return out as { [K in keyof T]?: Exclude<T[K], undefined> };
}

/**
 * The same properties, but optional ones may also be explicitly `undefined` —
 * the shape zod produces for `.optional()` fields.
 */
export type Loose<T> = { [K in keyof T]?: T[K] | undefined };
