import { createRunId, RunEventProducer } from '@termwright/protocol/run-events';
import {
  RUN_MANIFEST_VERSION,
  beginRunManifest,
  type NativeRunStatus,
  type NativeRunAttempt,
  type RunStartProvenance,
  type RunResourceTelemetry,
} from '@termwright/run-history';

export interface NativeRunFixtureTest {
  readonly title: string;
  readonly file: string;
  readonly status: 'passed' | 'failed' | 'skipped' | 'incomplete';
  readonly durationMs?: number | null;
  readonly retries?: readonly ('failed' | 'passed' | 'skipped' | 'incomplete')[];
}

export const fixtureRunTelemetry = (): RunResourceTelemetry => ({
  coordinatorCpuUserMicros: 1,
  coordinatorCpuSystemMicros: 1,
  coordinatorRssStartBytes: 1,
  coordinatorRssEndBytes: 1,
  coordinatorPeakSampledRssBytes: 1,
  workerPeakRssBytes: 'unavailable',
  ownedProcessPeakRssBytes: 'unavailable',
  ownedProcessCountPeak: 'unavailable',
  ptySlotsPeak: 0,
  terminalOutputBytes: 'unavailable',
  semanticBytes: 'unavailable',
  semanticFullCount: 'unavailable',
  semanticDeltaCount: 'unavailable',
  journalAcceptedEvents: 0,
  journalAcceptedBytes: 0,
  journalSinkCalls: 0,
  journalPeakBacklogEvents: 0,
  journalPeakBacklogBytes: 0,
  traceBytes: 'unavailable',
  tempDiskPeakBytes: 'unavailable',
  finalArtifactBytes: 'unavailable',
});

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
    invocationId: createRunId('invocation'),
    runId: createRunId('run'),
    startedAt,
    // Deliberately not a real engine version. This is a viewer fixture, and a
    // genuine version here reads as a claim about what Termwright certifies —
    // which is how this file went on naming 3.2.7 for months after the engine
    // moved on.
    engine: {
      name: 'vitest',
      version: '0.0.0-fixture',
      certification: 'termwright-vitest-fixture',
    },
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    resources: {
      profile: 'default',
      scheduler: { pool: 'forks', maxWorkers: 1, fileParallelism: true },
      capacities: { ptySession: 1 },
      perAttempt: {},
      perTerminal: { ptySession: 1 },
    },
    timeouts: { totalRunMs: 60_000, finalizationReserveMs: 5_000 },
    ci: {},
    git: null,
  };
  const specs = [];
  const attempts = [];
  let attemptOffsetMs = 0;
  for (const [index, test] of options.tests.entries()) {
    const projectId = createRunId('project');
    const specId = createRunId('spec');
    const runnerTaskId = createRunId('runner-task');
    const nativeTaskId = `fixture-${index}`;
    specs.push({
      runnerTaskId,
      projectId,
      specId,
      nativeTaskId,
      file: test.file,
      fullName: test.title,
    });
    if (test.status === 'skipped') continue;
    const states = test.retries ?? [test.status];
    for (const [retry, status] of states.entries()) {
      const durationMs = retry === states.length - 1 ? (test.durationMs ?? 0) : 1;
      attempts.push({
        attemptId: createRunId('attempt'),
        executionId: createRunId('execution'),
        runnerTaskId,
        projectId,
        specId,
        nativeTaskId,
        repeat: 0,
        retry,
        status,
        startedAfterRunMs: attemptOffsetMs,
        finishedAfterRunMs: status === 'incomplete' ? null : attemptOffsetMs + durationMs,
        durationMs: status === 'incomplete' ? null : durationMs,
      });
      attemptOffsetMs += durationMs;
    }
  }
  const duration = attemptOffsetMs;
  const skippedCount = options.tests.filter((test) => test.status === 'skipped').length;
  const status =
    options.status ??
    (options.tests.some((test) => test.status === 'failed')
      ? 'failed'
      : skippedCount === options.tests.length
        ? 'skipped'
        : skippedCount > 0
          ? 'passed-with-skips'
          : 'passed');
  let monotonicTime = 1;
  const producer = new RunEventProducer({
    producerId: createRunId('producer'),
    epoch: 0,
    monotonicNow: () => monotonicTime,
  });
  const events = [];
  for (const attempt of attempts as NativeRunAttempt[]) {
    const identity = {
      invocationId: start.invocationId,
      runId: start.runId,
      projectId: attempt.projectId,
      specId: attempt.specId,
      runnerTaskId: attempt.runnerTaskId,
      executionId: attempt.executionId,
      attemptId: attempt.attemptId,
    };
    const payload = {
      nativeTaskId: attempt.nativeTaskId,
      repeat: attempt.repeat,
      retry: attempt.retry,
    };
    events.push(
      producer.emit({ eventClass: 'authoritative', type: 'attempt.started', identity, payload }),
    );
    if (attempt.status !== 'incomplete') {
      monotonicTime += attempt.durationMs ?? 0;
      events.push(
        producer.emit({
          eventClass: 'authoritative',
          type: 'attempt.finished',
          identity,
          payload: { ...payload, state: attempt.status },
        }),
      );
    }
    monotonicTime += 1;
  }
  for (const [index, test] of options.tests.entries()) {
    if (test.status !== 'skipped') continue;
    const spec = specs[index]!;
    const identity = {
      invocationId: start.invocationId,
      runId: start.runId,
      projectId: spec.projectId,
      specId: spec.specId,
      runnerTaskId: spec.runnerTaskId,
    };
    events.push(
      producer.emit({
        eventClass: 'authoritative',
        type: 'run.skip-declaration',
        identity: { invocationId: start.invocationId, runId: start.runId },
        payload: {
          id: `fixture-skip-${index}`,
          file: spec.file,
          fullName: spec.fullName,
          required: true,
        },
      }),
    );
    events.push(
      producer.emit({
        eventClass: 'authoritative',
        type: 'test.skipped',
        identity,
        payload: { nativeTaskId: spec.nativeTaskId, file: spec.file, fullName: spec.fullName },
      }),
    );
  }
  events.push(
    producer.emit({
      eventClass: 'authoritative',
      type: 'run.skip-policy',
      identity: { invocationId: start.invocationId, runId: start.runId },
      payload: { status: 'matched', declarations: skippedCount, observed: skippedCount, issues: 0 },
    }),
  );
  events.push(
    producer.emit({
      eventClass: 'authoritative',
      type: 'run.state',
      identity: { invocationId: start.invocationId, runId: start.runId },
      payload: { state: status },
    }),
  );
  await (
    await beginRunManifest(runsDir, start)
  ).commit({
    ...start,
    v: RUN_MANIFEST_VERSION,
    finishedAt: startedAt + duration,
    durationMs: duration,
    status,
    specs,
    attempts,
    telemetry: fixtureRunTelemetry(),
    events,
  });
  return start.runId;
}
