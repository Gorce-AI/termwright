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
import { readFile } from 'node:fs/promises';
import { instrumentOpenTuiChunk, OPENTUI_CHUNK_PATTERN } from './instrumentation.js';
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
        return { loader: 'js', contents: buildShimSource(args.path) };
      });
      build.onLoad({ filter: OPENTUI_CHUNK_PATTERN }, async (args) => {
        const source = await readFile(args.path, 'utf8');
        const contents = instrumentOpenTuiChunk(args.path, source);
        // Bun 1.2 treats `undefined` from a matching onLoad callback as an
        // invalid module mock. OpenTUI ships additional same-shaped chunks
        // which are deliberately outside the certified transform, so return
        // their exact bytes unchanged while still instrumenting the pinned
        // render chunk.
        return { loader: 'js', contents: contents ?? source };
      });
    },
  });
  return true;
}

installBunPreload();
bootstrap();
