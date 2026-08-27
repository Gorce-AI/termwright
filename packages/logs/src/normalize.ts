/**
 * Normalisation of loose logger output into a protocol `LogRecord`.
 *
 * Every bridge funnels through here, so the wire shape is decided in exactly
 * one place. Normalisation never fails: it coerces, flattens and truncates
 * until the record satisfies the protocol, because dropping a diagnostic
 * because it was slightly the wrong shape is worse than truncating it.
 */

import { Buffer } from 'node:buffer';
import {
  DEFAULT_LIMITS,
  LOG_LEVELS,
  MAX_LOG_ATTRS,
  type LogAttrValue,
  type LogLevel,
  type LogRecord,
  type ProtocolLimits,
} from '@termwright/protocol';
import { type ResolvedRedaction, redactAttr, redactText, resolveRedaction } from './redact.js';

/**
 * Loose input accepted from any logger. Bridges map their native shape onto
 * this; unrecognised own properties become attributes.
 */
export interface LogInput {
  readonly level?: LogLevel | string | number;
  readonly message?: unknown;
  /** pino/bunyan spelling of `message`. */
  readonly msg?: unknown;
  readonly logger?: string;
  /** pino/winston spelling of `logger`. */
  readonly name?: string;
  readonly attrs?: Readonly<Record<string, unknown>>;
  /** Epoch ms, a Date, or an ISO string. Defaults to now. */
  readonly time?: number | string | Date;
  readonly ts?: number | string | Date;
  readonly timestamp?: number | string | Date;
  readonly revision?: number;
  readonly [key: string]: unknown;
}

/** Settings for {@link normalizeLogRecord}. */
export interface NormalizeOptions {
  readonly limits?: ProtocolLimits;
  readonly redaction?: ResolvedRedaction;
  /** Sequence number to stamp; callers usually pass a session counter. */
  readonly seq: number;
  /** Level used when the input carries none. */
  readonly defaultLevel?: LogLevel;
  /** Clock, injectable for tests. */
  readonly now?: () => number;
}

const LEVEL_SET: ReadonlySet<string> = new Set(LOG_LEVELS);

/** Aliases used by winston, consola, syslog and Python `logging`. */
const LEVEL_ALIASES: Readonly<Record<string, LogLevel>> = Object.freeze({
  silly: 'trace',
  verbose: 'trace',
  fine: 'trace',
  http: 'debug',
  log: 'info',
  notice: 'info',
  information: 'info',
  warning: 'warn',
  err: 'error',
  critical: 'fatal',
  crit: 'fatal',
  alert: 'fatal',
  emerg: 'fatal',
  emergency: 'fatal',
  panic: 'fatal',
});

/**
 * Map a level of unknown provenance onto the protocol ladder.
 *
 * Numbers are interpreted **pino/bunyan style** (10 trace … 60 fatal), the one
 * numeric convention shared by the JS ecosystem. Consola inverts that scale, so
 * its bridge resolves the level itself rather than passing a number here.
 *
 * @param level - Level name, alias, or pino-style number.
 * @param fallback - Used when nothing matches.
 */
export function toLogLevel(level: unknown, fallback: LogLevel = 'info'): LogLevel {
  if (typeof level === 'string') {
    const lower = level.toLowerCase().trim();
    if (LEVEL_SET.has(lower)) return lower as LogLevel;
    const alias = LEVEL_ALIASES[lower];
    if (alias !== undefined) return alias;
    const numeric = Number(lower);
    if (Number.isFinite(numeric)) return toLogLevel(numeric, fallback);
    return fallback;
  }
  if (typeof level === 'number' && Number.isFinite(level)) {
    if (level >= 60) return 'fatal';
    if (level >= 50) return 'error';
    if (level >= 40) return 'warn';
    if (level >= 30) return 'info';
    if (level >= 20) return 'debug';
    return 'trace';
  }
  return fallback;
}

