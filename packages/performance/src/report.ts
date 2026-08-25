import { performance } from 'node:perf_hooks';
import {
  createFrameDecoder,
  DEFAULT_LIMITS,
  encodeFrame,
  parseAdapterMessage,
  type FrameDecoder,
  type ProbeFrame,
  type SemanticSnapshot,
} from '@termwright/protocol';
import { recognize } from '@termwright/recognizers';
import { PERFORMANCE_SCENARIOS, type RenderingMode } from './fixtures.js';

export const PERFORMANCE_REPORT_KIND = 'termwright-performance-report' as const;
export const PERFORMANCE_REPORT_VERSION = 3 as const;
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
  | 'count'
  | 'events/frame'
  | 'bytes/frame'
  | 'nodes/frame'
  | 'microseconds/frame'
  | 'ratio';

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
  readonly renderingMode: RenderingMode;
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

export interface BenchmarkOptions {
  readonly iterations?: number;
  readonly warmupIterations?: number;
  readonly nodeCount?: number;
  readonly now?: () => number;
}

interface Samples {
  readonly probeEvents: number[];
  readonly bytes: number[];
  readonly semanticNodes: number[];
  readonly unknownNodes: number[];
  readonly serializationMicroseconds: number[];
  readonly parentNormalizationMicroseconds: number[];
  readonly probeHotPathMicroseconds: number[];
}

const unavailable = (unit: MetricUnit, reason: string): UnavailableMetric => ({
  status: 'unavailable',
  unit,
  value: null,
  reason,
});

function measured(unit: MetricUnit, values: readonly number[], note?: string): MeasuredMetric {
  const ordered = [...values].sort((left, right) => left - right);
  const value = values.reduce((total, sample) => total + sample, 0) / values.length;
  const p95 = ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * 0.95) - 1)] as number;
  return {
    status: 'measured',
    unit,
    value,
    ...(values.length > 1 ? { p95 } : {}),
    ...(note === undefined ? {} : { note }),
  };
}

function exact(unit: MetricUnit, value: number, note?: string): MeasuredMetric {
  return {
    status: 'measured',
    unit,
    value,
    ...(note === undefined ? {} : { note }),
  };
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return resolved;
}

function exerciseFrame(
  frame: ProbeFrame,
  framework: string,
  revision: number,
  decoder: FrameDecoder,
  now: () => number,
): {
  readonly snapshot: SemanticSnapshot;
  readonly bytes: number;
  readonly serializationMicroseconds: number;
  readonly parentNormalizationMicroseconds: number;
  readonly probeHotPathMicroseconds: number;
} {
  const normalizationStarted = now();
  const snapshot = recognize(frame, {
    sessionId: 'performance-session',
    revision,
    columns: 120,
    rows: 40,
    framework,
    paintOrderKnown: framework === 'opentui',
  });
  const normalizationEnded = now();

  const serializationStarted = now();
  const wire = encodeFrame({ type: 'snapshot', snapshot }, DEFAULT_LIMITS.maxFrameBytes);
  const serializationEnded = now();

  // This is the actual parent-side hostile-input boundary: UTF-8/JSON decode,
  // DTO projection, schema checks and full semantic-tree validation.
  const parentStarted = now();
  const decoded = decoder.push(wire);
  const parsed = parseAdapterMessage(decoded[0], DEFAULT_LIMITS);
  const parentEnded = now();
  if (decoded.length !== 1 || !parsed.ok || parsed.message.type !== 'snapshot') {
    throw new Error('benchmark frame did not survive the production wire parser');
  }

  const normalizationMicroseconds = (normalizationEnded - normalizationStarted) * 1_000;
  const serializationMicroseconds = (serializationEnded - serializationStarted) * 1_000;
  return {
    snapshot,
    bytes: wire.byteLength,
    serializationMicroseconds,
    parentNormalizationMicroseconds: (parentEnded - parentStarted) * 1_000,
    probeHotPathMicroseconds: normalizationMicroseconds + serializationMicroseconds,
  };
}

