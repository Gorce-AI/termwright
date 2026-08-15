/**
 * Environment probing for the **dormant rule** (design §4.1).
 *
 * Without a complete, well-formed instrumentation environment the adapter must
 * open nothing, allocate nothing and emit nothing: an instrumented build of an
 * application has to produce byte-for-byte identical output to an
 * uninstrumented one. Every activation decision funnels through
 * {@link readAdapterEnv}; there is no other switch.
 */

import { ENV_ENDPOINT, ENV_PROTOCOL, ENV_TOKEN, PROTOCOL_VERSION } from '@termwright/protocol';

/** Resolved instrumentation environment. Present only when the driver injected one. */
export interface AdapterEnv {
  /** Unix socket path (POSIX) or named pipe path (Windows). Never a TCP address. */
  readonly endpoint: string;
  /** 256-bit shared secret, used for the handshake and for marker MACs. */
  readonly token: string;
}

/** Minimal read-only view of `process.env`, so tests never mutate the real one. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Read the instrumentation environment.
 *
 * @returns the resolved environment, or `null` when the process is not
 * instrumented — in which case the adapter stays fully dormant.
 *
 * `TERMWRIGHT_PROTOCOL` is optional; when present it must name a major version
 * this adapter speaks, otherwise the process is treated as uninstrumented
 * (fail closed rather than negotiate an unknown dialect).
 *
 * @example
 * ```ts
 * const env = readAdapterEnv(process.env);
 * if (env === null) return; // dormant: no socket, no tree, no marker
 * ```
 */
export function readAdapterEnv(source: EnvSource): AdapterEnv | null {
  const endpoint = source[ENV_ENDPOINT];
  const token = source[ENV_TOKEN];
  if (typeof endpoint !== 'string' || endpoint.length === 0) return null;
  if (typeof token !== 'string' || token.length === 0) return null;

  const declared = source[ENV_PROTOCOL];
  if (declared !== undefined && declared !== String(PROTOCOL_VERSION)) return null;

  return { endpoint, token };
}