/** Truncate to a UTF-8 byte budget without splitting a code point. */
export function truncateToBytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  const marker = '…';
  const budget = Math.max(0, maxBytes - Buffer.byteLength(marker, 'utf8'));
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(text.slice(0, mid), 'utf8') <= budget) low = mid;
    else high = mid - 1;
  }
  let cut = low;
  // Never end on a lone high surrogate.
  const code = text.charCodeAt(cut - 1);
  if (cut > 0 && code >= 0xd800 && code <= 0xdbff) cut -= 1;
  return text.slice(0, cut) + marker;
}

function toEpochMs(value: unknown, now: () => number): number {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isSafeInteger(time) && time > 0 ? time : now();
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  }
  return now();
}

function stringifyMessage(input: LogInput): string {
  const raw = input.message ?? input.msg;
  if (typeof raw === 'string') return raw;
  if (raw === undefined || raw === null) return '';
  if (raw instanceof Error) return `${raw.name}: ${raw.message}`;
  if (typeof raw === 'object') {
    try {
      return JSON.stringify(raw) ?? String(raw);
    } catch {
      return String(raw);
    }
  }
  return String(raw);
}

function toScalar(value: unknown): LogAttrValue | undefined {
  if (value === null) return null;
  switch (typeof value) {
    case 'string':
      return value;
    case 'boolean':
      return value;
    case 'number':
      return Number.isFinite(value) ? value : String(value);
    case 'bigint':
      return value.toString();
    case 'undefined':
      return undefined;
    default:
      return undefined;
  }
}

/** Keys consumed as record fields rather than flattened into attrs. */
const RESERVED_INPUT_KEYS: ReadonlySet<string> = new Set([
  'level',
  'message',
  'msg',
  'logger',
  'name',
  'attrs',
  'time',
  'ts',
  'timestamp',
  'revision',
  'seq',
]);

function flattenInto(
  target: Record<string, LogAttrValue>,
  value: unknown,
  prefix: string,
  depth: number,
  redaction: ResolvedRedaction,
  limits: ProtocolLimits,
): void {
  if (Object.keys(target).length >= MAX_LOG_ATTRS) return;

  if (value instanceof Error) {
    // Errors carry the diagnosis; keep name/message/stack, drop the rest.
    put(target, `${prefix}.name`, value.name, redaction, limits);
    put(target, `${prefix}.message`, value.message, redaction, limits);
    if (typeof value.stack === 'string') {
      put(target, `${prefix}.stack`, value.stack, redaction, limits);
    }
    return;
  }

  const scalar = toScalar(value);
  if (scalar !== undefined) {
    put(target, prefix, scalar, redaction, limits);
    return;
  }

  if (depth <= 0) {
    put(target, prefix, safeJson(value), redaction, limits);
    return;
  }

  if (Array.isArray(value)) {
    // Arrays of scalars read better joined than exploded into a.0, a.1, …
    if (value.every((entry) => toScalar(entry) !== undefined)) {
      put(target, prefix, value.map((entry) => String(entry)).join(','), redaction, limits);
      return;
    }
    value.forEach((entry, index) => {
      flattenInto(target, entry, `${prefix}.${index}`, depth - 1, redaction, limits);
    });
    return;
  }

  if (typeof value === 'object' && value !== null) {
    for (const [key, nested] of Object.entries(value)) {
      flattenInto(target, nested, `${prefix}.${key}`, depth - 1, redaction, limits);
    }
    return;
  }

  put(target, prefix, safeJson(value), redaction, limits);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return '[unserialisable]';
  }
}

function put(
  target: Record<string, LogAttrValue>,
  key: string,
  value: LogAttrValue,
  redaction: ResolvedRedaction,
  limits: ProtocolLimits,
): void {
  if (Object.keys(target).length >= MAX_LOG_ATTRS && !(key in target)) return;
  const redacted = redactAttr(key, value, redaction);
  target[key] =
    typeof redacted === 'string' ? truncateToBytes(redacted, limits.maxStringBytes) : redacted;
}

