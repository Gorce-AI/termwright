import type { ResourceCapacities, ResourceVector } from '@termwright/resource-broker';

export interface TermwrightResourceProfile {
  readonly name: TermwrightResourceProfileName;
  readonly scheduler: {
    readonly pool: 'forks';
    readonly maxWorkers: number;
    readonly fileParallelism: true;
  };
  readonly capacities: ResourceCapacities;
  readonly perTerminal: ResourceVector;
}

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
    local: resourceProfile('local', 4, 4),
    ci: resourceProfile('ci', 2, 2),
    'windows-ci': resourceProfile('windows-ci', 2, 2),
    stress: resourceProfile('stress', 16, 16),
  });

export function isTermwrightResourceProfileName(value: string): value is TermwrightResourceProfileName {
  return (TERMWRIGHT_RESOURCE_PROFILE_NAMES as readonly string[]).includes(value);
}

function resourceProfile(name: TermwrightResourceProfileName, terminals: number, maxWorkers: number): TermwrightResourceProfile {
  return Object.freeze({
    name,
    scheduler: Object.freeze({ pool: 'forks', maxWorkers, fileParallelism: true }),
    capacities: Object.freeze({
      ptySession: terminals,
      externalProcess: terminals,
      semanticEndpoint: terminals,
      traceWriter: terminals,
    }),
    perTerminal: Object.freeze({ semanticEndpoint: 1 }),
  });
}
