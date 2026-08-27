export const PERFORMANCE_BASELINE_KIND = 'termwright-performance-baseline' as const;
export const PERFORMANCE_BASELINE_VERSION = 4 as const;
export const PERFORMANCE_BASELINE_POLICY_KIND = 'termwright-performance-baseline-policy' as const;
export const PERFORMANCE_BASELINE_POLICY_VERSION = 3 as const;

export type BaselineUnit = 'milliseconds' | 'bytes' | 'count' | 'microseconds/frame' | 'ratio';
const BASELINE_UNITS: readonly BaselineUnit[] = [
  'milliseconds',
  'bytes',
  'count',
  'microseconds/frame',
  'ratio',
];

export interface PerformanceObservation {
  readonly value: number;
  readonly unit: BaselineUnit;
  readonly source: string;
}

export interface PerformanceObservationSet {
  readonly generatedAt: string;
  readonly environment: string;
  readonly metrics: Readonly<Record<string, PerformanceObservation>>;
}

export interface PerformanceEnvironmentDescriptor {
  readonly kind: 'termwright-performance-environment';
  readonly schemaVersion: 1;
  readonly class: string;
  readonly runner: {
    readonly image: string;
    readonly platform: string;
    readonly arch: string;
  };
  readonly toolchains: {
    readonly node: { readonly qualified: string; readonly resolved: string };
    readonly go: { readonly qualified: string; readonly resolved: string };
    readonly bun: { readonly qualified: string; readonly resolved: string };
  };
}

export interface PerformanceBaselineProvenance {
  readonly environment: PerformanceEnvironmentDescriptor;
  readonly rawInputs: {
    readonly quality: string;
    readonly semantic: string;
    readonly charm: string;
    readonly opentui: string;
  };
}

export interface BaselineMetric extends PerformanceObservation {
  /** A lower value is better for ceilings; exact metrics are cleanup invariants. */
  readonly direction: 'lower' | 'exact';
  /** Relative increase allowed above the recorded value for lower-is-better metrics. */
  readonly relativeTolerance: number;
  /** Absolute allowance, required for a zero baseline and useful for noisy small values. */
  readonly absoluteTolerance: number;
}

export interface PerformanceBaseline {
  readonly kind: typeof PERFORMANCE_BASELINE_KIND;
  readonly schemaVersion: typeof PERFORMANCE_BASELINE_VERSION;
  readonly recordedAt: string;
  readonly environment: string;
  readonly provenance: PerformanceBaselineProvenance;
  readonly metrics: Readonly<Record<string, BaselineMetric>>;
}

export interface BaselineMetricPolicy {
  readonly unit: BaselineUnit;
  readonly direction: 'lower' | 'exact';
  readonly relativeTolerance: number;
  readonly absoluteTolerance: number;
}

/** Stable review policy used to turn a measured runner-class observation into a baseline. */
export interface PerformanceBaselinePolicy {
  readonly kind: typeof PERFORMANCE_BASELINE_POLICY_KIND;
  readonly schemaVersion: typeof PERFORMANCE_BASELINE_POLICY_VERSION;
  readonly environment: string;
  readonly metrics: Readonly<Record<string, BaselineMetricPolicy>>;
}

export interface BaselineComparison {
  readonly metric: string;
  readonly status: 'ok' | 'failure';
  readonly baseline: number;
  readonly current: number;
  readonly allowedMaximum: number;
  readonly unit: BaselineUnit;
  readonly message: string;
}

/** Render a native workflow error for any baseline regression. */
export function formatGitHubError(comparison: BaselineComparison, file: string): string {
  if (comparison.status !== 'failure') throw new Error('only failed comparisons can be errors');
  return formatGitHubAnnotation('Performance baseline failed', comparison, file);
}

