/**
 * asciicast **v3** reading and writing.
 *
 * v3 differs from v2 in two ways that matter here: the header carries a
 * `term: { cols, rows }` object instead of top-level `width`/`height`, and each
 * event line stores the *interval since the previous event* rather than an
 * absolute timestamp. Event codes used by termwright: `o` output, `i` input,
 * `m` marker (test steps), `r` resize, `x` exit.
 *
 * @see https://docs.asciinema.org/manual/asciicast/v3/
 */

import { TraceError } from './errors.js';

/** Terminal description in the asciicast header. */
export interface CastTerm {
  readonly cols: number;
  readonly rows: number;
  readonly type?: string;
  readonly version?: string;
  readonly theme?: { readonly fg: string; readonly bg: string; readonly palette: string };
}

/** First line of a `.cast` file. */
export interface CastHeader {
  readonly version: 3;
  readonly term: CastTerm;
  /** Unix timestamp (seconds) of the recording start. */
  readonly timestamp?: number;
  /** Maximum idle gap in seconds; longer gaps were already trimmed. */
  readonly idle_time_limit?: number;
  readonly command?: string;
  readonly title?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly tags?: readonly string[];
}

/** Event codes termwright emits. Unknown codes are preserved on read. */
export type CastEventCode = 'o' | 'i' | 'm' | 'r' | 'x';

/** A parsed cast event, carrying both interval and derived absolute time. */
export interface CastEvent {
  /** Seconds elapsed since the previous event (the on-disk value). */
  readonly interval: number;
  /** Absolute offset from recording start, in milliseconds (derived). */
  readonly timeMs: number;
  readonly code: CastEventCode | string;
  readonly data: string;
}

/** Rounds to microsecond precision so JSON stays short and stable. */
function roundInterval(seconds: number): number {
  return Math.round(seconds * 1e6) / 1e6;
}

/** Serializes a header object to its `.cast` first line (no trailing newline). */
export function formatCastHeader(header: CastHeader): string {
  return JSON.stringify(header);
}

/**
 * Serializes one event line (no trailing newline).
 *
 * @param interval - seconds since the previous event; negative values are
 *   clamped to zero so the timeline can never run backwards.
 */
export function formatCastEvent(interval: number, code: string, data: string): string {
  return JSON.stringify([roundInterval(Math.max(0, interval)), code, data]);
}

/** Parses and validates a header line. */
export function parseCastHeader(line: string): CastHeader {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new TraceError('protocol-violation', 'session.cast: header is not valid JSON', {
      suggestion: 'The archive is corrupt or was not produced by @termwright/trace.',
    });
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new TraceError('protocol-violation', 'session.cast: header is not an object');
  }
  const header = parsed as Partial<CastHeader>;
  if (header.version !== 3) {
    throw new TraceError(
      'protocol-violation',
      `session.cast: unsupported asciicast version ${String(header.version)} (expected 3)`,
      { suggestion: 'Re-record the trace; termwright writes and reads asciicast v3 only.' },
    );
  }
  const term = header.term;
  if (
    typeof term !== 'object' ||
    term === null ||
    typeof term.cols !== 'number' ||
    typeof term.rows !== 'number'
  ) {
    throw new TraceError('protocol-violation', 'session.cast: header.term.{cols,rows} missing');
  }
  return header as CastHeader;
}

/**
 * Parses one event line into a {@link CastEvent}.
 *
 * @param previousTimeMs - absolute time of the preceding event, used to resolve
 *   this event's interval into an absolute offset.
 */
export function parseCastEvent(line: string, previousTimeMs: number): CastEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new TraceError('protocol-violation', `session.cast: event line is not valid JSON`);
  }
  if (!Array.isArray(parsed) || parsed.length < 3) {
    throw new TraceError('protocol-violation', 'session.cast: event is not a 3-element array');
  }
  const [interval, code, data] = parsed as [unknown, unknown, unknown];
  if (typeof interval !== 'number' || !Number.isFinite(interval)) {
    throw new TraceError('protocol-violation', 'session.cast: event interval is not a number');
  }
  if (typeof code !== 'string') {
    throw new TraceError('protocol-violation', 'session.cast: event code is not a string');
  }
  return {
    interval,
    timeMs: previousTimeMs + interval * 1000,
    code,
    data: typeof data === 'string' ? data : String(data),
  };
}

/** Header plus fully resolved events. */
export interface ParsedCast {
  readonly header: CastHeader;
  readonly events: readonly CastEvent[];
}

/** Parses a complete `.cast` document held in memory. */
export function parseCast(text: string): ParsedCast {
  const lines = text.split('\n');
  const first = lines.shift();
  if (first === undefined || first.trim() === '') {
    throw new TraceError('protocol-violation', 'session.cast: file is empty');
  }
  const header = parseCastHeader(first);
  const events: CastEvent[] = [];
  let timeMs = 0;
  for (const line of lines) {
    if (line.trim() === '') continue;
    const event = parseCastEvent(line, timeMs);
    events.push(event);
    timeMs = event.timeMs;
  }
  return { header, events };
}

/**
 * Streams events out of a line source, so a large recording never has to be
 * materialised in memory.
 *
 * The first non-empty line must be the header; it is validated and skipped.
 */
export async function* streamCastEvents(lines: AsyncIterable<string>): AsyncGenerator<CastEvent> {
  let timeMs = 0;
  let sawHeader = false;
  for await (const line of lines) {
    if (line.trim() === '') continue;
    if (!sawHeader) {
      parseCastHeader(line);
      sawHeader = true;
      continue;
    }
    const event = parseCastEvent(line, timeMs);
    timeMs = event.timeMs;
    yield event;
  }
  if (!sawHeader) {
    throw new TraceError('protocol-violation', 'session.cast: file is empty');
  }
}
