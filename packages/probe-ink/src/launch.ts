/** Build an application command with the zero-config Ink preload attached. */

import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ProbeRuntime } from './runtime.js';

/** Published preload paths; callers never have to guess package layout. */
export const PROBE_ENTRIES = {
  bun: fileURLToPath(new URL('./bun-preload.js', import.meta.url)),
  node: fileURLToPath(new URL('./node-hook.js', import.meta.url)),
} as const;

export interface ProbeCommand {
  readonly command: readonly string[];
  readonly runtime: ProbeRuntime;
}

/** Prefix a normal Node or Bun command with the matching preload flag. */
export function withProbe(runtime: ProbeRuntime, argv: readonly string[]): ProbeCommand {
  if (argv.length === 0) throw new Error('withProbe needs an interpreter in argv');
  const [interpreter, ...rest] = argv as [string, ...string[]];
  const flag = runtime === 'bun' ? '--preload' : '--import';
  return {
    command: [
      interpreter,
      flag,
      runtimePreloadSpecifier(runtime, PROBE_ENTRIES[runtime]),
      ...rest,
    ],
    runtime,
  };
}

/** Node needs a file URL on Windows; Bun's Windows preload resolver needs a native path. */
export function runtimePreloadSpecifier(runtime: ProbeRuntime, entry: string): string {
  return runtime === 'bun' ? entry : pathToFileURL(entry).href;
}
