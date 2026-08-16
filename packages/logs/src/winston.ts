/**
 * winston bridge.
 *
 * A winston logger is a stream that pipes each `info` object to its
 * transports, and `winston-transport` is itself an object-mode `Writable`.
 * Implementing that shape directly means this module needs no winston import
 * and cannot drift from the version the application installed.
 *
 * ```ts
 * import winston from 'winston';
 * import { createWinstonTransport } from '@termwright/logs/winston';
 *
 * const logger = winston.createLogger({
 *   level: 'silly',
 *   transports: [createWinstonTransport()],
 * });
 * ```
 */

import { Writable } from 'node:stream';
import { publishLog, type PublishOptions } from './channel.js';
import type { LogInput } from './normalize.js';

/** The `info` object winston hands to a transport. */
export interface WinstonInfo {
  readonly level?: string;
  readonly message?: unknown;
  readonly timestamp?: string | number | Date;
  readonly label?: string;
  readonly [key: string]: unknown;
}

/** Settings for {@link createWinstonTransport}. */
export interface WinstonBridgeOptions extends PublishOptions {
  /** Transport-level threshold, honoured by winston itself. */
  readonly level?: string;
}

const WINSTON_RESERVED = new Set(['level', 'message', 'timestamp', 'label']);

function toInput(info: WinstonInfo): LogInput {
  const attrs: Record<string, unknown> = {};
  // Symbol-keyed winston internals (Symbol.for('level'), 'splat', 'message')
  // are invisible to Object.entries, so they are skipped for free.
  for (const [key, value] of Object.entries(info)) {
    if (WINSTON_RESERVED.has(key)) continue;
    attrs[key] = value;
  }
  const input: Record<string, unknown> = {
    level: info.level,
    message: info.message,
    attrs,
  };
  if (info.timestamp !== undefined) input['timestamp'] = info.timestamp;
  if (typeof info.label === 'string') input['logger'] = info.label;
  return input as LogInput;
}

/**
 * A winston transport that republishes records to termwright.
 *
 * The returned stream is an object-mode `Writable` carrying the `level`
 * property winston reads for per-transport filtering.
 *
 * @param options - Publishing, redaction and level settings.
 */
export function createWinstonTransport(options: WinstonBridgeOptions = {}): Writable {
  const emit = (info: WinstonInfo): void => {
    publishLog(() => toInput(info), options);
  };

  const transport = new Writable({
    objectMode: true,
    write(info: WinstonInfo, _encoding, callback): void {
      try {
        emit(info);
      } catch (error) {
        // A logging transport must never take the application down with it.
        callback(error as Error);
        return;
      }
      callback();
    },
  });

  // `Logger.add` reads `transport.log.length` to tell a modern transport from
  // a winston 2.x one, and treats arity > 2 as legacy. A transport without a
  // `log` method at all makes that read throw, so the method is required even
  // though the stream's `write` is what actually carries records.
  Object.defineProperty(transport, 'log', {
    value: (info: WinstonInfo, next?: () => void): void => {
      try {
        emit(info);
      } finally {
        next?.();
      }
    },
    writable: true,
  });

  if (options.level !== undefined) {
    Object.defineProperty(transport, 'level', {
      value: options.level,
      enumerable: true,
      writable: true,
    });
  }
  return transport;
}
