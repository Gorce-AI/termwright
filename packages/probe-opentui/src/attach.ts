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

/** Minimal shape the probe needs; the real type lives in `@opentui/core`. */
export type ObservedRenderer = object;

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
