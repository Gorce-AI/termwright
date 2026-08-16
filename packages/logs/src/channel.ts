/**
 * The `termwright:log` diagnostics channel.
 *
 * The channel name is a **public contract**, not an implementation detail. Any
 * application can feed termwright without importing it, and without taking a
 * production dependency on a test tool:
 *
 * ```js
 * import { channel } from 'node:diagnostics_channel';
 * channel('termwright:log').publish({ level: 'error', message: 'payment failed' });
 * ```
 *
 * When nothing is listening, `Channel.publish` is a no-op and this module adds
 * nothing on top of it — see {@link publishLog}, which refuses to touch its
 * input until it knows someone is subscribed.
 */

import { channel, type Channel } from 'node:diagnostics_channel';
import {
  DEFAULT_LIMITS,
  type LogRecord,
  type ProtocolLimits,
  validateLogRecord,
} from '@termwright/protocol';
import { type LogInput, normalizeLogRecord, redactRecord } from './normalize.js';
import { type RedactionOptions, type ResolvedRedaction, resolveRedaction } from './redact.js';

/** Name of the diagnostics channel carrying application log records. */
export const LOG_CHANNEL_NAME = 'termwright:log';

let cached: Channel | undefined;

/** The shared channel object. */
export function getLogChannel(): Channel {
  cached ??= channel(LOG_CHANNEL_NAME);
  return cached;
}

/**
 * Whether anything is currently subscribed.
 *
 * Guard expensive log construction with this: building a structured record
 * costs nothing if it never happens.
 */
export function hasLogSubscribers(): boolean {
  return getLogChannel().hasSubscribers;
}

let sequence = 0;

/** Next sequence number, monotonic for the lifetime of the process. */
export function nextLogSequence(): number {
  const value = sequence;
  sequence += 1;
  return value;
}

/** Reset the sequence counter. Intended for tests. */
export function resetLogSequence(): void {
  sequence = 0;
}

/** Settings for {@link publishLog}. */
export interface PublishOptions {
  readonly limits?: ProtocolLimits;
  readonly redaction?: RedactionOptions;
  /** Clock, injectable for tests. */
  readonly now?: () => number;
}

/**
 * Normalise, redact and publish one record.
 *
 * **Zero cost when nobody is listening**: the subscriber check happens before
 * anything else, so a thunk is never invoked and an input object is never even
 * read. That is what makes it safe to leave calls in production code.
 *
 * @param input - A record, or a thunk building one (preferred on hot paths).
 * @param options - Limits, redaction and clock.
 * @returns `true` if the record was published, `false` if nobody was listening.
 */
export function publishLog(
  input: LogInput | (() => LogInput),
  options: PublishOptions = {},
): boolean {
  const target = getLogChannel();
  if (!target.hasSubscribers) return false;

  const resolved = typeof input === 'function' ? input() : input;
  const record = normalizeLogRecord(resolved, {
    seq: nextLogSequence(),
    limits: options.limits ?? DEFAULT_LIMITS,
    redaction: resolveRedaction(options.redaction),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  target.publish(record);
  return true;
}

/** Settings for {@link subscribeToLogs}. */
export interface SubscribeOptions {
  readonly limits?: ProtocolLimits;
  /**
   * Receive-side redaction. Applied even to records that arrived already
   * redacted, because the channel is public and a third-party publisher never
   * ran ours.
   */
  readonly redaction?: RedactionOptions;
  /** Called instead of the handler when a message cannot be made valid. */
  readonly onInvalid?: (detail: string, raw: unknown) => void;
  /** Called when the handler itself throws. Defaults to swallowing. */
  readonly onError?: (error: unknown, record: LogRecord) => void;
}

function coerce(
  raw: unknown,
  limits: ProtocolLimits,
  redaction: ResolvedRedaction,
): { readonly record: LogRecord } | { readonly detail: string } {
  // Fast path: a record published by us is already well-formed, and keeping it
  // verbatim preserves the publisher's seq, which is what makes gaps mean
  // "records were dropped" rather than "two counters disagree".
  const direct = validateLogRecord(raw, limits);
  if (direct.ok) return { record: redactRecord(direct.record, redaction) };

  if (typeof raw !== 'object' || raw === null) {
    return { detail: `log message must be an object (${direct.detail})` };
  }
  const normalized = normalizeLogRecord(raw as LogInput, {
    seq: nextLogSequence(),
    limits,
    redaction,
  });
  const checked = validateLogRecord(normalized, limits);
  return checked.ok ? { record: checked.record } : { detail: checked.detail };
}

/**
 * Subscribe to application log records.
 *
 * Every message is coerced into a valid, redacted `LogRecord` before the
 * handler sees it, so a handler never has to defend itself against a
 * third-party publisher's shape. A handler that throws cannot break the
 * publisher: the error is routed to `onError`.
 *
 * @param handler - Receives each valid record.
 * @param options - Limits, redaction and error routing.
 * @returns An unsubscribe function; calling it twice is harmless.
 */
export function subscribeToLogs(
  handler: (record: LogRecord) => void,
  options: SubscribeOptions = {},
): () => void {
  const limits = options.limits ?? DEFAULT_LIMITS;
  const redaction = resolveRedaction(options.redaction);
  const target = getLogChannel();

  const listener = (message: unknown): void => {
    const result = coerce(message, limits, redaction);
    if ('detail' in result) {
      options.onInvalid?.(result.detail, message);
      return;
    }
    try {
      handler(result.record);
    } catch (error) {
      options.onError?.(error, result.record);
    }
  };

  target.subscribe(listener);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    target.unsubscribe(listener);
  };
}
