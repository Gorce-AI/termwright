import type { EffectiveSessionContract, SemanticSnapshot } from '@termwright/protocol';
import type { AppLogView } from '../../app-log.js';
import type { CommandRow } from '../../commands.js';
import type {
  UiActionability,
  UiActionPlan,
  UiGherkinStep,
  UiRunSummary,
  UiServerMode,
} from '../../events.js';
import type { PlaybackSpeed } from '../../playback.js';
import type { ProjectInfo } from '../../project.js';
import type { TraceLogs } from '../../trace-logs.js';
import type { TraceFrames } from '../../trace-playback.js';
import type { TraceOverview, TraceStatePayload } from '../../trace-source.js';

export type AppRoute = 'specs' | 'runner' | 'runs' | 'settings';
export type CompactWorkspace = 'steps' | 'screen' | 'inspect';
export type ExecutionStatus = 'queued' | 'running' | 'passed' | 'failed' | 'skipped' | 'cancelled';

export type ExecutionNodeKind = 'hook' | 'body' | 'step' | 'action' | 'assertion' | 'input';

export interface ExecutionNode {
  readonly nodeId: string;
  readonly parentId?: string;
  readonly kind: ExecutionNodeKind;
  readonly label: string;
  readonly status: 'queued' | 'running' | 'passed' | 'failed';
  readonly startMs: number;
  readonly endMs?: number;
  readonly selector?: string;
  readonly targetRef?: string;
  /** UI-only explanation for a structural row that cannot choose one exact target. */
  readonly targetIssue?: string;
  readonly error?: string;
  readonly actionPlan?: UiActionPlan;
  readonly actionability?: UiActionability;
  readonly gherkin?: UiGherkinStep;
}

export interface ExecutionCase {
  readonly caseKey: string;
  readonly runId: string | null;
  readonly executionId: string;
  readonly runtimeId?: string;
  /** Absent until the provider declares itself on the wire. Never inferred from a title. */
  readonly provider: string | null;
  readonly kind: 'test' | 'gherkin-scenario' | 'gherkin-outline-example';
  readonly title: string;
  readonly ancestors: readonly { readonly kind: 'feature' | 'rule'; readonly title: string }[];
  readonly tags: readonly string[];
  readonly source: { readonly file: string; readonly line?: number; readonly column?: number };
  readonly status: ExecutionStatus;
  readonly attempt: number;
  /** Earlier native-provider attempts for the same logical case. */
  readonly priorFailures: readonly {
    readonly attempt: number;
    readonly errors: readonly string[];
  }[];
  readonly startedAt?: number;
  readonly durationMs?: number;
  readonly flaky: boolean;
  readonly error?: string;
  readonly lostLogRecords: number;
  readonly sessionIds: readonly string[];
  readonly traceRef?: string;
  readonly nodes: readonly ExecutionNode[];
  /** Backend reported this execution outside this tab's explicit requested scope. */
  readonly scopeMismatch?: boolean;
}

export interface SessionRecord {
  readonly runId: string;
  readonly sessionId: string;
  readonly testId?: string;
  readonly columns: number;
  readonly rows: number;
  readonly terminalProfile: string;
  readonly contract?: EffectiveSessionContract;
  readonly adapterStatus?: 'attached' | 'disconnected' | 'error';
  readonly command: readonly string[];
  readonly writable: boolean;
  readonly output: readonly string[];
  readonly logs: readonly AppLogView[];
  readonly revision: number | null;
  readonly snapshot: SemanticSnapshot | null;
}

export interface RunState {
  readonly runId: string | null;
  readonly mode: UiServerMode;
  readonly status: 'idle' | 'running' | 'stopping' | 'finished' | 'cancelled';
  readonly startedAt: number | null;
  readonly summary: UiRunSummary | null;
  readonly stopError: string | null;
  /** Projection loss only; canonical run history remains authoritative. */
  readonly diagnosticGaps: number;
  /** null/[] mean the full initial CLI scope; a non-empty list is an exact UI request. */
  readonly requestedTargets: readonly string[] | null;
}

export interface ReplayState {
  readonly traceRef: string;
  readonly overview: TraceOverview;
  readonly frames: TraceFrames;
  readonly commands: readonly CommandRow[];
  readonly traceState: TraceStatePayload | null;
  readonly logs: TraceLogs;
  readonly timeMs: number;
  readonly playing: boolean;
  readonly speed: PlaybackSpeed;
  readonly loading: boolean;
  readonly error: string | null;
}

export type EvidenceState =
  | { readonly kind: 'empty' }
  | { readonly kind: 'live'; readonly runId: string; readonly executionId: string }
  | {
      readonly kind: 'replay-loading';
      readonly runId: string;
      readonly executionId: string;
      readonly traceRef: string;
    }
  | {
      readonly kind: 'replay-error';
      readonly runId: string;
      readonly executionId: string;
      readonly traceRef: string;
      readonly error: string;
    }
  | {
      readonly kind: 'replay';
      readonly runId: string;
      readonly executionId: string;
      readonly replay: ReplayState;
    };

export interface AppState {
  readonly boot: 'loading' | 'ready' | 'error';
  readonly bootError: string | null;
  readonly project: ProjectInfo | null;
  readonly connected: boolean;
  readonly canRun: boolean;
  readonly route: AppRoute;
  readonly compactWorkspace: CompactWorkspace;
  readonly run: RunState;
  /** Stable discovery catalogue. It is not run history and never owns selection. */
  readonly catalog: readonly ExecutionCase[];
  /** Immutable attempts across run epochs. Current live ingest appends/settles entries. */
  readonly executions: readonly ExecutionCase[];
  readonly sessions: Readonly<Record<string, SessionRecord>>;
  readonly selectedExecutionId: string | null;
  readonly selectedSessionId: string | null;
  /** Exact catalogue case explicitly requested by this tab; background runs leave it null. */
  readonly pendingRunTargets: readonly string[] | null;
  readonly evidence: EvidenceState;
  readonly toast: { readonly tone: 'success' | 'failure' | 'info'; readonly text: string } | null;
}

export const initialAppState: AppState = {
  boot: 'loading',
  bootError: null,
  project: null,
  connected: false,
  canRun: false,
  route: 'runner',
  compactWorkspace: 'steps',
  run: {
    runId: null,
    mode: 'live',
    status: 'idle',
    startedAt: null,
    summary: null,
    stopError: null,
    diagnosticGaps: 0,
    requestedTargets: null,
  },
  catalog: [],
  executions: [],
  sessions: {},
  selectedExecutionId: null,
  selectedSessionId: null,
  pendingRunTargets: null,
  evidence: { kind: 'empty' },
  toast: null,
};
