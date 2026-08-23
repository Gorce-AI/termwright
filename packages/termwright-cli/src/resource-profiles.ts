import type { ResourceCapacities, ResourceVector } from '@termwright/resource-broker';

export interface TermwrightResourceProfile {
  readonly name: TermwrightResourceProfileName;
  readonly scheduler: {
    readonly pool: TermwrightPool;
    readonly maxWorkers: number;
    readonly fileParallelism: true;
  };
  readonly capacities: ResourceCapacities;
  readonly perTerminal: ResourceVector;
}

/**
 * Worker pool for the embedded engine.
 *
 * `forks` everywhere except Windows. Vitest's programmatic `forks` pool relies
 * on a SIGTERM handler in the child to shut down cleanly (a workaround for
 * nodejs/node#55094), and on Windows `child.kill()` maps to TerminateProcess,
 * so that handler never runs — vitest#9907, still open, reported for exactly
 * this configuration and confirmed upstream as a Node bug. The observed
 * symptom is the run finishing and then crashing on a closed IPC channel.
 * `threads` has no such handshake. The A/B pressure matrix covers both pools
 * against real PTYs, so this is a measured choice rather than a preference.
 */
export type TermwrightPool = 'forks' | 'threads';

/** Pools differ only in shutdown, so pick per platform, not per profile. */
const DEFAULT_POOL: TermwrightPool = process.platform === 'win32' ? 'threads' : 'forks';

export const TERMWRIGHT_RESOURCE_PROFILE_NAMES = [
  'local',
  'ci',
  'windows-ci',
  'stress',
] as const;

export type TermwrightResourceProfileName = typeof TERMWRIGHT_RESOURCE_PROFILE_NAMES[number];

export const TERMWRIGHT_RESOURCE_PROFILES: Readonly<Record<TermwrightResourceProfileName, TermwrightResourceProfile>> =
  Object.freeze({
    // Multi-terminal tests use test.resources() and are atomically admitted by
    // the exact runner before their Attempt budget starts. These defaults stay
    // conservative until the current Windows worker-pressure matrix is
    // certified; worker and terminal controls are nevertheless independent,
    // and stress is the explicit high-fan-out profile.
    // Terminal capacity is a ceiling on concurrently live terminals, not on
    // workers, and it must clear the largest atomic reservation any test
    // declares — a group larger than the ceiling can never be admitted. CI
    // keeps two workers but the same terminal headroom as a laptop, because
    // starving the ceiling does not make a small runner safer: it only turns
    // multi-terminal tests into timeouts.
    local: resourceProfile('local', 4, 4),
    ci: resourceProfile('ci', 4, 2),
    'windows-ci': resourceProfile('windows-ci', 4, 2),
    stress: resourceProfile('stress', 16, 16),
  });

export function isTermwrightResourceProfileName(value: string): value is TermwrightResourceProfileName {
  return (TERMWRIGHT_RESOURCE_PROFILE_NAMES as readonly string[]).includes(value);
}

function resourceProfile(name: TermwrightResourceProfileName, terminals: number, maxWorkers: number): TermwrightResourceProfile {
  return Object.freeze({
    name,
    scheduler: Object.freeze({ pool: DEFAULT_POOL, maxWorkers, fileParallelism: true }),
    capacities: Object.freeze({
      ptySession: terminals,
      externalProcess: terminals,
      semanticEndpoint: terminals,
      traceWriter: terminals,
    }),
    perTerminal: Object.freeze({ semanticEndpoint: 1 }),
  });
}
