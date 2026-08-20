/** Bun entry: `bun --preload @termwright/probe-ink/bun-preload app.js`. */

import { buildShimSource, INK_ENTRY_PATTERN, shouldShim } from './shim.js';
import { isInstrumented } from './runtime.js';

interface BunPluginBuild {
  onLoad(
    options: { filter: RegExp },
    callback: (args: { path: string }) => Promise<{ loader: string; contents: string } | undefined>,
  ): void;
}

interface BunGlobal {
  plugin(definition: { name: string; setup(build: BunPluginBuild): void }): void;
}

/** Register the Ink entry replacement before the application's first import. */
export function installBunPreload(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!isInstrumented(env)) return false;
  const bun = (globalThis as { Bun?: BunGlobal }).Bun;
  if (bun === undefined) return false;

  bun.plugin({
    name: 'termwright-ink',
    setup(build) {
      build.onLoad({ filter: INK_ENTRY_PATTERN }, async (args) => {
        if (!shouldShim(args.path)) return undefined;
        return { loader: 'js', contents: buildShimSource(args.path) };
      });
    },
  });
  return true;
}

installBunPreload();
