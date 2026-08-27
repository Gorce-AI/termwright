export type AttemptPhase =
  | 'before-each'
  | 'fixture'
  | 'operation'
  | 'assertion'
  | 'diagnostics'
  | 'trace-flush'
  | 'teardown'
  | 'cleanup';

export interface AttemptBudgetReserves {
  readonly diagnosticsMs: number;
  readonly traceFlushMs: number;
  readonly teardownMs: number;
}

export const DEFAULT_ATTEMPT_BUDGET_RESERVES: AttemptBudgetReserves = Object.freeze({
  diagnosticsMs: 250,
  traceFlushMs: 500,
  teardownMs: 1_000,
});

export class AttemptBudgetExceededError extends Error {
  readonly code = 'TW_ATTEMPT_BUDGET_EXCEEDED';
  readonly phase: AttemptPhase;
  readonly elapsedMs: number;
  readonly totalMs: number;
  readonly reserves: AttemptBudgetReserves;

  constructor(input: {
    readonly phase: AttemptPhase;
    readonly elapsedMs: number;
    readonly totalMs: number;
    readonly reserves: AttemptBudgetReserves;
  }) {
    super(
      `attempt budget exhausted before ${input.phase}; elapsed=${Math.round(input.elapsedMs)}ms ` +
        `total=${input.totalMs}ms reserves=` +
        `diagnostics:${input.reserves.diagnosticsMs},trace:${input.reserves.traceFlushMs},teardown:${input.reserves.teardownMs}`,
    );
    this.name = 'AttemptBudgetExceededError';
    this.phase = input.phase;
    this.elapsedMs = input.elapsedMs;
    this.totalMs = input.totalMs;
    this.reserves = input.reserves;
  }
}

/** One monotonic budget spanning a complete native try and its cleanup. */
export class TestBudget {
  #startedAt: number;
  #endsAt: number;
  readonly #totalMs: number;
  readonly #reserves: AttemptBudgetReserves;
  readonly #now: () => number;
  #started: boolean;
  #phase: AttemptPhase = 'before-each';

  constructor(
    totalMs: number,
    reserves: AttemptBudgetReserves = DEFAULT_ATTEMPT_BUDGET_RESERVES,
    now: () => number = () => performance.now(),
    deferred = false,
  ) {
    finiteNonNegative(totalMs, 'attempt timeout');
    finiteNonNegative(reserves.diagnosticsMs, 'diagnostics reserve');
    finiteNonNegative(reserves.traceFlushMs, 'trace flush reserve');
    finiteNonNegative(reserves.teardownMs, 'teardown reserve');
    this.#totalMs = totalMs;
    this.#reserves = Object.freeze({ ...reserves });
    this.#now = now;
    this.#startedAt = now();
    this.#endsAt = this.#startedAt + totalMs;
    this.#started = !deferred;
  }

  get phase(): AttemptPhase {
    return this.#phase;
  }
  get totalMs(): number {
    return this.#totalMs;
  }
  get reserves(): AttemptBudgetReserves {
    return this.#reserves;
  }

  /** Starts a budget created dormant for host-owned resource admission. */
  start(): void {
    if (this.#started) throw new Error('attempt budget has already started');
    this.#startedAt = this.#now();
    this.#endsAt = this.#startedAt + this.#totalMs;
    this.#started = true;
  }

  /**
   * Returns time spent waiting for host-owned resource admission.
   *
   * Queueing for capacity shared by the whole run is a property of the
   * machine and the configured parallelism, never of the attempt's own work.
   * An attempt admitted up front through `test.resources()` never pays for the
   * wait, and one that acquires lazily must not pay either — otherwise the
   * same test passes or fails on how busy its neighbours happen to be.
   */
  creditAdmissionWait(waitedMs: number): void {
    finiteNonNegative(waitedMs, 'admission wait');
    this.#endsAt += waitedMs;
  }

  enter(phase: AttemptPhase): void {
    this.#assertStarted();
    this.#phase = phase;
    this.assertAvailable(phase);
  }

  /** Marks mandatory diagnostics/cleanup work, which must run even if late. */
  mark(phase: AttemptPhase): void {
    this.#phase = phase;
  }

  /** Remaining public-operation time, capped before a phase starts. */
  operationTimeout(requestedMs: number, phase: 'operation' | 'assertion' = 'operation'): number {
    this.#assertStarted();
    finiteNonNegative(requestedMs, 'requested operation timeout');
    this.#phase = phase;
    const remaining = this.#deadlineFor(phase) - this.#now();
    if (remaining <= 0) this.#expired(phase);
    return Math.min(requestedMs, remaining);
  }

  remaining(phase: AttemptPhase = this.#phase): number {
    this.#assertStarted();
    return Math.max(0, this.#deadlineFor(phase) - this.#now());
  }

  /**
   * Bounded control-plane time after user execution has already failed.
   *
   * Vitest runs fixture/user cleanup after its test-function timeout. The
   * attempt terminal event cannot be emitted earlier and must not disappear
   * merely because user code exhausted the execution budget. This allowance
   * never changes the failed test result or starts product work.
   */
  finalizationTimeout(requestedMs: number): number {
    this.#assertStarted();
    finiteNonNegative(requestedMs, 'requested finalization timeout');
    this.#phase = 'cleanup';
    const remaining = this.remaining('cleanup');
    if (remaining > 0) return Math.min(requestedMs, remaining);
    return Math.min(requestedMs, this.#reserves.teardownMs);
  }

  assertAvailable(phase: AttemptPhase = this.#phase): void {
    this.#assertStarted();
    if (this.remaining(phase) <= 0) this.#expired(phase);
  }

  #deadlineFor(phase: AttemptPhase): number {
    const { diagnosticsMs, traceFlushMs, teardownMs } = this.#reserves;
    switch (phase) {
      case 'before-each':
      case 'fixture':
      case 'operation':
      case 'assertion':
        return this.#endsAt - diagnosticsMs - traceFlushMs - teardownMs;
      case 'diagnostics':
        return this.#endsAt - traceFlushMs - teardownMs;
      case 'trace-flush':
        return this.#endsAt - teardownMs;
      case 'teardown':
      case 'cleanup':
        return this.#endsAt;
    }
  }

  #expired(phase: AttemptPhase): never {
    throw new AttemptBudgetExceededError({
      phase,
      elapsedMs: this.#now() - this.#startedAt,
      totalMs: this.#totalMs,
      reserves: this.#reserves,
    });
  }

  #assertStarted(): void {
    if (!this.#started)
      throw new Error('attempt budget has not started; resource admission is still pending');
  }
}

function finiteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0)
    throw new TypeError(`${label} must be a finite non-negative number`);
}
