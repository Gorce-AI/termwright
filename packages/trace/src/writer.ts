/**
 * {@link createTraceWriter} — subscribes to a live session and produces a
 * `.twtrace` archive directory.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SemanticSnapshot } from '@termwright/protocol';
import type { SessionCapabilities, SessionEvents } from '@termwright/driver';
import { formatCastEvent, formatCastHeader, type CastEventCode, type CastHeader } from './cast.js';
import { TraceError } from './errors.js';
import { buildCastTimeline, type HiddenWindow } from './timeline.js';
import {
  TRACE_FILES,
  TRACE_VERSION,
  type ActionEvent,
  type AssertEvent,
  type SemanticRecord,
  type StepStatus,
  type TraceEvent,
  type TraceExit,
  type TraceMeta,
} from './types.js';

/**
 * The slice of `TerminalHarness` a trace writer consumes.
 *
 * A real `TerminalHarness` satisfies it structurally; tests and the runner UI
 * can supply anything with a session id and an event emitter.
 */
export interface TraceSource {
  readonly sessionId: string;
  readonly events: SessionEvents;
  /** Called on every `semantic-revision` to capture the tree, when available. */
  semanticTree?(): SemanticSnapshot | null;
  capabilities?(): SessionCapabilities;
}

/** Options for {@link createTraceWriter}. */
export interface TraceWriterOptions {
  /** Destination directory; created recursively. Conventionally `*.twtrace`. */
  readonly dir: string;
  /** argv of the recorded session, stored in `meta.json`. */
  readonly command?: readonly string[];
  /** Initial viewport, used for the cast header. Default 100×30. */
  readonly columns?: number;
  readonly rows?: number;
  readonly platform?: NodeJS.Platform;
  /** Overrides capability detection for `meta.semanticTree`. */
  readonly semanticTree?: boolean;
  readonly title?: string;
  readonly env?: Readonly<Record<string, string>>;
  /**
   * Record PTY input as asciicast `i` events too. Off by default: inputs are
   * already in `events.jsonl` losslessly, and players ignore them.
   */
  readonly recordInput?: boolean;
  /**
   * Byte ceiling for buffered output. On overflow the writer stops recording
   * output and sets `meta.truncated`. Default 32 MiB.
   */
  readonly maxOutputBytes?: number;
  /** Injectable clock (milliseconds). Default `Date.now`. */
  readonly now?: () => number;
}

/** Options for {@link TraceWriter.finalize}. */
export interface FinalizeOptions {
  /**
   * Trim idle gaps longer than this many **seconds**, asciinema-style. Omitted
   * or `<= 0` keeps the recording untrimmed.
   */
  readonly idleTimeLimit?: number;
  /** Recorded process exit, when the caller knows it and no `exit` event fired. */
  readonly exit?: TraceExit;
}

/** Handle returned by {@link TraceWriter.addStep}. */
export interface StepHandle {
  readonly stepId: string;
  readonly title: string;
  /** Closes this step. Calling it twice is a no-op. */
  end(status?: StepStatus, error?: string): void;
}

/** Result of {@link TraceWriter.finalize}. */
export interface TraceArchive {
  /** Absolute or caller-relative path of the archive directory. */
  readonly dir: string;
  readonly meta: TraceMeta;
  /** Cast duration in milliseconds after hide/trim transforms. */
  readonly durationMs: number;
}

/** Records a live session into a `.twtrace` archive. */
export interface TraceWriter {
  /** Opens a step; writes a cast marker labelled with `title`. */
  addStep(title: string): StepHandle;
  /** Closes the innermost open step (or `stepId` when given). */
  endStep(stepId?: string, status?: StepStatus, error?: string): void;
  /** Excludes subsequent output from the recording until {@link show}. */
  hide(): void;
  /** Resumes recording after {@link hide}. Idempotent. */
  show(): void;
  /** True while a hide window is open. */
  isHidden(): boolean;
  /** Records a driver action and its outcome. */
  recordAction(action: Omit<ActionEvent, 't' | 'kind' | 'castOffset'>): void;
  /** Records an assertion and its outcome. */
  recordAssert(assertion: Omit<AssertEvent, 't' | 'kind' | 'castOffset'>): void;
  /** Detaches from the session and writes the archive. Callable once. */
  finalize(options?: FinalizeOptions): Promise<TraceArchive>;
  /** Detaches from the session without writing anything. */
  dispose(): void;
}