/** Compare one cadence observation and fail every reviewed-threshold breach. */
export function comparePerformanceBaseline(
  baseline: PerformanceBaseline,
  current: PerformanceObservationSet,
): readonly BaselineComparison[] {
  validateBaseline(baseline);
  validateObservationSet(current);
  if (baseline.environment !== current.environment) {
    throw new Error(
      `performance environments differ: baseline=${baseline.environment}, current=${current.environment}`,
    );
  }
  requireSameMetricSet(baseline.metrics, current.metrics, 'baseline', 'current observations');

  return Object.entries(baseline.metrics).map(([name, expected]) => {
    const observed = current.metrics[name];
    if (observed === undefined) throw new Error(`current observations are missing ${name}`);
    if (observed.unit !== expected.unit) {
      throw new Error(`${name} unit changed from ${expected.unit} to ${observed.unit}`);
    }
    if (observed.source !== expected.source) {
      throw new Error(
        `${name} measurement source changed from ${expected.source} to ${observed.source}`,
      );
    }
    const allowedMaximum =
      expected.direction === 'exact'
        ? expected.value + expected.absoluteTolerance
        : Math.max(
            expected.value + expected.absoluteTolerance,
            expected.value * (1 + expected.relativeTolerance),
          );
    const exceeded = observed.value > allowedMaximum;
    const status = exceeded ? ('failure' as const) : ('ok' as const);
    return {
      metric: name,
      status,
      baseline: expected.value,
      current: observed.value,
      allowedMaximum,
      unit: expected.unit,
      message: exceeded
        ? `${name} ${expected.direction === 'exact' ? 'violated its cleanup invariant' : 'regressed'}: ${observed.value} ${expected.unit} exceeds ${allowedMaximum} (baseline ${expected.value})`
        : `${name}: ${observed.value} ${expected.unit} (baseline ${expected.value}, allowed ${allowedMaximum})`,
    };
  });
}

/**
 * Capture a new runner-class baseline from measurements, never from an older
 * baseline's values. Exact metrics are cleanup invariants, so a leaking
 * capture is rejected instead of becoming the new normal.
 */
export function capturePerformanceBaseline(
  policy: PerformanceBaselinePolicy,
  current: PerformanceObservationSet,
  provenance: PerformanceBaselineProvenance,
): PerformanceBaseline {
  validateBaselinePolicy(policy);
  validateObservationSet(current);
  if (policy.environment !== current.environment) {
    throw new Error(
      `performance environments differ: policy=${policy.environment}, current=${current.environment}`,
    );
  }
  validateProvenance(provenance, current.environment);
  requireSameMetricSet(policy.metrics, current.metrics, 'baseline policy', 'current observations');

  const metrics = Object.fromEntries(
    Object.entries(policy.metrics).map(([name, expected]) => {
      const observed = current.metrics[name];
      if (observed === undefined) throw new Error(`current observations are missing ${name}`);
      if (observed.unit !== expected.unit) {
        throw new Error(`${name} unit changed from ${expected.unit} to ${observed.unit}`);
      }
      if (expected.direction === 'exact' && observed.value !== 0) {
        throw new Error(
          `${name} violated its exact cleanup invariant during baseline capture: ${observed.value}`,
        );
      }
      return [name, { ...observed, ...expected }];
    }),
  );

  const baseline: PerformanceBaseline = {
    kind: PERFORMANCE_BASELINE_KIND,
    schemaVersion: PERFORMANCE_BASELINE_VERSION,
    recordedAt: current.generatedAt,
    environment: current.environment,
    provenance,
    metrics,
  };
  validateBaseline(baseline);
  return baseline;
}

export function validateBaseline(value: unknown): asserts value is PerformanceBaseline {
  if (!record(value)) throw new Error('baseline must be an object');
  exactKeys(
    value,
    ['kind', 'schemaVersion', 'recordedAt', 'environment', 'provenance', 'metrics'],
    'baseline',
  );
  if (
    value.kind !== PERFORMANCE_BASELINE_KIND ||
    value.schemaVersion !== PERFORMANCE_BASELINE_VERSION
  ) {
    throw new Error('unsupported performance baseline kind or version');
  }
  date(value.recordedAt, 'baseline recordedAt');
  nonEmpty(value.environment, 'baseline environment');
  validateProvenance(value.provenance, value.environment);
  validateMetrics(value.metrics, true, true);
  validateRequiredCleanupMetrics(value.metrics, true);
}

