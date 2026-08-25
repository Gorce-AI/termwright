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

/** Name of the global notified when renderer construction rejects. */
export const RENDERER_FAILURE_HOOK = '__termwright_onRendererFailure';

/** Name of the process-local ownership predicate used by the structural transform. */
export const OUTPUT_SINK_HOOK = '__termwright_isOpenTuiOutputSink';

/** Minimal shape the probe needs; the real type lives in `@opentui/core`. */
export type ObservedRenderer = object;

export interface ObservedRuntimeCertification {
  readonly version: string;
  readonly source: 'builtin' | 'candidate';
  readonly candidateDigest?: string;
  readonly sourceRevision?: string;
}

/** Register the callback that may amend renderer config before construction. */
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
export function onRendererCreated(
  handler: (
    renderer: ObservedRenderer,
    certification: ObservedRuntimeCertification,
    effectiveConfig: Record<string, unknown>,
  ) => void,
): () => void {
  const scope = globalThis as Record<string, unknown>;
  const previous = scope[RENDERER_HOOK];
  scope[RENDERER_HOOK] = handler;
  return () => {
    if (scope[RENDERER_HOOK] === handler) scope[RENDERER_HOOK] = previous;
  };
}

/** Register cleanup for per-construction resources when OpenTUI rejects. */
export function onRendererCreationFailed(
  handler: (effectiveConfig: Record<string, unknown>) => void,
): () => void {
  const scope = globalThis as Record<string, unknown>;
  const previous = scope[RENDERER_FAILURE_HOOK];
  scope[RENDERER_FAILURE_HOOK] = handler;
  return () => {
    if (scope[RENDERER_FAILURE_HOOK] === handler) scope[RENDERER_FAILURE_HOOK] = previous;
  };
}

/** Register identity-based ownership certification for injected stdout sinks. */
export function onOutputSinkCheck(handler: (value: unknown) => boolean): () => void {
  const scope = globalThis as Record<string, unknown>;
  const previous = scope[OUTPUT_SINK_HOOK];
  scope[OUTPUT_SINK_HOOK] = handler;
  return () => {
    if (scope[OUTPUT_SINK_HOOK] === handler) scope[OUTPUT_SINK_HOOK] = previous;
  };
}
