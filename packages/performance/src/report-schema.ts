/** Self-contained performance-report schema and validator for runtime-neutral consumers. */
export const PERFORMANCE_REPORT_KIND = 'termwright-performance-report' as const;
export const PERFORMANCE_REPORT_VERSION = 4 as const;

const CHARM_MEASUREMENT_ORDER = [
  'reference-first',
  'instrumented-first',
  'instrumented-first',
  'reference-first',
  'instrumented-first',
  'reference-first',
  'reference-first',
  'instrumented-first',
] as const;

export type MetricUnit =
  'count' | 'events/frame' | 'bytes/frame' | 'nodes/frame' | 'microseconds/frame' | 'ratio';

export interface MeasuredMetric {
  readonly status: 'measured';
  readonly unit: MetricUnit;
  readonly value: number;
  readonly p95?: number;
  /** Raw same-unit samples retained when a metric is a statistical estimate. */
  readonly samples?: readonly number[];
  readonly note?: string;
}

export interface UnavailableMetric {
  readonly status: 'unavailable';
  readonly unit: MetricUnit;
  readonly value: null;
  readonly reason: string;
}

export type PerformanceMetric = MeasuredMetric | UnavailableMetric;

/** Closed metric set required by the semantic instrumentation design. */
export interface ScenarioMetrics {
  readonly probeEventsPerFrame: PerformanceMetric;
  readonly bytesPerFrame: PerformanceMetric;
  readonly fullSnapshots: PerformanceMetric;
  readonly deltas: PerformanceMetric;
  readonly droppedEvents: PerformanceMetric;
  readonly coalescedEvents: PerformanceMetric;
  readonly semanticNodesPerFrame: PerformanceMetric;
  readonly unknownFrameworkNodesPerFrame: PerformanceMetric;
  readonly renderCorrelationRate: PerformanceMetric;
  readonly probeSerializationTime: PerformanceMetric;
  readonly parentNormalizationTime: PerformanceMetric;
  readonly parentProtocolValidationTime: PerformanceMetric;
  readonly probeHotPathTime: PerformanceMetric;
  readonly applicationOverheadRatio: PerformanceMetric;
}

export interface ScenarioReport {
  readonly id: string;
  readonly framework: string;
  readonly renderingMode: 'retained' | 'immediate';
  readonly description: string;
  readonly workload: {
    readonly frames: number;
    readonly warmupFrames: number;
    readonly targetNodesPerFrame: number;
  };
  readonly metrics: ScenarioMetrics;
  readonly timingSamples?: readonly {
    readonly block: number;
    readonly order: 'reference-first' | 'instrumented-first';
    readonly referenceDurationMs: number;
    readonly instrumentedDurationMs: number;
    readonly frames: number;
  }[];
}

export interface PerformanceReport {
  readonly kind: typeof PERFORMANCE_REPORT_KIND;
  readonly schemaVersion: typeof PERFORMANCE_REPORT_VERSION;
  readonly generatedAt: string;
  readonly environment: {
    readonly runtime: string;
    readonly platform: NodeJS.Platform;
    readonly architecture: string;
  };
  readonly scenarios: readonly ScenarioReport[];
  readonly caveats: readonly string[];
}

