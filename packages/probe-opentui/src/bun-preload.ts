/**
 * Bun entry: `bun --preload @termwright/probe-opentui/bun-preload app.ts`.
 *
 * Three traps, all measured against Bun 1.2.15 and none of them obvious from
 * the documentation:
 *
 * - the flag must sit **before** the entry file; `bun --preload X run app.ts`
 *   is rejected as a usage error, while `bun --preload X app.ts` works;
 * - `BUN_PRELOAD` as an environment variable does nothing — it has to be argv;
 * - `onResolve` filtered on the bare specifier never fires. The filter has to
 *   match the **resolved path**, which is what `onLoad` receives.
 *
 * The query marker the shim appends is also what keeps `onLoad` from matching
 * its own output, since the pattern is anchored on the filename.
 */

import { buildShimSource, shouldShim, OPENTUI_ENTRY_PATTERN } from './shim.js';
import { certifyOpenTuiEntry } from './certification.js';
import { isInstrumented } from './runtime.js';
import { bootstrap } from './bootstrap.js';

interface BunPluginBuild {
  onLoad(
    options: { filter: RegExp },
    callback: (args: { path: string }) => Promise<{ loader: string; contents: string } | undefined>,
  ): void;
}

interface BunGlobal {
  plugin(definition: { name: string; setup(build: BunPluginBuild): void }): void;
}

/**
 * Install the interception.
 *
 * @returns `true` when a plugin was registered, `false` when the process is not
 * instrumented or is not running under Bun.
 */
export function installBunPreload(env: Record<string, string | undefined> = process.env): boolean {
  if (!isInstrumented(env)) return false;
  const bun = (globalThis as { Bun?: BunGlobal }).Bun;
  if (bun === undefined) return false;

  bun.plugin({
    name: 'termwright-opentui',
    setup(build) {
      build.onLoad({ filter: OPENTUI_ENTRY_PATTERN }, async (args) => {
        if (!shouldShim(args.path)) return undefined;
        const certification = certifyOpenTuiEntry(args.path, env);
        return certification === undefined
          ? undefined
          : { loader: 'js', contents: buildShimSource(args.path, certification) };
      });
    },
  });
  return true;
}

installBunPreload();
bootstrap();
