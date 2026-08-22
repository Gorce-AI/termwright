/** A monotonic clock used for correctness budgets. */
export interface MonotonicClock {
  now(): number;
}

export const systemMonotonicClock: MonotonicClock = Object.freeze({
  now: () => performance.now(),
});

/**
 * One absolute monotonic deadline shared by every phase of an operation.
 * Wall time is deliberately absent: changing the system clock cannot extend or
 * prematurely expire a Termwright operation.
 */
export class Deadline {
  readonly at: number;
  readonly #clock: MonotonicClock;

  private constructor(at: number, clock: MonotonicClock) {
    this.at = at;
    this.#clock = clock;
  }

  static after(timeoutMs: number, clock: MonotonicClock = systemMonotonicClock): Deadline {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw new RangeError(`timeout must be a finite non-negative number, received ${String(timeoutMs)}`);
    }
    return new Deadline(clock.now() + timeoutMs, clock);
  }

  static at(at: number, clock: MonotonicClock = systemMonotonicClock): Deadline {
    if (!Number.isFinite(at)) throw new RangeError(`deadline must be finite, received ${String(at)}`);
    return new Deadline(at, clock);
  }

  remaining(): number {
    return Math.max(0, this.at - this.#clock.now());
  }

  expired(): boolean {
    return this.#clock.now() >= this.at;
  }

  cap(durationMs: number): number {
    return Math.min(this.at, this.#clock.now() + Math.max(0, durationMs));
  }
}
