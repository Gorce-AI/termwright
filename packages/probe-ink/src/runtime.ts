/** Runtime activation shared by the two preload entry points. */

import { ENV_ENDPOINT, ENV_TOKEN } from '@termwright/protocol';

/** Runtimes into which the Ink probe can be injected. */
export type ProbeRuntime = 'bun' | 'node';

/** Read-only environment view, so activation is testable without mutation. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/** Both secrets are required. A partial environment remains fully dormant. */
export function isInstrumented(env: EnvSource): boolean {
  const endpoint = env[ENV_ENDPOINT];
  const token = env[ENV_TOKEN];
  return typeof endpoint === 'string' && endpoint.length > 0
    && typeof token === 'string' && token.length > 0;
}
