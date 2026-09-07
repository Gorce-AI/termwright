/** Native run-history projections consumed by the Runner UI. */

import {
  readRunHistory as readNativeRunHistory,
  readRunManifest as readNativeRunManifest,
  type NativeRunAttempt,
  type NativeRunStatus,
  type RunHistoryRecord,
  type RunManifest as NativeRunManifest,
} from '@termwright/run-history';
import { openTrace } from '@termwright/trace';
import { parseRunId, type RunId } from '@termwright/protocol/run-events';

export { RUN_MANIFEST_VERSION } from '@termwright/run-history';
export const DEFAULT_RUNS_DIR = '.termwright/runs';

export interface RunRecording {
  readonly path: string;
  readonly sessionId: string;
  readonly available: boolean;
  readonly reason?: string;
}

export interface RunTestAttempt {
  readonly executionId: string;
  readonly recordings: readonly RunRecording[];
  readonly attemptId: string;
  readonly repeat: number;
  readonly retry: number;
  readonly status: NativeRunAttempt['status'];
  readonly durationMs: number | null;
}

export interface RunTest {
  readonly id: string;
  readonly specId: string;
  readonly title: string;
  readonly file: string;
  readonly status: NativeRunAttempt['status'] | 'not-run';
  readonly durationMs: number | null;
  readonly flaky: boolean;
  readonly attempts: readonly RunTestAttempt[];
}

export interface RunSummary {
  readonly status: NativeRunStatus;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly incomplete: number;
  readonly notRun: number;
  readonly flaky: number;
  readonly durationMs: number;
}

export interface RunManifest {
  readonly state: 'complete';
  readonly id: string;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly summary: RunSummary;
  readonly tests: readonly RunTest[];
  readonly git: NativeRunManifest['git'];
  readonly engine: NativeRunManifest['engine'];
  readonly runtime: NativeRunManifest['runtime'];
  readonly ci: NativeRunManifest['ci'];
  readonly resources: NativeRunManifest['resources'];
}

export type RunSummaryEntry =
  | (Omit<RunManifest, 'tests'> & { readonly testCount: number })
  | {
      readonly state: 'incomplete';
      readonly id: string;
      readonly startedAt: number;
      readonly reason: string;
    }
  | {
      readonly state: 'corrupt';
      readonly id: string;
      readonly runId: string | null;
      readonly reason: string;
    }
  | {
      readonly state: 'unsupported-version';
      readonly id: string;
      readonly runId: string | null;
      readonly version: number | null;
    };

export type RunDetail = RunManifest | Exclude<RunSummaryEntry, { readonly state: 'complete' }>;

/** Lists every native entry; failed transactions are first-class history. */
export async function readRunHistory(runsDir: string): Promise<readonly RunSummaryEntry[]> {
  return (await readNativeRunHistory(runsDir)).map(projectSummary);
}

/** Reads one canonical RunId without accepting directory or legacy timestamp ids. */
export async function readRunManifest(runsDir: string, id: string): Promise<RunDetail> {
  let runId: RunId;
  try {
    runId = parseRunId('run', id);
  } catch {
    return { state: 'corrupt', id, runId: null, reason: 'invalid canonical RunId' };
  }
  const detail = projectDetail(await readNativeRunManifest(runsDir, runId));
  if (detail.state !== 'complete') return detail;
  const unique = new Map(
    detail.tests.flatMap((test) =>
      test.attempts.flatMap((attempt) =>
        attempt.recordings.map((recording) => [recording.path, recording] as const),
      ),
    ),
  );
  const queue = [...unique.values()];
  let next = 0;
  // Avoid exhausting file descriptors when a run retains hundreds of sessions.
  await Promise.all(
    Array.from({ length: Math.min(8, queue.length) }, async () => {
      while (next < queue.length) {
        const recording = queue[next++]!;
        try {
          const reader = await openTrace(recording.path);
          await reader.close();
        } catch {
          unique.set(recording.path, {
            ...recording,
            available: false,
            reason: 'Recording is missing or unreadable. It may have been moved or removed.',
          });
        }
      }
    }),
  );
  return {
    ...detail,
    tests: detail.tests.map((test) => ({
      ...test,
      attempts: test.attempts.map((attempt) => ({
        ...attempt,
        recordings: attempt.recordings.map((recording) => ({
          ...recording,
          available: unique.get(recording.path)!.available,
          ...(unique.get(recording.path)!.reason === undefined
            ? {}
            : { reason: unique.get(recording.path)!.reason! }),
        })),
      })),
    })),
  };
}

function projectSummary(record: RunHistoryRecord): RunSummaryEntry {
  const detail = projectDetail(record);
  if (detail.state !== 'complete') return detail;
  const { tests, ...summary } = detail;
  return { ...summary, testCount: tests.length };
}

