import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import {
  applySemanticDelta,
  createFrameDecoder,
  DEFAULT_LIMITS,
  diffSemanticSnapshots,
  encodeFrame,
  framedByteLength,
  parseAdapterMessage,
  type FrameDecoder,
  type ProbeFrame,
  type SemanticSnapshot,
} from '@termwright/protocol';
import { recognize } from '@termwright/recognizers';
import { PERFORMANCE_SCENARIOS } from './fixtures.js';
import {
  PERFORMANCE_REPORT_KIND,
  PERFORMANCE_REPORT_VERSION,
  type MeasuredMetric,
  type MetricUnit,
  type PerformanceReport,
  type ScenarioReport,
  type UnavailableMetric,
} from './report-schema.js';
export {
  PERFORMANCE_REPORT_KIND,
  PERFORMANCE_REPORT_VERSION,
  validatePerformanceReport,
} from './report-schema.js';
export type {
  MeasuredMetric,
  MetricUnit,
  PerformanceMetric,
  PerformanceReport,
  ScenarioMetrics,
  ScenarioReport,
  UnavailableMetric,
} from './report-schema.js';

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
  previous: SemanticSnapshot | null,
  now: () => number,
): {
  readonly snapshot: SemanticSnapshot;
  readonly bytes: number;
  readonly serializationMicroseconds: number;
  readonly parentNormalizationMicroseconds: number;
  readonly probeHotPathMicroseconds: number;
  readonly publication: 'full' | 'delta';
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
  const envelope =
    previous === null
      ? ({ type: 'semantic-full', snapshot } as const)
      : ({ type: 'semantic-delta', delta: diffSemanticSnapshots(previous, snapshot) } as const);
  const wire = encodeFrame(envelope, DEFAULT_LIMITS.maxFrameBytes);
  const serializationEnded = now();

  // This is the actual parent-side hostile-input boundary: UTF-8/JSON decode,
  // DTO projection, schema checks and full semantic-tree validation.
  const parentStarted = now();
  const decoded = decoder.push(wire);
  const parsed = parseAdapterMessage(decoded[0], DEFAULT_LIMITS);
  const parentEnded = now();
  if (decoded.length !== 1 || !parsed.ok) {
    throw new Error('benchmark frame did not survive the production wire parser');
  }
  let committed: SemanticSnapshot;
  if (parsed.message.type === 'semantic-full') {
    committed = parsed.message.snapshot;
  } else if (parsed.message.type === 'semantic-delta' && previous !== null) {
    const applied = applySemanticDelta(
      previous,
      parsed.message.delta,
      DEFAULT_LIMITS,
      framedByteLength(parsed.message),
    );
    if (!applied.ok) throw new Error(`benchmark delta did not apply: ${applied.detail}`);
    committed = applied.snapshot;
  } else {
    throw new Error('benchmark publication kind did not match its committed base');
  }
  if (!isDeepStrictEqual(committed, snapshot)) {
    throw new Error('incremental reconstruction differs from the full-snapshot oracle');
  }

  const normalizationMicroseconds = (normalizationEnded - normalizationStarted) * 1_000;
  const serializationMicroseconds = (serializationEnded - serializationStarted) * 1_000;
  return {
    snapshot: committed,
    bytes: wire.byteLength,
    serializationMicroseconds,
    parentNormalizationMicroseconds: (parentEnded - parentStarted) * 1_000,
    probeHotPathMicroseconds: normalizationMicroseconds + serializationMicroseconds,
    publication: envelope.type === 'semantic-full' ? 'full' : 'delta',
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
    let warmupCommitted: SemanticSnapshot | null = null;
    for (let index = 1; index <= warmupIterations; index += 1) {
      warmupCommitted = exerciseFrame(
        scenario.makeFrame(index, nodeCount),
        scenario.framework,
        index,
        decoder,
        warmupCommitted,
        now,
      ).snapshot;
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

    let committed: SemanticSnapshot | null = null;
    let fullSnapshots = 0;
    let deltas = 0;
    for (let index = 1; index <= iterations; index += 1) {
      const frame = scenario.makeFrame(index, nodeCount);
      const result = exerciseFrame(frame, scenario.framework, index, decoder, committed, now);
      committed = result.snapshot;
      if (result.publication === 'full') fullSnapshots += 1;
      else deltas += 1;
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
          fullSnapshots,
          'Initial keyframes sent by the incremental TypeScript probe transport.',
        ),
        deltas: exact(
          'count',
          deltas,
          'Revision-based semantic deltas reconstructed against the full-snapshot oracle.',
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
