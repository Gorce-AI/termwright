import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from '@termwright/protocol';
import {
  runPerformanceBenchmark,
  validatePerformanceReport,
  type PerformanceMetric,
} from './report.js';
import {
  parseCharmDebug,
  runCharmPerformanceBenchmark,
  summarizeApplicationDurations,
} from './charm.js';

function measured(metric: PerformanceMetric): number {
  expect(metric.status).toBe('measured');
  if (metric.status !== 'measured') throw new Error(metric.reason);
  return metric.value;
}

describe('semantic pipeline performance report', () => {
  it('covers the retained semantic pipeline with the complete metric vocabulary', () => {
    const report = runPerformanceBenchmark({ iterations: 5, warmupIterations: 2, nodeCount: 24 });
    expect(() => validatePerformanceReport(report)).not.toThrow();
    expect(report.scenarios.map((scenario) => scenario.renderingMode)).toEqual(['retained']);

    for (const scenario of report.scenarios) {
      expect(measured(scenario.metrics.fullSnapshots)).toBe(5);
      expect(measured(scenario.metrics.semanticNodesPerFrame)).toBe(24);
      expect(measured(scenario.metrics.bytesPerFrame)).toBeLessThan(DEFAULT_LIMITS.maxFrameBytes);
      expect(measured(scenario.metrics.probeEventsPerFrame)).toBeGreaterThanOrEqual(24);
      expect(measured(scenario.metrics.probeSerializationTime)).toBeGreaterThanOrEqual(0);
      expect(scenario.metrics.parentNormalizationTime.status).toBe('unavailable');
      expect(measured(scenario.metrics.parentProtocolValidationTime)).toBeGreaterThanOrEqual(0);
      expect(scenario.metrics.droppedEvents.status).toBe('unavailable');
      expect(scenario.metrics.coalescedEvents.status).toBe('unavailable');
      expect(scenario.metrics.renderCorrelationRate.status).toBe('unavailable');
      expect(scenario.metrics.applicationOverheadRatio.status).toBe('unavailable');
    }
  });

  it('rejects an inferred zero where the producer marked a metric unavailable', () => {
    const report = runPerformanceBenchmark({ iterations: 1, warmupIterations: 1, nodeCount: 4 });
    const invalid = structuredClone(report) as unknown as {
      scenarios: { metrics: { droppedEvents: unknown } }[];
    };
    invalid.scenarios[0]!.metrics.droppedEvents = {
      status: 'unavailable',
      unit: 'count',
      value: 0,
      reason: 'not observed',
    };
    expect(() => validatePerformanceReport(invalid)).toThrow(/droppedEvents/u);
  });

  it('rejects the previous report schema instead of retaining compatibility', () => {
    const report = runPerformanceBenchmark({ iterations: 1, warmupIterations: 1, nodeCount: 4 });
    expect(() => validatePerformanceReport({ ...report, schemaVersion: 2 })).toThrow(
      /unsupported performance report kind or version/u,
    );
  });

  it('keeps every checked-in representative report machine-readable and complete', async () => {
    const reports = [
      ['semantic-pipeline.json', 'retained'],
      ['charm-immediate.json', 'immediate'],
      ['opentui-marker-route.json', 'retained'],
    ] as const;
    for (const [name, renderingMode] of reports) {
      const raw = await readFile(new URL(`../reports/${name}`, import.meta.url), 'utf8');
      const value: unknown = JSON.parse(raw);
      expect(() => validatePerformanceReport(value), name).not.toThrow();
      expect(
        (value as { scenarios: { renderingMode: string }[] }).scenarios[0]?.renderingMode,
      ).toBe(renderingMode);
    }
  });

  it('rejects Charm burst reports whose raw evidence is missing or inconsistent', async () => {
    const raw = await readFile(new URL('../reports/charm-immediate.json', import.meta.url), 'utf8');
    const report = JSON.parse(raw);
    const missing = structuredClone(report);
    delete missing.scenarios[0].timingSamples;
    expect(() => validatePerformanceReport(missing)).toThrow(/raw timing samples/u);

    const inconsistent = structuredClone(report);
    inconsistent.scenarios[0].metrics.applicationOverheadRatio.samples[0] = 999;
    expect(() => validatePerformanceReport(inconsistent)).toThrow(/paired ratios/u);

    const incomplete = structuredClone(report);
    incomplete.scenarios[0].metrics.droppedEvents.value = 1;
    expect(() => validatePerformanceReport(incomplete)).toThrow(/publication evidence/u);
  });

  it('parses real Go debug counters without inferring unavailable values', () => {
    const metrics = parseCharmDebug(
      [
        '  tw:io   [s1]   0.010s performance r1 bytes=401 nodes=3 unknown=1 serialization_us=12.500',
        '  tw:io   [s1]   0.020s performance r2 bytes=187 nodes=3 unknown=1 serialization_us=8.250',
        '  tw:sem  [s1]   0.030s close r2 snapshots=2 logs_dropped=0 performance_dropped=0',
      ].join('\n'),
    );
    expect(metrics).toEqual({
      fullSnapshots: 2,
      droppedEvents: 0,
      bytes: [401, 187],
      nodes: [3, 3],
      unknownNodes: [1, 1],
      serializationMicroseconds: [12.5, 8.25],
    });

    expect(
      parseCharmDebug(
        [
          '  tw:io   [s1]   0.010s r1 snapshot nodes=3',
          '  tw:io   [s1]   0.011s performance r1 bytes=401 nodes=3 unknown=1 serialization_us=12.500',
        ].join('\n'),
      ).droppedEvents,
    ).toBe(0);
  });

  it('summarizes paired Charm durations without letting one small denominator dominate', () => {
    const summary = summarizeApplicationDurations(
      [100, 101, 20, 99, 102],
      [120, 121, 40, 119, 122],
    );
    expect(summary.ratio).toBeCloseTo(1.2, 2);
    expect(summary.pairedRatios).toHaveLength(5);
  });

  it('rejects partial Charm measurement blocks before building the fixture', async () => {
    await expect(runCharmPerformanceBenchmark({ iterations: 4 })).rejects.toThrow(
      /complete balanced measurement blocks/u,
    );
  });
});
