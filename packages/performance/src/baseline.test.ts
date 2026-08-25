import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  capturePerformanceBaseline,
  comparePerformanceBaseline,
  formatGitHubError,
  formatGitHubWarning,
  validateBaseline,
  validateBaselinePolicy,
  validateObservationSet,
  type PerformanceBaseline,
  type PerformanceBaselinePolicy,
  type PerformanceBaselineProvenance,
  type PerformanceObservationSet,
} from './baseline.js';

const policy: PerformanceBaselinePolicy = {
  kind: 'termwright-performance-baseline-policy',
  schemaVersion: 1,
  environment: 'darwin-arm64-node24-go1.25-bun1.2.15',
  history: { samples: 1, blockingAfterSamples: 12, decision: 'annotate' },
  metrics: {
    startupMs: {
      unit: 'milliseconds',
      direction: 'lower',
      relativeTolerance: 0.2,
      absoluteTolerance: 50,
    },
    leakedProcesses: {
      unit: 'count',
      direction: 'exact',
      relativeTolerance: 0,
      absoluteTolerance: 0,
    },
    leakedFileDescriptors: {
      unit: 'count',
      direction: 'exact',
      relativeTolerance: 0,
      absoluteTolerance: 0,
    },
  },
};

const provenance: PerformanceBaselineProvenance = {
  environment: {
    kind: 'termwright-performance-environment',
    schemaVersion: 1,
    class: 'linux-x64-node22-go1.25-bun1.2.15',
    runner: { image: 'ubuntu-24.04', platform: 'linux', arch: 'x64' },
    toolchains: {
      node: { qualified: '22', resolved: '22.20.0' },
      go: { qualified: '1.25', resolved: '1.25.1' },
      bun: { qualified: '1.2.15', resolved: '1.2.15' },
    },
  },
  rawInputs: {
    quality: '1'.repeat(64),
    semantic: '2'.repeat(64),
    charm: '3'.repeat(64),
    opentui: '4'.repeat(64),
  },
};

const captureProvenance: PerformanceBaselineProvenance = {
  ...provenance,
  environment: {
    ...provenance.environment,
    class: policy.environment,
    runner: { image: 'macos-15', platform: 'darwin', arch: 'arm64' },
    toolchains: {
      node: { qualified: '24', resolved: '24.1.0' },
      go: { qualified: '1.25', resolved: '1.25.1' },
      bun: { qualified: '1.2.15', resolved: '1.2.15' },
    },
  },
};

const baseline: PerformanceBaseline = {
  kind: 'termwright-performance-baseline',
  schemaVersion: 2,
  recordedAt: '2026-08-25T00:00:00.000Z',
  environment: 'linux-x64-node22-go1.25-bun1.2.15',
  provenance,
  history: { samples: 1, blockingAfterSamples: 12, decision: 'annotate' },
  metrics: {
    startupMs: {
      value: 1_000,
      unit: 'milliseconds',
      source: 'quality/soak',
      direction: 'lower',
      relativeTolerance: 0.2,
      absoluteTolerance: 50,
    },
    leakedProcesses: {
      value: 0,
      unit: 'count',
      source: 'quality/soak and quality/stress',
      direction: 'exact',
      relativeTolerance: 0,
      absoluteTolerance: 0,
    },
    leakedFileDescriptors: {
      value: 0,
      unit: 'count',
      source: 'quality/soak and quality/stress',
      direction: 'exact',
      relativeTolerance: 0,
      absoluteTolerance: 0,
    },
  },
};

function observations(startupMs: number): PerformanceObservationSet {
  return {
    generatedAt: '2026-08-25T01:00:00.000Z',
    environment: baseline.environment,
    metrics: {
      startupMs: { value: startupMs, unit: 'milliseconds', source: 'quality/soak' },
      leakedProcesses: { value: 0, unit: 'count', source: 'quality/soak and quality/stress' },
      leakedFileDescriptors: { value: 0, unit: 'count', source: 'quality/soak and quality/stress' },
    },
  };
}