/** Run representative retained- and immediate-mode semantic pipeline workloads. */
export function runPerformanceBenchmark(options: BenchmarkOptions = {}): PerformanceReport {
  const iterations = positiveInteger(options.iterations, 1_000, 'iterations');
  const warmupIterations = positiveInteger(options.warmupIterations, 100, 'warmupIterations');
  const nodeCount = positiveInteger(options.nodeCount, 96, 'nodeCount');
  if (nodeCount > DEFAULT_LIMITS.maxNodes) {
    throw new Error(`nodeCount cannot exceed the protocol ceiling ${DEFAULT_LIMITS.maxNodes}`);
  }
  const now = options.now ?? performance.now.bind(performance);

  const reports = PERFORMANCE_SCENARIOS.map((scenario): ScenarioReport => {
    // The production parent keeps one decoder per semantic connection. Reuse
    // it here as well: allocating a decoder per frame would measure a path the
    // application never takes and overstate parent normalization cost.
    const decoder = createFrameDecoder(DEFAULT_LIMITS.maxFrameBytes);
    for (let index = 1; index <= warmupIterations; index += 1) {
      exerciseFrame(scenario.makeFrame(index, nodeCount), scenario.framework, index, decoder, now);
    }

    const samples: Samples = {
      probeEvents: [],
      bytes: [],
      semanticNodes: [],
      unknownNodes: [],
      serializationMicroseconds: [],
      parentNormalizationMicroseconds: [],
      probeHotPathMicroseconds: [],
    };

    for (let index = 1; index <= iterations; index += 1) {
      const frame = scenario.makeFrame(index, nodeCount);
      const result = exerciseFrame(frame, scenario.framework, index, decoder, now);
      samples.probeEvents.push(frame.objects.length + (frame.operations?.length ?? 0));
      samples.bytes.push(result.bytes);
      samples.semanticNodes.push(result.snapshot.nodes.length);
      samples.unknownNodes.push(
        result.snapshot.nodes.filter((node) => node.role === 'generic').length,
      );
      samples.serializationMicroseconds.push(result.serializationMicroseconds);
      samples.parentNormalizationMicroseconds.push(result.parentNormalizationMicroseconds);
      samples.probeHotPathMicroseconds.push(result.probeHotPathMicroseconds);
    }

    return {
      id: scenario.id,
      framework: scenario.framework,
      renderingMode: scenario.renderingMode,
      description: scenario.description,
      workload: {
        frames: iterations,
        warmupFrames: warmupIterations,
        targetNodesPerFrame: nodeCount,
      },
      metrics: {
        probeEventsPerFrame: measured(
          'events/frame',
          samples.probeEvents,
          'Probe IR objects plus render/layout operations observed for one frame.',
        ),
        bytesPerFrame: measured(
          'bytes/frame',
          samples.bytes,
          'Length-prefixed snapshot frame, including the four-byte wire header.',
        ),
        fullSnapshots: exact(
          'count',
          iterations,
          'The current TypeScript probe transport sends one full snapshot per benchmark frame.',
        ),
        droppedEvents: unavailable(
          'count',
          'The synchronous semantic pipeline has no bounded producer queue; only a live transport can observe backpressure drops.',
        ),
        coalescedEvents: unavailable(
          'count',
          'The synchronous semantic pipeline does not coalesce frames; framework sessions must report this from their live render hook.',
        ),
        semanticNodesPerFrame: measured('nodes/frame', samples.semanticNodes),
        unknownFrameworkNodesPerFrame: measured(
          'nodes/frame',
          samples.unknownNodes,
          'Semantic nodes normalized to generic because no stronger portable role was proven.',
        ),
        renderCorrelationRate: unavailable(
          'ratio',
          'This benchmark has no PTY or render-marker consumer; correlation belongs to end-to-end session telemetry.',
        ),
        probeSerializationTime: measured(
          'microseconds/frame',
          samples.serializationMicroseconds,
          'Production encodeFrame JSON serialization, UTF-8 encoding and length prefix.',
        ),
        parentNormalizationTime: unavailable(
          'microseconds/frame',
          'The current JavaScript probes normalize Probe IR before publication; the parent receives an already normalized semantic snapshot.',
        ),
        parentProtocolValidationTime: measured(
          'microseconds/frame',
          samples.parentNormalizationMicroseconds,
          'Production parent frame decode, immutable DTO projection, schema checks and semantic validation; this is validation, not semantic normalization.',
        ),
        probeHotPathTime: measured(
          'microseconds/frame',
          samples.probeHotPathMicroseconds,
          'Recognizer normalization plus serialization on the current JavaScript probe path; excludes framework observation and socket I/O.',
        ),
        applicationOverheadRatio: unavailable(
          'ratio',
          'A pure semantic-pipeline benchmark has no uninstrumented framework process to compare against.',
        ),
      },
    };
  });

  return {
    kind: PERFORMANCE_REPORT_KIND,
    schemaVersion: PERFORMANCE_REPORT_VERSION,
    generatedAt: new Date().toISOString(),
    environment: {
      runtime: `node ${process.version}`,
      platform: process.platform,
      architecture: process.arch,
    },
    scenarios: reports,
    caveats: [
      'CPU timings describe the semantic pipeline, not whole-application wall-clock slowdown.',
      'Framework observation and socket/PTY scheduling require framework-specific end-to-end measurements.',
      'Unavailable metrics remain null with a reason; the report never substitutes an inferred zero.',
    ],
  };
}

