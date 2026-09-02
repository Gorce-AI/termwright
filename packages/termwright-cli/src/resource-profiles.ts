import { readFileSync, statfsSync } from 'node:fs';
import { availableParallelism, totalmem } from 'node:os';
import type { ResourceCapacities, ResourceVector } from '@termwright/resource-broker';

const MIB = 1024 * 1024;

export interface TermwrightHostCapacity {
  readonly availableCpu: number;
  readonly memoryLimitBytes: number;
  readonly memoryReserveBytes: number;
  readonly memoryBudgetBytes: number;
  readonly tempDiskAvailableBytes: number | 'unavailable';
  readonly tempDiskBudgetBytes: number | 'unavailable';
  readonly sources: {
    readonly cpu: 'host' | 'cgroup-v1' | 'cgroup-v2';
    readonly memory: 'host' | 'cgroup-v1' | 'cgroup-v2';
    readonly tempDisk: 'filesystem' | 'unavailable';
  };
}

export interface TermwrightResourceProfile {
  readonly name: TermwrightResourceProfileName;
  readonly scheduler: {
    readonly pool: 'forks';
    readonly maxWorkers: number;
    /** Whether a project's own Vitest config may enable file concurrency. */
    readonly fileParallelism: boolean;
    /** Stable explanations for the effective admission ceiling. */
    readonly decisions?: readonly string[];
  };
  readonly capacities: ResourceCapacities;
  readonly perAttempt?: ResourceVector;
  readonly perTerminal: ResourceVector;
  readonly hostCapacity?: TermwrightHostCapacity;
}

export const TERMWRIGHT_RESOURCE_PROFILE_NAMES = ['local', 'ci', 'windows-ci', 'stress'] as const;

export type TermwrightResourceProfileName = (typeof TERMWRIGHT_RESOURCE_PROFILE_NAMES)[number];

export const TERMWRIGHT_RESOURCE_PROFILES: Readonly<
  Record<TermwrightResourceProfileName, TermwrightResourceProfile>
> = Object.freeze({
  // Multi-terminal tests use test.resources() and are atomically admitted by
  // the exact runner before their Attempt budget starts. These defaults stay
  // conservative until the current worker-pressure matrix is certified;
  // worker and terminal controls are nevertheless independent, and stress
  // is the explicit high-fan-out profile. Local and CI use the same two-fork
  // envelope; worker teardown correctness must not depend on serializing the
  // entire monorepo behind a single process.
  // Terminal capacity is a ceiling on concurrently live terminals, not on
  // workers, and it must clear the largest atomic reservation any test
  // declares — a group larger than the ceiling can never be admitted. CI
  // keeps two workers but the same terminal headroom as a laptop, because
  // starving the ceiling does not make a small runner safer: it only turns
  // multi-terminal tests into timeouts.
  local: resourceProfile('local', 4, 2),
  ci: resourceProfile('ci', 4, 2),
  'windows-ci': resourceProfile('windows-ci', 4, 2),
  stress: resourceProfile('stress', 16, 16),
});

export function isTermwrightResourceProfileName(
  value: string,
): value is TermwrightResourceProfileName {
  return (TERMWRIGHT_RESOURCE_PROFILE_NAMES as readonly string[]).includes(value);
}

/** Resolves a named policy against the effective host/container budgets. */
export function resolveTermwrightResourceProfile(
  name: TermwrightResourceProfileName,
  cwd: string,
  capacity: TermwrightHostCapacity = detectTermwrightHostCapacity(cwd),
): TermwrightResourceProfile {
  const ceiling = name === 'stress' ? 32 : name === 'windows-ci' ? 6 : 8;
  const memoryWorkerSlots = Math.max(1, Math.floor(capacity.memoryBudgetBytes / (512 * MIB)));
  const cpuSlots = Math.max(1, Math.floor(capacity.availableCpu));
  const diskSlots =
    capacity.tempDiskBudgetBytes === 'unavailable'
      ? ceiling
      : Math.max(1, Math.floor(capacity.tempDiskBudgetBytes / (256 * MIB)));
  const maxWorkers = Math.max(1, Math.min(ceiling, cpuSlots, memoryWorkerSlots));
  const terminals = Math.max(1, Math.min(ceiling, memoryWorkerSlots, diskSlots));
  const decisions = Object.freeze([
    `workers=${maxWorkers}: min(policy=${ceiling}, cpu=${cpuSlots}, memory=${memoryWorkerSlots})`,
    `terminals=${terminals}: min(policy=${ceiling}, memory=${memoryWorkerSlots}, tempDisk=${diskSlots})`,
  ]);
  return Object.freeze({
    ...resourceProfile(name, terminals, maxWorkers),
    scheduler: Object.freeze({ pool: 'forks', maxWorkers, fileParallelism: true, decisions }),
    hostCapacity: capacity,
  });
}

