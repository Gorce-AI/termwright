import type { ViewerState } from '../../data-source.js';
import type { ServerMessage } from '../../events.js';
import type { TraceLogs } from '../../trace-logs.js';
import type { TraceCommands, TraceFrames } from '../../trace-playback.js';
import type { TraceOverview, TraceStatePayload } from '../../trace-source.js';
import type {
  AppRoute,
  AppState,
  CompactWorkspace,
  EvidenceState,
  ExecutionCase,
  ExecutionNode,
  ReplayState,
  SessionRecord,
} from './model.js';

export type AppAction =
  | { readonly type: 'boot-ready'; readonly viewer: ViewerState }
  | { readonly type: 'boot-error'; readonly error: string }
  | { readonly type: 'connected'; readonly connected: boolean }
  | { readonly type: 'message'; readonly message: ServerMessage }
  | { readonly type: 'route'; readonly route: AppRoute }
  | { readonly type: 'compact-workspace'; readonly workspace: CompactWorkspace }
  | { readonly type: 'select-execution'; readonly executionId: string }
  | { readonly type: 'select-session'; readonly sessionId: string }
  | { readonly type: 'select-history'; readonly execution: ExecutionCase }
  | { readonly type: 'stop-requested' }
  | { readonly type: 'run-requested'; readonly targets: readonly string[] }
  | { readonly type: 'run-request-cleared' }
  | { readonly type: 'replay-loading'; readonly executionId: string; readonly traceRef: string }
  | {
      readonly type: 'replay-loaded';
      readonly executionId: string;
      readonly traceRef: string;
      readonly overview: TraceOverview;
      readonly frames: TraceFrames;
      readonly commands: TraceCommands;
      readonly traceState: TraceStatePayload | null;
      readonly logs: TraceLogs;
    }
  | { readonly type: 'replay-error'; readonly executionId: string; readonly traceRef: string; readonly error: string }
  | { readonly type: 'replay-time'; readonly timeMs: number }
  | { readonly type: 'replay-state'; readonly traceRef: string; readonly traceState: TraceStatePayload }
  | { readonly type: 'replay-playing'; readonly playing: boolean }
  | { readonly type: 'replay-speed'; readonly speed: ReplayState['speed'] }
  | { readonly type: 'toast'; readonly tone: 'success' | 'failure' | 'info'; readonly text: string }
  | { readonly type: 'toast-clear' };

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'boot-ready':
      return bootReady(state, action.viewer);
    case 'boot-error':
      return { ...state, boot: 'error', bootError: action.error };
    case 'connected':
      return { ...state, connected: action.connected };
    case 'message':
      return reduceMessage(state, action.message);
    case 'route':
      return { ...state, route: action.route };
    case 'compact-workspace':
      return { ...state, compactWorkspace: action.workspace };
    case 'select-execution': {
      const selected = state.executions.find((test) => test.executionId === action.executionId)
        ?? state.catalog.find((test) => test.executionId === action.executionId);
      const sessionId = selected?.sessionIds.at(-1);
      const evidence: EvidenceState = selected === undefined || selected.runId === null
        ? { kind: 'empty' }
        : { kind: 'live', runId: selected.runId ?? 'run:unknown', executionId: selected.executionId };
      return {
        ...state,
        route: 'runner',
        selectedExecutionId: action.executionId,
        selectedSessionId: selected === undefined || sessionId === undefined
          ? null
          : sessionKey(selected.runId, sessionId),
        evidence,
      };
    }
    case 'select-session':
      return { ...state, selectedSessionId: action.sessionId };
    case 'select-history': {
      const executions = state.executions.some((test) => test.executionId === action.execution.executionId)
        ? state.executions
        : [...state.executions, action.execution];
      return {
        ...state,
        executions,
        route: 'runner',
        selectedExecutionId: action.execution.executionId,
        selectedSessionId: null,
        evidence: { kind: 'empty' },
      };
    }
    case 'stop-requested':
      return { ...state, run: { ...state.run, status: 'stopping', stopError: null } };
    case 'run-requested':
      return { ...state, run: { ...state.run, requestedTargets: action.targets }, pendingRunTargets: action.targets };
    case 'run-request-cleared':
      return { ...state, run: { ...state.run, requestedTargets: null }, pendingRunTargets: null };
    case 'replay-loading':
      if (state.selectedExecutionId !== action.executionId) return state;
      return {
        ...state,
        evidence: {
          kind: 'replay-loading',
          runId: state.executions.find((test) => test.executionId === action.executionId)?.runId ?? 'run:unknown',
          executionId: action.executionId,
          traceRef: action.traceRef,
        },
        toast: { tone: 'info', text: 'Opening retained recording…' },
      };
    case 'replay-loaded':
      if (state.selectedExecutionId !== action.executionId) return state;
      return {
        ...state,
        selectedSessionId: null,
        evidence: {
          kind: 'replay',
          runId: state.executions.find((test) => test.executionId === action.executionId)?.runId ?? 'run:unknown',
          executionId: action.executionId,
          replay: {
            traceRef: action.traceRef,
            overview: action.overview,
            frames: action.frames,
            commands: action.commands.commands,
            traceState: action.traceState,
            logs: action.logs,
            timeMs: 0,
            playing: false,
            speed: 1,
            loading: false,
            error: action.commands.incomplete ? (action.commands.error ?? 'The command stream is incomplete.') : null,
          },
        },
        toast: null,
      };
    case 'replay-error':
      if (state.selectedExecutionId !== action.executionId) return state;
      return {
        ...state,
        evidence: {
          kind: 'replay-error',
          runId: state.executions.find((test) => test.executionId === action.executionId)?.runId ?? 'run:unknown',
          executionId: action.executionId,
          traceRef: action.traceRef,
          error: action.error,
        },
        toast: { tone: 'failure', text: action.error },
      };
    case 'replay-time':
      return updateReplay(state, (replay) => ({ ...replay, timeMs: action.timeMs }));
    case 'replay-state':
      return updateReplay(state, (replay) => replay.traceRef === action.traceRef
        ? { ...replay, traceState: action.traceState }
        : replay);
    case 'replay-playing':
      return updateReplay(state, (replay) => ({ ...replay, playing: action.playing }));
    case 'replay-speed':
      return updateReplay(state, (replay) => ({ ...replay, speed: action.speed }));
    case 'toast':
      return { ...state, toast: { tone: action.tone, text: action.text } };
    case 'toast-clear':
      return { ...state, toast: null };
  }
}

