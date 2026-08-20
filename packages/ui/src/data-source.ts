/**
 * Where the viewer gets its data.
 *
 * The panel asks the same questions wherever it runs — what is the state at
 * this moment, what did the program log, what commands did the test issue —
 * and this is the shape of that asking. A running server answers them over
 * HTTP; a self-contained report answers them from a payload baked into the
 * page. One viewer, two sources, no second rendering of anything.
 *
 * What a source *cannot* do is declared up front rather than discovered by
 * calling and failing: a report has no run history and no live run, so the
 * viewer hides those affordances instead of offering buttons that error.
 *
 * @packageDocumentation
 */

import type { LogWindowQuery, TraceLogs } from './trace-logs.js';
import type { TraceCommands, TraceFrames } from './trace-playback.js';
import type { TraceOverview, TraceStatePayload } from './trace-source.js';
import type { ProjectInfo } from './project.js';
import type { RunManifest, RunSummaryEntry } from './runs.js';
import type { SpecFacts } from './spec-tree.js';

/**
 * The state a viewer starts from: what it is showing and what is attached.
 *
 * Named here rather than beside the server's routes because both sources
 * produce it — an inline report states the same facts about the archive it
 * carries as the server states about the one it opened.
 */
export interface ViewerState {
  readonly mode: 'live' | 'post-mortem' | 'record';
  /** Whether this server has a test runner behind its Run controls. */
  readonly canRun?: boolean;
  /**
   * Which project, which branch, which version — the frame around every view.
   * A report carries the values as they were when it was written.
   */
  readonly project: ProjectInfo;
  readonly sessions: readonly {
    readonly sessionId: string;
    readonly command: readonly string[];
    readonly columns: number | null;
    readonly rows: number | null;
    readonly writable: boolean;
  }[];
  readonly trace: TraceOverview | null;
  readonly record: {
    readonly sessionId: string;
    readonly command: readonly string[];
    readonly picking: boolean;
    readonly outFile: string | null;
  } | null;
}

/** What a source can do, so the viewer offers only what will work. */
export interface DataSourceFeatures {
  /** A live run can be driven: rerun, stop, and input reach a process. */
  readonly live: boolean;
  /** Past runs can be listed and opened. */
  readonly history: boolean;
  /** Another archive can be opened in place. */
  readonly openTrace: boolean;
}

/** Everything the viewer asks about what it is showing. */
export interface DataSource {
  readonly features: DataSourceFeatures;
  state(): Promise<ViewerState>;
  /** The screen and tree at a moment of the recording. */
  traceState(timeMs: number): Promise<TraceStatePayload>;
  traceLogs(query?: LogWindowQuery): Promise<TraceLogs>;
  traceCommands(): Promise<TraceCommands>;
  traceFrames(): Promise<TraceFrames>;
  /** What the project's spec files look like on disk and in the history. */
  specs(files: readonly string[]): Promise<{ readonly specs: readonly SpecFacts[] }>;
  runs(): Promise<{ readonly runs: readonly RunSummaryEntry[] }>;
  run(id: string): Promise<RunManifest>;
  openTrace(path: string): Promise<{ readonly trace: TraceOverview | null }>;
}

/**
 * A whole archive, packed into a page.
 *
 * The frames are the recording: with them the viewer replays and scrubs
 * entirely in the browser, exactly as it does when the server has already sent
 * them. That is why a report needs no `traceState` round trip and no server.
 */
export interface InlinePayload {
  readonly v: 1;
  readonly state: ViewerState;
  readonly frames: TraceFrames;
  readonly commands: TraceCommands;
  /** First semantic/terminal state, retained for an immediately useful inspector. */
  readonly traceState: TraceStatePayload;
  /** Every log record that fitted in the budget, oldest first. */
  readonly logs: TraceLogs;
}

/** Global the emitted report assigns its payload to. */
export const INLINE_PAYLOAD_KEY = '__termwrightInline';

/**
 * Reads the payload a self-contained report baked into the page.
 *
 * @returns the payload, or `undefined` when the page is served by a runner.
 */
export function readInlinePayload(scope: unknown = globalThis): InlinePayload | undefined {
  const value = (scope as Record<string, unknown>)[INLINE_PAYLOAD_KEY];
  if (typeof value !== 'object' || value === null) return undefined;
  const payload = value as { v?: unknown };
  // A payload from a build that numbered itself differently is not adapted to;
  // the report and the viewer inside it are emitted together.
  return payload.v === 1 ? (value as InlinePayload) : undefined;
}

/** Default window size, matching the server's `/api/trace/logs`. */
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

/**
 * A source backed by a payload in the page, for a report that has no server.
 *
 * Windowing the log is done here rather than handing the panel everything at
 * once, so the panel behaves identically in both modes — the same fetch on the
 * same scroll, answered from memory instead of a socket.
 */
export class InlineDataSource implements DataSource {
  readonly features: DataSourceFeatures = { live: false, history: false, openTrace: false };
  readonly #payload: InlinePayload;

  constructor(payload: InlinePayload) {
    this.#payload = payload;
  }

  async state(): Promise<ViewerState> {
    return this.#payload.state;
  }

  /**
   * @throws Error always. A report replays from its frames; nothing asks for a
   * server-derived state, and a silent empty screen would be worse than this.
   */
  async traceState(): Promise<TraceStatePayload> {
    return this.#payload.traceState;
  }

  async traceLogs(query: LogWindowQuery = {}): Promise<TraceLogs> {
    const all = this.#payload.logs.records;
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const { before, after } = query;

    let start: number;
    if (before !== undefined) {
      const end = all.findIndex((record) => record.t >= before);
      const upTo = end === -1 ? all.length : end;
      start = Math.max(upTo - limit, 0);
    } else if (after !== undefined) {
      const from = all.findIndex((record) => record.t >= after);
      start = from === -1 ? all.length : from;
    } else {
      // Match the server reader: opening Logs starts at the outcome, while an
      // explicit `after` cursor is how callers request the beginning.
      start = Math.max(all.length - limit, 0);
    }
    const records = all.slice(start, start + limit);

    return {
      ...this.#payload.logs,
      records,
      hasMoreBefore: start > 0 || this.#payload.logs.hasMoreBefore,
      hasMoreAfter: start + records.length < all.length || this.#payload.logs.hasMoreAfter,
    };
  }

  async traceCommands(): Promise<TraceCommands> {
    return this.#payload.commands;
  }

  async traceFrames(): Promise<TraceFrames> {
    return this.#payload.frames;
  }

  /**
   * @returns nothing to say. A report carries one recording, not the project
   * it came from: there are no files on disk to describe, and inventing an
   * empty history for them would be a different claim from "not applicable".
   */
  async specs(): Promise<{ readonly specs: readonly SpecFacts[] }> {
    return { specs: [] };
  }

  /** @throws Error always; `features.history` is false and the tab is hidden. */
  async runs(): Promise<{ readonly runs: readonly RunSummaryEntry[] }> {
    throw new Error('a self-contained report holds one recording and no run history');
  }

  /** @throws Error always; see {@link InlineDataSource.runs}. */
  async run(): Promise<RunManifest> {
    throw new Error('a self-contained report holds one recording and no run history');
  }

  /** @throws Error always; a report cannot reach the archives on your disk. */
  async openTrace(): Promise<{ readonly trace: TraceOverview | null }> {
    throw new Error('a self-contained report cannot open another archive');
  }
}