/** Detects effective CPU, cgroup memory and artifact-filesystem capacity. */
export function detectTermwrightHostCapacity(cwd: string): TermwrightHostCapacity {
  const hostCpu = Math.max(1, availableParallelism());
  const cpu = cgroupCpuLimit();
  const availableCpu = Math.max(1, Math.min(hostCpu, cpu?.value ?? hostCpu));
  const hostMemory = totalmem();
  const memory = cgroupMemoryLimit();
  const memoryLimitBytes = Math.max(MIB, Math.min(hostMemory, memory?.value ?? hostMemory));
  const memoryReserveBytes = Math.min(
    Math.max(256 * MIB, Math.floor(memoryLimitBytes * 0.15)),
    Math.max(0, memoryLimitBytes - 256 * MIB),
  );
  const memoryBudgetBytes = Math.max(MIB, memoryLimitBytes - memoryReserveBytes);
  const disk = filesystemAvailable(cwd);
  const tempDiskBudgetBytes =
    disk === undefined
      ? 'unavailable'
      : Math.max(0, disk - Math.max(512 * MIB, Math.floor(disk * 0.1)));
  return Object.freeze({
    availableCpu,
    memoryLimitBytes,
    memoryReserveBytes,
    memoryBudgetBytes,
    tempDiskAvailableBytes: disk ?? 'unavailable',
    tempDiskBudgetBytes,
    sources: Object.freeze({
      cpu: cpu?.source ?? 'host',
      memory: memory?.source ?? 'host',
      tempDisk: disk === undefined ? 'unavailable' : 'filesystem',
    }),
  });
}

function resourceProfile(
  name: TermwrightResourceProfileName,
  terminals: number,
  maxWorkers: number,
): TermwrightResourceProfile {
  return Object.freeze({
    name,
    scheduler: Object.freeze({ pool: 'forks', maxWorkers, fileParallelism: true }),
    capacities: Object.freeze({
      ptySession: terminals,
      externalProcess: terminals,
      semanticEndpoint: terminals,
      nativeHostPressure: terminals,
      traceWriter: terminals,
      cpuWeight: maxWorkers,
      memoryWeight: maxWorkers,
      ioWeight: maxWorkers,
    }),
    perAttempt: Object.freeze({ cpuWeight: 1, memoryWeight: 1, ioWeight: 1 }),
    perTerminal: Object.freeze({ semanticEndpoint: 1, nativeHostPressure: 1 }),
  });
}

function cgroupCpuLimit(): { value: number; source: 'cgroup-v1' | 'cgroup-v2' } | undefined {
  const v2 = readText('/sys/fs/cgroup/cpu.max');
  if (v2 !== undefined) {
    const [quota, period] = v2.split(/\s+/u);
    if (quota !== 'max') {
      const value = Number(quota) / Number(period);
      if (Number.isFinite(value) && value > 0) return { value, source: 'cgroup-v2' };
    }
  }
  const quota = Number(readText('/sys/fs/cgroup/cpu/cpu.cfs_quota_us'));
  const period = Number(readText('/sys/fs/cgroup/cpu/cpu.cfs_period_us'));
  if (Number.isFinite(quota) && quota > 0 && Number.isFinite(period) && period > 0) {
    return { value: quota / period, source: 'cgroup-v1' };
  }
  return undefined;
}

function cgroupMemoryLimit(): { value: number; source: 'cgroup-v1' | 'cgroup-v2' } | undefined {
  const v2 = readText('/sys/fs/cgroup/memory.max');
  if (v2 !== undefined && v2 !== 'max') {
    const value = Number(v2);
    if (Number.isSafeInteger(value) && value > 0) return { value, source: 'cgroup-v2' };
  }
  const value = Number(readText('/sys/fs/cgroup/memory/memory.limit_in_bytes'));
  if (Number.isSafeInteger(value) && value > 0) return { value, source: 'cgroup-v1' };
  return undefined;
}

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return undefined;
  }
}

function filesystemAvailable(path: string): number | undefined {
  try {
    const stats = statfsSync(path, { bigint: true });
    const bytes = stats.bavail * stats.bsize;
    return bytes <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(bytes) : Number.MAX_SAFE_INTEGER;
  } catch {
    return undefined;
  }
}
