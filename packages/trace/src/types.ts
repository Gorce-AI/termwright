/**
 * Normative on-disk shapes of a `.twtrace` archive.
 *
 * The archive is a directory (optionally zipped for transport) containing:
 *
 * | File              | Content                                              |
 * |-------------------|------------------------------------------------------|
 * | `meta.json`       | {@link TraceMeta}                                     |
 * | `session.cast`    | asciicast **v3** recording, markers = test steps      |
 * | `events.jsonl`    | raw monotonic events                                  |
 * | `semantics.jsonl` | keyframes and revision deltas                         |
 * | `logs.jsonl`      | raw monotonic application log entries                |
 * | `timeline.jsonl`  | cast anchors and hidden-window transforms            |
 *
 * See `/CONTRACTS.md` §Trace — that file is normative, this one mirrors it in
 * TypeScript.
 */

import type { CrashInput, LocatorRef, SessionDiagnostic } from '@termwright/driver';
import type {
  ActionReceipt,
  ActionabilityExplanation,
  AttemptId,
  EffectiveSessionContract,
  ExecutionId,
  InvocationId,
  LogAttrValue,
  LogLevel,
  ObservationStamp,
  ProjectId,
  RunId,
  RunnerTaskId,
  SessionId,
  ShardId,
  SpecId,
  SemanticSnapshot,
  SemanticDelta,
} from '@termwright/protocol';

/** Current archive version. Readers reject anything else. */
export const TRACE_VERSION = 4 as const;

/** File names inside an archive. */
export const TRACE_FILES = {
  meta: 'meta.json',
  cast: 'session.cast',
  events: 'events.jsonl',
  semantics: 'semantics.jsonl',
  logs: 'logs.jsonl',
  timeline: 'timeline.jsonl',
  commit: 'COMMITTED',
} as const;

/** Marker present only in a staging directory before atomic commit. */
export const TRACE_INCOMPLETE_FILE = 'INCOMPLETE.json' as const;

/** Process exit as recorded in `meta.json`. */
export interface TraceExit {
  readonly code: number | null;
  readonly signal: string | null;
}

/** Contents of `meta.json`. */
export interface TraceMeta {
  readonly v: typeof TRACE_VERSION;
  readonly sessionId: string;
  /** Exact native-host attempt that owned this session, when test-created. */
  readonly runIdentity?: TraceRunIdentity;
  /** argv of the recorded session, as passed to `launchTerminal`. */
  readonly command: readonly string[];
  /** Initial viewport width; later changes appear as cast `r` events. */
  readonly columns: number;
  /** Initial viewport height. */
  readonly rows: number;
  /** ISO-8601 timestamp of the first recorded moment. */
  readonly startedAt: string;
  readonly platform: NodeJS.Platform;
  /**
   * Terminal profile the session was measured with, from
   * `TerminalHarness.terminalProfile`. Absent means `'default'`.
   *
   * It lives here rather than in the asciicast header because it describes the
   * session, like `columns` and `platform` next to it, and because `meta.json`
   * is ours: putting a termwright field inside a foreign format's `term`
   * object risks colliding with whatever asciicast adds there later.
   */
  readonly terminalProfile?: string;
  /** Whether the recorded session published a semantic tree. */
  readonly semanticTree: boolean;
  /** Frozen capability/provenance contract used to plan the recorded actions. */
  readonly contract?: EffectiveSessionContract;
  readonly exit?: TraceExit;
  /** Present and `true` when recording hit a size limit and stopped early. */
  readonly truncated?: boolean;
  /** Effective idle trim applied at {@link TraceWriter.finalize}, in seconds. */
  readonly idleTimeLimit?: number;
  /** Total cast duration in milliseconds after hide/trim transforms. */
  readonly durationMs?: number;
  /**
   * Present when the recorded program died unexpectedly — a signal, or a
   * non-zero exit nobody asked for. Absent for a clean exit and for a session
   * the harness closed or signalled itself.
   */
  readonly crash?: TraceCrash;
  /** Present when the session produced application logs. */
  readonly logs?: TraceLogSummary;
}

