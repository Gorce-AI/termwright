/**
 * OpenTelemetry logs bridge.
 *
 * Implements the `LogRecordProcessor` shape from `@opentelemetry/sdk-logs`
 * structurally, so the OTel SDK stays an **optional peer**: nothing here
 * imports it, and an application that never uses OTel pays nothing.
 *
 * ```ts
 * import { LoggerProvider } from '@opentelemetry/sdk-logs';
 * import { TermwrightLogRecordProcessor } from '@termwright/logs/otel';
 *
 * const provider = new LoggerProvider();
 * provider.addLogRecordProcessor(new TermwrightLogRecordProcessor());
 * ```
 */

import type { LogAttrValue, LogLevel } from '@termwright/protocol';
import { publishLog, type PublishOptions } from './channel.js';
import type { LogInput } from './normalize.js';

/** `[seconds, nanoseconds]`, OTel's time representation. */
export type OtelHrTime = readonly [number, number];

/** The subset of a readable OTel log record this bridge consumes. */
export interface OtelReadableLogRecord {
  readonly hrTime?: OtelHrTime;
  readonly hrTimeObserved?: OtelHrTime;
  readonly severityNumber?: number;
  readonly severityText?: string;
  readonly body?: unknown;
  readonly attributes?: Readonly<Record<string, unknown>>;
  readonly instrumentationScope?: { readonly name?: string };
}

/** Settings for {@link TermwrightLogRecordProcessor}. */
export type OtelBridgeOptions = PublishOptions;

/**
 * Map an OTel severity number onto the protocol ladder.
 *
 * The OTel ranges are TRACE 1–4, DEBUG 5–8, INFO 9–12, WARN 13–16,
 * ERROR 17–20, FATAL 21–24.
 *
 * @param severityNumber - OTel severity, 1–24.
 * @param severityText - Fallback used when the number is absent or unknown.
 */
export function severityToLevel(
  severityNumber: number | undefined,
  severityText?: string,
): LogLevel {
  if (typeof severityNumber === 'number' && Number.isFinite(severityNumber)) {
    if (severityNumber >= 21) return 'fatal';
    if (severityNumber >= 17) return 'error';
    if (severityNumber >= 13) return 'warn';
    if (severityNumber >= 9) return 'info';
    if (severityNumber >= 5) return 'debug';
    if (severityNumber >= 1) return 'trace';
  }
  const text = severityText?.toLowerCase();
  switch (text) {
    case 'fatal':
      return 'fatal';
    case 'error':
      return 'error';
    case 'warn':
    case 'warning':
      return 'warn';
    case 'debug':
      return 'debug';
    case 'trace':
      return 'trace';
    default:
      return 'info';
  }
}

function hrTimeToMs(hrTime: OtelHrTime | undefined): number | undefined {
  if (hrTime === undefined) return undefined;
  const [seconds, nanos] = hrTime;
  if (!Number.isFinite(seconds) || !Number.isFinite(nanos)) return undefined;
  return Math.floor(seconds * 1000 + nanos / 1e6);
}

function bodyToMessage(body: unknown): string {
  if (typeof body === 'string') return body;
  if (body === undefined || body === null) return '';
  try {
    return JSON.stringify(body) ?? String(body);
  } catch {
    return String(body);
  }
}

function toInput(record: OtelReadableLogRecord): LogInput {
  const attrs: Record<string, LogAttrValue | unknown> = { ...(record.attributes ?? {}) };
  const input: Record<string, unknown> = {
    level: severityToLevel(record.severityNumber, record.severityText),
    message: bodyToMessage(record.body),
    attrs,
  };
  const time = hrTimeToMs(record.hrTime) ?? hrTimeToMs(record.hrTimeObserved);
  if (time !== undefined) input['time'] = time;
  const scope = record.instrumentationScope?.name;
  if (typeof scope === 'string' && scope.length > 0) input['logger'] = scope;
  return input as LogInput;
}

/**
 * A `LogRecordProcessor` that republishes OTel log records to termwright.
 *
 * Synchronous by nature: records are handed to the diagnostics channel as they
 * are emitted, so `forceFlush` has nothing to wait for.
 */
export class TermwrightLogRecordProcessor {
  readonly #options: OtelBridgeOptions;
  #shutdown = false;

  constructor(options: OtelBridgeOptions = {}) {
    this.#options = options;
  }

  /** Called by the SDK for every emitted record. */
  onEmit(logRecord: OtelReadableLogRecord): void {
    if (this.#shutdown) return;
    publishLog(() => toInput(logRecord), this.#options);
  }

  /** No buffering, so there is nothing to flush. */
  async forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  /** Stops accepting records; further `onEmit` calls are ignored. */
  async shutdown(): Promise<void> {
    this.#shutdown = true;
    return Promise.resolve();
  }
}
