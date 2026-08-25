import type { ObservationStamp } from '@termwright/protocol';
import type { ErrorDiagnostics } from '../api.js';
import { NotActionableError, StaleSnapshotError, TimeoutError } from '../errors.js';
import { Deadline, type MonotonicClock as Clock, systemMonotonicClock } from './deadline.js';

export interface ActionRetryContext {
  checkpoint(): ObservationStamp;
  actionObservationState?(): 'settled' | 'parser-in-flight' | 'semantic-frame-open' | 'pairing-pending';
  /** Wall-clock deadline retained at the session boundary; the budget itself is monotonic. */
  waitForChange(deadline: number): Promise<void>;
}

export type MonotonicClock = () => number;

export function assertBeforeActionInput(
  deadline: number,
  diagnostics: ErrorDiagnostics,
  clock: MonotonicClock = () => systemMonotonicClock.now(),
): void {
  if (clock() >= deadline) {
    throw new TimeoutError('the action deadline expired before physical input began', diagnostics);
  }
}

function relevantObservationChanged(
  error: StaleSnapshotError | NotActionableError,
  left: ObservationStamp,
  right: ObservationStamp,
): boolean {
  if (left.contractId !== right.contractId || left.epoch !== right.epoch) return true;
  if (error instanceof StaleSnapshotError) return left.sequence !== right.sequence;
  const targetRef = error.actionability?.reason?.targetRef ?? error.actionability?.intent.targetRef;
  return targetRef?.startsWith('screen:') === true
    ? left.screenRevision !== right.screenRevision
    : left.semanticRevision !== right.semanticRevision || left.pairedScreenRevision !== right.pairedScreenRevision;
}

function recoverable(error: unknown): error is StaleSnapshotError | NotActionableError {
  return error instanceof StaleSnapshotError ||
    (error instanceof NotActionableError && error.transient !== null);
}

/** One monotonic budget for resolution, planning, retry waits and first input. */
export class ActionRetryController {
  readonly deadline: number;
  readonly #clock: MonotonicClock;
  readonly #budget: Deadline;
  #staleRetries = 0;

  constructor(timeoutMs: number, clock: MonotonicClock = () => systemMonotonicClock.now()) {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw new RangeError(`action timeout must be a finite non-negative number, received ${String(timeoutMs)}`);
    }
    this.#clock = clock;
    const deadlineClock: Clock = { now: clock };
    this.#budget = Deadline.after(timeoutMs, deadlineClock);
    this.deadline = this.#budget.at;
  }

  remaining(): number {
    return this.#budget.remaining();
  }

  expired(): boolean {
    return this.#budget.expired();
  }

  /** Final guard immediately before the executor may emit its first byte. */
  assertBeforeInput(diagnostics: ErrorDiagnostics): void {
    assertBeforeActionInput(this.deadline, diagnostics, this.#clock);
  }

  async retry(error: unknown, ctx: ActionRetryContext): Promise<void> {
    if (!recoverable(error) || this.expired()) throw error;

    // A stale plan proves a newer observation already exists. Re-plan once
    // immediately; repeated stale races must wait for another committed frame.
    if (error instanceof StaleSnapshotError && this.#staleRetries++ === 0) return;

    const failedAt = error.actionability?.checkpoint ?? ctx.checkpoint();
    if (relevantObservationChanged(error, failedAt, ctx.checkpoint())) return;
    const observationState = ctx.actionObservationState?.();
    const pendingObservation = observationState !== undefined && observationState !== 'settled';

    for (;;) {
      await ctx.waitForChange(this.deadline);
      // Expiry wins immediately after every wait, before another resolution or
      // any device operation can consume time or emit bytes.
      if (this.expired()) throw error;
      if (pendingObservation && ctx.actionObservationState?.() === 'settled') return;
      if (relevantObservationChanged(error, failedAt, ctx.checkpoint())) return;
      // Status/log/output notifications can wake the session without a paired
      // observation. Stay here rather than creating a re-plan storm.
    }
  }
}
