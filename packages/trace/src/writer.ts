/**
 * {@link createTraceWriter} — subscribes to a live session and produces a
 * `.twtrace` archive directory.
 */

import {
  diffSemanticSnapshots,
  projectActionReceiptForArtifact,
  projectSemanticSnapshotForArtifact,
  resolveArtifactSecurityPolicy,
  type ArtifactSecurityPolicy,
  type EffectiveSessionContract,
  type SemanticSnapshot,
} from '@termwright/protocol';
import type { SessionEventRecord, SessionEvents } from '@termwright/driver';
import { basename } from 'node:path';
import { formatCastEvent, formatCastHeader, type CastEventCode, type CastHeader } from './cast.js';
import { TraceError } from './errors.js';
import { AppendSpool } from './append-spool.js';
import { TerminalSanitizer } from './terminal-sanitizer.js';
import {
  TRACE_FILES,
  TRACE_VERSION,
  type ActionEvent,
  type AssertEvent,
  type StoredSemanticRecord,
  type StoredTraceEvent,
  type StoredTraceLogEntry,
  type StepStatus,
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
  readonly artifactSecurity?: ArtifactSecurityPolicy;
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
   * only available when `artifactSecurity.mode` is explicitly `raw`.
   */
  readonly recordInput?: boolean;
  /** One policy for every trace persistence channel. Defaults to redacted. */
  readonly artifactSecurity?: ArtifactSecurityPolicy;
  /**
   * Byte ceiling for buffered output. On overflow the writer stops recording
   * output and sets `meta.truncated`. Default 32 MiB.
   */
  readonly maxOutputBytes?: number;
  /**
   * Application log entries admitted to the append-only stream. Later entries
   * are refused and counted in `meta.logs.dropped`. Default 10 000.
   */
  readonly maxLogEntries?: number;
  /** Idle gaps are projected lazily by readers; configure the policy up front. */
  readonly idleTimeLimit?: number;
  /** Maximum records waiting for the sequential append loop. Default 8 192. */
  readonly maxPendingRecords?: number;
  /** Maximum UTF-8 bytes waiting for the append loop. Default 8 MiB. */
  readonly maxPendingBytes?: number;
  /** Injectable monotonic clock (milliseconds). Default `performance.now`. */
  readonly now?: () => number;
}

/** Options for {@link TraceWriter.finalize}. */
export interface FinalizeOptions {
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
  addStep(
    title: string,
    metadata?: {
      /** Stable test-scoped id supplied by an external lifecycle producer. */
      readonly stepId?: string;
      readonly gherkin?: GherkinStepMetadata;
    },
  ): StepHandle;
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
  /** Detaches and securely removes the private staging trace. */
  dispose(): Promise<void>;
}

const DEFAULT_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_LOG_ENTRIES = 10_000;
const DEFAULT_MAX_PENDING_RECORDS = 8_192;
const DEFAULT_MAX_PENDING_BYTES = 8 * 1024 * 1024;

/**
 * Attaches a recorder to a live session.
 *
 * Recording starts immediately into a private staging directory. Finalization
 * only drains the bounded append queue and publishes the commit marker.
 *
 * @example
 * ```ts
 * const writer = createTraceWriter(harness, { dir: 'out/login.twtrace' });
 * const step = writer.addStep('log in');
 * await harness.getByRole('button', { name: 'Submit' }).click();
 * step.end('passed');
 * await writer.finalize();
 * ```
 */