/** Structural check used for checked-in reports and downstream automation. */
export function validatePerformanceReport(value: unknown): asserts value is PerformanceReport {
  if (typeof value !== 'object' || value === null) throw new Error('report must be an object');
  const report = value as Partial<PerformanceReport>;
  if (
    report.kind !== PERFORMANCE_REPORT_KIND ||
    report.schemaVersion !== PERFORMANCE_REPORT_VERSION
  ) {
    throw new Error('unsupported performance report kind or version');
  }
  if (typeof report.generatedAt !== 'string' || !Number.isFinite(Date.parse(report.generatedAt))) {
    throw new Error('report generatedAt must be an ISO date');
  }
  if (
    typeof report.environment !== 'object' ||
    report.environment === null ||
    typeof report.environment.runtime !== 'string' ||
    typeof report.environment.platform !== 'string' ||
    typeof report.environment.architecture !== 'string'
  ) {
    throw new Error('report environment is incomplete');
  }
  if (
    !Array.isArray(report.caveats) ||
    !report.caveats.every((entry) => typeof entry === 'string')
  ) {
    throw new Error('report caveats must be strings');
  }
  if (!Array.isArray(report.scenarios) || report.scenarios.length === 0) {
    throw new Error('report must contain scenarios');
  }

  const required = [
    'probeEventsPerFrame',
    'bytesPerFrame',
    'fullSnapshots',
    'deltas',
    'droppedEvents',
    'coalescedEvents',
    'semanticNodesPerFrame',
    'unknownFrameworkNodesPerFrame',
    'renderCorrelationRate',
    'probeSerializationTime',
    'parentNormalizationTime',
    'parentProtocolValidationTime',
    'probeHotPathTime',
    'applicationOverheadRatio',
  ] as const satisfies readonly (keyof ScenarioMetrics)[];
  const units: Readonly<Record<(typeof required)[number], MetricUnit>> = {
    probeEventsPerFrame: 'events/frame',
    bytesPerFrame: 'bytes/frame',
    fullSnapshots: 'count',
    deltas: 'count',
    droppedEvents: 'count',
    coalescedEvents: 'count',
    semanticNodesPerFrame: 'nodes/frame',
    unknownFrameworkNodesPerFrame: 'nodes/frame',
    renderCorrelationRate: 'ratio',
    probeSerializationTime: 'microseconds/frame',
    parentNormalizationTime: 'microseconds/frame',
    parentProtocolValidationTime: 'microseconds/frame',
    probeHotPathTime: 'microseconds/frame',
    applicationOverheadRatio: 'ratio',
  };

  for (const scenario of report.scenarios) {
    if (typeof scenario !== 'object' || scenario === null)
      throw new Error('scenario must be an object');
    const candidate = scenario as Partial<ScenarioReport>;
    if (
      typeof candidate.id !== 'string' ||
      typeof candidate.framework !== 'string' ||
      (candidate.renderingMode !== 'retained' && candidate.renderingMode !== 'immediate') ||
      typeof candidate.description !== 'string' ||
      typeof candidate.workload !== 'object' ||
      candidate.workload === null ||
      !Number.isSafeInteger(candidate.workload.frames) ||
      candidate.workload.frames <= 0 ||
      !Number.isSafeInteger(candidate.workload.warmupFrames) ||
      candidate.workload.warmupFrames < 0 ||
      !Number.isSafeInteger(candidate.workload.targetNodesPerFrame) ||
      candidate.workload.targetNodesPerFrame < 0
    ) {
      throw new Error('scenario identity or workload is invalid');
    }
    const metrics = candidate.metrics;
    if (typeof metrics !== 'object' || metrics === null)
      throw new Error('scenario metrics missing');
    for (const name of required) {
      const metric = metrics[name];
      if (typeof metric !== 'object' || metric === null) throw new Error(`metric ${name} missing`);
      if (metric.unit !== units[name]) throw new Error(`metric ${name} has the wrong unit`);
      if (metric.status === 'measured') {
        if (!Number.isFinite(metric.value) || metric.value < 0) {
          throw new Error(`metric ${name} must be a finite non-negative number`);
        }
        if (metric.p95 !== undefined && (!Number.isFinite(metric.p95) || metric.p95 < 0)) {
          throw new Error(`metric ${name} has an invalid p95`);
        }
        if (
          metric.samples !== undefined &&
          (metric.samples.length === 0 ||
            metric.samples.some((sample) => !Number.isFinite(sample) || sample < 0))
        ) {
          throw new Error(`metric ${name} has invalid raw samples`);
        }
      } else if (
        metric.status !== 'unavailable' ||
        metric.value !== null ||
        metric.reason.trim().length === 0
      ) {
        throw new Error(`metric ${name} has an invalid availability marker`);
      }
    }
    if (
      candidate.timingSamples !== undefined &&
      (candidate.timingSamples.length === 0 ||
        candidate.timingSamples.some(
          (sample) =>
            !Number.isSafeInteger(sample.block) ||
            sample.block < 0 ||
            (sample.order !== 'reference-first' && sample.order !== 'instrumented-first') ||
            !Number.isFinite(sample.referenceDurationMs) ||
            sample.referenceDurationMs <= 0 ||
            !Number.isFinite(sample.instrumentedDurationMs) ||
            sample.instrumentedDurationMs <= 0 ||
            !Number.isSafeInteger(sample.frames) ||
            sample.frames <= 0,
        ))
    ) {
      throw new Error('scenario has invalid raw timing samples');
    }
    if (candidate.id === 'charm-v2-burst-e2e') validateCharmTiming(candidate as ScenarioReport);
  }
}

function validateCharmTiming(scenario: ScenarioReport): void {
  const timing = scenario.timingSamples;
  if (timing === undefined || (timing.length !== 8 && timing.length !== 16)) {
    throw new Error('Charm burst report requires 8 or 16 raw timing samples');
  }
  for (let index = 0; index < timing.length; index += 1) {
    const sample = timing[index] as (typeof timing)[number];
    if (
      sample.block !== index ||
      sample.order !== CHARM_MEASUREMENT_ORDER[index % CHARM_MEASUREMENT_ORDER.length] ||
      sample.frames < 256
    ) {
      throw new Error('Charm burst timing blocks, order or frame evidence are incomplete');
    }
  }
  const totalFrames = timing.reduce((total, sample) => total + sample.frames, 0);
  if (scenario.workload.frames !== totalFrames || scenario.workload.warmupFrames < 256) {
    throw new Error('Charm burst workload does not match its raw frame evidence');
  }

  const overhead = scenario.metrics.applicationOverheadRatio;
  if (
    overhead.status !== 'measured' ||
    overhead.p95 !== undefined ||
    overhead.samples === undefined ||
    overhead.samples.length !== timing.length
  ) {
    throw new Error('Charm burst overhead requires complete raw ratio evidence');
  }
  const expectedSamples = timing.map(
    (sample) => sample.instrumentedDurationMs / sample.referenceDurationMs,
  );
  if (
    overhead.samples.some((sample, index) => !nearlyEqual(sample, expectedSamples[index] as number))
  ) {
    throw new Error('Charm burst paired ratios differ from raw durations');
  }
  const expectedRatio =
    sampleMedian(timing.map((sample) => sample.instrumentedDurationMs)) /
    sampleMedian(timing.map((sample) => sample.referenceDurationMs));
  if (!nearlyEqual(overhead.value, expectedRatio)) {
    throw new Error('Charm burst ratio differs from the ratio of arm medians');
  }

  const snapshots = scenario.metrics.fullSnapshots;
  const drops = scenario.metrics.droppedEvents;
  const correlation = scenario.metrics.renderCorrelationRate;
  if (
    snapshots.status !== 'measured' ||
    snapshots.value !== totalFrames ||
    drops.status !== 'measured' ||
    drops.value !== 0 ||
    correlation.status !== 'measured' ||
    correlation.value !== 1
  ) {
    throw new Error('Charm burst publication evidence is incomplete');
  }
}

function sampleMedian(values: readonly number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1
    ? (ordered[middle] as number)
    : ((ordered[middle - 1] as number) + (ordered[middle] as number)) / 2;
}

function nearlyEqual(left: number, right: number): boolean {
  return (
    Math.abs(left - right) <= Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right)) * 8
  );
}