interface PendingCastEvent {
  wall: number;
  seq: number;
  code: CastEventCode;
  data: string;
}

const DEFAULT_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const COALESCE_LIMIT_BYTES = 64 * 1024;

/**
 * Attaches a recorder to a live session.
 *
 * Recording starts immediately; nothing is written to disk until
 * {@link TraceWriter.finalize}, which is when hide windows and idle trimming
 * are applied and every artefact gets its `castOffset`.
 *
 * @example
 * ```ts
 * const writer = createTraceWriter(harness, { dir: 'out/login.twtrace' });
 * const step = writer.addStep('log in');
 * await harness.getByRole('button', { name: 'Submit' }).click();
 * step.end('passed');
 * await writer.finalize({ idleTimeLimit: 2 });
 * ```
 */
export function createTraceWriter(
  session: TraceSource,
  options: TraceWriterOptions,
): TraceWriter {
  const now = options.now ?? (() => Date.now());
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const startWall = now();
  const startedAt = new Date().toISOString();

  const castEvents: PendingCastEvent[] = [];
  const traceEvents: TraceEvent[] = [];
  const semantics: { t: number; revision: number; snapshot: SemanticSnapshot }[] = [];
  const hiddenWindows: HiddenWindow[] = [];
  const openSteps: string[] = [];
  const closedSteps = new Set<string>();
  const decoder = new TextDecoder('utf-8');
  const unsubscribers: (() => void)[] = [];

  let seq = 0;
  let stepCounter = 0;
  let outputBytes = 0;
  let truncated = false;
  let hideStart: number | null = null;
  let finalized = false;
  let disposed = false;
  let exit: TraceExit | undefined;
  let columns = options.columns ?? 100;
  let rows = options.rows ?? 30;
  let lastResize: { columns: number; rows: number } | null = null;

  /** Driver timestamps use an unknown epoch; anchor on the first one we see. */
  let driverBase: { driver: number; local: number } | null = null;

  function localTime(): number {
    return Math.max(0, now() - startWall);
  }

  function driverTime(timeMs: number): number {
    if (driverBase === null) {
      driverBase = { driver: timeMs, local: localTime() };
    }
    return Math.max(0, driverBase.local + (timeMs - driverBase.driver));
  }

  function pushCast(wall: number, code: CastEventCode, data: string): void {
    castEvents.push({ wall, seq: seq++, code, data });
  }

  function pushOutput(wall: number, text: string): void {
    if (text === '') return;
    const previous = castEvents[castEvents.length - 1];
    if (
      previous !== undefined &&
      previous.code === 'o' &&
      previous.wall === wall &&
      previous.data.length + text.length <= COALESCE_LIMIT_BYTES
    ) {
      previous.data += text;
      return;
    }
    pushCast(wall, 'o', text);
  }

  function inHiddenWindow(wall: number): boolean {
    return hideStart !== null && wall >= hideStart;
  }

  unsubscribers.push(
    session.events.on('output', ({ data, timeMs }) => {
      const wall = driverTime(timeMs);
      // Decode unconditionally so the streaming decoder keeps its state even
      // across hidden windows; discard the text when hidden.
      const text = decoder.decode(data, { stream: true });
      if (truncated || inHiddenWindow(wall)) return;
      outputBytes += data.byteLength;
      if (outputBytes > maxOutputBytes) {
        truncated = true;
        return;
      }
      pushOutput(wall, text);
    }),
  );

  unsubscribers.push(
    session.events.on('input', ({ data, timeMs, kind }) => {
      const wall = driverTime(timeMs);
      traceEvents.push({
        t: wall,
        kind: 'input',
        dataB64: Buffer.from(data).toString('base64'),
        inputKind: kind,
      });
      if (options.recordInput === true && !inHiddenWindow(wall)) {
        pushCast(wall, 'i', new TextDecoder('utf-8').decode(data));
      }
    }),
  );

  unsubscribers.push(
    session.events.on('resize', (event) => {
      const wall = driverTime(event.timeMs);
      columns = event.columns;
      rows = event.rows;
      lastResize = { columns: event.columns, rows: event.rows };
      traceEvents.push({
        t: wall,
        kind: 'resize',
        columns: event.columns,
        rows: event.rows,
      });
      pushCast(wall, 'r', `${event.columns}x${event.rows}`);
    }),
  );

  unsubscribers.push(
    session.events.on('semantic-revision', ({ revision, timeMs }) => {
      const snapshot = session.semanticTree?.() ?? null;
      if (snapshot === null) return;
      semantics.push({ t: driverTime(timeMs), revision, snapshot });
    }),
  );

  unsubscribers.push(
    session.events.on('exit', (status) => {
      const wall = driverTime(status.timeMs);
      exit = { code: status.code, signal: status.signal };
      pushCast(wall, 'x', String(status.code ?? ''));
    }),
  );

  function detach(): void {
    if (disposed) return;
    disposed = true;
    for (const off of unsubscribers) off();
    unsubscribers.length = 0;
  }

  const stepTitles = new Map<string, string>();

  function closeStep(stepId: string, status: StepStatus, error?: string): void {
    if (closedSteps.has(stepId)) return;
    closedSteps.add(stepId);
    const index = openSteps.lastIndexOf(stepId);
    if (index >= 0) openSteps.splice(index, 1);
    const title = stepTitles.get(stepId) ?? stepId;
    traceEvents.push({
      t: localTime(),
      kind: 'step-end',
      stepId,
      title,
      status,
      ...(error === undefined ? {} : { error }),
    });
  }

  const writer: TraceWriter = {
    addStep(title: string): StepHandle {
      assertLive();
      const stepId = `s${++stepCounter}`;
      const parentStepId = openSteps[openSteps.length - 1];
      stepTitles.set(stepId, title);
      openSteps.push(stepId);
      const wall = localTime();
      traceEvents.push({
        t: wall,
        kind: 'step-start',
        stepId,
        title,
        ...(parentStepId === undefined ? {} : { parentStepId }),
      });
      pushCast(wall, 'm', title);
      return {
        stepId,
        title,
        end(status: StepStatus = 'passed', error?: string) {
          closeStep(stepId, status, error);
        },
      };
    },

    endStep(stepId?: string, status: StepStatus = 'passed', error?: string): void {
      assertLive();
      const target = stepId ?? openSteps[openSteps.length - 1];
      if (target === undefined) return;
      closeStep(target, status, error);
    },

    hide(): void {
      assertLive();
      if (hideStart !== null) return;
      hideStart = localTime();
    },

    show(): void {
      assertLive();
      if (hideStart === null) return;
      hiddenWindows.push({ start: hideStart, end: localTime() });
      hideStart = null;
    },

    isHidden(): boolean {
      return hideStart !== null;
    },

    recordAction(action): void {
      assertLive();
      const stepId = action.stepId ?? openSteps[openSteps.length - 1];
      traceEvents.push({
        ...action,
        t: localTime(),
        kind: 'action',
        ...(stepId === undefined ? {} : { stepId }),
      });
    },

    recordAssert(assertion): void {
      assertLive();
      const stepId = assertion.stepId ?? openSteps[openSteps.length - 1];
      traceEvents.push({
        ...assertion,
        t: localTime(),
        kind: 'assert',
        ...(stepId === undefined ? {} : { stepId }),
      });
    },

    async finalize(finalizeOptions: FinalizeOptions = {}): Promise<TraceArchive> {
      if (finalized) {
        throw new TraceError('session-closed', 'TraceWriter.finalize() was already called');
      }
      finalized = true;
      const endWall = localTime();
      if (hideStart !== null) {
        hiddenWindows.push({ start: hideStart, end: endWall });
        hideStart = null;
      }
      for (const stepId of [...openSteps].reverse()) {
        closeStep(stepId, 'skipped');
      }
      detach();
      decoder.decode();
      const recordedExit = exit ?? finalizeOptions.exit;

      return writeArchive({
        dir: options.dir,
        castEvents,
        traceEvents,
        semantics,
        hiddenWindows,
        idleTimeLimit: finalizeOptions.idleTimeLimit,
        header: buildHeader(),
        meta: {
          v: TRACE_VERSION,
          sessionId: session.sessionId,
          command: options.command ?? [],
          columns: options.columns ?? 100,
          rows: options.rows ?? 30,
          startedAt,
          platform: options.platform ?? process.platform,
          semanticTree: resolveSemanticFlag(),
          ...(recordedExit === undefined ? {} : { exit: recordedExit }),
          ...(truncated ? { truncated: true } : {}),
        },
      });
    },

    dispose(): void {
      detach();
    },
  };

  function assertLive(): void {
    if (finalized) {
      throw new TraceError('session-closed', 'TraceWriter was already finalized');
    }
  }

  function resolveSemanticFlag(): boolean {
    if (options.semanticTree !== undefined) return options.semanticTree;
    const capabilities = session.capabilities?.();
    if (capabilities !== undefined) return capabilities.semanticTree;
    return semantics.length > 0;
  }

  function buildHeader(): CastHeader {
    const initialColumns = options.columns ?? (lastResize?.columns ?? columns);
    const initialRows = options.rows ?? (lastResize?.rows ?? rows);
    return {
      version: 3,
      term: { cols: initialColumns, rows: initialRows },
      timestamp: Math.floor(startWall / 1000),
      ...(options.command === undefined ? {} : { command: options.command.join(' ') }),
      ...(options.title === undefined ? {} : { title: options.title }),
      ...(options.env === undefined ? {} : { env: options.env }),
    };
  }

  return writer;
}

