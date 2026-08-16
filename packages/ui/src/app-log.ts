/**
 * Application logs, as the UI models them.
 *
 * A TUI cannot print diagnostics to the screen without corrupting its own
 * render, so the interesting half of what a terminal program has to say never
 * appears in the terminal. Two sources bring it back: a log file the driver
 * follows, and an instrumented adapter forwarding structured records over the
 * semantic channel. They arrive as one driver event (`app-log`) with two
 * payload shapes, and this module flattens them into one row the panel can
 * render and the timeline can mark.
 *
 * The flattening keeps one distinction that matters: **a followed file line has
 * no level**. Severity is not inferred from the text — no regex for `ERROR`,
 * no heuristics. An unleveled line is shown in the panel and never produces a
 * warn/error tick, because a tick that might be wrong is worse than no tick.
 *
 * @packageDocumentation
 */

/**
 * The severity ladder, ordered from least to most severe.
 *
 * Declared here rather than imported: this module is bundled into the browser
 * app, and `@termwright/protocol` is Node-only (it reaches for `node:crypto`).
 * `app-log.test.ts` asserts this array is identical to the protocol's
 * `LOG_LEVELS`, so the two cannot drift — the check runs in Node, where
 * importing the protocol is free.
 */
export const UI_LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

/** One of {@link UI_LOG_LEVELS}. Structurally the protocol's `LogLevel`. */
export type LogLevel = (typeof UI_LOG_LEVELS)[number];

/** Levels that earn a mark on the timeline. */
const MARKED_LEVELS: ReadonlySet<LogLevel> = new Set<LogLevel>(['warn', 'error', 'fatal']);

/** Longest message kept for display. */
const MAX_MESSAGE_LENGTH = 4_096;
/** Maximum attribute keys kept per row (the protocol's own ceiling). */
const MAX_ATTRS = 64;

/** Flat attribute values, as the protocol allows them. */
export type LogAttrs = Readonly<Record<string, string | number | boolean | null>>;

/** One log line, in the shape the UI transports and renders. */
export interface AppLogView {
  /** Milliseconds on the session clock (live) or the cast timeline (replay). */
  readonly t: number;
  readonly source: 'file' | 'adapter';
  /**
   * Severity, or `null` for a followed file line, whose severity nobody knows.
   */
  readonly level: LogLevel | null;
  readonly message: string;
  /** Log file label, or the adapter's logger name. */
  readonly label?: string;
  readonly logger?: string;
  readonly seq?: number;
  readonly revision?: number;
  readonly attrs?: LogAttrs;
}

/** True when this row should mark the timeline. */
export function isMarked(log: AppLogView): boolean {
  return log.level !== null && MARKED_LEVELS.has(log.level);
}

/** Ordering used by the level filter. Unleveled rows always pass. */
export function passesLevel(log: AppLogView, threshold: LogLevel | 'all'): boolean {
  if (threshold === 'all' || log.level === null) return true;
  return UI_LOG_LEVELS.indexOf(log.level) >= UI_LOG_LEVELS.indexOf(threshold);
}

/**
 * Validates an untrusted log row — a driver event, a WebSocket frame, or a line
 * of an archive written by somebody else's version.
 *
 * @returns the row, or `null` when there is nothing worth showing. A row must
 * have a finite time and a message; everything else is optional and a bad
 * value is dropped rather than propagated.
 */
export function parseAppLog(value: unknown): AppLogView | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;

  // `t` on the wire and in the archive; `timeMs` on the driver's own event.
  const t = finite(raw['t'] ?? raw['timeMs']);
  if (t === null) return null;

  // A file line arrives as `line`, an adapter record as `record`; the archive
  // and the wire both carry the flattened form with `message`.
  const record = asObject(raw['record']);
  const message = firstString(raw['message'], raw['line'], record?.['message']);
  if (message === null) return null;

  const source = raw['source'] === 'adapter' || record !== null ? 'adapter' : 'file';
  const level = parseLevel(raw['level'] ?? record?.['level']);
  const label = firstString(raw['label']);
  const logger = firstString(raw['logger'], record?.['logger']);
  const seq = finite(raw['seq'] ?? record?.['seq']);
  const revision = finite(raw['revision'] ?? record?.['revision']);
  const attrs = parseAttrs(raw['attrs'] ?? record?.['attrs']);

  return {
    t,
    source,
    // A file line has no severity, whatever it happens to say in its text.
    level: source === 'file' ? null : level,
    message: message.slice(0, MAX_MESSAGE_LENGTH),
    ...(label === null ? {} : { label }),
    ...(logger === null ? {} : { logger }),
    ...(seq === null ? {} : { seq }),
    ...(revision === null ? {} : { revision }),
    ...(attrs === null ? {} : { attrs }),
  };
}

function parseLevel(value: unknown): LogLevel | null {
  return typeof value === 'string' && (UI_LOG_LEVELS as readonly string[]).includes(value)
    ? (value as LogLevel)
    : null;
}

function parseAttrs(value: unknown): LogAttrs | null {
  const object = asObject(value);
  if (object === null) return null;
  const out: Record<string, string | number | boolean | null> = {};
  let kept = 0;
  for (const [key, entry] of Object.entries(object)) {
    if (kept >= MAX_ATTRS) break;
    if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') {
      out[key] = typeof entry === 'string' ? entry.slice(0, MAX_MESSAGE_LENGTH) : entry;
      kept += 1;
    } else if (typeof entry === 'number' && Number.isFinite(entry)) {
      out[key] = entry;
      kept += 1;
    }
  }
  return kept === 0 ? null : out;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstString(...values: readonly unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value !== '') return value;
  }
  return null;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