/** One append-only transform record in `timeline.jsonl`. */
export interface TraceHiddenWindow {
  readonly kind: 'hidden-window';
  readonly start: number;
  readonly end: number;
}

export interface TraceRunIdentity {
  readonly invocationId: InvocationId;
  readonly runId: RunId;
  readonly projectId: ProjectId;
  readonly shardId?: ShardId;
  readonly specId: SpecId;
  readonly runnerTaskId: RunnerTaskId;
  readonly executionId: ExecutionId;
  readonly attemptId: AttemptId;
  readonly sessionId: SessionId;
}

/**
 * What `logs.jsonl` holds, summarised so a consumer can decide whether to
 * stream it at all — and so the eviction count is always accurate.
 *
 * The counts are written once, at {@link TraceWriter.finalize}. A counter
 * flushed on the *next* log event would lose the last window whenever a flood
 * ends the session, which is exactly when the numbers matter.
 */
export interface TraceLogSummary {
  /** Entries actually written to `logs.jsonl`. */
  readonly count: number;
  /**
   * Entries refused after reaching the append-only writer ceiling.
   */
  readonly dropped: number;
  /** Distinct sources seen, in first-seen order. */
  readonly sources: readonly TraceLogSource[];
  /** Entry count per level; file lines have no level and are not counted. */
  readonly levels: Readonly<Partial<Record<LogLevel, number>>>;
}

/**
 * Where log entries came from.
 *
 * A label can be short and shared between sources, so the path is what
 * identifies a followed file — and what a reader opens. Adapter records have a
 * logger name and no path; a followed file has both.
 */
export interface TraceLogSource {
  readonly label?: string;
  /** Followed log files only: the path the driver is tailing. */
  readonly path?: string;
}

/**
 * One line of `logs.jsonl`: an application log entry on the session timeline.
 *
 * A followed file yields a raw line and an instrumented adapter yields a
 * structured record, but both land in `message`. Keeping one field rather than
 * the driver's mutually exclusive `line`/`record` means every consumer — the
 * report, the UI, an agent — can print a log without first branching on where
 * it came from; `source` is still there for the ones that care.
 */
export interface TraceLogEntry {
  /** Wall-clock offset from the start of recording, in milliseconds. */
  readonly t: number;
  /** Position on the cast timeline, in milliseconds. */
  readonly castOffset: number;
  readonly source: 'file' | 'adapter';
  /**
   * Display name of the stream: the log file's label, or the record's logger
   * when the file has none. What a panel header or a timeline row shows.
   */
  readonly label?: string;
  /**
   * Adapter records only: the record's own logger/channel name, verbatim
   * (`http`, `db.pool`). Kept separate from {@link label} because filtering by
   * channel is a different question from "which stream do I render this
   * under", and a display fallback is the wrong thing to filter on.
   */
  readonly logger?: string;
  /** Adapter records only — a followed file has no level to report. */
  readonly level?: LogLevel;
  /** The file line, or the record's already-formatted message. */
  readonly message: string;
  /**
   * Followed files only: the path this line came from, repeated per entry
   * rather than indexed into {@link TraceLogSummary.sources} — labels can
   * collide between sources, so a label alone cannot attribute an entry, and
   * an index into another file's array is a worse thing to read than a string.
   */
  readonly path?: string;
  /** Adapter records only: flat structured context. */
  readonly attrs?: Readonly<Record<string, LogAttrValue>>;
  /** Adapter records only: per-session counter; a gap means upstream drops. */
  readonly seq?: number;
  /** Semantic revision current when the record was produced, when known. */
  readonly revision?: number;
  /**
   * Adapter records only: the adapter's own Unix-epoch timestamp. `t` is when
   * the driver saw it, which for a followed file is an upper bound on when the
   * program wrote it.
   */
  readonly ts?: number;
}

/**
 * What the session knew when the program died, as stored in `meta.json`.
 *
 * A near-verbatim copy of the driver's `CrashReport`, with two deliberate
 * differences: it carries `castOffset` so a player can seek to the moment, and
 * it stores the last semantic *revision* rather than the tree itself — the tree
 * is already in `semantics.jsonl`, and `TraceReader.crashSemantic()` fetches it.
 */