/**
 * Convert loose logger output into a valid protocol `LogRecord`.
 *
 * Redaction runs here, so a record is already safe by the time it reaches any
 * subscriber. The result always satisfies `validateLogRecord`: over-long
 * strings are truncated, nested attributes flattened with dot notation, and
 * surplus attributes dropped rather than rejected.
 *
 * @param input - Loose record from any logger.
 * @param options - Sequence number, limits, redaction and clock.
 */
export function normalizeLogRecord(input: LogInput, options: NormalizeOptions): LogRecord {
  const limits = options.limits ?? DEFAULT_LIMITS;
  const redaction = options.redaction ?? resolveRedaction();
  const now = options.now ?? Date.now;

  const attrs: Record<string, LogAttrValue> = {};
  if (input.attrs !== undefined) {
    for (const [key, value] of Object.entries(input.attrs)) {
      flattenInto(attrs, value, key, 4, redaction, limits);
    }
  }
  for (const [key, value] of Object.entries(input)) {
    if (RESERVED_INPUT_KEYS.has(key)) continue;
    flattenInto(attrs, value, key, 4, redaction, limits);
  }

  const message = truncateToBytes(
    redactText(stringifyMessage(input), redaction),
    limits.maxStringBytes,
  );
  const logger = input.logger ?? input.name;
  const revision =
    typeof input.revision === 'number' && Number.isSafeInteger(input.revision) && input.revision > 0
      ? input.revision
      : undefined;

  const record: LogRecord = {
    ts: toEpochMs(input.ts ?? input.time ?? input.timestamp, now),
    level: toLogLevel(input.level, options.defaultLevel ?? 'info'),
    message,
    seq: Number.isSafeInteger(options.seq) && options.seq >= 0 ? options.seq : 0,
    ...(logger === undefined
      ? {}
      : { logger: truncateToBytes(String(logger), limits.maxStringBytes) }),
    ...(revision === undefined ? {} : { revision }),
    ...(Object.keys(attrs).length === 0 ? {} : { attrs }),
  };

  return Object.freeze(fitToBytes(record, limits));
}

/**
 * Last-resort size fit: shed attributes, then shorten the message, until the
 * serialised record is under the ceiling. Guarantees the protocol's byte bound
 * holds no matter how the caller sized the pieces.
 */
function fitToBytes(record: LogRecord, limits: ProtocolLimits): LogRecord {
  const size = (value: unknown): number => Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');
  if (size(record) <= limits.maxLogRecordBytes) return record;

  let working: LogRecord = record;
  if (working.attrs !== undefined) {
    const entries = Object.entries(working.attrs);
    while (entries.length > 0 && size(working) > limits.maxLogRecordBytes) {
      entries.pop();
      const attrs = Object.fromEntries(entries);
      const { attrs: _dropped, ...rest } = working;
      working = entries.length === 0 ? rest : { ...rest, attrs };
    }
  }
  if (size(working) <= limits.maxLogRecordBytes) return working;

  // Only the message is left to shrink; leave room for the rest of the record.
  const overhead = size({ ...working, message: '' });
  const budget = Math.max(0, limits.maxLogRecordBytes - overhead - 2);
  return { ...working, message: truncateToBytes(working.message, budget) };
}

/**
 * Apply redaction to an already-well-formed record.
 *
 * Used on the receive side: the diagnostics channel is a public contract, so a
 * record can arrive from a publisher that never ran our redaction. Redaction
 * is idempotent, so re-running it on our own output costs a scan and changes
 * nothing.
 *
 * @param record - A record that already satisfies the protocol shape.
 * @param redaction - Resolved settings.
 */
export function redactRecord(record: LogRecord, redaction: ResolvedRedaction): LogRecord {
  if (!redaction.enabled) return record;
  const message = redactText(record.message, redaction);
  let attrs = record.attrs;
  if (attrs !== undefined) {
    const next: Record<string, LogAttrValue> = {};
    for (const [key, value] of Object.entries(attrs)) {
      next[key] = redactAttr(key, value, redaction);
    }
    attrs = next;
  }
  return Object.freeze({
    ...record,
    message,
    ...(attrs === undefined ? {} : { attrs }),
  });
}
