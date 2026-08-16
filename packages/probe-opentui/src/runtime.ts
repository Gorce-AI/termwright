/**
 * Deciding whether to instrument at all, and how to phrase it for a runtime.
 *
 * The dormant rule from the adapters applies unchanged: with no endpoint and no
 * token in the environment the probe installs nothing — no module hook, no
 * global, no allocation. The launcher already knows not to inject in that case;
 * this is the second guard, for a preload script that ends up somewhere it was
 * not meant to be.
 */

import { ENV_ENDPOINT, ENV_TOKEN } from '@termwright/protocol';

/** Runtimes the probe can be injected into. */
export type ProbeRuntime = 'bun' | 'node';

/** Read-only view of an environment, so tests never mutate the real one. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/** Whether this process was launched with instrumentation. */
export function isInstrumented(env: EnvSource): boolean {
  const endpoint = env[ENV_ENDPOINT];
  const token = env[ENV_TOKEN];
  return typeof endpoint === 'string' && endpoint.length > 0
    && typeof token === 'string' && token.length > 0;
}

/**
 * Which runtime is executing this process.
 *
 * Bun is detected by its own global rather than by argv, because a Bun process
 * started through a shim or a package script still has to be recognised.
 */
export function detectRuntime(): ProbeRuntime {
  return (globalThis as { Bun?: unknown }).Bun === undefined ? 'node' : 'bun';
}
