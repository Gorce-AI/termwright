import type { CommandRow } from '../../commands.js';
import type { TestCounts } from '../../test-model.js';
import type { TraceOverview } from '../../trace-source.js';
import type { AppState, ExecutionCase, ExecutionNode, SessionRecord } from './model.js';

export function selectedCase(state: AppState): ExecutionCase | null {
  return (
    state.executions.find((test) => test.executionId === state.selectedExecutionId) ??
    state.catalog.find((test) => test.executionId === state.selectedExecutionId) ??
    null
  );
}

/** Full stable catalogue with the latest reported status for each case. */
export function catalogCases(state: AppState): readonly ExecutionCase[] {
  const latestByCase = new Map<string, ExecutionCase>();
  for (const test of state.executions) {
    const current = latestByCase.get(test.caseKey);
    if (current === undefined || newerExecution(test, current))
      latestByCase.set(test.caseKey, test);
  }
  return state.catalog.map((test) => latestByCase.get(test.caseKey) ?? test);
}

function newerExecution(candidate: ExecutionCase, current: ExecutionCase): boolean {
  const candidateStarted = candidate.startedAt ?? Number.NEGATIVE_INFINITY;
  const currentStarted = current.startedAt ?? Number.NEGATIVE_INFINITY;
  return (
    candidateStarted > currentStarted ||
    (candidateStarted === currentStarted && candidate.attempt >= current.attempt)
  );
}

/** Current run attempts followed by stable catalogue entries that have not run yet. */
export function currentRunCases(state: AppState): readonly ExecutionCase[] {
  const currentByCase = new Map<string, ExecutionCase>();
  const requested = state.run.requestedTargets;
  const exactScope = requested !== null && requested.length > 0 ? new Set(requested) : null;
  for (const test of state.executions) {
    if (test.runId !== state.run.runId) continue;
    const previous = currentByCase.get(test.caseKey);
    const scoped =
      exactScope !== null && !exactScope.has(test.caseKey)
        ? { ...test, scopeMismatch: true }
        : test;
    if (previous === undefined || test.attempt >= previous.attempt)
      currentByCase.set(test.caseKey, scoped);
  }
  const current = [...currentByCase.values()];
  const touched = new Set(current.map((test) => test.caseKey));
  const catalogue = state.catalog.filter(
    (test) => !touched.has(test.caseKey) && (exactScope === null || exactScope.has(test.caseKey)),
  );
  return [...current, ...catalogue];
}

export function selectedSession(state: AppState): SessionRecord | null {
  if (state.selectedSessionId === null) return null;
  return state.sessions[state.selectedSessionId] ?? null;
}

export function caseCounts(cases: readonly ExecutionCase[]): TestCounts {
  const counts = {
    total: cases.length,
    passed: 0,
    failed: 0,
    skipped: 0,
    flaky: 0,
    running: 0,
    cancelled: 0,
    notRun: 0,
  };
  for (const test of cases) {
    if (test.status === 'queued') counts.notRun += 1;
    else counts[test.status] += 1;
    if (test.flaky) counts.flaky += 1;
  }
  return counts;
}

export function nodesForSelected(state: AppState): readonly ExecutionNode[] {
  if (state.evidence.kind !== 'replay') return selectedCase(state)?.nodes ?? [];
  return state.evidence.replay.commands.map((row) =>
    commandNode(row, state.evidence.kind === 'replay' ? state.evidence.replay.overview.steps : []),
  );
}

function commandNode(row: CommandRow, steps: TraceOverview['steps']): ExecutionNode {
  const gherkin =
    row.stepId === undefined
      ? undefined
      : steps.find((step) => step.stepId === row.stepId)?.gherkin;
  return {
    nodeId: row.kind === 'step' ? `replay-step:${row.stepId ?? row.id}` : `replay:${row.id}`,
    parentId:
      row.kind === 'step' || row.stepId === undefined ? 'body' : `replay-step:${row.stepId}`,
    kind: row.kind === 'assert' ? 'assertion' : row.kind,
    label: row.label,
    status:
      row.ok === false
        ? 'failed'
        : row.endT === undefined && row.kind === 'step'
          ? 'running'
          : 'passed',
    startMs: row.t,
    ...(row.endT === undefined ? {} : { endMs: row.endT }),
    ...(row.selector === undefined ? {} : { selector: row.selector }),
    ...(row.ref === undefined ? {} : { targetRef: row.ref }),
    ...(row.error === undefined ? {} : { error: row.error }),
    ...(row.actionPlan === undefined ? {} : { actionPlan: row.actionPlan }),
    ...(row.actionability === undefined ? {} : { actionability: row.actionability }),
    ...(gherkin === undefined || row.kind !== 'step' ? {} : { gherkin }),
  };
}
