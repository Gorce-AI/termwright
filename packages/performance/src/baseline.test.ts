import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  comparePerformanceBaseline,
  formatGitHubError,
  formatGitHubWarning,
  validateBaseline,
  type PerformanceBaseline,
  type PerformanceObservationSet,
} from './baseline.js';

const baseline: PerformanceBaseline = {
  kind: 'termwright-performance-baseline',
  schemaVersion: 1,
  recordedAt: '2026-08-25T00:00:00.000Z',
  environment: 'ubuntu-24.04-x64-node22',
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
  },
};

function observations(startupMs: number): PerformanceObservationSet {
  return {
    generatedAt: '2026-08-25T01:00:00.000Z',
    environment: baseline.environment,
    metrics: {
      startupMs: { value: startupMs, unit: 'milliseconds', source: 'quality/soak' },
      leakedProcesses: { value: 0, unit: 'count', source: 'quality/soak and quality/stress' },
    },
  };
}

describe('performance baseline comparator', () => {
  it('keeps observations within the recorded tolerance green', () => {
    expect(comparePerformanceBaseline(baseline, observations(1_199))).toMatchObject([
      { metric: 'startupMs', status: 'ok' },
      { metric: 'leakedProcesses', status: 'ok' },
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

  it('keeps the checked-in baseline complete and machine-readable', async () => {
    const raw = await readFile(
      new URL('../baselines/darwin-arm64-node24.json', import.meta.url),
      'utf8',
    );
    const value: unknown = JSON.parse(raw);
    expect(() => validateBaseline(value)).not.toThrow();
    expect(Object.keys((value as PerformanceBaseline).metrics)).toEqual([
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
