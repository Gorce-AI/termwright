import { describe, expect, it } from 'vitest';
import type { TraceLogs } from '../../trace-logs.js';
import type { TraceFrames } from '../../trace-playback.js';
import type { TraceOverview, TraceStatePayload } from '../../trace-source.js';
import type { AppState, ExecutionCase } from './model.js';
import { initialAppState } from './model.js';
import { appReducer } from './reducer.js';
import { nodesForSelected } from './selectors.js';

describe('greenfield application reducer identities', () => {
  it('makes bounded diagnostic loss visible and cumulative', () => {
    let state = appReducer(initialAppState, {
      type: 'message',
      message: {
        v: 1,
        type: 'diagnostic-gap',
        source: 'ui-hub',
        droppedMessages: 7,
        droppedBytes: 1_024,
      },
    });
    state = appReducer(state, {
      type: 'message',
      message: {
        v: 1,
        type: 'diagnostic-gap',
        source: 'live-session-producer',
        droppedMessages: 2,
        droppedBytes: 64,
      },
    });

    expect(state.run.diagnosticGaps).toBe(9);
    expect(state.toast).toMatchObject({
      tone: 'failure',
      text: expect.stringContaining('2 projected messages were dropped'),
    });
  });

  it('keeps a pinned historical replay while a new live run starts', () => {
    const history = execution('history-run', 'history-runtime', 'history-session');
    const replay = {
      traceRef: '/tmp/history.twtrace',
      overview: overview('/tmp/history.twtrace', 'history-session'),
      frames: emptyFrames,
      commands: [],
      traceState: emptyTraceState,
      logs: emptyLogs,
      timeMs: 42,
      playing: false,
      speed: 1 as const,
      loading: false,
      error: null,
    };
    const before: AppState = {
      ...initialAppState,
      run: { ...initialAppState.run, runId: 'history-run', status: 'finished' },
      executions: [history],
      selectedExecutionId: history.executionId,
      evidence: { kind: 'replay', runId: 'history-run', executionId: history.executionId, replay },
    };

    const after = appReducer(before, {
      type: 'message',
      message: { v: 1, type: 'run-start', runId: 'run:test', mode: 'live', startedAt: 2_000 },
    });

    expect(after.run.runId).toBe('run:test');
    expect(after.selectedExecutionId).toBe(history.executionId);
    expect(after.evidence).toBe(before.evidence);
    expect(after.executions).toEqual([history]);
  });

  it('hydrates replay at the requested bounded deep-link position', () => {
    const history = execution('history-run', 'history-runtime', 'history-session');
    let state: AppState = {
      ...initialAppState,
      executions: [history],
      selectedExecutionId: history.executionId,
    };
    state = appReducer(state, {
      type: 'replay-loading',
      executionId: history.executionId,
      traceRef: history.traceRef as string,
    });
    state = appReducer(state, {
      type: 'replay-loaded',
      executionId: history.executionId,
      traceRef: history.traceRef as string,
      overview: overview(history.traceRef as string, 'history-session'),
      frames: emptyFrames,
      commands: { commands: [], incomplete: false },
      traceState: emptyTraceState,
      logs: emptyLogs,
      timeMs: 150,
    });
    expect(state.evidence.kind).toBe('replay');
    if (state.evidence.kind === 'replay') expect(state.evidence.replay.timeMs).toBe(100);
  });

  it('hands an explicitly rerun historical case to its new live attempt', () => {
    const history = execution('history-run', 'history-runtime', 'history-session');
    let state: AppState = {
      ...initialAppState,
      run: { ...initialAppState.run, runId: 'history-run', status: 'finished' },
      executions: [history],
      selectedExecutionId: history.executionId,
      evidence: {
        kind: 'replay',
        runId: 'history-run',
        executionId: history.executionId,
        replay: {
          traceRef: history.traceRef as string,
          overview: overview(history.traceRef as string, 'history-session'),
          frames: emptyFrames,
          commands: [],
          traceState: emptyTraceState,
          logs: emptyLogs,
          timeMs: 0,
          playing: false,
          speed: 1,
          loading: false,
          error: null,
        },
      },
    };
    state = appReducer(state, { type: 'run-requested', targets: [history.caseKey] });
    state = appReducer(state, {
      type: 'message',
      message: { v: 1, type: 'run-start', runId: 'run:test', mode: 'live', startedAt: 2 },
    });
    state = appReducer(state, {
      type: 'message',
      message: {
        v: 1,
        type: 'test-start',
        id: 'new-runtime',
        runnerTaskId: history.caseKey,
        title: 'case',
        file: '/repo/case.test.ts',
        startedAt: 2,
      },
    });

    expect(state.selectedExecutionId).toBe('run:test:new-runtime:1');
    expect(state.evidence).toEqual({
      kind: 'live',
      runId: 'run:test',
      executionId: 'run:test:new-runtime:1',
    });
    expect(state.selectedSessionId).toBeNull();
    expect(state.pendingRunTargets).toBeNull();
  });

  it('keeps the requested scope after the pending latch clears and resets it for a background run', () => {
    const selected = 'runner-task:a';
    let state = appReducer(initialAppState, { type: 'run-requested', targets: [selected] });
    state = appReducer(state, {
      type: 'message',
      message: { v: 1, type: 'run-start', runId: 'run:test', mode: 'live', startedAt: 10 },
    });
    state = appReducer(state, {
      type: 'message',
      message: {
        v: 1,
        type: 'test-start',
        id: 'runtime-a',
        runnerTaskId: selected,
        title: 'suite > A',
        file: '/repo/a.test.ts',
        startedAt: 10,
      },
    });
    expect(state.pendingRunTargets).toBeNull();
    expect(state.run.requestedTargets).toEqual([selected]);
    state = appReducer(state, {
      type: 'message',
      message: {
        v: 1,
        type: 'run-end',
        summary: {
          verdict: 'passed',
          total: 1,
          passed: 1,
          failed: 0,
          skipped: 0,
          flaky: 0,
          durationMs: 1,
        },
      },
    });
    expect(state.run.requestedTargets).toEqual([selected]);
    state = appReducer(state, {
      type: 'message',
      message: { v: 1, type: 'run-start', runId: 'run:test', mode: 'live', startedAt: 20 },
    });
    expect(state.run.requestedTargets).toBeNull();
  });

  it('preserves the yellow verdict independently of attempt counters', () => {
    const state = appReducer(initialAppState, {
      type: 'message',
      message: {
        v: 1,
        type: 'run-end',
        summary: {
          verdict: 'passed-with-skips',
          total: 2,
          passed: 1,
          failed: 0,
          skipped: 0,
          flaky: 0,
          durationMs: 1,
        },
      },
    });
    expect(state.run.summary?.verdict).toBe('passed-with-skips');
  });

  it('fails closed for an unmatched action even when history is selected', () => {
    const history = execution('history-run', 'history-runtime', 'history-session');
    const before: AppState = {
      ...initialAppState,
      run: { ...initialAppState.run, runId: 'new-run', status: 'running' },
      executions: [history],
      selectedExecutionId: history.executionId,
    };
    const after = appReducer(before, {
      type: 'message',
      message: { v: 1, type: 'action-start', actionId: 'a1', api: 'press', t: 10 },
    });
    expect(after.executions).toEqual(before.executions);
  });

  it('scopes reused runtime, session and action ids to the current run epoch', () => {
    let state: AppState = {
      ...initialAppState,
      run: { ...initialAppState.run, runId: 'run:1', status: 'running' },
    };
    state = start(state, 'same-runtime', 'same-session', 1);
    state = appReducer(state, {
      type: 'message',
      message: {
        v: 1,
        type: 'action-start',
        actionId: 'a1',
        api: 'press',
        t: 10,
        testId: 'same-runtime',
        sessionId: 'same-session',
      },
    });
    const oldExecution = state.executions[0] as ExecutionCase;

    state = appReducer(state, {
      type: 'message',
      message: { v: 1, type: 'run-start', runId: 'run:test', mode: 'live', startedAt: 2 },
    });
    state = start(state, 'same-runtime', 'same-session', 2);
    state = appReducer(state, {
      type: 'message',
      message: {
        v: 1,
        type: 'action-start',
        actionId: 'a1',
        api: 'press',
        t: 20,
        testId: 'same-runtime',
        sessionId: 'same-session',
      },
    });
    state = appReducer(state, {
      type: 'message',
      message: {
        v: 1,
        type: 'action',
        actionId: 'a1',
        kind: 'action',
        api: 'press',
        t: 30,
        ok: false,
        testId: 'same-runtime',
        sessionId: 'same-session',
      },
    });

    expect(state.executions).toHaveLength(2);
    expect(state.executions[0]).toEqual(oldExecution);
    expect(state.executions[1]?.nodes).toHaveLength(1);
    expect(state.executions[1]?.nodes[0]).toMatchObject({
      status: 'failed',
      nodeId: 'action:same-session:a1',
    });
  });

  it('keeps identical action ids from two sessions as separate rows', () => {
    let state: AppState = {
      ...initialAppState,
      run: { ...initialAppState.run, runId: 'run:1', status: 'running' },
    };
    state = start(state, 'runtime', 'session-a', 1);
    state = appReducer(state, {
      type: 'message',
      message: {
        v: 1,
        type: 'session',
        sessionId: 'session-b',
        testId: 'runtime',
        terminalProfile: 'default',
        columns: 80,
        rows: 24,
      },
    });
    for (const sessionId of ['session-a', 'session-b']) {
      state = appReducer(state, {
        type: 'message',
        message: {
          v: 1,
          type: 'action-start',
          actionId: 'a1',
          api: 'press',
          t: 10,
          testId: 'runtime',
          sessionId,
        },
      });
    }
    expect(state.executions[0]?.nodes.map((node) => node.nodeId)).toEqual([
      'action:session-a:a1',
      'action:session-b:a1',
    ]);
  });

  it('clears terminal evidence when the next selected case has no session', () => {
    let state: AppState = {
      ...initialAppState,
      run: { ...initialAppState.run, runId: 'run:1', status: 'running' },
    };
    state = start(state, 'runtime-a', 'session-a', 1);
    expect(state.selectedSessionId).toBe('run:1:session-a');
    state = appReducer(state, {
      type: 'message',
      message: {
        v: 1,
        type: 'test-end',
        id: 'runtime-a',
        status: 'passed',
        durationMs: 1,
        flaky: false,
        lostLogRecords: 0,
      },
    });
    state = appReducer(state, {
      type: 'message',
      message: {
        v: 1,
        type: 'test-start',
        id: 'runtime-b',
        runnerTaskId: 'runner-task:b',
        title: 'case without terminal',
        file: '/repo/b.test.ts',
        startedAt: 2,
      },
    });
    expect(state.selectedSessionId).toBeNull();
    expect(state.selectedExecutionId).toBe('run:1:runtime-b:1');
    expect(state.evidence).toEqual({
      kind: 'live',
      runId: 'run:1',
      executionId: 'run:1:runtime-b:1',
    });
  });

  it('keeps the selected running case when another concurrent case starts', () => {
    let state: AppState = {
      ...initialAppState,
      run: { ...initialAppState.run, runId: 'run:1', status: 'running' },
    };
    state = start(state, 'runtime-a', 'session-a', 1);
    state = appReducer(state, {
      type: 'message',
      message: {
        v: 1,
        type: 'test-start',
        id: 'runtime-b',
        runnerTaskId: 'runner-task:b',
        title: 'case b',
        file: '/repo/b.test.ts',
        startedAt: 2,
      },
    });
    expect(state.selectedExecutionId).toBe('run:1:runtime-a:1');
    expect(state.selectedSessionId).toBe('run:1:session-a');
    expect(state.executions.map((test) => test.status)).toEqual(['running', 'running']);
  });

  it('returns to idle when Stop recording transitions the server back to live', () => {
    const before: AppState = {
      ...initialAppState,
      run: { ...initialAppState.run, mode: 'record', status: 'running', runId: 'record:1' },
    };
    const after = appReducer(before, {
      type: 'message',
      message: { v: 1, type: 'run-start', runId: 'run:test', mode: 'live', startedAt: 2 },
    });
    expect(after.run).toMatchObject({ mode: 'live', status: 'idle' });
  });

  it('keeps a replay step as the parent of its actions instead of parenting it to itself', () => {
    const history = execution('history-run', 'history-runtime', 'history-session');
    const state: AppState = {
      ...initialAppState,
      executions: [history],
      selectedExecutionId: history.executionId,
      evidence: {
        kind: 'replay',
        runId: 'history-run',
        executionId: history.executionId,
        replay: {
          traceRef: '/tmp/history.twtrace',
          overview: overview('/tmp/history.twtrace', 'history-session'),
          frames: emptyFrames,
          commands: [
            { id: 'r0', kind: 'step', t: 1, label: 'approve', stepId: 's1', depth: 0 },
            { id: 'r1', kind: 'action', t: 2, label: 'press', stepId: 's1', depth: 1, ok: true },
          ],
          traceState: emptyTraceState,
          logs: emptyLogs,
          timeMs: 0,
          playing: false,
          speed: 1,
          loading: false,
          error: null,
        },
      },
    };
    expect(nodesForSelected(state)).toMatchObject([
      { nodeId: 'replay-step:s1', parentId: 'body' },
      { nodeId: 'replay:r1', parentId: 'replay-step:s1' },
    ]);
  });

  it('replaces a selected replay identity with an explicit loading/error state', () => {
    const first = execution('history-a', 'runtime-a', 'session-a');
    const second = {
      ...execution('history-b', 'runtime-b', 'session-b'),
      executionId: 'history-b:runtime-b:1',
      traceRef: '/tmp/b.twtrace',
    };
    let state: AppState = {
      ...initialAppState,
      executions: [first, second],
      selectedExecutionId: first.executionId,
      evidence: {
        kind: 'replay',
        runId: 'history-a',
        executionId: first.executionId,
        replay: {
          traceRef: first.traceRef as string,
          overview: overview(first.traceRef as string, 'session-a'),
          frames: emptyFrames,
          commands: [{ id: 'a', kind: 'action', label: 'old replay action', t: 1, depth: 0 }],
          traceState: emptyTraceState,
          logs: emptyLogs,
          timeMs: 0,
          playing: false,
          speed: 1,
          loading: false,
          error: null,
        },
      },
    };
    state = appReducer(state, { type: 'select-execution', executionId: second.executionId });
    expect(state.evidence).toEqual({
      kind: 'live',
      runId: 'history-b',
      executionId: second.executionId,
    });
    expect(nodesForSelected(state)).toEqual([]);
    state = appReducer(state, {
      type: 'replay-loading',
      executionId: second.executionId,
      traceRef: '/tmp/b.twtrace',
    });
    expect(state.evidence).toEqual({
      kind: 'replay-loading',
      runId: 'history-b',
      executionId: second.executionId,
      traceRef: '/tmp/b.twtrace',
    });
    state = appReducer(state, {
      type: 'replay-error',
      executionId: second.executionId,
      traceRef: '/tmp/b.twtrace',
      error: 'trace not found',
    });
    expect(state.evidence).toEqual({
      kind: 'replay-error',
      runId: 'history-b',
      executionId: second.executionId,
      traceRef: '/tmp/b.twtrace',
      error: 'trace not found',
    });
    expect(nodesForSelected(state)).toEqual([]);
  });

  it('keeps native retry history on one settled execution', () => {
    let state: AppState = {
      ...initialAppState,
      run: { ...initialAppState.run, runId: 'run:retry', status: 'running' },
    };
    state = start(state, 'retry-runtime', 'retry-session', 1);
    state = appReducer(state, {
      type: 'message',
      message: {
        v: 1,
        type: 'test-end',
        id: 'retry-runtime',
        status: 'passed',
        durationMs: 90,
        flaky: true,
        lostLogRecords: 0,
        attempt: 3,
        priorFailures: [
          { attempt: 1, errors: ['first failure'] },
          { attempt: 2, errors: ['second failure'] },
        ],
      },
    });
    expect(state.executions).toHaveLength(1);
    expect(state.executions[0]).toMatchObject({ status: 'passed', attempt: 3, flaky: true });
    expect(state.executions[0]?.priorFailures).toEqual([
      { attempt: 1, errors: ['first failure'] },
      { attempt: 2, errors: ['second failure'] },
    ]);
  });
});

