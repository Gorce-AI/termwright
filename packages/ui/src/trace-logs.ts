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

/** Maximum records kept for display. The archive keeps them all. */
const MAX_RECORDS = 5_000;

/** One log stream the recording carried. */
export interface LogSourceView {
  /** Display name: a file's label, or an adapter logger's name. */
  readonly label?: string;
  /** Followed files only: the path the driver tailed. */
  readonly path?: string;
}

/** What the panel shows about an archive's logs. */
export interface TraceLogs {
  /** Records, oldest first, positioned on the cast timeline. */
  readonly records: readonly AppLogView[];
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
  truncated: false,
  dropped: 0,
  available: false,
  sources: [],
  levels: {},
};

/**
 * Reads and validates the archive's log stream.
 *
 * @example
 * ```ts
 * const logs = await readTraceLogs(reader);
 * logs.available ? logs.records.length : 'this archive has no logs';
 * ```
 */
export async function readTraceLogs(reader: TraceReader): Promise<TraceLogs> {
  const summary = reader.meta.logs;
  if (summary === undefined) return EMPTY;

  const dropped = Number.isFinite(summary.dropped) ? summary.dropped : 0;
  const sources = parseSources(summary.sources);

  const levels = countsByLevel(summary.levels);
  const records: AppLogView[] = [];
  let truncated = dropped > 0;
  try {
    for await (const entry of reader.logs()) {
      if (records.length >= MAX_RECORDS) {
        truncated = true;
        break;
      }
      // `castOffset` is the position a player seeks to, and the panel and the
      // timeline marks both work in cast time.
      const record = parseAppLog({ ...entry, t: entry.castOffset });
      if (record === null) continue; // a line we cannot read is a line we skip
      records.push(record);
    }
  } catch {
    // A truncated or corrupt log file costs the rest of its records, not the
    // archive: everything read so far is still worth showing.
    return { records, truncated: true, dropped, available: true, sources, levels };
  }
  records.sort((left, right) => left.t - right.t);
  return { records, truncated, dropped, available: true, sources, levels };
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