describe('performance baseline comparator', () => {
  it('keeps observations within the recorded tolerance green', () => {
    expect(comparePerformanceBaseline(baseline, observations(1_199))).toMatchObject([
      { metric: 'startupMs', status: 'ok' },
      { metric: 'leakedProcesses', status: 'ok' },
      { metric: 'leakedFileDescriptors', status: 'ok' },
    ]);
  });

  it('turns a deliberate slowdown into a visible warning without throwing', () => {
    const comparison = comparePerformanceBaseline(baseline, observations(1_500));
    expect(comparison[0]).toMatchObject({
      metric: 'startupMs',
      status: 'warning',
      baseline: 1_000,
      current: 1_500,
      allowedMaximum: 1_200,
    });
    expect(formatGitHubWarning(comparison[0]!, 'packages/performance/baselines/ubuntu.json'))
      .toContain('::warning file=packages/performance/baselines/ubuntu.json,title=Performance regression::startupMs regressed%3A');
  });

  it('refuses comparisons across runner classes', () => {
    expect(() => comparePerformanceBaseline(baseline, {
      ...observations(1_000),
      environment: 'darwin-arm64-node24',
    })).toThrow(/environments differ/u);
  });

  it('fails a violated exact cleanup invariant instead of hiding it as noise', () => {
    const comparison = comparePerformanceBaseline(baseline, {
      ...observations(1_000),
      metrics: {
        ...observations(1_000).metrics,
        leakedProcesses: {
          value: 1,
          unit: 'count',
          source: 'quality/soak and quality/stress',
        },
      },
    });
    expect(comparison[1]).toMatchObject({
      metric: 'leakedProcesses',
      status: 'failure',
      current: 1,
      allowedMaximum: 0,
    });
    expect(formatGitHubError(comparison[1]!, 'packages/performance/baselines/ubuntu.json'))
      .toContain('::error file=packages/performance/baselines/ubuntu.json,title=Cleanup invariant failed::');
  });

  it('captures a new runner class entirely from measured values and retained policy', () => {
    const captured = capturePerformanceBaseline(policy, {
      generatedAt: '2026-08-25T02:00:00.000Z',
      environment: policy.environment,
      metrics: {
        startupMs: { value: 777, unit: 'milliseconds', source: 'new measured run' },
        leakedProcesses: { value: 0, unit: 'count', source: 'new measured cleanup' },
        leakedFileDescriptors: { value: 0, unit: 'count', source: 'new measured cleanup' },
      },
    }, captureProvenance);
    expect(captured).toMatchObject({
      recordedAt: '2026-08-25T02:00:00.000Z',
      environment: policy.environment,
      metrics: {
        startupMs: {
          value: 777,
          source: 'new measured run',
          relativeTolerance: 0.2,
          absoluteTolerance: 50,
        },
      },
    });
    expect(() => validateBaseline(captured)).not.toThrow();
  });

  it('refuses to bless non-zero exact cleanup as a baseline', () => {
    expect(() => capturePerformanceBaseline(policy, {
      generatedAt: '2026-08-25T02:00:00.000Z',
      environment: policy.environment,
      metrics: {
        startupMs: { value: 777, unit: 'milliseconds', source: 'new measured run' },
        leakedProcesses: { value: 1, unit: 'count', source: 'leaking capture' },
        leakedFileDescriptors: { value: 0, unit: 'count', source: 'measured cleanup' },
      },
    }, captureProvenance)).toThrow(/exact cleanup invariant during baseline capture/u);
  });

  it('requires both exact cleanup invariants independently of policy data', () => {
    const metrics = { ...policy.metrics };
    delete (metrics as Partial<typeof metrics>).leakedProcesses;
    expect(() => validateBaselinePolicy({ ...policy, metrics })).toThrow(/leakedProcesses is a required/u);
    expect(() => validateObservationSet({
      ...observations(1_000),
      metrics: { startupMs: observations(1_000).metrics.startupMs! },
    })).toThrow(/required count cleanup observation/u);
  });

  it('keeps the checked-in capture policy complete, machine-readable and value-free', async () => {
    const raw = await readFile(
      new URL('../baselines/darwin-arm64-node24-go1.25-bun1.2.15.policy.json', import.meta.url),
      'utf8',
    );
    const value: unknown = JSON.parse(raw);
    expect(() => validateBaselinePolicy(value)).not.toThrow();
    expect(JSON.stringify(value)).not.toMatch(/"value"/u);
    expect(Object.keys((value as PerformanceBaselinePolicy).metrics)).toEqual([
      'startupMs',
      'perTestOverheadMs',
      'peakRssBytes',
      'peakOpenFileDescriptors',
      'leakedFileDescriptors',
      'leakedProcesses',
      'semanticHotPathP95Us',
      'charmOverheadRatio',
      'opentuiOverheadRatio',
    ]);
  });
});
