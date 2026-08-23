/**
 * Which pseudo-terminal a session gets, and why.
 *
 * On Windows there are two implementations and they do not offer the same
 * guarantees, so the choice is recorded rather than made quietly. The native
 * backend ends its stream when the pipe ends; the node-pty path ends it when a
 * one-second flush window elapses, which is a heuristic wearing the clothes of
 * a boundary. A session that runs on the second one should be able to say so.
 *
 * This is a migration state, not a design. The fallback exists because the
 * native addon is not yet distributed as a prebuild, so a Windows machine
 * without a toolchain has to run on something. It goes away with packaging.
 */

import { createConPtyBackend, type ConPtySpawn } from './conpty-backend.js';
import { createNodePtyBackend, type PtyBackend } from './pty.js';

export interface PtyBackendChoice {
  readonly backend: PtyBackend;
  /**
   * Why this backend and not the other, in a sentence a report can carry.
   * `undefined` when the choice was the platform's only one and needs no
   * explanation.
   */
  readonly degradedReason?: string;
}

let cached: Promise<PtyBackendChoice> | undefined;

/** Forgets the cached choice. Tests that change the platform need this. */
export function resetPtyBackendChoice(): void {
  cached = undefined;
}

/**
 * Loads the native Windows backend, or explains what stopped it.
 *
 * Split out so the failure has one shape. An addon that was never built and an
 * addon that cannot be loaded on this machine are both "no native backend
 * here", and the difference belongs in the message rather than in the control
 * flow of the caller.
 */
async function loadNativeWindowsBackend(): Promise<PtyBackendChoice> {
  try {
    const module_ = (await import('@termwright/conpty')) as {
      conPtyAvailable(): boolean;
      spawnConPty: ConPtySpawn;
    };
    if (!module_.conPtyAvailable()) {
      return {
        backend: createNodePtyBackend(),
        degradedReason:
          '@termwright/conpty is present but its native addon is not built for this Node ABI; ' +
          'output ends on a bounded flush window rather than on the pipe',
      };
    }
    return { backend: createConPtyBackend(module_.spawnConPty) };
  } catch (error) {
    return {
      backend: createNodePtyBackend(),
      degradedReason:
        `@termwright/conpty could not be loaded (${error instanceof Error ? error.message : String(error)}); ` +
        'output ends on a bounded flush window rather than on the pipe',
    };
  }
}

/**
 * The backend a session uses when its caller did not supply one.
 *
 * Resolved once per process: the answer depends on the machine, not on the
 * session, and probing a native module for every terminal would be a cost paid
 * repeatedly for a constant.
 */
export function resolveDefaultPtyBackend(
  platform: NodeJS.Platform = process.platform,
): Promise<PtyBackendChoice> {
  cached ??= platform === 'win32'
    ? loadNativeWindowsBackend()
    : Promise.resolve({ backend: createNodePtyBackend() });
  return cached;
}