interface WriteArchiveInput {
  readonly dir: string;
  readonly castEvents: readonly PendingCastEvent[];
  readonly traceEvents: readonly TraceEvent[];
  readonly semantics: readonly { t: number; revision: number; snapshot: SemanticSnapshot }[];
  readonly hiddenWindows: readonly HiddenWindow[];
  readonly idleTimeLimit: number | undefined;
  readonly header: CastHeader;
  readonly meta: Omit<TraceMeta, 'idleTimeLimit' | 'durationMs'>;
}

/** Applies the timeline transforms and writes the four archive files. */
async function writeArchive(input: WriteArchiveInput): Promise<TraceArchive> {
  const ordered = [...input.castEvents].sort((a, b) => a.wall - b.wall || a.seq - b.seq);
  const idleLimitMs =
    input.idleTimeLimit !== undefined && input.idleTimeLimit > 0
      ? input.idleTimeLimit * 1000
      : undefined;

  const timeline = buildCastTimeline(
    ordered.map((event) => event.wall),
    {
      hidden: input.hiddenWindows,
      ...(idleLimitMs === undefined ? {} : { idleTimeLimitMs: idleLimitMs }),
    },
  );
  const castTimes = timeline.castTimes();

  const header: CastHeader = {
    ...input.header,
    ...(input.idleTimeLimit !== undefined && input.idleTimeLimit > 0
      ? { idle_time_limit: input.idleTimeLimit }
      : {}),
  };

  const castLines: string[] = [formatCastHeader(header)];
  let previousCast = 0;
  for (const [index, event] of ordered.entries()) {
    const castTime = castTimes[index] ?? previousCast;
    castLines.push(formatCastEvent((castTime - previousCast) / 1000, event.code, event.data));
    previousCast = castTime;
  }

  const eventLines = input.traceEvents.map((event) =>
    JSON.stringify({ ...event, castOffset: round(timeline.mapWall(event.t)) }),
  );

  const semanticLines = input.semantics.map((record) => {
    const line: SemanticRecord = {
      t: record.t,
      revision: record.revision,
      castOffset: round(timeline.mapWall(record.t)),
      snapshot: record.snapshot,
    };
    return JSON.stringify(line);
  });

  const meta: TraceMeta = {
    ...input.meta,
    ...(input.idleTimeLimit !== undefined && input.idleTimeLimit > 0
      ? { idleTimeLimit: input.idleTimeLimit }
      : {}),
    durationMs: round(timeline.durationMs),
  };

  await mkdir(input.dir, { recursive: true });
  await Promise.all([
    writeFile(join(input.dir, TRACE_FILES.meta), `${JSON.stringify(meta, null, 2)}\n`, 'utf8'),
    writeFile(join(input.dir, TRACE_FILES.cast), `${castLines.join('\n')}\n`, 'utf8'),
    writeFile(join(input.dir, TRACE_FILES.events), joinLines(eventLines), 'utf8'),
    writeFile(join(input.dir, TRACE_FILES.semantics), joinLines(semanticLines), 'utf8'),
  ]);

  return { dir: input.dir, meta, durationMs: meta.durationMs ?? 0 };
}

function joinLines(lines: readonly string[]): string {
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
