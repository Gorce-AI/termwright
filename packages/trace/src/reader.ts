/**
 * {@link openTrace} — streaming reader for `.twtrace` archives, and the
 * `stateAt()` primitive the runner UI's time travel is built on.
 */

import { openArchive, type ArchiveFiles } from './archive.js';
import {
  parseCastHeader,
  streamCastEvents,
  type CastEvent,
  type CastHeader,
} from './cast.js';
import { TraceError } from './errors.js';
import {
  TRACE_FILES,
  TRACE_VERSION,
  type SemanticRecord,
  type StepSummary,
  type TraceEvent,
  type TraceLogEntry,
  type TraceMeta,
} from './types.js';

/** Reconstructed session state at one point on the cast timeline. */
export interface TraceState {
  /** The requested cast-timeline offset, clamped to the recording. */
  readonly timeMs: number;
  /**
   * Concatenated asciicast output up to and including `timeMs`. Writing this
   * into a terminal emulator reproduces the screen at that moment.
   */
  readonly castPrefix: string;
  /** Viewport after applying every resize up to `timeMs`. */
  readonly columns: number;
  readonly rows: number;
  /** Revision of the newest semantic snapshot at or before `timeMs`. */
  readonly nearestSemanticRevision: number | null;
  /** That snapshot's full record, or `null` when the session had no tree. */
  readonly nearestSemantic: SemanticRecord | null;
  /** The innermost step covering `timeMs`, when any. */
  readonly step: StepSummary | null;
  /**
   * The application log entries leading up to `timeMs`, oldest first — what
   * the program was saying about itself as the screen reached this state.
   * Bounded by `StateOptions.logWindow`.
   */
  readonly logs: readonly TraceLogEntry[];
}

/** Options for {@link TraceReader.stateAt}. */
export interface StateOptions {
  /** How many preceding log entries to include. Default 20; `0` disables. */
  readonly logWindow?: number;
}

/** Streaming reader over one archive. */
export interface TraceReader {
  readonly meta: TraceMeta;
  readonly container: 'directory' | 'zip';
  readonly path: string;
  /** Parsed `session.cast` header. */
  castHeader(): Promise<CastHeader>;
  /** Streams cast events with absolute offsets resolved. */
  castEvents(): AsyncIterable<CastEvent>;
  /** Streams `events.jsonl`. */
  events(): AsyncIterable<TraceEvent>;
  /** Streams `semantics.jsonl`. */
  semantics(): AsyncIterable<SemanticRecord>;
  /** Streams `logs.jsonl`; empty when the session produced no logs. */
  logs(): AsyncIterable<TraceLogEntry>;
  /** Flattened step list, ordered by start time. Cached. */
  steps(): Promise<readonly StepSummary[]>;
  /** The newest semantic record at or before `castOffsetMs`. */
  semanticAt(castOffsetMs: number): Promise<SemanticRecord | null>;
  /**
   * The semantic tree the crash report points at, or `null` when the session
   * did not crash or had no tree. `meta.crash` stores only the revision, so
   * the snapshot is not duplicated between `meta.json` and `semantics.jsonl`.
   */
  crashSemantic(): Promise<SemanticRecord | null>;
  /** Everything the UI needs to render one point in time. */
  stateAt(timeMs: number, options?: StateOptions): Promise<TraceState>;
  close(): Promise<void>;
}

/**
 * Opens a `.twtrace` directory or zip.
 *
 * @throws TraceError `protocol-violation` for a missing, malformed, or
 *   future-versioned archive.
 *
 * @example
 * ```ts
 * const trace = await openTrace('out/login.twtrace');
 * const state = await trace.stateAt(1_500);
 * terminal.write(state.castPrefix);
 * console.log(state.nearestSemanticRevision);
 * await trace.close();
 * ```
 */
export async function openTrace(path: string): Promise<TraceReader> {
  const files = await openArchive(path);
  const meta = parseMeta(await files.read(TRACE_FILES.meta), path);
  return new ArchiveReader(files, meta);
}

