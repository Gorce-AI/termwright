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
import { parseAppLog, type AppLogView } from './app-log.js';

/** Maximum records kept for display. The archive keeps them all. */
const MAX_RECORDS = 5_000;

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
  /** Log file labels and logger names seen, in first-seen order. */
  readonly sources: readonly string[];
}

const EMPTY: TraceLogs = {
  records: [],
  truncated: false,
  dropped: 0,
  available: false,
  sources: [],
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
  if (summary === undefined || typeof reader.logs !== 'function') return EMPTY;

  const dropped = Number.isFinite(summary.dropped) ? summary.dropped : 0;
  const sources = Array.isArray(summary.sources)
    ? summary.sources.filter((source): source is string => typeof source === 'string')
    : [];

  const records: AppLogView[] = [];
  let truncated = dropped > 0;
  try {
    for await (const entry of reader.logs()) {
      if (records.length >= MAX_RECORDS) {
        truncated = true;
        break;
      }
      // `castOffset` is the position a player seeks to; the panel and the
      // timeline marks both work in cast time, so it wins over the wall clock.
      const record = parseAppLog({ ...entry, t: entry.castOffset ?? entry.t });
      if (record === null) continue; // a line we cannot read is a line we skip
      records.push(record);
    }
  } catch {
    // A truncated or corrupt log file costs the rest of its records, not the
    // archive: everything read so far is still worth showing.
    return { records, truncated: true, dropped, available: true, sources };
  }
  records.sort((left, right) => left.t - right.t);
  return { records, truncated, dropped, available: true, sources };
}