function bootReady(state: AppState, viewer: ViewerState): AppState {
  const sessions: Record<string, SessionRecord> = {};
  for (const session of viewer.sessions) {
    const runId = viewer.trace === null ? 'boot' : `trace:${viewer.trace.startedAt}`;
    const key = sessionKey(runId, session.sessionId);
    sessions[key] = {
      runId,
      sessionId: session.sessionId,
      columns: session.columns ?? 80,
      rows: session.rows ?? 24,
      terminalProfile: 'default',
      command: session.command,
      writable: session.writable,
      output: [],
      logs: [],
      revision: null,
      snapshot: null,
    };
  }
  const traceExecution = viewer.trace === null ? null : executionFromTrace(viewer.trace);
  return {
    ...state,
    boot: 'ready',
    project: viewer.project,
    canRun: viewer.canRun === true,
    run: viewer.trace === null ? { ...state.run, mode: viewer.mode } : {
      runId: traceExecution?.runId ?? null,
      mode: viewer.mode,
      status: 'finished',
      startedAt: viewer.trace.startedAt,
      summary: {
        total: 1,
        passed: traceExecution?.status === 'passed' ? 1 : 0,
        failed: traceExecution?.status === 'failed' ? 1 : 0,
        skipped: 0,
        flaky: 0,
        durationMs: viewer.trace.durationMs,
      },
      stopError: null,
      diagnosticGaps: 0,
      requestedTargets: null,
    },
    executions: traceExecution === null ? state.executions : [traceExecution],
    sessions,
    selectedExecutionId: traceExecution?.executionId ?? null,
    selectedSessionId: viewer.sessions.at(0) === undefined
      ? null
      : sessionKey(viewer.trace === null ? 'boot' : `trace:${viewer.trace.startedAt}`, (viewer.sessions[0] as ViewerState['sessions'][number]).sessionId),
    evidence: traceExecution === null
      ? state.evidence
      : { kind: 'live', runId: traceExecution.runId ?? 'trace:unknown', executionId: traceExecution.executionId },
  };
}

