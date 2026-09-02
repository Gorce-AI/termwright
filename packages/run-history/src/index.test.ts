import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRunId, RunEventProducer } from '@termwright/protocol/run-events';
import {
  RUN_MANIFEST_VERSION,
  beginRunManifest,
  parseManifest,
  readRunHistory,
  readRunManifest,
  runDirectoryName,
  type RunManifest,
  type RunManifestWriter,
  type RunResourceTelemetry,
  type RunStartProvenance,
} from './index.js';

const directories: string[] = [];
const fixtureTelemetry = (): RunResourceTelemetry => ({
  coordinatorCpuUserMicros: 1,
  coordinatorCpuSystemMicros: 1,
  coordinatorRssStartBytes: 1,
  coordinatorRssEndBytes: 1,
  coordinatorPeakSampledRssBytes: 1,
  workerPeakRssBytes: 64 * 1024 * 1024,
  workerCpuUserMicros: 100,
  workerCpuSystemMicros: 20,
  ownedProcessPeakRssBytes: 'unavailable',
  ownedProcessCountPeak: 'unavailable',
  ptySlotsPeak: 0,
  terminalOutputBytes: 'unavailable',
  semanticBytes: 'unavailable',
  semanticFullCount: 'unavailable',
  semanticDeltaCount: 'unavailable',
  journalAcceptedEvents: 3,
  journalAcceptedBytes: 1,
  journalSinkCalls: 1,
  journalPeakBacklogEvents: 3,
  journalPeakBacklogBytes: 1,
  traceBytes: 'unavailable',
  tempDiskPeakBytes: 'unavailable',
  finalArtifactBytes: 'unavailable',
});
afterEach(async () =>
  Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))),
);

