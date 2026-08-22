import { createRunId, RunEventProducer } from '@termwright/protocol/run-events';
import {
  RUN_MANIFEST_VERSION,
  beginRunManifest,
  type NativeRunStatus,
  type NativeRunAttempt,
  type RunStartProvenance,
} from '@termwright/run-history';

export interface NativeRunFixtureTest {
  readonly title: string;
  readonly file: string;
  readonly status: 'passed' | 'failed' | 'skipped' | 'incomplete';
  readonly durationMs?: number | null;
  readonly retries?: readonly ('failed' | 'passed' | 'skipped' | 'incomplete')[];
}

/** Creates only the current native-host schema; never a reporter/legacy manifest. */
export async function writeNativeRunFixture(
  runsDir: string,
  options: {
    readonly startedAt?: number;
    readonly status?: NativeRunStatus;
    readonly tests: readonly NativeRunFixtureTest[];
  },
): Promise<string> {
  const startedAt = options.startedAt ?? Date.now();
  const start: RunStartProvenance = {
    invocationId: createRunId('invocation'), runId: createRunId('run'), startedAt,
    engine: { name: 'vitest', version: '3.2.7', certification: 'termwright-vitest-3.2.7' },
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    resources: {
      profile: 'default', scheduler: { pool: 'forks', maxWorkers: 1, fileParallelism: true },
      capacities: { ptySession: 1 }, perTerminal: { ptySession: 1 },
    },
    timeouts: { totalRunMs: 60_000, finalizationReserveMs: 5_000 },
    ci: {}, git: null,
  };
  const specs = [];
  const attempts = [];
  for (const [index, test] of options.tests.entries()) {
    const projectId = createRunId('project');
    const specId = createRunId('spec');
    const runnerTaskId = createRunId('runner-task');
    const nativeTaskId = `fixture-${index}`;
    specs.push({ runnerTaskId, projectId, specId, nativeTaskId, file: test.file, fullName: test.title });
    const states = test.retries ?? [test.status];
    for (const [retry, status] of states.entries()) {
      attempts.push({
        attemptId: createRunId('attempt'), executionId: createRunId('execution'), runnerTaskId, projectId, specId,
        nativeTaskId, repeat: 0, retry, status,
        durationMs: retry === states.length - 1 ? (test.durationMs ?? 0) : 1,
      });
    }
  }
  const duration = attempts.reduce((total, attempt) => total + (attempt.durationMs ?? 0), 0);
  const status = options.status ?? (options.tests.some((test) => test.status === 'failed') ? 'failed' : 'passed');
  let monotonicTime = 1;
  const producer = new RunEventProducer({
    producerId: createRunId('producer'), epoch: 0, monotonicNow: () => monotonicTime,
  });
  const events = [];
  for (const attempt of attempts as NativeRunAttempt[]) {
    const identity = { invocationId: start.invocationId, runId: start.runId, projectId: attempt.projectId,
      specId: attempt.specId, runnerTaskId: attempt.runnerTaskId, executionId: attempt.executionId, attemptId: attempt.attemptId };
    const payload = { nativeTaskId: attempt.nativeTaskId, repeat: attempt.repeat, retry: attempt.retry };
    events.push(producer.emit({ eventClass: 'authoritative', type: 'attempt.started', identity, payload }));
    if (attempt.status !== 'incomplete') {
      monotonicTime += attempt.durationMs ?? 0;
      events.push(producer.emit({ eventClass: 'authoritative', type: 'attempt.finished', identity,
        payload: { ...payload, state: attempt.status } }));
    }
    monotonicTime += 1;
  }
  events.push(producer.emit({
    eventClass: 'authoritative', type: 'run.state',
    identity: { invocationId: start.invocationId, runId: start.runId }, payload: { state: status },
  }));
  await (await beginRunManifest(runsDir, start)).commit({
    ...start, v: RUN_MANIFEST_VERSION, finishedAt: startedAt + duration,
    status,
    specs, attempts, events,
  });
  return start.runId;
}