function executionFromTrace(trace: NonNullable<ViewerState['trace']>): ExecutionCase {
  const failed = trace.crash !== null
    || trace.steps.some((step) => step.status === 'failed')
    || (trace.exit !== null && trace.exit.code !== null && trace.exit.code !== 0);
  const runId = `trace:${trace.startedAt}`;
  const title = trace.command.length === 0 ? trace.sessionId : trace.command.join(' ');
  return {
    caseKey: `trace:${trace.sessionId}`,
    runId,
    executionId: `${runId}:${trace.sessionId}:1`,
    runtimeId: trace.sessionId,
    provider: null,
    kind: 'test',
    title,
    ancestors: [],
    tags: [],
    source: { file: trace.path },
    status: failed ? 'failed' : 'passed',
    attempt: 1,
    priorFailures: [],
    startedAt: trace.startedAt,
    durationMs: trace.durationMs,
    flaky: false,
    lostLogRecords: trace.lostLogRecords,
    sessionIds: [trace.sessionId],
    traceRef: trace.path,
    nodes: trace.steps.map((step) => ({
      nodeId: `step:${step.stepId}`,
      ...(step.parentStepId === undefined ? { parentId: 'body' } : { parentId: `step:${step.parentStepId}` }),
      kind: 'step',
      label: step.title,
      status: step.status === 'failed' ? 'failed' : step.endedAt === null ? 'running' : 'passed',
      startMs: step.castOffset,
      ...(step.castEndOffset === null ? {} : { endMs: step.castEndOffset }),
      ...(step.error === undefined ? {} : { error: step.error }),
      ...(step.gherkin === undefined ? {} : { gherkin: step.gherkin }),
    })),
    ...(trace.crash === null ? {} : { error: `Recorded process crashed: ${trace.crash.cause}` }),
  };
}