export function validateBaselinePolicy(value: unknown): asserts value is PerformanceBaselinePolicy {
  if (!record(value)) throw new Error('baseline policy must be an object');
  exactKeys(value, ['kind', 'schemaVersion', 'environment', 'metrics'], 'baseline policy');
  if (
    value.kind !== PERFORMANCE_BASELINE_POLICY_KIND ||
    value.schemaVersion !== PERFORMANCE_BASELINE_POLICY_VERSION
  ) {
    throw new Error('unsupported performance baseline policy kind or version');
  }
  nonEmpty(value.environment, 'baseline policy environment');
  validateMetrics(value.metrics, true, false);
  validateRequiredCleanupMetrics(value.metrics, false);
}

export function validateObservationSet(value: unknown): asserts value is PerformanceObservationSet {
  if (!record(value)) throw new Error('observations must be an object');
  date(value.generatedAt, 'observations generatedAt');
  nonEmpty(value.environment, 'observations environment');
  validateMetrics(value.metrics, false, true);
  validateRequiredCleanupObservations(value.metrics);
}

const REQUIRED_CLEANUP_METRICS = ['leakedFileDescriptors', 'leakedProcesses'] as const;

function validateRequiredCleanupMetrics(value: unknown, values: boolean): void {
  if (!record(value)) throw new Error('cleanup metrics are missing');
  for (const name of REQUIRED_CLEANUP_METRICS) {
    const metric = value[name];
    if (!record(metric)) throw new Error(`${name} is a required exact cleanup invariant`);
    if (
      metric.unit !== 'count' ||
      metric.direction !== 'exact' ||
      metric.relativeTolerance !== 0 ||
      metric.absoluteTolerance !== 0
    ) {
      throw new Error(`${name} must be an exact count invariant with zero tolerance`);
    }
    if (values && metric.value !== 0)
      throw new Error(`${name} exact cleanup baseline must be zero`);
  }
}

function validateRequiredCleanupObservations(value: unknown): void {
  if (!record(value)) throw new Error('cleanup observations are missing');
  for (const name of REQUIRED_CLEANUP_METRICS) {
    const metric = value[name];
    if (!record(metric) || metric.unit !== 'count') {
      throw new Error(`${name} is a required count cleanup observation`);
    }
  }
}

function validateProvenance(
  value: unknown,
  environment: string,
): asserts value is PerformanceBaselineProvenance {
  if (!record(value) || !record(value.environment) || !record(value.rawInputs)) {
    throw new Error('baseline provenance is missing');
  }
  const descriptor = value.environment;
  if (descriptor.kind !== 'termwright-performance-environment' || descriptor.schemaVersion !== 1) {
    throw new Error('baseline provenance environment descriptor is unsupported');
  }
  if (descriptor.class !== environment)
    throw new Error('baseline provenance environment class differs from baseline');
  if (!record(descriptor.runner) || !record(descriptor.toolchains)) {
    throw new Error('baseline provenance environment descriptor is incomplete');
  }
  nonEmpty(descriptor.runner.image, 'baseline provenance runner image');
  nonEmpty(descriptor.runner.platform, 'baseline provenance runner platform');
  nonEmpty(descriptor.runner.arch, 'baseline provenance runner architecture');
  for (const name of ['node', 'go', 'bun'] as const) {
    const toolchain = descriptor.toolchains[name];
    if (!record(toolchain)) throw new Error(`baseline provenance ${name} toolchain is missing`);
    nonEmpty(toolchain.qualified, `baseline provenance ${name} qualification`);
    nonEmpty(toolchain.resolved, `baseline provenance ${name} resolution`);
  }
  const runnerClass =
    /^(darwin|linux)-(arm64|x64)-node(\d+)-go(\d+\.\d+)-bun(\d+\.\d+\.\d+)$/u.exec(environment);
  if (runnerClass === null) throw new Error('baseline provenance runner class is invalid');
  const [, platform, arch, nodeMajor, goLine, bunVersion] = runnerClass;
  if (descriptor.runner.platform !== platform || descriptor.runner.arch !== arch) {
    throw new Error('baseline provenance runner does not match its class');
  }
  const node = descriptor.toolchains.node as Record<string, unknown>;
  const go = descriptor.toolchains.go as Record<string, unknown>;
  const bun = descriptor.toolchains.bun as Record<string, unknown>;
  if (
    node.qualified !== nodeMajor ||
    major(node.resolved) !== nodeMajor ||
    go.qualified !== goLine ||
    majorMinor(go.resolved) !== goLine ||
    bun.qualified !== bunVersion ||
    bun.resolved !== bunVersion
  ) {
    throw new Error('baseline provenance toolchains do not match their runner class');
  }
  for (const name of ['quality', 'semantic', 'charm', 'opentui'] as const) {
    const digest = value.rawInputs[name];
    if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/u.test(digest)) {
      throw new Error(`baseline provenance ${name} SHA-256 is invalid`);
    }
  }
}

