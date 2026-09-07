import type { RunManifest, RunTest, RunTestAttempt, RunRecording } from '../../runs.js';
import type { ExecutionCase } from './model.js';

export function historyExecution(
  run: RunManifest,
  test: RunTest,
  attempt: RunTestAttempt,
  recording: RunRecording,
): ExecutionCase {
  return {
    caseKey: test.id,
    runId: run.id,
    executionId: attempt.executionId,
    provider: null,
    kind: 'test',
    title: test.title,
    ancestors: [],
    tags: [],
    source: { file: test.file },
    status: attempt.status === 'incomplete' ? 'failed' : attempt.status,
    attempt: attempt.retry + 1,
    priorFailures: [],
    startedAt: run.startedAt,
    ...(attempt.durationMs === null ? {} : { durationMs: attempt.durationMs }),
    flaky: test.flaky,
    lostLogRecords: 0,
    sessionIds: [],
    traceRef: recording.path,
    nodes: [],
  };
}
