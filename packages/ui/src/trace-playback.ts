/**
 * Reading a `.twtrace` for the two things playback needs: the command log and
 * the frames themselves.
 *
 * Frames are loaded once and played in the browser rather than fetched per
 * step. A scrub can afford a round trip per move; playback at 4× cannot, and a
 * recording that stutters is worse than no playback at all.
 *
 * @packageDocumentation
 */

import type { TraceReader } from '@termwright/trace';
import { buildCommandLog, type CommandRow } from './commands.js';
import type { PlaybackFrame } from './playback.js';

/** Byte ceiling on the frames handed to a page. */
const MAX_FRAME_BYTES = 8 * 1024 * 1024;

/** What `/api/trace/frames` answers. */
export interface TraceFrames {
  readonly frames: readonly PlaybackFrame[];
  /** True when the recording was too large to send whole. */
  readonly truncated: boolean;
  /** Cast-timeline length covered by `frames`. */
  readonly durationMs: number;
  /** Semantic revisions on the cast timeline, for keeping the tree in step. */
  readonly revisions: readonly { readonly t: number; readonly revision: number }[];
}

/** Reads the command log from `events.jsonl`. */
export async function readCommandLog(reader: TraceReader): Promise<readonly CommandRow[]> {
  const events: unknown[] = [];
  try {
    for await (const event of reader.events()) events.push(event);
  } catch {
    // A truncated event log still describes everything before the truncation.
  }
  return buildCommandLog(events);
}

/**
 * Reads the recording as playable frames.
 *
 * Output frames carry base64 so the wire stays JSON-safe; resize frames carry
 * the viewport, because a recording whose terminal grew mid-run has to grow
 * with it or every later frame lands in the wrong place.
 */
export async function readFrames(reader: TraceReader): Promise<TraceFrames> {
  const frames: PlaybackFrame[] = [];
  let bytes = 0;
  let truncated = false;
  let durationMs = 0;

  try {
    for await (const event of reader.castEvents()) {
      if (bytes > MAX_FRAME_BYTES) {
        truncated = true;
        break;
      }
      durationMs = Math.max(durationMs, event.timeMs);
      if (event.code === 'o') {
        const dataB64 = Buffer.from(event.data, 'utf8').toString('base64');
        bytes += dataB64.length;
        frames.push({ t: event.timeMs, kind: 'output', dataB64 });
      } else if (event.code === 'r') {
        const size = parseResize(event.data);
        if (size !== null) frames.push({ t: event.timeMs, kind: 'resize', ...size });
      }
    }
  } catch {
    truncated = true;
  }

  const revisions: { t: number; revision: number }[] = [];
  try {
    for await (const record of reader.semantics()) {
      revisions.push({ t: record.castOffset, revision: record.revision });
    }
  } catch {
    // No revision list: playback still runs, the tree just stops updating.
  }

  return {
    frames,
    truncated,
    durationMs: Math.max(durationMs, reader.meta.durationMs ?? 0),
    revisions,
  };
}

/** asciicast resize payload: `"120x40"`. */
function parseResize(data: string): { columns: number; rows: number } | null {
  const match = /^(\d+)x(\d+)$/.exec(data.trim());
  if (match === null) return null;
  const [, columns, rows] = match;
  if (columns === undefined || rows === undefined) return null;
  return { columns: Number.parseInt(columns, 10), rows: Number.parseInt(rows, 10) };
}
