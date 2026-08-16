/**
 * Application log records carried over the semantic channel.
 *
 * A TUI cannot print diagnostics to the screen without corrupting the render,
 * so applications write them to an internal logger instead. The `logs`
 * capability lets an instrumented adapter forward those records to the driver,
 * where they become assertable test state rather than invisible side effects.
 *
 * Records are bounded exactly like snapshots: projected into frozen plain DTOs
 * before retention, checked against a byte ceiling, and rejected wholesale on
 * any violation. A misbehaving logger degrades into dropped records, never
 * into unbounded driver memory.
 */

import { Buffer } from 'node:buffer';
import type { ProtocolLimits } from './limits.js';
import type { ValidationErrorCode } from './validate.js';
import { ProtocolViolation } from './errors.js';
import { projectDto } from './framing.js';

/**
 * Severity ladder, ordered from least to most severe. Deliberately the
 * intersection of the ladders used by pino, winston, consola, Python
 * `logging`, Go `slog` and Rust `tracing`, so every bridge maps onto it
 * without inventing a level.
 */
export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/** Numeric severity, useful for threshold comparisons. Higher is more severe. */
export const LOG_LEVEL_SEVERITY: Readonly<Record<LogLevel, number>> = Object.freeze({
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
});

/**
 * Structured attribute value. Scalars only, by design: nested objects make
 * record size unbounded and depth-dependent, and every bridge already has to
 * flatten for its own transport. `@termwright/logs` does the flattening.
 */
export type LogAttrValue = string | number | boolean | null;

/** Maximum number of attribute keys on one record. */
export const MAX_LOG_ATTRS = 64;

/**
 * One application log record.
 *
 * @remarks
 * `ts` is **Unix epoch milliseconds**, not session-relative: the adapter has no
 * reliable view of when the driver considers the session to have started, so
 * the only clock both sides can agree on without negotiation is the wall
 * clock. The driver rebases it onto the session/cast timeline.
 */
export interface LogRecord {
  /** Unix epoch milliseconds when the record was produced. */
  readonly ts: number;
  readonly level: LogLevel;
  /** Human-readable message, already formatted by the source logger. */
  readonly message: string;
  /** Flat structured context. Nested values are flattened by the bridge. */
  readonly attrs?: Readonly<Record<string, LogAttrValue>>;
  /** Logger/channel name, e.g. `http` or `db.pool`. */
  readonly logger?: string;
  /**
   * Per-session counter, non-decreasing, assigned by the adapter. A gap tells
   * the driver records were dropped upstream (rate limit, queue overflow)
   * rather than lost in transit.
   */
  readonly seq: number;
  /** Semantic revision current when the record was produced, when known. */
  readonly revision?: number;
}

/** Structured result: never throws hostile data onward. */
export type LogValidationResult =
  | { readonly ok: true; readonly record: LogRecord }
  | { readonly ok: false; readonly code: ValidationErrorCode; readonly detail: string };

function fail(code: ValidationErrorCode, detail: string): LogValidationResult {
  return { ok: false, code, detail };
}

const LEVELS: ReadonlySet<string> = new Set(LOG_LEVELS);

function isSafeNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Validate an untrusted log record.
 *
 * Mirrors {@link import('./validate.js').validateSnapshot}: the value is
 * projected into a frozen plain DTO first (so getters are rejected without
 * being invoked), then measured against the byte ceiling, then checked field
 * by field.
 *
 * @param value - Untrusted candidate record.
 * @param limits - Active limits; `maxLogRecordBytes` and `maxStringBytes` apply.
 * @returns `{ ok: true, record }` with a deep-frozen record, or a typed
 * failure. Never throws.
 */
export function validateLogRecord(value: unknown, limits: ProtocolLimits): LogValidationResult {
  let projected: unknown;
  try {
    projected = projectDto<unknown>(value, limits.maxDepth);
  } catch (error) {
    if (error instanceof ProtocolViolation) {
      return fail(error.code === 'dto-depth' ? 'depth' : 'schema', error.message);
    }
    return fail('schema', 'value could not be projected into a plain DTO');
  }

  const serialised = JSON.stringify(projected);
  if (serialised === undefined) {
    return fail('schema', 'log record is not a JSON object');
  }
  const bytes = Buffer.byteLength(serialised, 'utf8');
  if (bytes > limits.maxLogRecordBytes) {
    return fail('bytes', `log record is ${bytes} bytes, ceiling is ${limits.maxLogRecordBytes}`);
  }

  if (typeof projected !== 'object' || projected === null || Array.isArray(projected)) {
    return fail('schema', 'log record must be an object');
  }
  const record = projected as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (!['ts', 'level', 'message', 'attrs', 'logger', 'seq', 'revision'].includes(key)) {
      return fail('schema', `unknown log record property "${key}"`);
    }
  }

  if (!isSafeNonNegative(record['ts']) || record['ts'] === 0) {
    return fail('schema', 'ts must be a positive safe integer (epoch milliseconds)');
  }
  if (typeof record['level'] !== 'string' || !LEVELS.has(record['level'])) {
    return fail('schema', `level must be one of ${LOG_LEVELS.join(', ')}`);
  }
  if (typeof record['message'] !== 'string') {
    return fail('schema', 'message must be a string');
  }
  if (Buffer.byteLength(record['message'], 'utf8') > limits.maxStringBytes) {
    return fail('string-bytes', `message exceeds ${limits.maxStringBytes} UTF-8 bytes`);
  }
  if (!isSafeNonNegative(record['seq'])) {
    return fail('schema', 'seq must be a non-negative safe integer');
  }

  if (record['logger'] !== undefined) {
    if (typeof record['logger'] !== 'string') {
      return fail('schema', 'logger must be a string');
    }
    if (Buffer.byteLength(record['logger'], 'utf8') > limits.maxStringBytes) {
      return fail('string-bytes', `logger exceeds ${limits.maxStringBytes} UTF-8 bytes`);
    }
  }

  if (record['revision'] !== undefined) {
    if (!isSafeNonNegative(record['revision']) || record['revision'] === 0) {
      return fail('revision', 'revision must be a positive safe integer');
    }
  }

  const attrs = record['attrs'];
  if (attrs !== undefined) {
    if (typeof attrs !== 'object' || attrs === null || Array.isArray(attrs)) {
      return fail('schema', 'attrs must be a flat object');
    }
    const entries = Object.entries(attrs as Record<string, unknown>);
    if (entries.length > MAX_LOG_ATTRS) {
      return fail('count', `attrs carries ${entries.length} keys, ceiling is ${MAX_LOG_ATTRS}`);
    }
    for (const [key, attrValue] of entries) {
      if (Buffer.byteLength(key, 'utf8') > limits.maxStringBytes) {
        return fail('string-bytes', `attribute key "${key}" exceeds the string ceiling`);
      }
      const type = typeof attrValue;
      if (attrValue !== null && type !== 'string' && type !== 'number' && type !== 'boolean') {
        return fail('schema', `attribute "${key}" must be a string, number, boolean or null`);
      }
      if (type === 'number' && !Number.isFinite(attrValue)) {
        return fail('schema', `attribute "${key}" must be a finite number`);
      }
      if (type === 'string' && Buffer.byteLength(attrValue as string, 'utf8') > limits.maxStringBytes) {
        return fail('string-bytes', `attribute "${key}" exceeds the string ceiling`);
      }
    }
  }

  return { ok: true, record: projected as LogRecord };
}
