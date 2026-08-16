/**
 * Application logs read back from a `.twtrace`.
 *
 * `@termwright/trace` writes them as `logs.jsonl` and summarises them in
 * `meta.logs`; the summary is what tells the panel whether an archive recorded
 * logs at all, so "this session logged nothing" never looks like "your filter
 * hid everything".
 *
 * Every entry is validated on the way in, exactly like the crash section: an
 * archive is a file somebody else wrote, possibly with a different version.
 *
 * @packageDocumentation
 */

import type { TraceReader } from '@termwright/trace';
import { parseAppLog, UI_LOG_LEVELS, type AppLogView, type LogLevel } from './app-log.js';

/** Maximum records one window may hold. */
const MAX_WINDOW = 500;
/** Default window size when the caller does not choose one. */
const DEFAULT_WINDOW = 200;

/** One log stream the recording carried. */
export interface LogSourceView {
  /** Display name: a file's label, or an adapter logger's name. */
  readonly label?: string;
  /** Followed files only: the path the driver tailed. */
  readonly path?: string;
}

/** Which slice of the log to read. */
export interface LogWindowQuery {
  /**
   * Return the entries **before** this cast offset — the ones the panel scrolls
   * back into. Omitted means "from the start".
   */
  readonly before?: number;
  /**
   * Return the entries **at or after** this cast offset. Used when the replay
   * moves forward and the panel needs what happened next.
   */
  readonly after?: number;
  /** How many entries to return. Default 200, ceiling 500. */
  readonly limit?: number;
}

/** What the panel shows about an archive's logs. */
export interface TraceLogs {
  /** Records in this window, oldest first, positioned on the cast timeline. */
  readonly records: readonly AppLogView[];
  /** True when older entries exist before this window. */
  readonly hasMoreBefore: boolean;
  /** True when newer entries exist after this window. */
  readonly hasMoreAfter: boolean;
  /** Entries the archive holds in total, per `meta.logs.count`. */
  readonly total: number;
  /**
   * True when records are missing from this list — evicted by the writer under
   * its own ceiling, dropped here to stay within the display bound, or lost to
   * a corrupt line.
   */
  readonly truncated: boolean;
  /** Entries the writer evicted while recording, per `meta.logs.dropped`. */
  readonly dropped: number;
  /**
   * False when the archive recorded no logs at all — a session that followed no
   * file and had no instrumented adapter, or a recording made before logs
   * existed. Distinguishes "nothing was recorded" from "nothing matched".
   */
  readonly available: boolean;
  /**
   * Streams the recording carried, in first-seen order: a log file's label and
   * the path being tailed, or an adapter logger's name.
   */
  readonly sources: readonly LogSourceView[];
  /**
   * Entry count per level, straight from `meta.logs.levels` — the writer counted
   * the whole recording, so the header is honest even when this list is
   * truncated. File lines have no level and are not counted.
   */
  readonly levels: Readonly<Partial<Record<LogLevel, number>>>;
}

const EMPTY: TraceLogs = {
  records: [],
  hasMoreBefore: false,
  hasMoreAfter: false,
  total: 0,
  truncated: false,
  dropped: 0,
  available: false,
  sources: [],
  levels: {},
};

/**
 * Reads one window of the archive's log stream.
 *
 * A recording of a chatty program can hold far more log lines than a page has
 * any business holding, so the panel asks for a window and asks again when the
 * user scrolls out of it. The archive is streamed per request rather than
 * indexed up front: the file is local, and an index of a file we may never
 * scroll through costs more than it saves.
 *
 * @example
 * ```ts
 * const tail = await readTraceLogs(reader);                    // newest window
 * const older = await readTraceLogs(reader, { before: tail.records[0]?.t });
 * ```
 */
export async function readTraceLogs(
  reader: TraceReader,
  query: LogWindowQuery = {},
): Promise<TraceLogs> {
  const summary = reader.meta.logs;
  if (summary === undefined) return EMPTY;

  const limit = Math.min(Math.max(Math.trunc(query.limit ?? DEFAULT_WINDOW), 1), MAX_WINDOW);
  const dropped = Number.isFinite(summary.dropped) ? summary.dropped : 0;
  const total = Number.isFinite(summary.count) ? summary.count : 0;
  const base = {
    total,
    dropped,
    available: true,
    sources: parseSources(summary.sources),
    levels: countsByLevel(summary.levels),
  };

  // `before` keeps the last `limit` entries under the cursor; `after` (and the
  // default) keeps the first `limit` at or past it.
  const window: AppLogView[] = [];
  let skippedBefore = 0;
  let skippedAfter = 0;
  let failed = false;

  try {
    for await (const entry of reader.logs()) {
      // `castOffset` is the position a player seeks to, and the panel and the
      // timeline marks both work in cast time.
      const record = parseAppLog({ ...entry, t: entry.castOffset });
      if (record === null) continue; // a line we cannot read is a line we skip

      if (query.before !== undefined) {
        if (record.t >= query.before) {
          skippedAfter += 1;
          continue;
        }
        window.push(record);
        if (window.length > limit) {
          window.shift();
          skippedBefore += 1;
        }
        continue;
      }

      if (query.after !== undefined && record.t < query.after) {
        skippedBefore += 1;
        continue;
      }
      if (window.length >= limit) {
        skippedAfter += 1;
        continue;
      }
      window.push(record);
    }
  } catch {
    // A truncated or corrupt log file costs the rest of its records, not the
    // archive: everything read so far is still worth showing.
    failed = true;
  }

  return {
    ...base,
    records: window,
    hasMoreBefore: skippedBefore > 0,
    hasMoreAfter: skippedAfter > 0,
    truncated: failed || dropped > 0,
  };
}

/** Reads `meta.logs.sources`: `{label?, path?}` objects. */
function parseSources(value: unknown): LogSourceView[] {
  if (!Array.isArray(value)) return [];
  const out: LogSourceView[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const source = entry as Record<string, unknown>;
    const label = typeof source['label'] === 'string' ? source['label'] : undefined;
    const path = typeof source['path'] === 'string' ? source['path'] : undefined;
    if (label === undefined && path === undefined) continue;
    out.push({ ...(label === undefined ? {} : { label }), ...(path === undefined ? {} : { path }) });
  }
  return out;
}

/** Keeps only the counters that name a level this build knows. */
function countsByLevel(value: unknown): Readonly<Partial<Record<LogLevel, number>>> {
  if (typeof value !== 'object' || value === null) return {};
  const counts: Partial<Record<LogLevel, number>> = {};
  for (const level of UI_LOG_LEVELS) {
    const count = (value as Record<string, unknown>)[level];
    if (typeof count === 'number' && Number.isFinite(count) && count > 0) counts[level] = count;
  }
  return counts;
}
