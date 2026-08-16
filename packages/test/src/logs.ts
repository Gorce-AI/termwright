/**
 * Application logs, as a test sees them.
 *
 * The driver publishes two different things on one event: lines from a
 * followed file, and structured records from an instrumented adapter. A test
 * wants to query both the same way, snapshot them without the timestamps that
 * change every run, and — above all — be told when the program logged an error
 * it never asserted on.
 */

import { LOG_LEVEL_SEVERITY, type LogLevel } from '@termwright/protocol';
import type { AppLogEvent, SessionEvents } from '@termwright/driver';

/** One log entry, tagged with the session that produced it. */
export interface CapturedLog extends AppLogEvent {
  readonly sessionId: string;
}

/** Which entries an operation applies to. Every field narrows further. */
export interface LogQuery {
  /** One level or a set of them. */
  readonly level?: LogLevel | readonly LogLevel[];
  /** This level or more severe. */
  readonly minLevel?: LogLevel;
  readonly source?: 'file' | 'adapter';
  readonly label?: string;
  readonly logger?: string;
  /** Substring, or a pattern, of the message (or of a file line). */
  readonly message?: string | RegExp;
  readonly sessionId?: string;
}

/**
 * Entries kept per test before the oldest are dropped.
 *
 * A chatty program under a long test would otherwise grow this without bound;
 * the driver bounds its own queue, and this bounds the test's copy.
 */
export const MAX_CAPTURED_LOGS = 5_000;

/** Everything a test can ask of its logs. */
export interface LogCollection {
  /** Every entry, oldest first. */
  all(): readonly CapturedLog[];
  /** The entries a query selects, oldest first. */
  filter(query?: LogQuery): readonly CapturedLog[];
  /**
   * Entries rendered one per line, without timestamps, sequence numbers or
   * revisions — stable enough to put in a snapshot.
   */
  text(query?: LogQuery): string;
  /** Forgets everything captured so far. */
  clear(): void;
  /** Entries dropped because {@link MAX_CAPTURED_LOGS} was reached. */
  dropped(): number;
  /** Appends an entry. Used by the fixtures; tests read rather than write. */
  push(entry: CapturedLog): void;
}

/** An in-memory collection. */
export function createLogCollection(): LogCollection {
  let entries: CapturedLog[] = [];
  let dropped = 0;
  const collection: LogCollection = {
    all: () => entries,
    filter: (query) => (query === undefined ? entries : entries.filter((entry) => matchesLog(entry, query))),
    text: (query) => {
      const selected = collection.filter(query);
      return selected.length === 0 ? '' : `${selected.map(formatLogEntry).join('\n')}\n`;
    },
    clear: () => {
      entries = [];
      dropped = 0;
    },
    dropped: () => dropped,
    push: (entry) => {
      entries.push(entry);
      if (entries.length > MAX_CAPTURED_LOGS) {
        entries = entries.slice(-MAX_CAPTURED_LOGS);
        dropped += 1;
      }
    },
  };
  return collection;
}

/** The slice of a harness {@link collectLogs} needs. */
export interface LogSource {
  readonly sessionId: string;
  readonly events: SessionEvents;
}

/** Collections by harness, so a matcher can find the logs of a session. */
const collections = new WeakMap<object, LogCollection>();

/**
 * Subscribes to a session's logs.
 *
 * The fixtures call this for every session they launch. Call it yourself for a
 * harness they did not create — a `mountInk` component, say — and
 * `expect(harness).toHaveLogged(…)` starts working on it too.
 *
 * @returns the collection and an unsubscribe function.
 */
export function collectLogs(
  harness: LogSource,
  into: LogCollection = createLogCollection(),
): { readonly collection: LogCollection; dispose(): void } {
  const unsubscribe = harness.events.on('app-log', (event) => {
    into.push({ ...event, sessionId: harness.sessionId });
  });
  collections.set(harness, into);
  return {
    collection: into,
    dispose: () => {
      unsubscribe();
      if (collections.get(harness) === into) collections.delete(harness);
    },
  };
}

/** The collection attached to a harness, when one is. */
export function logsOf(harness: object): LogCollection | undefined {
  return collections.get(harness);
}