function reduceMessage(state: AppState, message: ServerMessage): AppState {
  switch (message.type) {
    case 'tests-discovered': {
      const catalog = message.tests
        .map<ExecutionCase>((test) => {
          const metadata = test as typeof test & {
            readonly provider?: { readonly id: string; readonly version?: number };
            readonly kind?: ExecutionCase['kind'];
            readonly ancestors?: ExecutionCase['ancestors'];
            readonly tags?: readonly string[];
            readonly source?: ExecutionCase['source'];
          };
          return {
          caseKey: test.id,
          runId: null,
          executionId: `catalog:${test.id}`,
          provider: metadata.provider?.id ?? null,
          kind: metadata.kind ?? 'test',
          title: test.title,
          ancestors: metadata.ancestors ?? [],
          tags: metadata.tags ?? [],
          source: metadata.source ?? { file: test.file },
          status: 'queued',
          attempt: 0,
          priorFailures: [],
          flaky: false,
          lostLogRecords: 0,
          sessionIds: [],
          nodes: [],
          };
        });
      return {
        ...state,
        catalog,
      };
    }
    case 'collection-failed':
      return {
        ...state,
        toast: { tone: 'failure', text: `Collection failed: ${message.error}` },
      };
    case 'run-start': {
      const redundantTraceBacklog = message.mode === 'post-mortem'
        && state.run.mode === 'post-mortem'
        && state.executions.some((test) => test.runId === `trace:${message.startedAt}`);
      if (redundantTraceBacklog) return state;
      const pinnedReplay = (state.evidence.kind === 'replay' || state.evidence.kind === 'replay-loading' || state.evidence.kind === 'replay-error')
        && state.pendingRunTargets === null;
      const leavingRecorder = state.run.mode === 'record' && message.mode === 'live';
      return {
        ...state,
        run: {
          runId: message.runId,
          mode: message.mode,
          status: leavingRecorder ? 'idle' : 'running',
          startedAt: message.startedAt,
          summary: null,
          stopError: null,
          diagnosticGaps: 0,
          requestedTargets: state.pendingRunTargets,
        },
        selectedExecutionId: pinnedReplay ? state.selectedExecutionId : null,
        selectedSessionId: pinnedReplay ? state.selectedSessionId : null,
        evidence: pinnedReplay ? state.evidence : { kind: 'empty' },
      };
    }
    case 'test-start':
      return startTest(state, message);
    case 'session':
      return addSession(state, message);
    case 'step':
      return updateCaseForMessage(state, message.testId, (test) => updateStep(test, message));
    case 'action-start': {
      const executionId = executionForCorrelation(state, message.testId, message.sessionId);
      if (executionId === null) return state;
      return updateCase(state, executionId, (test) => {
        const nodeId = actionNodeId(message.sessionId, message.actionId);
        if (test.nodes.some((node) => node.nodeId === nodeId)) return test;
        const parentId = message.stepId === undefined ? 'body' : `step:${message.stepId}`;
        return {
          ...test,
          nodes: [...test.nodes, {
            nodeId,
            parentId,
            kind: 'action',
            label: message.api,
            status: 'running',
            startMs: message.t,
            ...(message.selector === undefined ? {} : { selector: message.selector }),
          }],
        };
      });
    }
    case 'action': {
      const executionId = executionForCorrelation(state, message.testId, message.sessionId);
      if (executionId === null) return state;
      return updateCase(state, executionId, (test) => settleAction(test, message));
    }
    case 'output': {
      const key = sessionKey(state.run.runId, message.sessionId);
      const current = state.sessions[key];
      if (current === undefined) return state;
      return {
        ...state,
        sessions: {
          ...state.sessions,
          [key]: { ...current, output: [...current.output.slice(-1_999), message.dataB64] },
        },
      };
    }
    case 'semantic': {
      const key = sessionKey(state.run.runId, message.sessionId);
      const current = state.sessions[key];
      if (current === undefined) return state;
      return {
        ...state,
        sessions: {
          ...state.sessions,
          [key]: { ...current, revision: message.revision, snapshot: message.snapshot },
        },
      };
    }
    case 'test-end': {
      const ended = [...state.executions].reverse().find((test) => test.runtimeId === message.id);
      if (ended === undefined) return state;
      const next = updateCase(state, ended.executionId, (test) => ({
        ...test,
        status: message.status,
        durationMs: message.durationMs,
        attempt: message.attempt ?? test.attempt,
        priorFailures: message.priorFailures ?? test.priorFailures,
        flaky: message.flaky || (message.priorFailures?.length ?? 0) > 0,
        lostLogRecords: message.lostLogRecords,
        ...(message.error === undefined ? {} : { error: message.error }),
        ...(message.traceRef === undefined ? {} : { traceRef: message.traceRef }),
      }));
      return {
        ...next,
        toast: {
          tone: message.status === 'failed' ? 'failure' : 'success',
          text: `${ended.title} ${message.status}`,
        },
      };
    }
    case 'run-end':
      return {
        ...state,
        run: { ...state.run, status: 'finished', summary: message.summary },
      };
    case 'run-cancelled':
      return {
        ...state,
        run: { ...state.run, status: 'cancelled' },
        executions: state.executions.map((test) =>
          test.runId === state.run.runId && test.status === 'running'
            ? { ...test, status: 'cancelled' as const }
            : test),
        toast: { tone: 'info', text: 'Run cancelled' },
      };
    case 'run-cancel-failed':
      return {
        ...state,
        run: { ...state.run, status: 'running', stopError: message.error },
        toast: { tone: 'failure', text: `Could not stop: ${message.error}` },
      };
    case 'run-infrastructure-failed':
      return {
        ...state,
        run: { ...state.run, status: 'finished' },
        toast: { tone: 'failure', text: `Infrastructure failure: ${message.error}` },
      };
    case 'diagnostic-gap':
      return {
        ...state,
        run: {
          ...state.run,
          diagnosticGaps: state.run.diagnosticGaps + message.droppedMessages,
        },
        toast: {
          tone: 'failure',
          text: `Runner diagnostics incomplete: ${message.droppedMessages} projected messages were dropped`,
        },
      };
    case 'app-log': {
      const key = sessionKey(state.run.runId, message.sessionId);
      const current = state.sessions[key];
      if (current === undefined) return state;
      const { v: _version, type: _type, sessionId: _sessionId, ...log } = message;
      return {
        ...state,
        sessions: {
          ...state.sessions,
          [key]: { ...current, logs: [...current.logs.slice(-1_999), log] },
        },
      };
    }
    case 'actionability-inspection':
    case 'control-result':
      // RunnerClient or another request owner consumes request-scoped replies;
      // they do not enter the append-only application event projection.
      return state;
  }
}

