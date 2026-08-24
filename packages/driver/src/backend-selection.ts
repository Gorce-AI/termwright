/**
 * Which pseudo-terminal a session gets.
 *
 * Windows has one, and it is the native backend. There was a fallback while
 * the addon had to be compiled locally, and prebuilds removed the reason for
 * it: both architectures Windows runs on ship a binary, so a machine that
 * cannot load one has something wrong with its installation rather than an
 * unsupported toolchain.
 *
 * Falling back would be worse than failing. The two implementations do not
 * offer the same guarantee — the native one ends its stream when the pipe
 * ends, node-pty's Windows path ends it when a flush window elapses — so a
 * quiet substitution hands the caller a boundary that looks identical and
 * means something weaker. This raises instead, with what it tried.
 */

import { createConPtyBackend, type ConPtySpawn } from './conpty-backend.js';
import { PtyBackendError } from './errors.js';
import { createNodePtyBackend, type PtyBackend } from './pty.js';

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
 * Loads the native Windows backend, or explains what stopped it.
 *
 * Split out so the failure has one shape. An addon that was never built and an
 * addon that cannot be loaded on this machine are both "no native backend
 * here", and the difference belongs in the message rather than in the control
 * flow of the caller.
 */
async function loadNativeWindowsBackend(): Promise<PtyBackendChoice> {
  let module_: {
    conPtyAvailable(): boolean;
    conPtyUnavailableReason?(): string | undefined;
    spawnConPty: ConPtySpawn;
  };
  try {
    module_ = (await import('@termwright/conpty')) as typeof module_;
  } catch (error) {
    throw backendUnavailable(
      '@termwright/conpty is not installed, so this Windows machine has no pseudo-terminal backend: ' +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!module_.conPtyAvailable()) {
    throw backendUnavailable(
      'the termwright ConPTY addon did not load, so this Windows machine has no pseudo-terminal ' +
        `backend: ${module_.conPtyUnavailableReason?.() ?? 'no reason reported'}`,
    );
  }
  return { backend: createConPtyBackend(module_.spawnConPty) };
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
