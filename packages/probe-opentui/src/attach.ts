/**
 * The seam between the shim and the probe.
 *
 * The shim runs inside a module the application imported, so it cannot import
 * anything of ours — it reaches the probe through one global function instead.
 * Keeping that contract in one file means the string is written twice, here and
 * in `shim.ts`, rather than scattered.
 */

/** Name of the global the shim calls when a renderer is created. */
export const RENDERER_HOOK = '__termwright_onRenderer';

/** Name of the global the shim calls to amend the config before creation. */
export const CONFIG_HOOK = '__termwright_onConfig';

/** Minimal shape the probe needs; the real type lives in `@opentui/core`. */
export type ObservedRenderer = object;

/**
 * Register the callback that may amend a renderer config before it is built.
 *
 * Returning a new config replaces the application's; returning nothing leaves
 * it alone. This is the only point at which a custom stdout can be installed,
 * and without one the frame bytes never reach JS at all — they are written by
 * a Zig thread (see NOTES).
 *
 * @returns a disposer that removes the hook again.
 */
export function onRendererConfig(
  handler: (config: Record<string, unknown>) => Record<string, unknown> | undefined,
): () => void {
  const scope = globalThis as Record<string, unknown>;
  const previous = scope[CONFIG_HOOK];
  scope[CONFIG_HOOK] = handler;
  return () => {
    if (scope[CONFIG_HOOK] === handler) scope[CONFIG_HOOK] = previous;
  };
}

/**
 * Register the callback the shim invokes for every renderer the application
 * creates.
 *
 * @returns a disposer that removes the hook again.
 */
export function onRendererCreated(handler: (renderer: ObservedRenderer) => void): () => void {
  const scope = globalThis as Record<string, unknown>;
  const previous = scope[RENDERER_HOOK];
  scope[RENDERER_HOOK] = handler;
  return () => {
    if (scope[RENDERER_HOOK] === handler) scope[RENDERER_HOOK] = previous;
  };
}