function projectDetail(record: RunHistoryRecord): RunDetail {
  switch (record.state) {
    case 'complete':
      return projectComplete(record.manifest);
    case 'incomplete':
      return {
        state: 'incomplete',
        id: record.runId,
        startedAt: record.start.startedAt,
        reason: record.reason,
      };
    case 'corrupt':
      return {
        state: 'corrupt',
        id: record.runId ?? record.directory,
        runId: record.runId,
        reason: record.reason,
      };
    case 'unsupported-version':
      return {
        state: 'unsupported-version',
        id: record.runId ?? record.directory,
        runId: record.runId,
        version: record.version,
      };
  }
}

function projectComplete(manifest: NativeRunManifest): RunManifest {
  const recordingsByAttempt = retainedRecordings(manifest);
  const skippedTasks = new Set(
    manifest.events
      .filter((event) => event.type === 'test.skipped' && event.identity.runnerTaskId !== undefined)
      .map((event) => event.identity.runnerTaskId!),
  );
  const attemptsByTask = new Map<string, NativeRunAttempt[]>();
  for (const attempt of manifest.attempts) {
    const attempts = attemptsByTask.get(attempt.runnerTaskId) ?? [];
    attempts.push(attempt);
    attemptsByTask.set(attempt.runnerTaskId, attempts);
  }
  const tests = manifest.specs.map((spec): RunTest => {
    const nativeAttempts = attemptsByTask.get(spec.runnerTaskId) ?? [];
    const attempts = nativeAttempts.map((attempt): RunTestAttempt => ({
      attemptId: attempt.attemptId,
      executionId: attempt.executionId,
      recordings: [...(recordingsByAttempt.get(attempt.attemptId)?.values() ?? [])],
      repeat: attempt.repeat,
      retry: attempt.retry,
      status: attempt.status,
      durationMs: attempt.durationMs,
    }));
    const final = nativeAttempts.at(-1);
    return {
      id: spec.runnerTaskId,
      specId: spec.specId,
      title: spec.fullName,
      file: spec.file,
      status: final?.status ?? (skippedTasks.has(spec.runnerTaskId) ? 'skipped' : 'not-run'),
      durationMs: sumDuration(nativeAttempts),
      flaky:
        final?.status === 'passed' && nativeAttempts.some((attempt) => attempt.status === 'failed'),
      attempts,
    };
  });
  return {
    state: 'complete',
    id: manifest.runId,
    startedAt: manifest.startedAt,
    finishedAt: manifest.finishedAt,
    summary: summarize(manifest, tests),
    tests,
    git: manifest.git,
    engine: manifest.engine,
    runtime: manifest.runtime,
    ci: manifest.ci,
    resources: manifest.resources,
  };
}

function summarize(manifest: NativeRunManifest, tests: readonly RunTest[]): RunSummary {
  return {
    status: manifest.status,
    total: tests.length,
    passed: tests.filter((test) => test.status === 'passed').length,
    failed: tests.filter((test) => test.status === 'failed').length,
    skipped: tests.filter((test) => test.status === 'skipped').length,
    incomplete: tests.filter((test) => test.status === 'incomplete').length,
    notRun: tests.filter((test) => test.status === 'not-run').length,
    flaky: tests.filter((test) => test.flaky).length,
    durationMs: manifest.durationMs,
  };
}

function sumDuration(attempts: readonly NativeRunAttempt[]): number | null {
  const durations = attempts.map((attempt) => attempt.durationMs);
  return durations.some((duration) => duration === null)
    ? null
    : durations.reduce<number>((total, duration) => total + (duration ?? 0), 0);
}

/** References come from the committed journal, never from titles or directory scans. */
function retainedRecordings(
  manifest: NativeRunManifest,
): ReadonlyMap<string, ReadonlyMap<string, RunRecording>> {
  const recordings = new Map<string, Map<string, RunRecording>>();
  const attempts = new Map(manifest.attempts.map((attempt) => [attempt.attemptId, attempt]));
  for (const event of manifest.events) {
    const attempt =
      event.identity.attemptId === undefined ? undefined : attempts.get(event.identity.attemptId);
    if (
      attempt === undefined ||
      event.type !== 'trace.finalized' ||
      event.eventClass !== 'authoritative' ||
      event.identity.attemptId !== attempt.attemptId ||
      event.identity.executionId !== attempt.executionId ||
      event.identity.runnerTaskId !== attempt.runnerTaskId ||
      event.identity.sessionId === undefined
    )
      continue;
    const payload = event.payload;
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('traceRef' in payload) ||
      typeof payload.traceRef !== 'string' ||
      payload.traceRef === ''
    )
      continue;
    const path = payload.traceRef;
    const retained = recordings.get(attempt.attemptId) ?? new Map<string, RunRecording>();
    retained.set(path, { path, sessionId: event.identity.sessionId, available: true });
    recordings.set(attempt.attemptId, retained);
  }
  return recordings;
}
