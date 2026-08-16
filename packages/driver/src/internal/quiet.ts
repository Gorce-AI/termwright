/**
 * "The output stream has stopped" — the second half of the evidence barrier
 * the revision pairing waits on.
 *
 * A pending revision half may not be declared missing while its partner could
 * still be in transit. Two things can hold that partner up, and they need
 * different questions: bytes already received but not yet parsed (answered by
 * draining the emulator), and bytes still inside the pty (answered here, by
 * waiting for the stream to fall quiet).
 */

/** Everything the wait needs, injected so it can be driven by a test clock. */
export interface QuietOptions {
  /** Timestamp of the most recent output, on the same clock as {@link now}. */
  lastOutputAt(): number;
  /** How long the stream must be silent to count as stopped. */
  readonly quietMs: number;
  now(): number;
  /** Resolves after roughly `ms`; a test supplies its own. */
  sleep(ms: number): Promise<void>;
  /** True once the session is gone: the wait gives up rather than spinning. */
  cancelled?(): boolean;
}

/**
 * Resolves once no output has arrived for `quietMs`.
 *
 * Re-checks after each sleep rather than sleeping once, because output that
 * lands mid-wait moves the deadline — a stream that keeps talking never
 * becomes quiet, which is the intended answer, not a hang: the caller's
 * queue is bounded elsewhere and evicts under pressure.
 */
export async function waitForQuiet(options: QuietOptions): Promise<void> {
  for (;;) {
    if (options.cancelled?.() === true) return;
    const idle = options.now() - options.lastOutputAt();
    if (idle >= options.quietMs) return;
    await options.sleep(options.quietMs - idle);
  }
}