function start(state: AppState, runtimeId: string, sessionId: string, startedAt: number): AppState {
  let next = appReducer(state, {
    type: 'message',
    message: {
      v: 1,
      type: 'test-start',
      id: runtimeId,
      runnerTaskId: `runner-task:${runtimeId}`,
      title: 'case',
      file: '/repo/case.test.ts',
      startedAt,
      sessionId,
    },
  });
  next = appReducer(next, {
    type: 'message',
    message: {
      v: 1,
      type: 'session',
      sessionId,
      testId: runtimeId,
      terminalProfile: 'default',
      columns: 80,
      rows: 24,
    },
  });
  return next;
}

function execution(runId: string, runtimeId: string, sessionId: string): ExecutionCase {
  return {
    caseKey: '/repo/case.test.ts::case',
    runId,
    executionId: `${runId}:${runtimeId}:1`,
    runtimeId,
    provider: null,
    kind: 'test',
    title: 'historical case',
    ancestors: [],
    tags: [],
    source: { file: '/repo/case.test.ts' },
    status: 'passed',
    attempt: 1,
    priorFailures: [],
    flaky: false,
    lostLogRecords: 0,
    sessionIds: [sessionId],
    traceRef: '/tmp/history.twtrace',
    nodes: [],
  };
}

const emptyFrames: TraceFrames = { frames: [], truncated: false, durationMs: 100, revisions: [] };
const emptyTraceState: TraceStatePayload = {
  timeMs: 0,
  castPrefixB64: '',
  columns: 80,
  rows: 24,
  revision: null,
  snapshot: null,
  step: null,
};
const emptyLogs: TraceLogs = {
  records: [],
  hasMoreBefore: false,
  hasMoreAfter: false,
  total: 0,
  truncated: false,
  dropped: 0,
  available: false,
  sources: [],
  levels: {},
};

function overview(path: string, sessionId: string): TraceOverview {
  return {
    path,
    sessionId,
    command: ['node', 'app.mjs'],
    columns: 80,
    rows: 24,
    startedAt: 1,
    durationMs: 100,
    semanticTree: false,
    contract: null,
    terminalProfile: 'default',
    exit: { code: 0, signal: null },
    lostLogRecords: 0,
    steps: [],
    crash: null,
    markers: [],
  };
}
