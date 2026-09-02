import { describe, expect, it } from 'vitest';
import {
  detectTermwrightHostCapacity,
  resolveTermwrightResourceProfile,
  type TermwrightHostCapacity,
} from './resource-profiles.js';

const GIB = 1024 ** 3;

function capacity(cpu: number, memoryGiB: number, diskGiB = 20): TermwrightHostCapacity {
  const memoryLimitBytes = memoryGiB * GIB;
  const memoryReserveBytes = 512 * 1024 ** 2;
  const disk = diskGiB * GIB;
  return {
    availableCpu: cpu,
    memoryLimitBytes,
    memoryReserveBytes,
    memoryBudgetBytes: memoryLimitBytes - memoryReserveBytes,
    tempDiskAvailableBytes: disk,
    tempDiskBudgetBytes: disk - GIB,
    sources: { cpu: 'host', memory: 'host', tempDisk: 'filesystem' },
  };
}

describe('resource-aware profile resolution', () => {
  it.each([
    { label: '2 CPU / 2 GiB', host: capacity(2, 2), workers: 2, terminals: 3 },
    { label: '4 CPU / 7 GiB', host: capacity(4, 7), workers: 4, terminals: 8 },
    { label: 'high-memory workstation', host: capacity(24, 64), workers: 8, terminals: 8 },
  ])('plans the synthetic $label host deterministically', ({ host, workers, terminals }) => {
    const first = resolveTermwrightResourceProfile('local', '/unused', host);
    const second = resolveTermwrightResourceProfile('local', '/unused', host);
    expect(first).toEqual(second);
    expect(first.scheduler.maxWorkers).toBe(workers);
    expect(first.capacities.ptySession).toBe(terminals);
    expect(first.scheduler.decisions).toEqual([
      expect.stringContaining(`workers=${workers}`),
      expect.stringContaining(`terminals=${terminals}`),
    ]);
  });

  it('lets temp-disk pressure queue terminal/trace work without reducing worker fidelity', () => {
    const profile = resolveTermwrightResourceProfile('local', '/unused', capacity(8, 16, 1.25));
    expect(profile.scheduler.maxWorkers).toBe(8);
    expect(profile.capacities.ptySession).toBe(1);
    expect(profile.capacities.traceWriter).toBe(1);
  });

  it('reports real capacity with truthful source and non-zero reserved budgets', () => {
    const found = detectTermwrightHostCapacity(process.cwd());
    expect(found.availableCpu).toBeGreaterThanOrEqual(1);
    expect(found.memoryBudgetBytes).toBeGreaterThan(0);
    expect(found.memoryLimitBytes).toBeGreaterThanOrEqual(found.memoryBudgetBytes);
    expect(['host', 'cgroup-v1', 'cgroup-v2']).toContain(found.sources.cpu);
  });
});
