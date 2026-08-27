/** Node entry: `node --import @termwright/probe-ink/node-hook app.js`. */

import * as nodeModule from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildShimSource, shouldShim } from './shim.js';
import {
  instrumentInkCore,
  instrumentInkRenderer,
  INK_CORE_PATTERN,
  INK_RENDERER_PATTERN,
} from './instrumentation.js';
import { isInstrumented } from './runtime.js';

type LoadResult = {
  format?: string | null;
  source?: string | ArrayBufferView | undefined;
  shortCircuit?: boolean;
};
type NextLoad = (url: string, context: unknown) => LoadResult;

function loadWithInstrumentation(url: string, context: unknown, nextLoad: NextLoad): LoadResult {
  if (shouldShim(url))
    return { format: 'module', shortCircuit: true, source: buildShimSource(url) };
  const loaded = nextLoad(url, context);
  const path = url.split('?')[0] ?? '';
  if (!INK_RENDERER_PATTERN.test(path) && !INK_CORE_PATTERN.test(path)) return loaded;
  const source = sourceText(loaded.source);
  const instrumented =
    source === undefined
      ? undefined
      : INK_RENDERER_PATTERN.test(path)
        ? instrumentInkRenderer(url, source)
        : instrumentInkCore(url, source);
  return instrumented === undefined
    ? loaded
    : { ...loaded, format: 'module', shortCircuit: true, source: instrumented };
}

function sourceText(source: LoadResult['source']): string | undefined {
  if (typeof source === 'string') return source;
  if (source === undefined) return undefined;
  return Buffer.from(source.buffer, source.byteOffset, source.byteLength).toString('utf8');
}

/** Install the best loader API available on the current Node 22+ release. */
export function installNodeHook(env: NodeJS.ProcessEnv = process.env): 'sync' | 'thread' | null {
  if (!isInstrumented(env)) return null;
  // A named ESM import of `registerHooks` makes early Node 22 fail while
  // instantiating this module, before a feature check can run. Namespace access
  // is the compatibility boundary: 22.9 simply yields `undefined`.
  const registerHooks = (
    nodeModule as typeof nodeModule & {
      readonly registerHooks?: (hooks: { load: never }) => unknown;
    }
  ).registerHooks;
  if (typeof registerHooks === 'function') {
    registerHooks({ load: loadWithInstrumentation as never });
    return 'sync';
  }
  nodeModule.register(new URL(import.meta.url), { parentURL: new URL(import.meta.url) });
  return 'thread';
}

/** Off-thread loader export for early Node 22 releases. */
export async function loadHook(
  url: string,
  context: unknown,
  nextLoad: (url: string, context: unknown) => Promise<LoadResult>,
): Promise<LoadResult> {
  if (shouldShim(url))
    return { format: 'module', shortCircuit: true, source: buildShimSource(url) };
  const loaded = await nextLoad(url, context);
  const path = url.split('?')[0] ?? '';
  if (!INK_RENDERER_PATTERN.test(path) && !INK_CORE_PATTERN.test(path)) return loaded;
  const source = sourceText(loaded.source);
  const instrumented =
    source === undefined
      ? undefined
      : INK_RENDERER_PATTERN.test(path)
        ? instrumentInkRenderer(url, source)
        : instrumentInkCore(url, source);
  return instrumented === undefined
    ? loaded
    : { ...loaded, format: 'module', shortCircuit: true, source: instrumented };
}

export { loadHook as load };
export const NODE_HOOK_PATH = fileURLToPath(import.meta.url);

installNodeHook();
