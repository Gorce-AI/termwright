import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRunId, RunEventProducer, type RunEvent } from '@termwright/protocol/run-events';
import {
  RUN_MANIFEST_VERSION,
  beginRunManifest,
  runDirectoryName,
  type RunManifest as NativeRunManifest,
  type RunStartProvenance,
} from '@termwright/run-history';
import { readRunHistory, readRunManifest } from './runs.js';

describe('native run history UI projection', () => {
  it('projects exact specs, attempts, flaky state and captured provenance', async () => {
    const dir = await emptyDir();
    const start = provenance(100);
    const native = manifest(start);
    await (await beginRunManifest(dir, start)).commit(native);

    const [summary] = await readRunHistory(dir);
    expect(summary).toMatchObject({
      state: 'complete',
      id: start.runId,
      testCount: 1,
      summary: { status: 'flaky', total: 1, passed: 1, failed: 0, flaky: 1, durationMs: 10 },
      engine: start.engine,
      runtime: start.runtime,
      resources: start.resources,
    });
    const detail = await readRunManifest(dir, start.runId);
    expect(detail).toMatchObject({
      state: 'complete',
      id: start.runId,
      tests: [
        {
          id: native.specs[0]?.runnerTaskId,
          specId: native.specs[0]?.specId,
          title: 'suite > works',
          file: '/repo/example.test.ts',
          status: 'passed',
          durationMs: 7,
          flaky: true,
          attempts: [
            {
              attemptId: native.attempts[0]?.attemptId,
              repeat: 0,
              retry: 0,
              status: 'failed',
              durationMs: 3,
            },
            {
              attemptId: native.attempts[1]?.attemptId,
              repeat: 0,
              retry: 1,
              status: 'passed',
              durationMs: 4,
            },
          ],
        },
      ],
    });
  });

  it('surfaces incomplete, corrupt and unsupported entries instead of skipping them', async () => {
    const dir = await emptyDir();
    const partial = provenance(300);
    await beginRunManifest(dir, partial);

    const corrupt = createRunId('run');
    const corruptDir = join(dir, runDirectoryName(corrupt));
    await mkdir(corruptDir);
    await writeFile(join(corruptDir, 'manifest.json'), '{', 'utf8');
    await writeFile(join(corruptDir, 'COMMITTED'), 'bad\n', 'utf8');

    const unsupported = provenance(200);
    const unsupportedDir = join(dir, runDirectoryName(unsupported.runId));
    await mkdir(unsupportedDir);
    const body = `${JSON.stringify({ ...manifest(unsupported), v: 99 })}\n`;
    const digest = createHash('sha256').update(body).digest('hex');
    await writeFile(join(unsupportedDir, 'manifest.json'), body, 'utf8');
    await writeFile(
      join(unsupportedDir, 'COMMITTED'),
      `termwright-run-history-v1 sha256:${digest}\n`,
      'utf8',
    );

    expect((await readRunHistory(dir)).map((run) => run.state).sort()).toEqual([
      'corrupt',
      'incomplete',
      'unsupported-version',
    ]);
  });

  it('rejects legacy timestamps and path-shaped ids at the projection boundary', async () => {
    const dir = await emptyDir();
    await expect(readRunManifest(dir, '2026-08-16T10-00-00-000Z')).resolves.toMatchObject({
      state: 'corrupt',
      reason: 'invalid canonical RunId',
    });
    await expect(readRunManifest(dir, '../../etc')).resolves.toMatchObject({
      state: 'corrupt',
      reason: 'invalid canonical RunId',
    });
  });
});

async function emptyDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'tw-ui-native-runs-'));
}

function provenance(startedAt: number): RunStartProvenance {
  return {
    invocationId: createRunId('invocation'),
    runId: createRunId('run'),
    startedAt,
    engine: { name: 'vitest', version: '4.1.11', certification: 'termwright-vitest-4.1.11' },
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    resources: {
      profile: 'default',
      scheduler: { pool: 'forks', maxWorkers: 2, fileParallelism: true },
      capacities: { ptySession: 2 },
      perTerminal: { ptySession: 1 },
    },
    timeouts: { totalRunMs: 60_000, finalizationReserveMs: 5_000 },
    ci: { CI: 'true' },
    git: { commit: 'abcdef1', message: 'native host', author: 'Ada', branch: 'main' },
  };
}

function manifest(start: RunStartProvenance): NativeRunManifest {
  const projectId = createRunId('project');
  const specId = createRunId('spec');
  const runnerTaskId = createRunId('runner-task');
  const attempts = [
    {
      attemptId: createRunId('attempt'),
      executionId: createRunId('execution'),
      runnerTaskId,
      projectId,
      specId,
      nativeTaskId: 'vitest-task',
      repeat: 0,
      retry: 0,
      status: 'failed',
      startedAfterRunMs: 1,
      finishedAfterRunMs: 4,
      durationMs: 3,
    },
    {
      attemptId: createRunId('attempt'),
      executionId: createRunId('execution'),
      runnerTaskId,
      projectId,
      specId,
      nativeTaskId: 'vitest-task',
      repeat: 0,
      retry: 1,
      status: 'passed',
      startedAfterRunMs: 5,
      finishedAfterRunMs: 9,
      durationMs: 4,
    },
  ] as const;
  let monotonicTime = 1;
  const producer = new RunEventProducer({
    producerId: createRunId('producer'),
    epoch: 0,
    monotonicNow: () => monotonicTime,
  });
  const events: RunEvent[] = attempts.flatMap((attempt) => {
    const identity = {
      invocationId: start.invocationId,
      runId: start.runId,
      projectId,
      specId,
      runnerTaskId,
      executionId: attempt.executionId,
      attemptId: attempt.attemptId,
    };
    const payload = {
      nativeTaskId: attempt.nativeTaskId,
      repeat: attempt.repeat,
      retry: attempt.retry,
    };
    const started = producer.emit({
      eventClass: 'authoritative',
      type: 'attempt.started',
      identity,
      payload,
    });
    monotonicTime += attempt.durationMs;
    const finished = producer.emit({
      eventClass: 'authoritative',
      type: 'attempt.finished',
      identity,
      payload: { ...payload, state: attempt.status },
    });
    monotonicTime += 1;
    return [started, finished];
  });
  events.push(
    producer.emit({
      eventClass: 'authoritative',
      type: 'run.skip-policy',
      identity: { invocationId: start.invocationId, runId: start.runId },
      payload: { status: 'matched', declarations: 0, observed: 0, issues: 0 },
    }),
  );
  events.push(
    producer.emit({
      eventClass: 'authoritative',
      type: 'run.state',
      identity: { invocationId: start.invocationId, runId: start.runId },
      payload: { state: 'flaky' },
    }),
  );
  return {
    ...start,
    v: RUN_MANIFEST_VERSION,
    finishedAt: start.startedAt + 10_000,
    durationMs: 10,
    status: 'flaky',
    specs: [
      {
        runnerTaskId,
        projectId,
        specId,
        nativeTaskId: 'vitest-task',
        file: '/repo/example.test.ts',
        fullName: 'suite > works',
      },
    ],
    attempts,
    events,
  };
}
