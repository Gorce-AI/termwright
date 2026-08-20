/**
 * Node entry: `node --import @termwright/probe-opentui/node-hook app.js`.
 *
 * Two APIs can install a module hook and they do not cover the same ground:
 *
 * - `module.registerHooks` is synchronous and in-thread, and also covers CJS.
 *   Measured present on Node 22.22.0 and 24.1.0, **absent on 22.9.0** — our
 *   `engines` say `>= 22`, so it cannot be assumed.
 * - `module.register` runs hooks on a loader thread and exists across the whole
 *   supported range. It is the fallback rather than the default because the
 *   synchronous API also covers CJS and avoids cross-thread hook state.
 *
 * Both were verified to replace a bare `import('@opentui/core')` with the shim.
 */

import * as nodeModule from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildShimSource, shouldShim } from './shim.js';
import { isInstrumented } from './runtime.js';
import { bootstrap } from './bootstrap.js';

type LoadResult = { format?: string | null; source?: string | ArrayBufferView | undefined; shortCircuit?: boolean };
type NextLoad = (url: string, context: unknown) => LoadResult;

/** The `load` hook, shared by both installation paths. */
function load(url: string, context: unknown, nextLoad: NextLoad): LoadResult {
  if (!shouldShim(url)) return nextLoad(url, context);
  return { format: 'module', shortCircuit: true, source: buildShimSource(url) };
}

/**
 * Install the interception.
 *
 * @returns how it was installed, or `null` when the process is not
 * instrumented and nothing was touched.
 */
export function installNodeHook(env: NodeJS.ProcessEnv = process.env): 'sync' | 'thread' | null {
  if (!isInstrumented(env)) return null;

  // Do not named-import `registerHooks`: early Node 22 does not export it and
  // would fail module instantiation before this compatibility check ran.
  const registerHooks = (nodeModule as typeof nodeModule & {
    readonly registerHooks?: (hooks: { load: never }) => unknown;
  }).registerHooks;
  if (typeof registerHooks === 'function') {
    registerHooks({ load: load as never });
    return 'sync';
  }

  // Older Node 22: the off-thread loader is the only option. It needs its own
  // module file, which is this same file re-entered through `--import`.
  nodeModule.register(new URL(import.meta.url), { parentURL: new URL(import.meta.url) });
  return 'thread';
}

/** Async `load` export, used when this module is registered as a loader. */
export async function loadHook(
  url: string,
  context: unknown,
  nextLoad: (url: string, context: unknown) => Promise<LoadResult>,
): Promise<LoadResult> {
  if (!shouldShim(url)) return nextLoad(url, context);
  return { format: 'module', shortCircuit: true, source: buildShimSource(url) };
}

export { loadHook as load };

/** Path of this module, for a launcher building `--import`. */
export const NODE_HOOK_PATH = fileURLToPath(import.meta.url);

installNodeHook();
bootstrap();