export interface TraceCrash {
  /** Wall-clock offset from the start of recording, in milliseconds. */
  readonly t: number;
  /** Position on the cast timeline, in milliseconds. */
  readonly castOffset: number;
  readonly exit: TraceExit;
  /**
   * Last lines of scrollback plus the visible grid, oldest first.
   *
   * **Not redacted.** This is what the terminal showed, verbatim: whatever the
   * program or the tty's echo displayed is here, secrets included. A `.twtrace`
   * carrying a crash should be treated like a screenshot when it is stored,
   * uploaded as a CI artifact or forwarded.
   */
  readonly screenTail: readonly string[];
  /**
   * Revision of the last fully paired semantic tree, or `null`. Look the tree
   * itself up in `semantics.jsonl` via {@link TraceReader.crashSemantic}.
   */
  readonly lastSemanticRevision: number | null;
  /** The most recent inputs, oldest first. Paste contents are never included. */
  readonly recentInputs: readonly CrashInput[];
  /** Tail of the session diagnostics log. */
  readonly diagnosticsTail: readonly SessionDiagnostic[];
}

/** Kind discriminator of {@link TraceEvent}. */
export type TraceEventKind =
  'input' | 'resize' | 'step-start' | 'step-end' | 'action' | 'assert' | 'crash';

/** Terminal state of a recorded test step. */
export type StepStatus = 'passed' | 'failed' | 'skipped';

interface TraceEventBase {
  /** Wall-clock offset from the start of recording, in milliseconds. */
  readonly t: number;
  readonly kind: TraceEventKind;
  /**
   * Offset into the **cast timeline** in milliseconds: `t` after hidden
   * windows and idle trimming were removed.
   *
   * Required. Written by {@link TraceWriter.finalize}, which is the only
   * moment the transforms are known — a line without it cannot be placed on
   * the recording, so the reader rejects it as corrupt rather than guessing
   * `t`. `t` and `castOffset` are equal only in a recording that was neither
   * hidden nor trimmed, so the guess would be silently wrong exactly where
   * the timeline matters.
   */
  readonly castOffset: number;
}

/** Raw bytes written into the PTY by the harness. */
interface InputEventBase extends TraceEventBase {
  readonly kind: 'input';
  readonly inputKind: 'key' | 'mouse' | 'paste' | 'raw';
}

export type InputEvent = InputEventBase &
  (
    | { readonly dataB64: string; readonly recording: 'raw' }
    | { readonly recording: 'withheld'; readonly withheldReason: 'artifact-policy' }
  );

/** Viewport resize. */
export interface ResizeEvent extends TraceEventBase {
  readonly kind: 'resize';
  readonly columns: number;
  readonly rows: number;
}

/** Opening of a `test.step()`; produces a cast marker with the same title. */
export interface StepStartEvent extends TraceEventBase {
  readonly kind: 'step-start';
  readonly stepId: string;
  readonly title: string;
  /** Enclosing step, when steps are nested. */
  readonly parentStepId?: string;
  /** Authored Gherkin identity, when this step came from a physical feature. */
  readonly gherkin?: GherkinStepMetadata;
}

/** Physical authoring metadata retained without parsing a display title. */
export interface GherkinStepMetadata {
  readonly keyword: string;
  readonly text: string;
  readonly source: { readonly file: string; readonly line: number; readonly column: number };
  readonly background?: boolean;
}

/** Closing of a `test.step()`. */
export interface StepEndEvent extends TraceEventBase {
  readonly kind: 'step-end';
  readonly stepId: string;
  readonly title: string;
  readonly status: StepStatus;
  readonly error?: string;
}

/**
 * A driver action (`click`, `press`, …) with its outcome.
 *
 * `t` is when the action **finished**, because that is when the driver reports
 * it. The bytes an action sent therefore appear on the timeline *before* the
 * action entry that caused them — anything drawing a "this action produced
 * that output" relationship has to read backwards from the action, not
 * forwards.
 *
 * Failed actions are recorded too, which is the point: a report can say the
 * click never landed and why, instead of showing silence.
 */