/** Whether an entry satisfies every field of a query. */
export function matchesLog(entry: CapturedLog, query: LogQuery): boolean {
  if (query.sessionId !== undefined && entry.sessionId !== query.sessionId) return false;
  if (query.source !== undefined && entry.source !== query.source) return false;
  if (query.label !== undefined && entry.label !== query.label) return false;
  if (query.logger !== undefined && entry.record?.logger !== query.logger) return false;

  const level = entry.record?.level;
  if (query.level !== undefined) {
    const wanted = typeof query.level === 'string' ? [query.level] : query.level;
    if (level === undefined || !wanted.includes(level)) return false;
  }
  if (query.minLevel !== undefined) {
    if (level === undefined || !atLeast(level, query.minLevel)) return false;
  }
  if (query.message !== undefined) {
    const text = entry.record?.message ?? entry.line ?? '';
    const matched =
      query.message instanceof RegExp ? query.message.test(text) : text.includes(query.message);
    if (!matched) return false;
  }
  return true;
}

/** Whether `level` is as severe as `threshold`, or worse. */
export function atLeast(level: LogLevel, threshold: LogLevel): boolean {
  return LOG_LEVEL_SEVERITY[level] >= LOG_LEVEL_SEVERITY[threshold];
}

/**
 * Renders an entry for snapshots and failure messages.
 *
 * Timestamps, sequence numbers and revisions are left out on purpose: they
 * change on every run, and a snapshot that changes on every run is noise.
 */
export function formatLogEntry(entry: CapturedLog): string {
  const record = entry.record;
  if (record === undefined) {
    const line = entry.line ?? '';
    return entry.label === undefined ? line : `[${entry.label}] ${line}`;
  }
  const head = record.logger === undefined ? record.level : `${record.level} ${record.logger}:`;
  const attrs = record.attrs;
  const rendered =
    attrs === undefined
      ? ''
      : Object.keys(attrs)
          .sort()
          .map((key) => ` ${key}=${JSON.stringify(attrs[key])}`)
          .join('');
  return `${head} ${record.message}${rendered}`;
}

/**
 * Entries at or above a threshold — the ones that fail an otherwise green test.
 *
 * A followed file yields lines, not levels, and a line has no severity to
 * compare: guessing one from its text would fail tests on the word "error"
 * appearing in a URL. Only structured records can cross this threshold.
 */
export function logsFailingThreshold(
  entries: readonly CapturedLog[],
  threshold: LogLevel,
): readonly CapturedLog[] {
  return entries.filter((entry) => entry.record !== undefined && atLeast(entry.record.level, threshold));
}

/**
 * The failure text for a passing test whose program logged something severe,
 * or `undefined` when nothing crossed the threshold.
 */
export function describeLogThresholdFailure(
  entries: readonly CapturedLog[],
  threshold: LogLevel,
): string | undefined {
  const offenders = logsFailingThreshold(entries, threshold);
  return offenders.length === 0 ? undefined : formatLogFailure(offenders, threshold);
}

/**
 * The whole decision the fixtures make after a test: whether to fail it for
 * what the program logged.
 *
 * A test that already failed is left alone — the assertion that failed is the
 * story, and a second failure stacked on top only buries it.
 */
export function logThresholdFailure(
  entries: readonly CapturedLog[],
  threshold: LogLevel | false,
  testAlreadyFailed: boolean,
): string | undefined {
  if (threshold === false || testAlreadyFailed) return undefined;
  return describeLogThresholdFailure(entries, threshold);
}

/** How many offending entries a failure message lists before summarising. */
const FAILURE_LIST_LIMIT = 10;

/** The message a test fails with when the program logged something severe. */
export function formatLogFailure(offenders: readonly CapturedLog[], threshold: LogLevel): string {
  const shown = offenders.slice(0, FAILURE_LIST_LIMIT);
  const rest = offenders.length - shown.length;
  return [
    `The test passed, but the program logged ${offenders.length} record${offenders.length === 1 ? '' : 's'} ` +
      `at level ${threshold} or above:`,
    ...shown.map((entry) => `  ${formatLogEntry(entry)}`),
    ...(rest > 0 ? [`  …and ${rest} more`] : []),
    '',
    'Assert on them with expect(terminal).toHaveLogged({ level: ... }), or turn the check off:',
    "  for one test:   terminal.failOnLogLevel(false)",
    '  for the suite:  defineTermwrightConfig({ failOnLogLevel: false })',
  ].join('\n');
}
