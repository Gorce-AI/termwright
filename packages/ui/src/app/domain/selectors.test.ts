import { describe, expect, it } from 'vitest';
import type { ExecutionCase } from './model.js';
import { initialAppState } from './model.js';
import { catalogCases, currentRunCases } from './selectors.js';

describe('currentRunCases', () => {
  it('shows only the latest attempt for each stable case key', () => {
    const first = execution('case:a', 'attempt:1', 1, 'failed');
    const second = execution('case:a', 'attempt:2', 2, 'passed');
    const other = execution('case:b', 'attempt:b', 1, 'running');
    const cases = currentRunCases({
      ...initialAppState,
      run: { ...initialAppState.run, runId: 'run:1', status: 'running' },
      executions: [first, second, other],
    });
    expect(cases.map((test) => test.executionId)).toEqual(['attempt:2', 'attempt:b']);
  });

  it('keeps an exact requested scope and includes unexpected backend truth explicitly', () => {
    const a = execution('case:a', 'attempt:a', 1, 'passed');
    const unexpected = execution('case:c', 'attempt:c', 1, 'running');
    const catalogA = catalog('case:a');
    const catalogB = catalog('case:b');
    const catalogC = catalog('case:c');
    const catalogOutside = catalog('case:outside');

    const cases = currentRunCases({
      ...initialAppState,
      run: { ...initialAppState.run, runId: 'run:1', status: 'running', requestedTargets: ['case:a', 'case:b'] },
      catalog: [catalogA, catalogB, catalogC, catalogOutside],
      executions: [a, unexpected],
    });

    expect(cases.map((test) => test.caseKey)).toEqual(['case:a', 'case:c', 'case:b']);
    expect(cases.find((test) => test.caseKey === 'case:c')?.scopeMismatch).toBe(true);
    expect(cases.find((test) => test.caseKey === 'case:b')?.status).toBe('queued');
    expect(cases.some((test) => test.caseKey === 'case:outside')).toBe(false);
  });

  it('does not expand an active exact scope when discovery adds another case', () => {
    const state = {
      ...initialAppState,
      run: { ...initialAppState.run, runId: 'run:1', status: 'running' as const, requestedTargets: ['case:a'] },
      catalog: [catalog('case:a'), catalog('case:new')],
    };
    expect(currentRunCases(state).map((test) => test.caseKey)).toEqual(['case:a']);
  });

  it('treats an empty request as the full current CLI catalogue and never reuses old statuses', () => {
    const old = { ...execution('case:a', 'old-attempt', 1, 'passed'), runId: 'run:old' };
    const cases = currentRunCases({
      ...initialAppState,
      run: { ...initialAppState.run, runId: 'run:new', status: 'running', requestedTargets: [] },
      catalog: [catalog('case:a'), catalog('case:b')],
      executions: [old],
    });
    expect(cases.map((test) => [test.caseKey, test.status])).toEqual([
      ['case:a', 'queued'],
      ['case:b', 'queued'],
    ]);
  });

  it('keeps Specs on the full catalogue while exposing each latest known result', () => {
    const latestA = { ...execution('case:a', 'latest-a', 2, 'passed'), runId: 'run:2', startedAt: 20 };
    const cases = catalogCases({
      ...initialAppState,
      run: { ...initialAppState.run, runId: 'run:2', requestedTargets: ['case:a'] },
      catalog: [catalog('case:a'), catalog('case:b')],
      executions: [latestA, { ...execution('case:a', 'old-a', 1, 'failed'), runId: 'run:1', startedAt: 10 }],
    });
    expect(cases.map((test) => [test.caseKey, test.status])).toEqual([
      ['case:a', 'passed'],
      ['case:b', 'queued'],
    ]);
  });
});

function catalog(caseKey: string): ExecutionCase {
  return {
    ...execution(caseKey, `catalog:${caseKey}`, 0, 'queued'),
    runId: null,
  };
}

function execution(caseKey: string, executionId: string, attempt: number, status: ExecutionCase['status']): ExecutionCase {
  return {
    caseKey,
    runId: 'run:1',
    executionId,
    provider: '@termwright/test',
    kind: 'test',
    title: caseKey,
    ancestors: [],
    tags: [],
    source: { file: `${caseKey}.test.ts` },
    status,
    attempt,
    priorFailures: [],
    flaky: false,
    lostLogRecords: 0,
    sessionIds: [],
    nodes: [],
  };
}
