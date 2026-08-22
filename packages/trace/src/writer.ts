/**
 * {@link createTraceWriter} — subscribes to a live session and produces a
 * `.twtrace` archive directory.
 */

import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { mkdir, mkdtemp, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { DEFAULT_ARTIFACT_VALUE_POLICY, projectActionReceiptForArtifact, projectSemanticSnapshotForArtifact, type ArtifactValuePolicy, type EffectiveSessionContract, type SemanticSnapshot } from '@termwright/protocol';
import type { SessionEventRecord, SessionEvents } from '@termwright/driver';
import { formatCastEvent, formatCastHeader, type CastEventCode, type CastHeader } from './cast.js';
import { TraceError } from './errors.js';
import { buildCastTimeline, type HiddenWindow } from './timeline.js';
import {
  TRACE_FILES,
  TRACE_INCOMPLETE_FILE,
  TRACE_VERSION,
  type ActionEvent,
  type AssertEvent,
  type SemanticRecord,
  type StepStatus,
  type TraceEvent,
  type TraceCrash,
  type TraceLogEntry,
  type TraceLogSource,
  type TraceLogSummary,
  type TraceExit,
  type TraceMeta,
  type TraceRunIdentity,
  type GherkinStepMetadata,
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
  readonly terminalProfile?: string;
  contract?(): EffectiveSessionContract | null;
}

/** Options for {@link createTraceWriter}. */
export interface TraceWriterOptions {
  /** Destination directory; created recursively. Conventionally `*.twtrace`. */
  readonly dir: string;
  /** Required for traces owned by a certified native-host attempt. */
  readonly runIdentity?: TraceRunIdentity;
  /** argv of the recorded session, stored in `meta.json`. */
  readonly command?: readonly string[];
  /** Initial viewport, used for the cast header. Default 100×30. */
  readonly columns?: number;
  readonly rows?: number;
  readonly platform?: NodeJS.Platform;
  /** Overrides capability detection for `meta.semanticTree`. */
  readonly semanticTree?: boolean;
  /**
   * Terminal profile the session measures characters with. Defaults to
   * `session.terminalProfile`; a replay that does not match it
   * can place wide characters a column out.
   */
  readonly terminalProfile?: string;
  readonly title?: string;
  readonly env?: Readonly<Record<string, string>>;
  /**
   * Record PTY input as asciicast `i` events too. Off by default: inputs are
   * represented in `events.jsonl`, and players ignore them. Exact bytes are
   * only available when `artifactValuePolicy` is explicitly `raw`.
   */
  readonly recordInput?: boolean;
  /** Semantic value policy. Defaults to `redacted`; `raw` is explicit opt-in. */
  readonly artifactValuePolicy?: ArtifactValuePolicy;
  /**
   * Byte ceiling for buffered output. On overflow the writer stops recording
   * output and sets `meta.truncated`. Default 32 MiB.
   */
  readonly maxOutputBytes?: number;
  /**
   * Application log entries to retain. On overflow the **oldest** are evicted
   * and counted in `meta.logs.dropped`: when a program floods its log, the end
   * is the part worth keeping. Default 10 000.
   */
  readonly maxLogEntries?: number;
  /** Injectable monotonic clock (milliseconds). Default `performance.now`. */
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
  addStep(title: string, metadata?: {
    /** Stable test-scoped id supplied by an external lifecycle producer. */
    readonly stepId?: string;
    readonly gherkin?: GherkinStepMetadata;
  }): StepHandle;
  /** Closes the innermost open step (or `stepId` when given). */
  endStep(stepId?: string, status?: StepStatus, error?: string): void;
  /** Excludes subsequent output from the recording until {@link show}. */
  hide(): void;
  /** Resumes recording after {@link hide}. Idempotent. */
  show(): void;
  /** True while a hide window is open. */
  isHidden(): boolean;
  /**
   * Records an action the driver cannot see.
   *
   * Actions performed through the harness arrive on their own — the driver
   * emits an `action` event for each one, failures included — so this is for
   * work a caller does outside it. Calling it for a harness action would
   * record that action twice.
   */
  recordAction(action: Omit<ActionEvent, 't' | 'kind' | 'castOffset'>): void;
  /** Records an assertion and its outcome. */
  recordAssert(assertion: Omit<AssertEvent, 't' | 'kind' | 'castOffset'>): void;
  /** Detaches from the session and writes the archive. Callable once. */
  finalize(options?: FinalizeOptions): Promise<TraceArchive>;
  /** Detaches from the session without writing anything. */
  dispose(): void;
}

/**
 * An event as the writer holds it, before the timeline exists.
 *
 * `castOffset` is required on disk but unknowable until `finalize()` applies
 * the hide and trim transforms, so the buffered form omits it and
 * `writeArchive` is the one place that can complete an event. Distributive, so
 * each member of the union keeps its own shape.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

type PendingTraceEvent = DistributiveOmit<TraceEvent, 'castOffset'>;

interface PendingCastEvent {
  wall: number;
  seq: number;
  code: CastEventCode;
  data: string;
}

const DEFAULT_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_LOG_ENTRIES = 10_000;
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
  // Timeline offsets must not jump when NTP or a user adjusts the wall clock.
  // `startedAt` below remains a real ISO wall time; only elapsed positions use
  // the monotonic clock, matching the driver's own event timestamps.
  const now = options.now ?? (() => performance.now());
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const maxLogEntries = options.maxLogEntries ?? DEFAULT_MAX_LOG_ENTRIES;
  const artifactValuePolicy = options.artifactValuePolicy ?? DEFAULT_ARTIFACT_VALUE_POLICY;
  const startClock = now();
  const wallStartedAt = Date.now();
  const startedAt = new Date(wallStartedAt).toISOString();

  const castEvents: PendingCastEvent[] = [];
  const traceEvents: PendingTraceEvent[] = [];
  const semantics: { t: number; revision: number; snapshot: SemanticSnapshot }[] = [];
  const hiddenWindows: HiddenWindow[] = [];
  const logs: TraceLogEntry[] = [];
  const logSources = new Map<string, TraceLogSource>();
  const logLevels = new Map<NonNullable<TraceLogEntry['level']>, number>();
  const openSteps: string[] = [];
  const closedSteps = new Set<string>();
  const decoder = new TextDecoder('utf-8');
  const unsubscribers: (() => void)[] = [];

  let seq = 0;
  let stepCounter = 0;
  let outputBytes = 0;
  let truncated = false;
  let hideStart: number | null = null;
  let sealed = false;
  let preparedArchive: WriteArchiveInput | undefined;
  let finalizePromise: Promise<TraceArchive> | undefined;
  let finalizedArchive: TraceArchive | undefined;
  let disposed = false;
  let exit: TraceExit | undefined;
  let crash: TraceCrash | undefined;
  let droppedLogs = 0;
  let columns = options.columns ?? 100;
  let rows = options.rows ?? 30;
  let lastResize: { columns: number; rows: number } | null = null;

  /** Driver timestamps use an unknown epoch; anchor on the first one we see. */
  let driverBase: { driver: number; local: number } | null = null;

  function localTime(): number {
    return Math.max(0, now() - startClock);
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

  function consumeSessionEvent(recorded: SessionEventRecord): void {
    switch (recorded.type) {
    case 'output': {
      const { data, timeMs } = recorded.payload;
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
      break;
    }
    case 'input': {
      const { data, timeMs, kind } = recorded.payload;
      const wall = driverTime(timeMs);
      traceEvents.push(artifactValuePolicy === 'raw'
        ? { t: wall, kind: 'input', dataB64: Buffer.from(data).toString('base64'), inputKind: kind, recording: 'raw' }
        : { t: wall, kind: 'input', inputKind: kind, recording: 'withheld', withheldReason: 'artifact-policy' });
      if (options.recordInput === true && artifactValuePolicy === 'raw' && !inHiddenWindow(wall)) {
        pushCast(wall, 'i', new TextDecoder('utf-8').decode(data));
      }
      break;
    }
    case 'resize': {
      const event = recorded.payload;
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
      break;
    }
    case 'semantic-revision': {
      const { revision, timeMs, snapshot } = recorded.payload;
      if (snapshot.revision !== revision) {
        throw new TraceError('protocol-violation', `semantic event revision ${revision} carried snapshot revision ${snapshot.revision}`);
      }
      semantics.push({ t: driverTime(timeMs), revision, snapshot: projectSemanticSnapshotForArtifact(snapshot, artifactValuePolicy) });
      break;
    }
    case 'exit': {
      const status = recorded.payload;
      const wall = driverTime(status.timeMs);
      exit = { code: status.code, signal: status.signal };
      pushCast(wall, 'x', String(status.code ?? ''));
      break;
    }
    case 'crash': {
      const report = recorded.payload;
    // `crash` arrives just before `exit`, and `exit` only after the emulator
    // has drained — so the screen tail in the report is the screen the archive
    // ends on, and both land at their own timestamps on the same clock.
      const wall = driverTime(report.timeMs);
      const lastSemanticRevision = report.lastSemanticTree?.revision ?? null;
      crash = {
        t: wall,
        // Rewritten with the real value in writeArchive; the wall clock is the
        // only timeline that exists before the hide/trim transforms run.
        castOffset: wall,
        exit: { code: report.exit.code, signal: report.exit.signal },
        screenTail: [...report.screenTail],
        lastSemanticRevision,
        recentInputs: [...report.recentInputs],
        diagnosticsTail: [...report.diagnosticsTail],
      };
      traceEvents.push({
        t: wall,
        kind: 'crash',
        exit: crash.exit,
        screenTailLines: crash.screenTail.length,
        lastSemanticRevision,
      });
      break;
    }
    case 'action': {
      const event = recorded.payload;
    // Emitted after the action finished, so `t` is its completion — see
    // ActionEvent's TSDoc for what that means for the timeline.
      const stepId = openSteps[openSteps.length - 1];
      traceEvents.push({
        t: driverTime(event.timeMs),
        kind: 'action',
        api: event.api,
        ...(event.selector === undefined ? {} : { selector: event.selector }),
        ...(event.ref === undefined ? {} : { ref: event.ref }),
        ok: event.ok,
        ...(event.error === undefined ? {} : { error: event.error }),
        ...(event.observation === undefined ? {} : { observation: event.observation }),
        ...(event.receipt === undefined ? {} : { receipt: projectActionReceiptForArtifact(event.receipt, artifactValuePolicy) }),
        ...(event.actionability === undefined ? {} : { actionability: event.actionability }),
        ...(stepId === undefined ? {} : { stepId }),
      });
      break;
    }
    case 'app-log': {
      const event = recorded.payload;
      const wall = driverTime(event.timeMs);
      const record = event.record;
      const label = event.label ?? record?.logger;
      const entry: TraceLogEntry = {
        t: wall,
        // Replaced with the real offset in writeArchive.
        castOffset: wall,
        source: event.source,
        ...(label === undefined ? {} : { label }),
        ...(event.path === undefined ? {} : { path: event.path }),
        ...(record?.logger === undefined ? {} : { logger: record.logger }),
        ...(record?.level === undefined ? {} : { level: record.level }),
        message: record?.message ?? event.line ?? '',
        ...(record?.attrs === undefined ? {} : { attrs: record.attrs }),
        ...(record?.seq === undefined ? {} : { seq: record.seq }),
        ...(record?.revision === undefined ? {} : { revision: record.revision }),
        ...(record?.ts === undefined ? {} : { ts: record.ts }),
      };
      if (label !== undefined || event.path !== undefined) {
        // Keyed on both: one label can front several files, and the same file
        // can be relabelled between runs.
        const key = `${label ?? ''}\u0000${event.path ?? ''}`;
        if (!logSources.has(key)) {
          logSources.set(key, {
            ...(label === undefined ? {} : { label }),
            ...(event.path === undefined ? {} : { path: event.path }),
          });
        }
      }
      if (entry.level !== undefined) {
        logLevels.set(entry.level, (logLevels.get(entry.level) ?? 0) + 1);
      }
      logs.push(entry);
      if (logs.length > maxLogEntries) {
        logs.shift();
        droppedLogs += 1;
      }
      break;
    }
    // These events are either represented by richer events above or are live
    // projection concerns rather than trace archive records.
    case 'action-start':
    case 'diagnostic':
    case 'screen-revision':
      break;
    }
  }

  // The source journal is armed before the PTY spawn. Starting at sequence 1
  // makes startup output/tree/crash part of the trace even though the writer
  // itself is constructed after launchTerminal() resolves. A gap is fatal by
  // default: a lossless trace must never silently look complete.
  unsubscribers.push(session.events.subscribe({ fromSequence: 1 }, consumeSessionEvent));

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
    addStep(title: string, metadata?: { readonly stepId?: string; readonly gherkin?: GherkinStepMetadata }): StepHandle {
      assertLive();
      const stepId = metadata?.stepId ?? `s${++stepCounter}`;
      if (stepTitles.has(stepId)) throw new TraceError('protocol-violation', `duplicate trace step id ${stepId}`);
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
        ...(metadata?.gherkin === undefined ? {} : { gherkin: metadata.gherkin }),
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
      if (finalizedArchive !== undefined) return finalizedArchive;
      if (finalizePromise !== undefined) return finalizePromise;
      if (preparedArchive === undefined) {
        sealed = true;
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
        const contract = session.contract?.() ?? null;

        preparedArchive = {
          dir: options.dir,
          castEvents,
          traceEvents,
          semantics,
          hiddenWindows,
          idleTimeLimit: finalizeOptions.idleTimeLimit,
          header: buildHeader(),
          crash,
          logs,
          logSummary: buildLogSummary(),
          meta: {
            v: TRACE_VERSION,
            sessionId: session.sessionId,
            ...(options.runIdentity === undefined ? {} : { runIdentity: options.runIdentity }),
            command: options.command ?? [],
            columns: options.columns ?? 100,
            rows: options.rows ?? 30,
            startedAt,
            platform: options.platform ?? process.platform,
            semanticTree: resolveSemanticFlag(),
            ...(contract === null ? {} : { contract }),
            ...(resolveTerminalProfile() === undefined
              ? {}
              : { terminalProfile: resolveTerminalProfile() as string }),
            ...(recordedExit === undefined ? {} : { exit: recordedExit }),
            ...(truncated ? { truncated: true } : {}),
          },
        };
      }
      finalizePromise = writeArchive(preparedArchive).then((archive) => {
        finalizedArchive = archive;
        return archive;
      }).catch((error: unknown) => {
        finalizePromise = undefined;
        throw error;
      });
      return finalizePromise;
    },

    dispose(): void {
      detach();
    },
  };

  function assertLive(): void {
    if (sealed) {
      throw new TraceError('session-closed', 'TraceWriter is finalizing or finalized');
    }
  }

  function resolveSemanticFlag(): boolean {
    if (options.semanticTree !== undefined) return options.semanticTree;
    const contract = session.contract?.() ?? null;
    if (contract !== null) return contract.capabilities['semantic-tree'].status === 'supported';
    return semantics.length > 0;
  }

  /** Counted once, at the end: a flood that ends the session still adds up. */
  function buildLogSummary(): TraceLogSummary | undefined {
    if (logs.length === 0 && droppedLogs === 0) return undefined;
    return {
      count: logs.length,
      dropped: droppedLogs,
      sources: [...logSources.values()],
      levels: Object.fromEntries(logLevels),
    };
  }

  function resolveTerminalProfile(): string | undefined {
    return options.terminalProfile ?? session.terminalProfile ?? session.contract?.()?.terminal.profile;
  }

  function buildHeader(): CastHeader {
    const initialColumns = options.columns ?? (lastResize?.columns ?? columns);
    const initialRows = options.rows ?? (lastResize?.rows ?? rows);
    return {
      version: 3,
      term: { cols: initialColumns, rows: initialRows },
      timestamp: Math.floor(wallStartedAt / 1000),
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
  readonly traceEvents: readonly PendingTraceEvent[];
  readonly semantics: readonly { t: number; revision: number; snapshot: SemanticSnapshot }[];
  readonly hiddenWindows: readonly HiddenWindow[];
  readonly idleTimeLimit: number | undefined;
  readonly header: CastHeader;
  /** Its `castOffset` is still the wall-clock time; the timeline fixes it up. */
  readonly crash: TraceCrash | undefined;
  /** Same: `castOffset` is rewritten once the timeline exists. */
  readonly logs: readonly TraceLogEntry[];
  readonly logSummary: TraceLogSummary | undefined;
  readonly meta: Omit<TraceMeta, 'idleTimeLimit' | 'durationMs' | 'crash' | 'logs'>;
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

  const logLines = input.logs.map((entry) =>
    JSON.stringify({ ...entry, castOffset: round(timeline.mapWall(entry.t)) }),
  );

  const meta: TraceMeta = {
    ...input.meta,
    ...(input.idleTimeLimit !== undefined && input.idleTimeLimit > 0
      ? { idleTimeLimit: input.idleTimeLimit }
      : {}),
    durationMs: round(timeline.durationMs),
    ...(input.crash === undefined
      ? {}
      : { crash: { ...input.crash, castOffset: round(timeline.mapWall(input.crash.t)) } }),
    ...(input.logSummary === undefined ? {} : { logs: input.logSummary }),
  };

  const target = resolve(input.dir);
  const parent = dirname(target);
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(join(parent, `.${basename(target)}.staging-`));
  const files: Record<string, string> = {
    [TRACE_FILES.meta]: `${JSON.stringify(meta, null, 2)}\n`,
    [TRACE_FILES.cast]: `${castLines.join('\n')}\n`,
    [TRACE_FILES.events]: joinLines(eventLines),
    [TRACE_FILES.semantics]: joinLines(semanticLines),
    ...(logLines.length === 0 ? {} : { [TRACE_FILES.logs]: joinLines(logLines) }),
  };
  await writeDurable(join(staging, TRACE_INCOMPLETE_FILE), `${JSON.stringify({ v: 1, target })}\n`);
  for (const [name, body] of Object.entries(files)) await writeDurable(join(staging, name), body);
  const checksums = Object.fromEntries(Object.entries(files).map(([name, body]) => [name, sha256(body)]));
  await unlink(join(staging, TRACE_INCOMPLETE_FILE));
  await writeDurable(join(staging, TRACE_FILES.commit), `${JSON.stringify({ v: 1, checksums })}\n`);
  await fsyncDirectory(staging);
  await rename(staging, target);
  await fsyncDirectory(parent);

  return { dir: target, meta, durationMs: meta.durationMs ?? 0 };
}

async function writeDurable(path: string, body: string): Promise<void> {
  await writeFile(path, body, 'utf8');
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

async function fsyncDirectory(path: string): Promise<void> {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

function sha256(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

function joinLines(lines: readonly string[]): string {
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
