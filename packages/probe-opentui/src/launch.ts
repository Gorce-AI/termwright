/**
 * Building the command that launches an application with the probe attached.
 *
 * This is the whole of "zero-config" from the application's side: the argv it
 * would have been started with, plus one flag. Nothing is written into the
 * project, no config file is required, and the application's own source is
 * untouched.
 *
 * The caller — a driver launch, a test harness — composes the command. This
 * package deliberately does not spawn anything, so nothing that depends on the
 * driver has to depend on a probe.
 */

import { fileURLToPath } from 'node:url';
import type { ProbeRuntime } from './runtime.js';

/** Resolved entry points, so a launcher never has to guess a path. */
export const PROBE_ENTRIES = {
  bun: fileURLToPath(new URL('./bun-preload.js', import.meta.url)),
  node: fileURLToPath(new URL('./node-hook.js', import.meta.url)),
} as const;

/** A command, split the way `launchTerminal` wants it. */
export interface ProbeCommand {
  readonly command: readonly string[];
  readonly runtime: ProbeRuntime;
}

/**
 * Prefix an application's argv with the injection flag for its runtime.
 *
 * @param runtime - `bun` or `node`.
 * @param argv - The application's own command, interpreter first, e.g.
 * `['bun', 'app.ts']`.
 * @returns the same command with the probe attached.
 *
 * @remarks
 * For Bun the flag goes immediately after the interpreter and **before** the
 * entry, because `bun --preload X run app.ts` is a usage error while
 * `bun --preload X app.ts` is not. For Node, `--import` is used rather than
 * `--require`: the probe is ESM, and `--import` is what runs it before the
 * application's first module.
 *
 * @example
 * ```ts
 * const {command} = withProbe('bun', ['bun', 'app.ts']);
 * // ['bun', '--preload', '/…/bun-preload.js', 'app.ts']
 * ```
 */
export function withProbe(runtime: ProbeRuntime, argv: readonly string[]): ProbeCommand {
  if (argv.length === 0) {
    throw new Error('withProbe needs at least an interpreter in argv');
  }
  const [interpreter, ...rest] = argv as [string, ...string[]];
  const flag = runtime === 'bun' ? '--preload' : '--import';
  return { command: [interpreter, flag, PROBE_ENTRIES[runtime], ...rest], runtime };
}