function major(value: unknown): string | undefined {
  return typeof value === 'string' ? /^(\d+)\./u.exec(value)?.[1] : undefined;
}

function majorMinor(value: unknown): string | undefined {
  return typeof value === 'string' ? /^(\d+\.\d+)(?:\.|$)/u.exec(value)?.[1] : undefined;
}

function validateMetrics(value: unknown, policy: boolean, values: boolean): void {
  if (!record(value) || Object.keys(value).length === 0)
    throw new Error('metrics must be a non-empty object');
  for (const [name, candidate] of Object.entries(value)) {
    nonEmpty(name, 'metric name');
    if (!record(candidate)) throw new Error(`${name} must be an object`);
    if (values) {
      finite(candidate.value, `${name}.value`);
      nonEmpty(candidate.source, `${name}.source`);
    } else {
      if ('value' in candidate) throw new Error(`${name} policy must not contain a measured value`);
      if ('source' in candidate)
        throw new Error(`${name} policy must not contain an observation source`);
    }
    if (!BASELINE_UNITS.includes(candidate.unit as BaselineUnit)) {
      throw new Error(`${name}.unit is unsupported`);
    }
    if (!policy) continue;
    if (candidate.direction !== 'lower' && candidate.direction !== 'exact') {
      throw new Error(`${name}.direction must be lower or exact`);
    }
    if (values && candidate.direction === 'exact' && candidate.value !== 0) {
      throw new Error(`${name}.direction exact is reserved for zero-leak invariants`);
    }
    finite(candidate.relativeTolerance, `${name}.relativeTolerance`);
    finite(candidate.absoluteTolerance, `${name}.absoluteTolerance`);
    if (
      (candidate.relativeTolerance as number) < 0 ||
      (candidate.absoluteTolerance as number) < 0
    ) {
      throw new Error(`${name} tolerances must be non-negative`);
    }
    if (
      candidate.direction === 'exact' &&
      (candidate.relativeTolerance !== 0 || candidate.absoluteTolerance !== 0)
    ) {
      throw new Error(`${name} exact cleanup policy must have zero tolerance`);
    }
  }
}

function requireSameMetricSet(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
  leftName: string,
  rightName: string,
): void {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (
    leftKeys.length !== rightKeys.length ||
    leftKeys.some((key, index) => key !== rightKeys[index])
  ) {
    throw new Error(`${leftName} and ${rightName} must contain the same metric set`);
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite non-negative number`);
  }
}

function nonEmpty(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new Error(`${name} must be a string`);
}

function date(value: unknown, name: string): void {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    throw new Error(`${name} must be an ISO date`);
}

function escapeAnnotation(value: string): string {
  return value
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A')
    .replaceAll(':', '%3A')
    .replaceAll(',', '%2C');
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  owner: string,
): void {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new Error(`${owner} must contain exactly: ${required.join(', ')}`);
  }
}

function formatGitHubAnnotation(
  title: string,
  comparison: BaselineComparison,
  file: string,
): string {
  return `::error file=${escapeAnnotation(file)},title=${escapeAnnotation(title)}::${escapeAnnotation(comparison.message)}`;
}
