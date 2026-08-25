export const PERFORMANCE_BASELINE_KIND = 'termwright-performance-baseline' as const;
export const PERFORMANCE_BASELINE_VERSION = 1 as const;

export type BaselineUnit = 'milliseconds' | 'bytes' | 'count' | 'microseconds/frame' | 'ratio';
const BASELINE_UNITS: readonly BaselineUnit[] = [
  'milliseconds', 'bytes', 'count', 'microseconds/frame', 'ratio',
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
  readonly history: {
    readonly samples: number;
    readonly blockingAfterSamples: number;
    readonly decision: 'annotate';
  };
  readonly metrics: Readonly<Record<string, BaselineMetric>>;
}

export interface BaselineComparison {
  readonly metric: string;
  readonly status: 'ok' | 'warning' | 'failure';
  readonly baseline: number;
  readonly current: number;
  readonly allowedMaximum: number;
  readonly unit: BaselineUnit;
  readonly message: string;
}

/** Render a native workflow annotation for a non-blocking regression. */
export function formatGitHubWarning(comparison: BaselineComparison, file: string): string {
  if (comparison.status !== 'warning') throw new Error('only warning comparisons can be annotated');
  return formatGitHubAnnotation('warning', 'Performance regression', comparison, file);
}

/** Render a native workflow error for a violated exact cleanup invariant. */
export function formatGitHubError(comparison: BaselineComparison, file: string): string {
  if (comparison.status !== 'failure') throw new Error('only failed comparisons can be errors');
  return formatGitHubAnnotation('error', 'Cleanup invariant failed', comparison, file);
}

/** Compare one cadence observation without turning an early baseline into a merge gate. */
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

  return Object.entries(baseline.metrics).map(([name, expected]) => {
    const observed = current.metrics[name];
    if (observed === undefined) throw new Error(`current observations are missing ${name}`);
    if (observed.unit !== expected.unit) {
      throw new Error(`${name} unit changed from ${expected.unit} to ${observed.unit}`);
    }
    const allowedMaximum = expected.direction === 'exact'
      ? expected.value + expected.absoluteTolerance
      : Math.max(
        expected.value + expected.absoluteTolerance,
        expected.value * (1 + expected.relativeTolerance),
      );
    const exceeded = observed.value > allowedMaximum;
    const status = !exceeded
      ? 'ok' as const
      : expected.direction === 'exact'
        ? 'failure' as const
        : 'warning' as const;
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

export function validateBaseline(value: unknown): asserts value is PerformanceBaseline {
  if (!record(value)) throw new Error('baseline must be an object');
  if (value.kind !== PERFORMANCE_BASELINE_KIND || value.schemaVersion !== PERFORMANCE_BASELINE_VERSION) {
    throw new Error('unsupported performance baseline kind or version');
  }
  date(value.recordedAt, 'baseline recordedAt');
  nonEmpty(value.environment, 'baseline environment');
  if (!record(value.history)) throw new Error('baseline history is missing');
  integer(value.history.samples, 'baseline history samples', 1);
  integer(value.history.blockingAfterSamples, 'baseline blockingAfterSamples', 1);
  if (value.history.decision !== 'annotate') throw new Error('performance baseline must remain annotate-only');
  validateMetrics(value.metrics, true);
}

export function validateObservationSet(value: unknown): asserts value is PerformanceObservationSet {
  if (!record(value)) throw new Error('observations must be an object');
  date(value.generatedAt, 'observations generatedAt');
  nonEmpty(value.environment, 'observations environment');
  validateMetrics(value.metrics, false);
}

function validateMetrics(value: unknown, baseline: boolean): void {
  if (!record(value) || Object.keys(value).length === 0) throw new Error('metrics must be a non-empty object');
  for (const [name, candidate] of Object.entries(value)) {
    nonEmpty(name, 'metric name');
    if (!record(candidate)) throw new Error(`${name} must be an object`);
    finite(candidate.value, `${name}.value`);
    if (!BASELINE_UNITS.includes(candidate.unit as BaselineUnit)) {
      throw new Error(`${name}.unit is unsupported`);
    }
    nonEmpty(candidate.source, `${name}.source`);
    if (!baseline) continue;
    if (candidate.direction !== 'lower' && candidate.direction !== 'exact') {
      throw new Error(`${name}.direction must be lower or exact`);
    }
    if (candidate.direction === 'exact' && candidate.value !== 0) {
      throw new Error(`${name}.direction exact is reserved for zero-leak invariants`);
    }
    finite(candidate.relativeTolerance, `${name}.relativeTolerance`);
    finite(candidate.absoluteTolerance, `${name}.absoluteTolerance`);
    if ((candidate.relativeTolerance as number) < 0 || (candidate.absoluteTolerance as number) < 0) {
      throw new Error(`${name} tolerances must be non-negative`);
    }
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

function integer(value: unknown, name: string, minimum: number): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }
}

function nonEmpty(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be a string`);
}

function date(value: unknown, name: string): void {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error(`${name} must be an ISO date`);
}

function escapeAnnotation(value: string): string {
  return value
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A')
    .replaceAll(':', '%3A')
    .replaceAll(',', '%2C');
}

function formatGitHubAnnotation(
  level: 'warning' | 'error',
  title: string,
  comparison: BaselineComparison,
  file: string,
): string {
  return `::${level} file=${escapeAnnotation(file)},title=${escapeAnnotation(title)}::${escapeAnnotation(comparison.message)}`;
}