function parseMeta(text: string, path: string): TraceMeta {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TraceError('protocol-violation', `${path}: meta.json is not valid JSON`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new TraceError('protocol-violation', `${path}: meta.json is not an object`);
  }
  const meta = parsed as TraceMeta;
  if (meta.v !== TRACE_VERSION) {
    throw new TraceError(
      'protocol-violation',
      `${path}: unsupported trace version ${String(meta.v)} (expected ${TRACE_VERSION})`,
      { suggestion: 'Upgrade @termwright/trace, or re-record with the current version.' },
    );
  }
  if (typeof meta.sessionId !== 'string') {
    throw new TraceError('protocol-violation', `${path}: meta.sessionId is missing`);
  }
  return meta;
}

interface SemanticIndexEntry {
  readonly line: number;
  readonly t: number;
  readonly revision: number;
  readonly castOffset: number;
}

class ArchiveReader implements TraceReader {
  readonly meta: TraceMeta;
  readonly #files: ArchiveFiles;
  #steps: readonly StepSummary[] | null = null;
  #semanticIndex: readonly SemanticIndexEntry[] | null = null;

  constructor(files: ArchiveFiles, meta: TraceMeta) {
    this.#files = files;
    this.meta = meta;
  }

  get container(): 'directory' | 'zip' {
    return this.#files.container;
  }

  get path(): string {
    return this.#files.path;
  }

  async castHeader(): Promise<CastHeader> {
    for await (const line of this.#files.lines(TRACE_FILES.cast)) {
      return parseCastHeader(line);
    }
    throw new TraceError('protocol-violation', `${this.path}: session.cast is empty`);
  }

