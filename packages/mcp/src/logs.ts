/**
 * The application's own log, on the session timeline.
 *
 * A terminal shows what a program *drew*; its log says what the program
 * *decided*. That gap is where "the screen looks right but nothing happened"
 * lives, so an agent that can read both stops guessing.
 *
 * The driver publishes `app-log` events — a followed file yields a raw line, an
 * instrumented adapter yields a structured record — and this module buffers
 * them per terminal so `terminal.capture_since` can hand back everything since
 * a cursor.
 */
import { z } from 'zod';
import type { AppLogEvent } from '@termwright/driver';

/** Ceilings for the buffer and for one response. */
export const LOG_LIMITS = Object.freeze({
  /** Entries retained per terminal; the oldest are evicted first. */
  bufferSize: 1_000,
  /** Entries returned by one call, newest kept. */
  maxPerResponse: 100,
  /** Characters kept per line or message. */
  maxTextChars: 2_000,
});

/** One buffered log entry, as an agent reads it. */
export const logEntrySchema = z.object({
  seq: z.number().int().describe('per-session counter assigned on arrival; the cursor for logs'),
  timeMs: z.number().describe('session clock; for a followed file, when the driver read the line'),
  source: z.enum(['file', 'adapter']),
  label: z.string().optional().describe('which log source, when the session follows more than one'),
  level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional(),
  message: z.string().describe('the raw line, or the record’s formatted message'),
  logger: z.string().optional(),
  attrs: z.record(z.string(), z.unknown()).optional(),
  revision: z.number().int().optional().describe('semantic revision current when the record was produced'),
});

/** The structured shape of {@link logEntrySchema}. */
export type LogEntry = z.output<typeof logEntrySchema>;

function clamp(text: string): string {
  return text.length > LOG_LIMITS.maxTextChars ? `${text.slice(0, LOG_LIMITS.maxTextChars)}…` : text;
}

/** Projects a driver event into a buffered entry. */
function toEntry(event: AppLogEvent, seq: number): LogEntry {
  const record = event.record;
  return {
    seq,
    timeMs: event.timeMs,
    source: event.source,
    ...(event.label === undefined ? {} : { label: event.label }),
    ...(record === undefined
      ? { message: clamp(event.line ?? '') }
      : {
          level: record.level,
          message: clamp(record.message),
          ...(record.logger === undefined ? {} : { logger: record.logger }),
          ...(record.attrs === undefined ? {} : { attrs: { ...record.attrs } }),
          ...(record.revision === undefined ? {} : { revision: record.revision }),
        }),
  };
}

/** What a read since a cursor found. */
export interface LogWindow {
  readonly entries: readonly LogEntry[];
  /**
   * Entries that existed between the cursor and the oldest one still buffered,
   * plus any trimmed to fit the response ceiling.
   *
   * Computed **at read time** from sequence numbers rather than accumulated in
   * a counter as entries are dropped. A counter that is only published with the
   * next event silently loses the final window — exactly when a program has
   * gone quiet because it died, which is when the number matters most.
   */
  readonly omitted: number;
  /** Pass as the next cursor; equals the newest sequence number seen. */
  readonly cursor: number;
}

/** A bounded, per-terminal ring of log entries. */
export class LogBuffer {
  readonly #entries: LogEntry[] = [];
  readonly #capacity: number;
  #counter = 0;

  constructor(capacity: number = LOG_LIMITS.bufferSize) {
    this.#capacity = capacity;
  }

  /** Sequence number of the newest entry; 0 when nothing has arrived. */
  get sequence(): number {
    return this.#counter;
  }

  /** Entries currently retained. */
  get size(): number {
    return this.#entries.length;
  }

  /** Records one driver event. */
  append(event: AppLogEvent): void {
    this.#counter += 1;
    this.#entries.push(toEntry(event, this.#counter));
    if (this.#entries.length > this.#capacity) this.#entries.splice(0, this.#entries.length - this.#capacity);
  }

  /** Advances the cursor for source events that were explicitly reported lost. */
  omit(count: number): void {
    if (!Number.isSafeInteger(count) || count <= 0) throw new TypeError('omitted log count must be a positive safe integer');
    this.#counter += count;
  }

  /**
   * Everything after `cursor`, newest-biased and bounded.
   *
   * A cursor older than the buffer is not an error: the entries in between are
   * counted in {@link LogWindow.omitted} so an agent knows its view has a hole,
   * rather than quietly seeing a shorter list.
   */
  since(cursor: number, limit: number = LOG_LIMITS.maxPerResponse): LogWindow {
    const newer = this.#entries.filter((entry) => entry.seq > cursor);
    const oldestKept = this.#entries[0]?.seq ?? this.#counter + 1;
    const evicted = Math.max(0, Math.min(oldestKept - 1, this.#counter) - cursor);
    const trimmed = newer.length > limit ? newer.slice(-limit) : newer;
    return {
      entries: trimmed,
      omitted: evicted + (newer.length - trimmed.length),
      cursor: this.#counter,
    };
  }
}

/** Renders a log window the way it appears in a tool result's text. */
export function renderLogs(window: LogWindow): string {
  if (window.entries.length === 0 && window.omitted === 0) return 'logs: none';
  const header =
    window.omitted === 0
      ? `logs: ${window.entries.length}`
      : `logs: ${window.entries.length} (${window.omitted} omitted — raise the limit or read more often)`;
  return [
    header,
    ...window.entries.map((entry) => {
      const level = entry.level === undefined ? '' : ` ${entry.level.toUpperCase()}`;
      const label = entry.label === undefined ? '' : ` [${entry.label}]`;
      const logger = entry.logger === undefined ? '' : ` ${entry.logger}:`;
      return `  ${entry.timeMs}ms${level}${label}${logger} ${entry.message}`;
    }),
  ].join('\n');
}