describe('native run history transaction', () => {
  it('prepares and becomes complete only after the atomic commit', async () => {
    const runs = await runsDirectory();
    const start = provenance();
    const transaction = await beginRunManifest(runs, start, { writer: nodeWriter() });
    const value = manifest(start);
    await transaction.appendEvents(value.events);
    await transaction.prepare(value);
    expect(await readRunHistory(runs)).toMatchObject([{ state: 'incomplete', runId: start.runId }]);
    const path = await transaction.commitPrepared();
    expect(path).toBe(join(runs, runDirectoryName(start.runId), 'manifest.json'));
    const record = await readRunManifest(runs, start.runId);
    expect(record).toMatchObject({
      state: 'complete',
      runId: start.runId,
      manifest: {
        invocationId: start.invocationId,
        eventStream: { file: 'events.ndjson', count: value.events.length },
      },
    });
    const persisted = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    expect(persisted).not.toHaveProperty('events');
    expect(
      Buffer.byteLength(
        await readFile(join(runs, runDirectoryName(start.runId), 'events.ndjson'), 'utf8'),
      ),
    ).toBe((persisted['eventStream'] as { bytes: number }).bytes);
    await expect(transaction.commitPrepared()).rejects.toThrow(/not prepared/u);
  });

  it('surfaces partial, truncated, digest-mismatched and unsupported histories', async () => {
    const runs = await runsDirectory();
    const partial = provenance();
    await beginRunManifest(runs, partial, { writer: nodeWriter() });

    const truncated = provenance();
    const truncatedDirectory = join(runs, runDirectoryName(truncated.runId));
    await mkdir(truncatedDirectory);
    await writeFile(join(truncatedDirectory, 'manifest.json'), '{"v":1', 'utf8');
    await writeFile(
      join(truncatedDirectory, 'COMMITTED'),
      marker(createHash('sha256').update('{"v":1').digest('hex')),
      'utf8',
    );

    const mismatched = provenance();
    const mismatchTransaction = await beginRunManifest(runs, mismatched, { writer: nodeWriter() });
    const mismatchedManifest = manifest(mismatched);
    await mismatchTransaction.appendEvents(mismatchedManifest.events);
    await mismatchTransaction.commit(mismatchedManifest);
    await writeFile(
      join(runs, runDirectoryName(mismatched.runId), 'COMMITTED'),
      marker('0'.repeat(64)),
      'utf8',
    );

    const tampered = provenance();
    const tamperedManifest = manifest(tampered);
    const tamperedTransaction = await beginRunManifest(runs, tampered, { writer: nodeWriter() });
    await tamperedTransaction.appendEvents(tamperedManifest.events);
    await tamperedTransaction.commit(tamperedManifest);
    await appendFile(join(runs, runDirectoryName(tampered.runId), 'events.ndjson'), '{}\n', 'utf8');

    const unsupported = provenance();
    const unsupportedDirectory = join(runs, runDirectoryName(unsupported.runId));
    await mkdir(unsupportedDirectory);
    const unsupportedBody = `${JSON.stringify({ ...manifest(unsupported), v: 99 })}\n`;
    await writeFile(join(unsupportedDirectory, 'manifest.json'), unsupportedBody, 'utf8');
    await writeFile(
      join(unsupportedDirectory, 'COMMITTED'),
      marker(createHash('sha256').update(unsupportedBody).digest('hex')),
      'utf8',
    );

    const records = await readRunHistory(runs);
    expect(records.find((record) => record.runId === partial.runId)?.state).toBe('incomplete');
    expect(
      records.find(
        (record) => 'directory' in record && record.directory === runDirectoryName(truncated.runId),
      )?.state,
    ).toBe('corrupt');
    expect(
      records.find(
        (record) =>
          'directory' in record && record.directory === runDirectoryName(mismatched.runId),
      )?.state,
    ).toBe('corrupt');
    expect(records.find((record) => record.runId === tampered.runId)?.state).toBe('corrupt');
    expect(records.find((record) => record.runId === unsupported.runId)).toMatchObject({
      state: 'unsupported-version',
      version: 99,
    });
  });

  it('rejects the same RunId concurrently and permits independent canonical IDs', async () => {
    const runs = await runsDirectory();
    const same = provenance();
    const collisions = await Promise.allSettled([
      beginRunManifest(runs, same, { writer: nodeWriter() }),
      beginRunManifest(runs, same, { writer: nodeWriter() }),
    ]);
    expect(collisions.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(collisions.filter((result) => result.status === 'rejected')).toHaveLength(1);

    const first = provenance();
    const second = provenance();
    const [one, two] = await Promise.all([
      beginRunManifest(runs, first, { writer: nodeWriter() }),
      beginRunManifest(runs, second, { writer: nodeWriter() }),
    ]);
    const firstManifest = manifest(first);
    const secondManifest = manifest(second);
    await Promise.all([
      one.appendEvents(firstManifest.events),
      two.appendEvents(secondManifest.events),
    ]);
    await Promise.all([one.commit(firstManifest), two.commit(secondManifest)]);
    expect(
      (await readRunHistory(runs)).filter((record) => record.state === 'complete'),
    ).toHaveLength(2);
  });

  it('leaves an explicit incomplete transaction when finalization hits ENOSPC', async () => {
    const runs = await runsDirectory();
    const start = provenance();
    const base = nodeWriter();
    const writer: RunManifestWriter = {
      ...base,
      async writeExclusive(path, body) {
        if (path.endsWith('manifest.json')) {
          const error = new Error('disk full') as NodeJS.ErrnoException;
          error.code = 'ENOSPC';
          throw error;
        }
        await base.writeExclusive(path, body);
      },
    };
    const transaction = await beginRunManifest(runs, start, { writer });
    await expect(transaction.prepare(manifest(start))).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(await readRunManifest(runs, start.runId)).toMatchObject({
      state: 'incomplete',
      runId: start.runId,
    });
  });

  it('rejects a manifest whose status is not proven by its canonical journal', () => {
    const start = provenance();
    const passed = manifest(start);
    expect(parseManifest(JSON.stringify({ ...passed, status: 'failed' })).state).toBe('corrupt');
    expect(parseManifest(JSON.stringify({ ...passed, status: 'incomplete' })).state).toBe(
      'corrupt',
    );
    const correction = new RunEventProducer({ producerId: createRunId('producer'), epoch: 0 }).emit(
      {
        eventClass: 'authoritative',
        type: 'run.persistence-failed',
        identity: { invocationId: start.invocationId, runId: start.runId },
        payload: { stage: 'canonical-run-history', detail: 'fault' },
      },
    );
    expect(
      parseManifest(
        JSON.stringify({
          ...passed,
          status: 'incomplete',
          eventStream: { ...passed.eventStream, count: passed.events.length + 1 },
          events: [...passed.events, correction],
        }),
      ).state,
    ).toBe('complete');
  });

  it('requires explicit unavailable resource metrics instead of fabricated zeroes', () => {
    const start = provenance();
    const valid = manifest(start);
    expect(valid.telemetry.workerPeakRssBytes).toBe(64 * 1024 * 1024);
    expect(
      parseManifest(
        JSON.stringify({
          ...valid,
          telemetry: { ...valid.telemetry, coordinatorRssEndBytes: -1 },
        }),
      ).state,
    ).toBe('corrupt');
    const missing = { ...valid.telemetry } as Record<string, unknown>;
    delete missing['ownedProcessPeakRssBytes'];
    expect(parseManifest(JSON.stringify({ ...valid, telemetry: missing })).state).toBe('corrupt');
    expect(
      parseManifest(
        JSON.stringify({
          ...valid,
          telemetry: {
            ...valid.telemetry,
            workerCpuUserMicros: (valid.telemetry.workerCpuUserMicros as number) + 1,
          },
        }),
      ).state,
    ).toBe('corrupt');
    expect(
      parseManifest(
        JSON.stringify({
          ...valid,
          events: valid.events.map((event) =>
            event.type === 'attempt.finished'
              ? { ...event, payload: { ...(event.payload as object), worker: undefined } }
              : event,
          ),
        }),
      ).state,
    ).toBe('corrupt');
  });

  it('requires current monotonic run and attempt timing evidence', () => {
    const current = manifest(provenance());
    const { durationMs: _duration, ...missingDuration } = current;
    expect(parseManifest(JSON.stringify(missingDuration)).state).toBe('corrupt');
    const attemptWithoutFinishOffset = current.attempts.map(
      ({ finishedAfterRunMs: _finished, ...attempt }) => attempt,
    );
    expect(
      parseManifest(JSON.stringify({ ...current, attempts: attemptWithoutFinishOffset })).state,
    ).toBe('corrupt');
    expect(parseManifest(JSON.stringify({ ...current, v: 2 })).state).toBe('unsupported-version');
    expect(parseManifest(JSON.stringify({ ...current, durationMs: -1 })).state).toBe('corrupt');
    expect(
      parseManifest(
        JSON.stringify({
          ...current,
          attempts: current.attempts.map((attempt) => ({
            ...attempt,
            startedAfterRunMs: current.durationMs + 1,
          })),
        }),
      ).state,
    ).toBe('corrupt');
    expect(
      parseManifest(
        JSON.stringify({
          ...current,
          attempts: current.attempts.map((attempt) => ({ ...attempt, finishedAfterRunMs: 0 })),
        }),
      ).state,
    ).toBe('corrupt');
    expect(
      parseManifest(
        JSON.stringify({
          ...current,
          attempts: current.attempts.map((attempt) => ({
            ...attempt,
            finishedAfterRunMs: current.durationMs + 1,
          })),
        }),
      ).state,
    ).toBe('corrupt');
  });

  it('rejects changed attempt hierarchy and events emitted after attempt completion', () => {
    const start = provenance();
    const passed = manifest(start);
    const attemptStart = passed.events.find((event) => event.type === 'attempt.started')!;
    const attemptFinish = passed.events.findIndex((event) => event.type === 'attempt.finished');
    const diagnostics = new RunEventProducer({ producerId: createRunId('producer'), epoch: 0 });
    const changedHierarchy = diagnostics.emit({
      eventClass: 'diagnostic',
      type: 'diagnostic.fixture',
      identity: { ...attemptStart.identity, executionId: createRunId('execution') },
      payload: {},
    });
    expect(
      parseManifest(
        JSON.stringify({
          ...passed,
          events: [
            ...passed.events.slice(0, attemptFinish),
            changedHierarchy,
            ...passed.events.slice(attemptFinish),
          ],
        }),
      ).state,
    ).toBe('corrupt');

    const lateEvent = diagnostics.emit({
      eventClass: 'diagnostic',
      type: 'diagnostic.fixture',
      identity: attemptStart.identity,
      payload: {},
    });
    expect(
      parseManifest(
        JSON.stringify({
          ...passed,
          events: [
            ...passed.events.slice(0, attemptFinish + 1),
            lateEvent,
            ...passed.events.slice(attemptFinish + 1),
          ],
        }),
      ).state,
    ).toBe('corrupt');
  });

  it('rejects missing, duplicate, count-mismatched and plain-green skip evidence', () => {
    const start = provenance();
    const passed = manifest(start);
    const aggregateIndex = passed.events.findIndex((event) => event.type === 'run.skip-policy');
    const aggregate = passed.events[aggregateIndex]!;
    expect(
      parseManifest(
        JSON.stringify({
          ...passed,
          events: passed.events.filter((event) => event !== aggregate),
        }),
      ).state,
    ).toBe('corrupt');
    expect(
      parseManifest(
        JSON.stringify({
          ...passed,
          events: [
            ...passed.events.slice(0, aggregateIndex),
            aggregate,
            aggregate,
            ...passed.events.slice(aggregateIndex + 1),
          ],
        }),
      ).state,
    ).toBe('corrupt');
    expect(
      parseManifest(
        JSON.stringify({
          ...passed,
          events: passed.events.map((event) =>
            event === aggregate
              ? {
                  ...event,
                  payload: { status: 'matched', declarations: 0, observed: 1, issues: 0 },
                }
              : event,
          ),
        }),
      ).state,
    ).toBe('corrupt');

    const skippedSpec = {
      runnerTaskId: createRunId('runner-task'),
      specId: createRunId('spec'),
      projectId: createRunId('project'),
      nativeTaskId: 'native_skipped',
      file: 'platform.test.ts',
      fullName: 'platform case',
    };
    const skipped = new RunEventProducer({ producerId: createRunId('producer'), epoch: 0 }).emit({
      eventClass: 'authoritative',
      type: 'test.skipped',
      identity: {
        invocationId: start.invocationId,
        runId: start.runId,
        projectId: skippedSpec.projectId,
        specId: skippedSpec.specId,
        runnerTaskId: skippedSpec.runnerTaskId,
      },
      payload: {
        nativeTaskId: skippedSpec.nativeTaskId,
        file: skippedSpec.file,
        fullName: skippedSpec.fullName,
      },
    });
    const forgedGreen = {
      ...passed,
      specs: [...passed.specs, skippedSpec],
      events: [
        ...passed.events.slice(0, aggregateIndex),
        skipped,
        { ...aggregate, payload: { status: 'matched', declarations: 0, observed: 1, issues: 0 } },
        ...passed.events.slice(aggregateIndex + 1),
      ],
    };
    expect(parseManifest(JSON.stringify(forgedGreen)).state).toBe('corrupt');
    const yellow = {
      ...forgedGreen,
      status: 'passed-with-skips' as const,
      eventStream: { ...forgedGreen.eventStream, count: forgedGreen.events.length },
      events: forgedGreen.events.map((event) =>
        event.type === 'run.state' ? { ...event, payload: { state: 'passed-with-skips' } } : event,
      ),
    };
    expect(parseManifest(JSON.stringify(yellow)).state).toBe('complete');
  });
});

async function runsDirectory(): Promise<string> {
  const path = join(tmpdir(), `termwright-runs-${randomUUID()}`);
  directories.push(path);
  await mkdir(path);
  return path;
}

function provenance(): RunStartProvenance {
  return {
    invocationId: createRunId('invocation'),
    runId: createRunId('run'),
    startedAt: Date.now(),
    engine: { name: 'vitest', version: '4.1.11', certification: 'termwright-vitest-4.1.11' },
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    resources: {
      profile: 'test',
      scheduler: { pool: 'forks', maxWorkers: 2, fileParallelism: true },
      capacities: { ptySession: 2 },
      perAttempt: {},
      perTerminal: { ptySession: 1 },
    },
    timeouts: { totalRunMs: 60_000, finalizationReserveMs: 5_000 },
    ci: {},
    git: null,
  };
}

function manifest(start: RunStartProvenance): RunManifest {
  const projectId = createRunId('project');
  const specId = createRunId('spec');
  const runnerTaskId = createRunId('runner-task');
  const attemptId = createRunId('attempt');
  const executionId = createRunId('execution');
  let clock = 0;
  const producer = new RunEventProducer({
    producerId: createRunId('producer'),
    epoch: 0,
    monotonicNow: () => {
      clock += clock === 1 ? 4 : 1;
      return clock;
    },
  });
  const identity = {
    invocationId: start.invocationId,
    runId: start.runId,
    projectId,
    specId,
    runnerTaskId,
    executionId,
    attemptId,
  };
  return {
    ...start,
    v: RUN_MANIFEST_VERSION,
    finishedAt: start.startedAt + 5,
    durationMs: 5,
    status: 'passed',
    specs: [
      {
        runnerTaskId,
        specId,
        projectId,
        nativeTaskId: 'native_0',
        file: 'example.test.ts',
        fullName: 'works',
      },
    ],
    attempts: [
      {
        attemptId,
        executionId,
        runnerTaskId,
        projectId,
        specId,
        nativeTaskId: 'native_0',
        repeat: 0,
        retry: 0,
        status: 'passed',
        startedAfterRunMs: 1,
        finishedAfterRunMs: 5,
        durationMs: 4,
      },
    ],
    telemetry: fixtureTelemetry(),
    eventStream: {
      file: 'events.ndjson',
      count: 4,
      bytes: 0,
      sha256: '0'.repeat(64),
    },
    events: [
      producer.emit({
        eventClass: 'authoritative',
        type: 'attempt.started',
        identity,
        payload: { nativeTaskId: 'native_0', repeat: 0, retry: 0 },
      }),
      producer.emit({
        eventClass: 'authoritative',
        type: 'attempt.finished',
        identity,
        payload: {
          nativeTaskId: 'native_0',
          repeat: 0,
          retry: 0,
          state: 'passed',
          worker: {
            capability: 'worker-process',
            cpuUserMicros: 100,
            cpuSystemMicros: 20,
            peakSampledRssBytes: 64 * 1024 * 1024,
          },
        },
      }),
      producer.emit({
        eventClass: 'authoritative',
        type: 'run.skip-policy',
        identity: { invocationId: start.invocationId, runId: start.runId },
        payload: { status: 'matched', declarations: 0, observed: 0, issues: 0 },
      }),
      producer.emit({
        eventClass: 'authoritative',
        type: 'run.state',
        identity: { invocationId: start.invocationId, runId: start.runId },
        payload: { state: 'passed' },
      }),
    ],
  };
}

function nodeWriter(): RunManifestWriter {
  return {
    async mkdir(path, options) {
      await mkdir(path, options);
    },
    async exists(path) {
      try {
        await stat(path);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }
    },
    async writeExclusive(path, body) {
      await writeFile(path, body, { encoding: 'utf8', flag: 'wx' });
    },
    async append(path, body) {
      await appendFile(path, body, 'utf8');
    },
    async syncFile() {},
    async syncDirectory() {},
    async rename(source, destination) {
      await rename(source, destination);
    },
  };
}

function marker(digest: string): string {
  return `termwright-run-history-v2 sha256:${digest}\n`;
}