function startTest(state: AppState, message: Extract<ServerMessage, { type: 'test-start' }>): AppState {
  if (state.run.mode === 'post-mortem' && state.executions.some((test) => test.runtimeId === message.id)) {
    return state;
  }
  // Native host identity is the join key. Recorder pseudo-cases have no
  // catalogue identity and remain scoped to their explicit recorder id.
  const caseKey = message.runnerTaskId ?? `record:${message.id}`;
  const explicitlyRequested = state.pendingRunTargets !== null && (
    state.pendingRunTargets.length === 0
      || state.pendingRunTargets.includes(caseKey)
      || state.pendingRunTargets.includes(message.file)
  );
  const priorAttempts = state.executions.filter(
    (test) => test.runId === state.run.runId && test.caseKey === caseKey,
  );
  const attempt = message.attempt ?? priorAttempts.length + 1;
  const executionId = message.executionId ?? `${state.run.runId ?? 'run:unknown'}:${message.id}:${attempt}`;
  const entry: ExecutionCase = {
    caseKey,
    runId: state.run.runId,
    executionId,
    runtimeId: message.id,
    provider: state.catalog.find((test) => test.caseKey === caseKey)?.provider ?? null,
    kind: state.catalog.find((test) => test.caseKey === caseKey)?.kind ?? 'test',
    title: message.title,
    ancestors: state.catalog.find((test) => test.caseKey === caseKey)?.ancestors ?? [],
    tags: state.catalog.find((test) => test.caseKey === caseKey)?.tags ?? [],
    source: state.catalog.find((test) => test.caseKey === caseKey)?.source ?? { file: message.file },
    status: 'running',
    attempt,
    priorFailures: [],
    startedAt: message.startedAt,
    flaky: false,
    lostLogRecords: 0,
    sessionIds: message.sessionId === undefined ? [] : [message.sessionId],
    nodes: [],
  };
  const preservePinnedReplay = (state.evidence.kind === 'replay' || state.evidence.kind === 'replay-loading' || state.evidence.kind === 'replay-error')
    && !explicitlyRequested;
  const preserveLiveSelection = state.evidence.kind === 'live'
    && state.evidence.runId === (state.run.runId ?? 'run:unknown')
    && state.executions.some((test) => test.executionId === state.selectedExecutionId && test.status === 'running');
  const preserveWorkspace = preservePinnedReplay || preserveLiveSelection;
  return {
    ...state,
    executions: [...state.executions, entry],
    route: preserveWorkspace ? state.route : 'runner',
    selectedExecutionId: preserveWorkspace ? state.selectedExecutionId : executionId,
    selectedSessionId: preserveWorkspace
      ? state.selectedSessionId
      : (message.sessionId === undefined ? null : sessionKey(state.run.runId, message.sessionId)),
    evidence: preserveWorkspace
      ? state.evidence
      : { kind: 'live', runId: state.run.runId ?? 'run:unknown', executionId },
    pendingRunTargets: explicitlyRequested ? null : state.pendingRunTargets,
  };
}

function addSession(state: AppState, message: Extract<ServerMessage, { type: 'session' }>): AppState {
  const record: SessionRecord = {
    runId: state.run.runId ?? 'run:unknown',
    sessionId: message.sessionId,
    ...(message.testId === undefined ? {} : { testId: message.testId }),
    columns: message.columns,
    rows: message.rows,
    terminalProfile: message.terminalProfile,
    ...(message.contract === undefined ? {} : { contract: message.contract }),
    ...(message.adapterStatus === undefined ? {} : { adapterStatus: message.adapterStatus }),
    command: [],
    writable: state.run.mode === 'record',
    output: [],
    logs: [],
    revision: null,
    snapshot: null,
  };
  let executions = state.executions;
  const owner = message.testId === undefined
    ? undefined
    : [...executions].reverse().find((test) => test.runtimeId === message.testId);
  if (owner !== undefined) {
    executions = executions.map((test) => test.executionId === owner.executionId
      ? { ...test, sessionIds: [...new Set([...test.sessionIds, message.sessionId])] }
      : test);
  }
  const key = sessionKey(state.run.runId, message.sessionId);
  return {
    ...state,
    executions,
    sessions: { ...state.sessions, [key]: record },
    selectedSessionId: owner?.executionId === state.selectedExecutionId ? key : state.selectedSessionId,
  };
}