export interface ActionEvent extends TraceEventBase {
  readonly kind: 'action';
  /** Driver API name, e.g. `'click'`, `'press'`, `'resize'`. */
  readonly api: string;
  readonly selector?: string;
  /** Domain-tagged resolved target ref, e.g. `'semantic:n8@42'`. */
  readonly ref?: LocatorRef;
  readonly ok: boolean;
  /**
   * Failure reason as a **code** (`'not-actionable'`, `'timeout'`), not
   * prose: the message belongs to the thrown error, this field is for grouping
   * and filtering.
   */
  readonly error?: string;
  /** Exact screen/tree pair observed when the driver completed the action. */
  readonly observation?: ObservationStamp;
  /**
   * Authoritative planning evidence and the real keyboard/mouse operations
   * executed through the PTY. Present for centrally planned semantic actions.
   */
  readonly receipt?: ActionReceipt;
  /** Exact rejection produced by the same planner invocation that failed. */
  readonly actionability?: ActionabilityExplanation;
  readonly stepId?: string;
}

/** An assertion / matcher evaluation with its outcome. */
export interface AssertEvent extends TraceEventBase {
  readonly kind: 'assert';
  readonly api: string;
  readonly selector?: string;
  readonly ref?: LocatorRef;
  readonly ok: boolean;
  readonly error?: string;
  /** Exact screen/tree pair used to diagnose this assertion, when available. */
  readonly observation?: ObservationStamp;
  readonly stepId?: string;
}

/**
 * The program died unexpectedly.
 *
 * Marks *when* on the timeline; the forensic detail lives in
 * {@link TraceMeta.crash}, so a reader scanning the event log does not have to
 * carry a screen tail on every line.
 */
export interface CrashEvent extends TraceEventBase {
  readonly kind: 'crash';
  readonly exit: TraceExit;
  /** Number of rows captured in `meta.crash.screenTail`. */
  readonly screenTailLines: number;
  readonly lastSemanticRevision: number | null;
}

/** One line of `events.jsonl`. */
export type TraceEvent =
  InputEvent | ResizeEvent | StepStartEvent | StepEndEvent | ActionEvent | AssertEvent | CrashEvent;

/** One line of `semantics.jsonl`. */
export interface SemanticRecord {
  /** Wall-clock offset from the start of recording, in milliseconds. */
  readonly t: number;
  /** `snapshot.revision`, hoisted for cheap indexing. */
  readonly revision: number;
  /**
   * Offset into the **cast timeline** in milliseconds. Differs from `t`
   * whenever hidden windows or idle trimming compressed the recording; this is
   * the value a player must seek to in order to show the screen that produced
   * this tree.
   */
  readonly castOffset: number;
  readonly snapshot: SemanticSnapshot;
}

/** Append-only semantic representation used on disk by trace v4. */
export type StoredSemanticRecord =
  | {
      readonly kind: 'keyframe';
      readonly t: number;
      readonly revision: number;
      readonly snapshot: SemanticSnapshot;
    }
  | {
      readonly kind: 'delta';
      readonly t: number;
      readonly revision: number;
      readonly baseRevision: number;
      readonly delta: SemanticDelta;
    };

/** A trace event as persisted; presentation time is derived by the reader. */
export type StoredTraceEvent = TraceEvent extends infer Event
  ? Event extends TraceEvent
    ? Omit<Event, 'castOffset'>
    : never
  : never;

/** A log entry as persisted; presentation time is derived by the reader. */
export type StoredTraceLogEntry = Omit<TraceLogEntry, 'castOffset'>;

/** Flattened view of a step, as returned by the reader. */
export interface StepSummary {
  readonly stepId: string;
  readonly title: string;
  readonly parentStepId?: string;
  readonly gherkin?: GherkinStepMetadata;
  /** Wall-clock start, in milliseconds. */
  readonly startedAt: number;
  /** Wall-clock end, in milliseconds; `null` when the step never closed. */
  readonly endedAt: number | null;
  /** Cast-timeline start offset, in milliseconds. */
  readonly castOffset: number;
  /** Cast-timeline end offset, in milliseconds; `null` for unclosed steps. */
  readonly castEndOffset: number | null;
  readonly status: StepStatus | null;
  readonly error?: string;
}
