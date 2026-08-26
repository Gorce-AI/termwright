/**
 * Which pseudo-terminal a session gets.
 *
 * Every supported platform has exactly one Termwright-owned native backend.
 *
 * A quiet substitution would hand the caller a boundary that looks identical
 * and means something weaker, so a missing native capability fails closed.
 */

import { createNativePtyBackend, type NativePtySpawn } from './native-pty-backend.js';
import { PtyBackendError } from './errors.js';
import type { PtyBackend } from './pty.js';

export interface PtyBackendChoice {
  readonly backend: PtyBackend;
  /**
   * Retained for callers that report on the choice. Every supported platform
   * now has exactly one backend, so nothing sets it; a future platform with a
   * weaker second implementation would.
   */
  readonly degradedReason?: string;
}

/**
 * The failure a machine sees when its backend cannot be loaded.
 *
 * Typed like every other backend failure, so a caller can tell this apart from
 * an ordinary error, and carrying the empty diagnostics an error raised before
 * any session exists honestly has: there is no screen to excerpt and no tree
 * to report.
 */
function backendUnavailable(message: string): PtyBackendError {
  return new PtyBackendError(message, { semanticTree: false }, undefined);
}

let cached: Promise<PtyBackendChoice> | undefined;

/** Forgets the cached choice. Tests that change the platform need this. */
export function resetPtyBackendChoice(): void {
  cached = undefined;
}

/**
 * Loads the native backend for the active platform, or explains what stopped it.
 *
 * Split out so the failure has one shape. An addon that was never built and an
 * addon that cannot be loaded on this machine are both "no native backend
 * here", and the difference belongs in the message rather than in the control
 * flow of the caller.
 */
async function loadNativeBackend(platform: NodeJS.Platform): Promise<PtyBackendChoice> {
  let module_: {
    ptyAvailable(): boolean;
    ptyUnavailableReason?(): string | undefined;
    spawnPty: NativePtySpawn;
  };
  try {
    module_ = (await import('@termwright/pty')) as typeof module_;
  } catch (error) {
    throw backendUnavailable(
      '@termwright/pty is not installed, so this machine has no pseudo-terminal backend: ' +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!module_.ptyAvailable()) {
    throw backendUnavailable(
      `the Termwright PTY addon did not load for ${platform}-${process.arch}: ` +
        `${module_.ptyUnavailableReason?.() ?? 'no reason reported'}`,
    );
  }
  return { backend: createNativePtyBackend(module_.spawnPty, platform) };
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
  cached ??= loadNativeBackend(platform);
  return cached;
}