function updateStep(test: ExecutionCase, message: Extract<ServerMessage, { type: 'step' }>): ExecutionCase {
  const stepId = `step:${message.stepId ?? `${message.title}:${message.t ?? 0}`}`;
  const index = test.nodes.findIndex((node) => node.nodeId === stepId);
  if (message.phase === 'start') {
    const started: ExecutionNode = {
      nodeId: stepId,
      parentId: 'body',
      kind: 'step',
      label: message.gherkin === undefined ? message.title : gherkinLabel(message.gherkin.keyword, message.gherkin.text),
      status: 'running',
      startMs: message.t ?? 0,
      ...(message.gherkin === undefined ? {} : { gherkin: message.gherkin }),
    };
    if (index === -1) return { ...test, nodes: [...test.nodes, started] };
    const nodes = [...test.nodes];
    const current = nodes[index] as ExecutionNode;
    // A post-run trace can repeat the same stable step annotation. Enrich the
    // existing row, but never turn an already settled live row back to running.
    nodes[index] = {
      ...current,
      label: started.label,
      ...(message.gherkin === undefined ? {} : { gherkin: message.gherkin }),
    };
    return { ...test, nodes };
  }
  if (index === -1) return test;
  const nodes = [...test.nodes];
  const current = nodes[index] as ExecutionNode;
  nodes[index] = {
    ...current,
    status: message.status === 'failed' ? 'failed' : 'passed',
    ...(message.t === undefined ? {} : { endMs: message.t }),
    ...(message.error === undefined ? {} : { error: message.error }),
    ...(message.gherkin === undefined ? {} : { gherkin: message.gherkin }),
  };
  return { ...test, nodes };
}

function gherkinLabel(keyword: string, text: string): string {
  return `${keyword.trim()} ${text.trim()}`.trim();
}

function settleAction(test: ExecutionCase, message: Extract<ServerMessage, { type: 'action' }>): ExecutionCase {
  const nodeId = message.actionId === undefined
    ? `event:${message.sessionId ?? 'session'}:${message.kind}:${message.t}:${message.api}`
    : actionNodeId(message.sessionId, message.actionId);
  const index = test.nodes.findIndex((node) => node.nodeId === nodeId);
  const settled: ExecutionNode = {
    nodeId,
    parentId: message.stepId === undefined ? 'body' : `step:${message.stepId}`,
    kind: message.kind === 'assert' ? 'assertion' : 'action',
    label: message.api,
    status: message.ok ? 'passed' : 'failed',
    startMs: index === -1 ? message.t : ((test.nodes[index] as ExecutionNode).startMs),
    endMs: message.t,
    ...(message.selector === undefined ? {} : { selector: message.selector }),
    ...(message.ref === undefined ? {} : { targetRef: message.ref }),
    ...(message.error === undefined ? {} : { error: message.error }),
    ...(message.actionPlan === undefined ? {} : { actionPlan: message.actionPlan }),
    ...(message.actionability === undefined ? {} : { actionability: message.actionability }),
  };
  if (index === -1) return { ...test, nodes: [...test.nodes, settled] };
  const nodes = [...test.nodes];
  nodes[index] = { ...(nodes[index] as ExecutionNode), ...settled };
  return { ...test, nodes };
}

function actionNodeId(sessionId: string | undefined, actionId: string): string {
  return `action:${sessionId ?? 'session'}:${actionId}`;
}

function executionForCorrelation(state: AppState, testId: string | undefined, sessionId: string | undefined): string | null {
  if (testId !== undefined) {
    const byTest = [...state.executions].reverse().find(
      (test) => test.runId === state.run.runId && test.runtimeId === testId,
    );
    if (byTest !== undefined) return byTest.executionId;
  }
  if (sessionId !== undefined) {
    const bySession = [...state.executions].reverse().find(
      (test) => test.runId === state.run.runId && test.sessionIds.includes(sessionId),
    );
    if (bySession !== undefined) return bySession.executionId;
  }
  return null;
}

function sessionKey(runId: string | null, sessionId: string): string {
  return `${runId ?? 'run:unknown'}:${sessionId}`;
}

function updateCaseForMessage(
  state: AppState,
  runtimeId: string,
  update: (test: ExecutionCase) => ExecutionCase,
): AppState {
  const found = [...state.executions].reverse().find((test) => test.runtimeId === runtimeId);
  return found === undefined ? state : updateCase(state, found.executionId, update);
}

function updateCase(
  state: AppState,
  executionId: string,
  update: (test: ExecutionCase) => ExecutionCase,
): AppState {
  return {
    ...state,
    executions: state.executions.map((test) => test.executionId === executionId ? update(test) : test),
  };
}

function updateReplay(state: AppState, update: (replay: ReplayState) => ReplayState): AppState {
  if (state.evidence.kind !== 'replay') return state;
  return {
    ...state,
    evidence: { ...state.evidence, replay: update(state.evidence.replay) },
  };
}