  castEvents(): AsyncIterable<CastEvent> {
    return streamCastEvents(this.#files.lines(TRACE_FILES.cast));
  }

  events(): AsyncIterable<TraceEvent> {
    return validateEvents(
      parseJsonLines<TraceEvent>(this.#files.lines(TRACE_FILES.events), TRACE_FILES.events),
    );
  }

  semantics(): AsyncIterable<SemanticRecord> {
    return parseJsonLines<SemanticRecord>(
      this.#files.lines(TRACE_FILES.semantics),
      TRACE_FILES.semantics,
    );
  }

  logs(): AsyncIterable<TraceLogEntry> {
    return parseJsonLines<TraceLogEntry>(this.#files.lines(TRACE_FILES.logs), TRACE_FILES.logs);
  }

  /** The last `limit` entries at or before `castOffsetMs`, oldest first. */
  async #logsBefore(castOffsetMs: number, limit: number): Promise<readonly TraceLogEntry[]> {
    if (limit <= 0 || this.meta.logs === undefined) return [];
    const window: TraceLogEntry[] = [];
    for await (const entry of this.logs()) {
      if (entry.castOffset > castOffsetMs) break;
      window.push(entry);
      if (window.length > limit) window.shift();
    }
    return window;
  }

  async steps(): Promise<readonly StepSummary[]> {
    if (this.#steps !== null) return this.#steps;
    const open = new Map<string, StepSummary>();
    const ordered: StepSummary[] = [];
    for await (const event of this.events()) {
      const castOffset = event.castOffset;
      if (event.kind === 'step-start') {
        const summary: StepSummary = {
          stepId: event.stepId,
          title: event.title,
          ...(event.parentStepId === undefined ? {} : { parentStepId: event.parentStepId }),
          startedAt: event.t,
          endedAt: null,
          castOffset,
          castEndOffset: null,
          status: null,
        };
        open.set(event.stepId, summary);
        ordered.push(summary);
      } else if (event.kind === 'step-end') {
        const started = open.get(event.stepId);
        if (started === undefined) continue;
        open.delete(event.stepId);
        const index = ordered.indexOf(started);
        ordered[index] = {
          ...started,
          endedAt: event.t,
          castEndOffset: castOffset,
          status: event.status,
          ...(event.error === undefined ? {} : { error: event.error }),
        };
      }
    }
    this.#steps = ordered;
    return ordered;
  }

  async #index(): Promise<readonly SemanticIndexEntry[]> {
    if (this.#semanticIndex !== null) return this.#semanticIndex;
    const entries: SemanticIndexEntry[] = [];
    let line = 0;
    for await (const record of this.semantics()) {
      entries.push({
        line,
        t: record.t,
        revision: record.revision,
        castOffset: record.castOffset,
      });
      line += 1;
    }
    this.#semanticIndex = entries;
    return entries;
  }

  async semanticAt(castOffsetMs: number): Promise<SemanticRecord | null> {
    const index = await this.#index();
    let candidate: SemanticIndexEntry | null = null;
    for (const entry of index) {
      if (entry.castOffset <= castOffsetMs) candidate = entry;
      else break;
    }
    if (candidate === null) return null;
    let line = 0;
    for await (const record of this.semantics()) {
      if (line === candidate.line) return record;
      line += 1;
    }
    return null;
  }

  async crashSemantic(): Promise<SemanticRecord | null> {
    const revision = this.meta.crash?.lastSemanticRevision;
    if (revision === undefined || revision === null) return null;
    for await (const record of this.semantics()) {
      if (record.revision === revision) return record;
    }
    return null;
  }

  async stateAt(timeMs: number, options: StateOptions = {}): Promise<TraceState> {
    if (!Number.isFinite(timeMs) || timeMs < 0) {
      throw new TraceError('protocol-violation', `stateAt(${timeMs}): time must be >= 0`);
    }
    const header = await this.castHeader();
    let columns = header.term.cols;
    let rows = header.term.rows;
    let reached = 0;
    const output: string[] = [];
    for await (const event of this.castEvents()) {
      if (event.timeMs > timeMs) break;
      reached = event.timeMs;
      if (event.code === 'o') output.push(event.data);
      else if (event.code === 'r') {
        const size = parseSize(event.data);
        if (size !== null) {
          columns = size.columns;
          rows = size.rows;
        }
      }
    }
    const semantic = await this.semanticAt(timeMs);
    const step = findStep(await this.steps(), timeMs);
    const logs = await this.#logsBefore(timeMs, options.logWindow ?? 20);
    return {
      timeMs: reached,
      castPrefix: output.join(''),
      columns,
      rows,
      nearestSemanticRevision: semantic?.revision ?? null,
      nearestSemantic: semantic,
      step,
      logs,
    };
  }

  async close(): Promise<void> {
    await this.#files.close();
  }
}

function findStep(steps: readonly StepSummary[], timeMs: number): StepSummary | null {
  let best: StepSummary | null = null;
  for (const step of steps) {
    const end = step.castEndOffset ?? Number.POSITIVE_INFINITY;
    if (step.castOffset <= timeMs && timeMs <= end) {
      // Later entries are nested more deeply; the last match is the innermost.
      best = step;
    }
  }
  return best;
}

function parseSize(data: string): { columns: number; rows: number } | null {
  const match = /^(\d+)x(\d+)$/.exec(data);
  if (match === null) return null;
  return { columns: Number(match[1]), rows: Number(match[2]) };
}

/**
 * Rejects event lines that cannot be placed on the recording.
 *
 * `castOffset` is required by §Trace. Falling back to `t` would put an event
 * at the wrong moment in any recording that was hidden or idle-trimmed, and
 * do it silently — a corrupt line is better news than a plausible lie.
 */
async function* validateEvents(events: AsyncIterable<TraceEvent>): AsyncGenerator<TraceEvent> {
  let lineNumber = 0;
  for await (const event of events) {
    lineNumber += 1;
    if (typeof event.castOffset !== 'number' || !Number.isFinite(event.castOffset)) {
      throw new TraceError(
        'protocol-violation',
        `${TRACE_FILES.events}:${lineNumber} has no castOffset`,
        {
          suggestion:
            'The archive predates the required castOffset field, or was written by something other than @termwright/trace. Re-record it.',
        },
      );
    }
    yield event;
  }
}

async function* parseJsonLines<T>(
  lines: AsyncIterable<string>,
  file: string,
): AsyncGenerator<T> {
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    try {
      yield JSON.parse(line) as T;
    } catch {
      throw new TraceError('protocol-violation', `${file}:${lineNumber} is not valid JSON`);
    }
  }
}