export function createTraceWriter(session: TraceSource, options: TraceWriterOptions): TraceWriter {
  // Timeline offsets must not jump when NTP or a user adjusts the wall clock.
  // `startedAt` below remains a real ISO wall time; only elapsed positions use
  // the monotonic clock, matching the driver's own event timestamps.
  const now = options.now ?? (() => performance.now());
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const maxLogEntries = options.maxLogEntries ?? DEFAULT_MAX_LOG_ENTRIES;
  const idleLimitMs =
    options.idleTimeLimit !== undefined && options.idleTimeLimit > 0
      ? options.idleTimeLimit * 1000
      : Number.POSITIVE_INFINITY;
  const artifactSecurity = resolveArtifactSecurityPolicy(
    options.artifactSecurity ?? session.artifactSecurity,
  );
  const sanitizer = new TerminalSanitizer(artifactSecurity);
  registerSemanticSecrets(session.semanticTree?.() ?? null);
  const startClock = now();
  const wallStartedAt = Date.now();
  const startedAt = new Date(wallStartedAt).toISOString();

  const logSources = new Map<string, TraceLogSource>();
  const logLevels = new Map<NonNullable<TraceLogEntry['level']>, number>();
  const openSteps: string[] = [];
  const closedSteps = new Set<string>();
  const decoder = new TextDecoder('utf-8');
  const unsubscribers: (() => void)[] = [];

  let stepCounter = 0;
  let outputBytes = 0;
  let truncated = false;
  let hideStart: number | null = null;
  let sealed = false;
  let finalizePromise: Promise<TraceArchive> | undefined;
  let finalizedArchive: TraceArchive | undefined;
  let disposed = false;
  let exit: TraceExit | undefined;
  let crash: TraceCrash | undefined;
  let logCount = 0;
  let droppedLogs = 0;
  let columns = options.columns ?? 100;
  let rows = options.rows ?? 30;
  let lastResize: { columns: number; rows: number } | null = null;
  let lastSemantic: SemanticSnapshot | undefined;
  let lastCastWall = 0;
  let lastCastHidden = 0;
  let hiddenTotal = 0;
  let durationMs = 0;

  const spool = new AppendSpool({
    target: options.dir,
    maxPendingRecords: options.maxPendingRecords ?? DEFAULT_MAX_PENDING_RECORDS,
    maxPendingBytes: options.maxPendingBytes ?? DEFAULT_MAX_PENDING_BYTES,
    initial: {
      [TRACE_FILES.cast]: `${formatCastHeader(buildHeader())}\n`,
      [TRACE_FILES.events]: '',
      [TRACE_FILES.semantics]: '',
      [TRACE_FILES.logs]: '',
      [TRACE_FILES.timeline]: '',
    },
  });

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

  function hiddenAt(wall: number): number {
    return hiddenTotal + (hideStart === null ? 0 : Math.max(0, wall - hideStart));
  }

  function presentationAt(wall: number): number {
    const clamped = Math.max(lastCastWall, wall);
    const visibleDelta = Math.max(0, clamped - lastCastWall - (hiddenAt(clamped) - lastCastHidden));
    return durationMs + Math.min(visibleDelta, idleLimitMs);
  }

  function pushCast(wall: number, code: CastEventCode, data: string): void {
    const clamped = Math.max(lastCastWall, wall);
    const hidden = hiddenAt(clamped);
    const visibleDelta = Math.max(0, clamped - lastCastWall - (hidden - lastCastHidden));
    durationMs += Math.min(visibleDelta, idleLimitMs);
    spool.enqueue(
      TRACE_FILES.cast,
      `${formatCastEvent(Math.min(visibleDelta, idleLimitMs) / 1000, code, data)}\n`,
    );
    spool.enqueue(TRACE_FILES.timeline, `${JSON.stringify({ kind: 'cast-anchor', t: clamped })}\n`);
    lastCastWall = clamped;
    lastCastHidden = hidden;
  }

  function pushOutput(wall: number, text: string): void {
    if (text === '') return;
    pushCast(wall, 'o', text);
  }

  function pushEvent(event: StoredTraceEvent): void {
    spool.enqueue(TRACE_FILES.events, `${JSON.stringify(sanitizeJson(event, sanitizer))}\n`);
  }

  function registerSemanticSecrets(snapshot: SemanticSnapshot | null): void {
    if (snapshot === null || artifactSecurity.mode !== 'redacted') return;
    for (const node of snapshot.nodes) {
      if (node.value?.status === 'known' && node.value.sensitivity === 'sensitive') {
        sanitizer.register(node.value.value);
      }
    }
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
        const text = sanitizer.push(decoder.decode(data, { stream: true }));
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
        if (artifactSecurity.mode === 'redacted' && kind !== 'mouse') {
          const candidate = new TextDecoder('utf-8', { fatal: false }).decode(data);
          if (candidate !== '') sanitizer.register(candidate);
        }
        pushEvent(
          artifactSecurity.mode === 'raw'
            ? {
                t: wall,
                kind: 'input',
                dataB64: Buffer.from(data).toString('base64'),
                inputKind: kind,
                recording: 'raw',
              }
            : {
                t: wall,
                kind: 'input',
                inputKind: kind,
                recording: 'withheld',
                withheldReason: 'artifact-policy',
              },
        );
        if (
          options.recordInput === true &&
          artifactSecurity.mode === 'raw' &&
          !inHiddenWindow(wall)
        ) {
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
        pushEvent({
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
          throw new TraceError(
            'protocol-violation',
            `semantic event revision ${revision} carried snapshot revision ${snapshot.revision}`,
          );
        }
        registerSemanticSecrets(snapshot);
        const t = driverTime(timeMs);
        const projected = sanitizeJson(
          projectSemanticSnapshotForArtifact(snapshot, artifactSecurity.mode),
          sanitizer,
        );
        const full: StoredSemanticRecord = {
          kind: 'keyframe',
          t,
          revision,
          snapshot: projected,
        };
        let record: StoredSemanticRecord = full;
        if (lastSemantic !== undefined) {
          const delta = diffSemanticSnapshots(lastSemantic, projected);
          const candidate: StoredSemanticRecord = {
            kind: 'delta',
            t,
            revision,
            baseRevision: lastSemantic.revision,
            delta,
          };
          // A delta larger than its independent keyframe buys no storage or
          // replay work. This content-based trigger replaces arbitrary N-frame
          // keyframe intervals.
          if (JSON.stringify(candidate).length < JSON.stringify(full).length) record = candidate;
        }
        spool.enqueue(TRACE_FILES.semantics, `${JSON.stringify(record)}\n`);
        lastSemantic = projected;
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
          castOffset: round(presentationAt(wall)),
          exit: { code: report.exit.code, signal: report.exit.signal },
          screenTail: report.screenTail.map((line) => sanitizer.sanitizeComplete(line)),
          lastSemanticRevision,
          recentInputs: sanitizeJson(report.recentInputs, sanitizer),
          diagnosticsTail: sanitizeJson(report.diagnosticsTail, sanitizer),
        };
        pushEvent({
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
        pushEvent({
          t: driverTime(event.timeMs),
          kind: 'action',
          api: event.api,
          ...(event.selector === undefined ? {} : { selector: event.selector }),
          ...(event.ref === undefined ? {} : { ref: event.ref }),
          ok: event.ok,
          ...(event.error === undefined ? {} : { error: event.error }),
          ...(event.observation === undefined ? {} : { observation: event.observation }),
          ...(event.receipt === undefined
            ? {}
            : { receipt: projectActionReceiptForArtifact(event.receipt, artifactSecurity.mode) }),
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
        const entry: StoredTraceLogEntry = {
          t: wall,
          source: event.source,
          ...(label === undefined ? {} : { label }),
          ...(event.path === undefined ? {} : { path: event.path }),
          ...(record?.logger === undefined ? {} : { logger: record.logger }),
          ...(record?.level === undefined ? {} : { level: record.level }),
          message: sanitizer.sanitizeComplete(record?.message ?? event.line ?? ''),
          ...(record?.attrs === undefined ? {} : { attrs: sanitizeJson(record.attrs, sanitizer) }),
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
        if (logCount >= maxLogEntries) {
          droppedLogs += 1;
        } else {
          spool.enqueue(
            TRACE_FILES.logs,
            `${JSON.stringify(entry satisfies StoredTraceLogEntry)}\n`,
          );
          logCount += 1;
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
    pushEvent({
      t: localTime(),
      kind: 'step-end',
      stepId,
      title,
      status,
      ...(error === undefined ? {} : { error }),
    });
  }

  const writer: TraceWriter = {
    addStep(
      title: string,
      metadata?: { readonly stepId?: string; readonly gherkin?: GherkinStepMetadata },
    ): StepHandle {
      assertLive();
      const stepId = metadata?.stepId ?? `s${++stepCounter}`;
      if (stepTitles.has(stepId))
        throw new TraceError('protocol-violation', `duplicate trace step id ${stepId}`);
      const parentStepId = openSteps[openSteps.length - 1];
      stepTitles.set(stepId, title);
      openSteps.push(stepId);
      const wall = localTime();
      pushEvent({
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
      const end = localTime();
      spool.enqueue(
        TRACE_FILES.timeline,
        `${JSON.stringify({ kind: 'hidden-window', start: hideStart, end })}\n`,
      );
      hiddenTotal += Math.max(0, end - hideStart);
      hideStart = null;
    },

    isHidden(): boolean {
      return hideStart !== null;
    },

    recordAction(action): void {
      assertLive();
      const stepId = action.stepId ?? openSteps[openSteps.length - 1];
      pushEvent({
        ...action,
        t: localTime(),
        kind: 'action',
        ...(stepId === undefined ? {} : { stepId }),
      });
    },

    recordAssert(assertion): void {
      assertLive();
      const stepId = assertion.stepId ?? openSteps[openSteps.length - 1];
      pushEvent({
        ...assertion,
        t: localTime(),
        kind: 'assert',
        ...(stepId === undefined ? {} : { stepId }),
      });
    },

    async finalize(finalizeOptions: FinalizeOptions = {}): Promise<TraceArchive> {
      if (finalizedArchive !== undefined) return finalizedArchive;
      if (finalizePromise !== undefined) return finalizePromise;
      sealed = true;
      const endWall = localTime();
      if (hideStart !== null) {
        const start = hideStart;
        spool.enqueue(
          TRACE_FILES.timeline,
          `${JSON.stringify({ kind: 'hidden-window', start, end: endWall })}\n`,
        );
        hiddenTotal += Math.max(0, endWall - start);
        hideStart = null;
      }
      for (const stepId of [...openSteps].reverse()) closeStep(stepId, 'skipped');
      detach();
      const tail = sanitizer.push(decoder.decode()) + sanitizer.finish();
      if (!truncated && tail !== '') pushOutput(endWall, tail);
      const recordedExit = exit ?? finalizeOptions.exit;
      const contract = session.contract?.() ?? null;
      const logSummary = buildLogSummary();
      const meta: TraceMeta = {
        v: TRACE_VERSION,
        sessionId: session.sessionId,
        ...(options.runIdentity === undefined ? {} : { runIdentity: options.runIdentity }),
        command: sanitizeJson(options.command ?? [], sanitizer),
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
        ...(options.idleTimeLimit !== undefined && options.idleTimeLimit > 0
          ? { idleTimeLimit: options.idleTimeLimit }
          : {}),
        durationMs: round(durationMs),
        ...(crash === undefined ? {} : { crash }),
        ...(logSummary === undefined ? {} : { logs: logSummary }),
      };
      finalizePromise = spool
        .commit({ [TRACE_FILES.meta]: `${JSON.stringify(meta, null, 2)}\n` })
        .then((dir) => {
          const archive = { dir, meta, durationMs: meta.durationMs ?? 0 };
          finalizedArchive = archive;
          return archive;
        })
        .catch((error: unknown) => {
          finalizePromise = undefined;
          throw error;
        });
      return finalizePromise;
    },

    async dispose(): Promise<void> {
      sealed = true;
      detach();
      await spool.abort();
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
    return lastSemantic !== undefined;
  }

  /** Counted once, at the end: a flood that ends the session still adds up. */
  function buildLogSummary(): TraceLogSummary | undefined {
    if (logCount === 0 && droppedLogs === 0) return undefined;
    return {
      count: logCount,
      dropped: droppedLogs,
      sources: [...logSources.values()],
      levels: Object.fromEntries(logLevels),
    };
  }

  function resolveTerminalProfile(): string | undefined {
    return (
      options.terminalProfile ?? session.terminalProfile ?? session.contract?.()?.terminal.profile
    );
  }

  function buildHeader(): CastHeader {
    const initialColumns = options.columns ?? lastResize?.columns ?? columns;
    const initialRows = options.rows ?? lastResize?.rows ?? rows;
    return {
      version: 3,
      term: { cols: initialColumns, rows: initialRows },
      timestamp: Math.floor(wallStartedAt / 1000),
      ...(options.idleTimeLimit !== undefined && options.idleTimeLimit > 0
        ? { idle_time_limit: options.idleTimeLimit }
        : {}),
      ...(options.command === undefined
        ? {}
        : { command: sanitizer.sanitizeComplete(options.command.join(' ')) }),
      ...(options.title === undefined ? {} : { title: sanitizer.sanitizeComplete(options.title) }),
      ...(options.env === undefined ? {} : { env: sanitizeJson(options.env, sanitizer) }),
    };
  }

  return writer;
}

/**
 * The prefix a half-written trace directory carries.
 *
 * It leads with the target's basename rather than the staging marker on
 * purpose: run-history names its own incomplete runs `.staging-<run>` and
 * reads every directory with that prefix as one, so a trace staged in the same
 * place would be decoded as a half-written run. Keeping the basename in front
 * makes the two namespaces unmistakable.
 */
export function traceStagingPrefix(target: string): string {
  return `.${basename(target)}.staging-`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function sanitizeJson<T>(value: T, sanitizer: TerminalSanitizer): T {
  if (typeof value === 'string') return sanitizer.sanitizeComplete(value) as T;
  if (Array.isArray(value)) return value.map((item) => sanitizeJson(item, sanitizer)) as T;
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, sanitizeJson(item, sanitizer)]),
  ) as T;
}
