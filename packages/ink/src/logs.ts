/**
 * Forwarding application logs to the driver.
 *
 * A TUI cannot print diagnostics without corrupting its own render, so the
 * interesting ones end up in a logger that a test can no longer see. This file
 * carries them across: it subscribes to the `termwright:log` diagnostics
 * channel and pushes each record down the semantic channel.
 *
 * Two rules shape it. **The budget is enforced here, at the source**, because a
 * log storm that reached the socket would compete with the semantic tree for
 * the frame budget; over-budget records are dropped locally, and the resulting
 * gap in `LogRecord.seq` is how the driver learns how many were lost. And, as
 * everywhere else in this adapter, **nothing here may take the application
 * down**: a fault disables log forwarding and leaves rendering untouched.
 */

import { format } from 'node:util';
import { publishLog, subscribeToLogs } from '@termwright/logs';
import type { LogLevel, LogRecord, ProtocolLimits } from '@termwright/protocol';
import type { SemanticChannel } from './channel.js';

/** The driver's log budget, as negotiated in `hello-ack`. */
export interface LogBudget {
  readonly maxRecordsPerSecond: number;
  readonly burst: number;
}

/** Everything the forwarder needs beyond the budget itself. */
export interface LogForwarderOptions {
  readonly channel: SemanticChannel;
  readonly budget: LogBudget;
  readonly limits: ProtocolLimits;
  /** Current semantic revision, or 0 before the first commit. */
  readonly currentRevision: () => number;
  /** Monotonic clock in milliseconds. Injectable for tests. */
  readonly now?: () => number;
}

/**
 * A token bucket sized by the driver's budget.
 *
 * `maxRecordsPerSecond` is the sustained refill rate and `burst` the capacity,
 * so a quiet application can spend a backlog of tokens on a sudden burst
 * without the steady-state ceiling moving.
 */
class TokenBucket {
  readonly #rate: number;
  readonly #capacity: number;
  readonly #now: () => number;
  #tokens: number;
  #updated: number;

  constructor(rate: number, capacity: number, now: () => number) {
    this.#rate = rate;
    this.#capacity = capacity;
    this.#now = now;
    this.#tokens = capacity;
    this.#updated = now();
  }

  /** Consume one token. Returns `false` when the budget is exhausted. */
  take(): boolean {
    const now = this.#now();
    const elapsedSeconds = Math.max(0, now - this.#updated) / 1000;
    this.#updated = now;
    this.#tokens = Math.min(this.#capacity, this.#tokens + elapsedSeconds * this.#rate);
    if (this.#tokens < 1) return false;
    this.#tokens -= 1;
    return true;
  }
}

/**
 * Subscribes to application logs and forwards them within budget.
 *
 * Start one with {@link startLogForwarder}; a `null` result means the driver's
 * budget was unusable and no subscription was made.
 */
export class LogForwarder {
  readonly #options: LogForwarderOptions;
  readonly #bucket: TokenBucket;
  #unsubscribe: (() => void) | undefined;
  #dropped = 0;

  /** @internal Use {@link startLogForwarder}. */
  constructor(options: LogForwarderOptions, bucket: TokenBucket) {
    this.#options = options;
    this.#bucket = bucket;
    this.#unsubscribe = subscribeToLogs((record) => this.#forward(record), {
      limits: options.limits,
      // A malformed third-party publisher is not this application's problem,
      // and neither is a fault in our own send path.
      onInvalid: () => undefined,
      onError: () => undefined,
    });
  }

  /** How many records the budget rejected. Equals the total gap in `seq`. */
  get dropped(): number {
    return this.#dropped;
  }

  /** Whether the forwarder is still subscribed. */
  get isActive(): boolean {
    return this.#unsubscribe !== undefined;
  }

  /** Unsubscribe. Idempotent. */
  dispose(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
  }

  #forward(record: LogRecord): void {
    const { channel } = this.#options;
    if (!channel.isOpen) {
      this.dispose();
      return;
    }
    if (!this.#bucket.take()) {
      // Dropped on purpose: the gap this leaves in `seq` is the signal.
      this.#dropped += 1;
      return;
    }
    channel.sendLog(this.#stamp(record));
  }

  /**
   * Attach the revision that was on screen when the record was produced.
   *
   * Forwarding is synchronous with publication, so "current" is accurate. A
   * fresh object is built rather than the record mutated: records are frozen,
   * and reusing one object across messages is exactly the aliasing trap that
   * the protocol's DTO projection rejects.
   */
  #stamp(record: LogRecord): LogRecord {
    if (record.revision !== undefined) return record;
    const revision = this.#options.currentRevision();
    return revision > 0 ? { ...record, revision } : record;
  }
}

/**
 * Start forwarding application logs.
 *
 * @returns the forwarder, or `null` when the driver's budget is not a usable
 * pair of positive numbers — in which case nothing is subscribed at all, which
 * is the fail-closed reading of a budget we cannot honour.
 */
export function startLogForwarder(options: LogForwarderOptions): LogForwarder | null {
  const { maxRecordsPerSecond, burst } = options.budget;
  if (!Number.isFinite(maxRecordsPerSecond) || maxRecordsPerSecond <= 0) return null;
  if (!Number.isFinite(burst) || burst < 1) return null;

  const now = options.now ?? (() => performance.now());
  return new LogForwarder(options, new TokenBucket(maxRecordsPerSecond, burst, now));
}

/** Console methods captured, and the level each maps onto. */
const CONSOLE_LEVELS: Readonly<Record<string, LogLevel>> = Object.freeze({
  error: 'error',
  warn: 'warn',
  info: 'info',
  log: 'info',
  debug: 'debug',
});

/** Minimal shape of the console methods this module replaces. */
type ConsoleMethod = (...args: readonly unknown[]) => void;

/**
 * Capture `console.*` calls as log records.
 *
 * Ink offers no way to observe what its own `patchConsole` intercepts — the
 * callback is private, and it would not help anyway: it receives already
 * formatted text tagged only `stdout` or `stderr`, so `warn` and `error` are
 * indistinguishable by the time Ink sees them (see NOTES.md). Wrapping the
 * console methods directly is plain JavaScript, keeps the level, and composes
 * with Ink rather than fighting it: the wrapper is installed *after* Ink has
 * patched, so the original call still reaches Ink's render-safe routing, and
 * Ink's own restore on unmount drops the wrapper with it.
 *
 * Records are published to the diagnostics channel, which is free while no
 * termwright session is subscribed, and are tagged `logger: 'console'` so a
 * test can tell them apart from an application's structured logging.
 *
 * @returns a function restoring the previous methods; calling it twice is
 * harmless.
 */
export function captureConsole(target: Console = console): () => void {
  const previous = new Map<string, ConsoleMethod>();

  for (const [method, level] of Object.entries(CONSOLE_LEVELS)) {
    const original = (target as unknown as Record<string, ConsoleMethod>)[method];
    if (typeof original !== 'function') continue;
    previous.set(method, original);

    (target as unknown as Record<string, ConsoleMethod>)[method] = (
      ...args: readonly unknown[]
    ): void => {
      try {
        // Cheap when nobody listens: `publishLog` checks for subscribers
        // before it touches the thunk.
        publishLog(() => ({
          level,
          message: format(...args),
          logger: 'console',
        }));
      } catch {
        // Capturing a log must never break the call it was capturing.
      }
      original.apply(target, args as unknown[]);
    };
  }

  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    for (const [method, original] of previous) {
      (target as unknown as Record<string, ConsoleMethod>)[method] = original;
    }
  };
}