/** Structural check used for checked-in reports and downstream automation. */
export function validatePerformanceReport(value: unknown): asserts value is PerformanceReport {
  if (typeof value !== 'object' || value === null) throw new Error('report must be an object');
  const report = value as Partial<PerformanceReport>;
  if (report.kind !== PERFORMANCE_REPORT_KIND || report.schemaVersion !== PERFORMANCE_REPORT_VERSION) {
    throw new Error('unsupported performance report kind or version');
  }
  if (typeof report.generatedAt !== 'string' || !Number.isFinite(Date.parse(report.generatedAt))) {
    throw new Error('report generatedAt must be an ISO date');
  }
  if (
    typeof report.environment !== 'object'
    || report.environment === null
    || typeof report.environment.runtime !== 'string'
    || typeof report.environment.platform !== 'string'
    || typeof report.environment.architecture !== 'string'
  ) {
    throw new Error('report environment is incomplete');
  }
  if (!Array.isArray(report.caveats) || !report.caveats.every((entry) => typeof entry === 'string')) {
    throw new Error('report caveats must be strings');
  }
  if (!Array.isArray(report.scenarios) || report.scenarios.length === 0) {
    throw new Error('report must contain scenarios');
  }

  const required = [
    'probeEventsPerFrame',
    'bytesPerFrame',
    'fullSnapshots',
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
    if (typeof scenario !== 'object' || scenario === null) throw new Error('scenario must be an object');
    const candidate = scenario as Partial<ScenarioReport>;
    if (
      typeof candidate.id !== 'string'
      || typeof candidate.framework !== 'string'
      || (candidate.renderingMode !== 'retained' && candidate.renderingMode !== 'immediate')
      || typeof candidate.description !== 'string'
      || typeof candidate.workload !== 'object'
      || candidate.workload === null
      || !Number.isSafeInteger(candidate.workload.frames)
      || candidate.workload.frames <= 0
      || !Number.isSafeInteger(candidate.workload.warmupFrames)
      || candidate.workload.warmupFrames < 0
      || !Number.isSafeInteger(candidate.workload.targetNodesPerFrame)
      || candidate.workload.targetNodesPerFrame < 0
    ) {
      throw new Error('scenario identity or workload is invalid');
    }
    const metrics = candidate.metrics;
    if (typeof metrics !== 'object' || metrics === null) throw new Error('scenario metrics missing');
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
        if (metric.samples !== undefined && (metric.samples.length === 0
          || metric.samples.some((sample) => !Number.isFinite(sample) || sample < 0))) {
          throw new Error(`metric ${name} has invalid raw samples`);
        }
      } else if (
        metric.status !== 'unavailable'
        || metric.value !== null
        || metric.reason.trim().length === 0
      ) {
        throw new Error(`metric ${name} has an invalid availability marker`);
      }
    }
    if (candidate.timingSamples !== undefined && (candidate.timingSamples.length === 0
      || candidate.timingSamples.some((sample) => !Number.isSafeInteger(sample.block) || sample.block < 0
        || (sample.order !== 'reference-first' && sample.order !== 'instrumented-first')
        || !Number.isFinite(sample.referenceDurationMs) || sample.referenceDurationMs <= 0
        || !Number.isFinite(sample.instrumentedDurationMs) || sample.instrumentedDurationMs <= 0
        || !Number.isSafeInteger(sample.frames) || sample.frames <= 0))) {
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
    if (sample.block !== index
      || sample.order !== CHARM_MEASUREMENT_ORDER[index % CHARM_MEASUREMENT_ORDER.length]
      || sample.frames < 256) {
      throw new Error('Charm burst timing blocks, order or frame evidence are incomplete');
    }
  }
  const totalFrames = timing.reduce((total, sample) => total + sample.frames, 0);
  if (scenario.workload.frames !== totalFrames || scenario.workload.warmupFrames < 256) {
    throw new Error('Charm burst workload does not match its raw frame evidence');
  }

  const overhead = scenario.metrics.applicationOverheadRatio;
  if (overhead.status !== 'measured' || overhead.p95 !== undefined
    || overhead.samples === undefined || overhead.samples.length !== timing.length) {
    throw new Error('Charm burst overhead requires complete raw ratio evidence');
  }
  const expectedSamples = timing.map(
    (sample) => sample.instrumentedDurationMs / sample.referenceDurationMs,
  );
  if (overhead.samples.some((sample, index) => !nearlyEqual(sample, expectedSamples[index] as number))) {
    throw new Error('Charm burst paired ratios differ from raw durations');
  }
  const expectedRatio = sampleMedian(timing.map((sample) => sample.instrumentedDurationMs))
    / sampleMedian(timing.map((sample) => sample.referenceDurationMs));
  if (!nearlyEqual(overhead.value, expectedRatio)) {
    throw new Error('Charm burst ratio differs from the ratio of arm medians');
  }

  const snapshots = scenario.metrics.fullSnapshots;
  const drops = scenario.metrics.droppedEvents;
  const correlation = scenario.metrics.renderCorrelationRate;
  if (snapshots.status !== 'measured' || snapshots.value !== totalFrames
    || drops.status !== 'measured' || drops.value !== 0
    || correlation.status !== 'measured' || correlation.value !== 1) {
    throw new Error('Charm burst publication evidence is incomplete');
  }
}

function sampleMedian(values: readonly number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1
    ? ordered[middle] as number
    : ((ordered[middle - 1] as number) + (ordered[middle] as number)) / 2;
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right)) * 8;
}
