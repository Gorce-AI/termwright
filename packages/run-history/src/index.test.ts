import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
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
  type RunStartProvenance,
} from './index.js';

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe('native run history transaction', () => {
  it('prepares durably and becomes complete only after the atomic commit', async () => {
    const runs = await runsDirectory();
    const start = provenance();
    const transaction = await beginRunManifest(runs, start);
    await transaction.prepare(manifest(start));
    expect(await readRunHistory(runs)).toMatchObject([{ state: 'incomplete', runId: start.runId }]);
    const path = await transaction.commitPrepared();
    expect(path).toBe(join(runs, runDirectoryName(start.runId), 'manifest.json'));
    expect(await readRunManifest(runs, start.runId)).toMatchObject({
      state: 'complete', runId: start.runId, manifest: { invocationId: start.invocationId },
    });
    await expect(transaction.commitPrepared()).rejects.toThrow(/not prepared/u);
  });

  it('surfaces partial, truncated, digest-mismatched and unsupported histories', async () => {
    const runs = await runsDirectory();
    const partial = provenance();
    await beginRunManifest(runs, partial);

    const truncated = provenance();
    const truncatedDirectory = join(runs, runDirectoryName(truncated.runId));
    await mkdir(truncatedDirectory);
    await writeFile(join(truncatedDirectory, 'manifest.json'), '{"v":1', 'utf8');
    await writeFile(join(truncatedDirectory, 'COMMITTED'), marker(createHash('sha256').update('{"v":1').digest('hex')), 'utf8');

    const mismatched = provenance();
    const mismatchTransaction = await beginRunManifest(runs, mismatched);
    await mismatchTransaction.commit(manifest(mismatched));
    await writeFile(join(runs, runDirectoryName(mismatched.runId), 'COMMITTED'), marker('0'.repeat(64)), 'utf8');

    const unsupported = provenance();
    const unsupportedDirectory = join(runs, runDirectoryName(unsupported.runId));
    await mkdir(unsupportedDirectory);
    const unsupportedBody = `${JSON.stringify({ ...manifest(unsupported), v: 99 })}\n`;
    await writeFile(join(unsupportedDirectory, 'manifest.json'), unsupportedBody, 'utf8');
    await writeFile(join(unsupportedDirectory, 'COMMITTED'),
      marker(createHash('sha256').update(unsupportedBody).digest('hex')), 'utf8');

    const records = await readRunHistory(runs);
    expect(records.find((record) => record.runId === partial.runId)?.state).toBe('incomplete');
    expect(records.find((record) => 'directory' in record && record.directory === runDirectoryName(truncated.runId))?.state).toBe('corrupt');
    expect(records.find((record) => 'directory' in record && record.directory === runDirectoryName(mismatched.runId))?.state).toBe('corrupt');
    expect(records.find((record) => record.runId === unsupported.runId)).toMatchObject({
      state: 'unsupported-version', version: 99,
    });
  });

  it('rejects the same RunId concurrently and permits independent canonical IDs', async () => {
    const runs = await runsDirectory();
    const same = provenance();
    const collisions = await Promise.allSettled([
      beginRunManifest(runs, same), beginRunManifest(runs, same),
    ]);
    expect(collisions.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(collisions.filter((result) => result.status === 'rejected')).toHaveLength(1);

    const first = provenance(); const second = provenance();
    const [one, two] = await Promise.all([beginRunManifest(runs, first), beginRunManifest(runs, second)]);
    await Promise.all([one.commit(manifest(first)), two.commit(manifest(second))]);
    expect((await readRunHistory(runs)).filter((record) => record.state === 'complete')).toHaveLength(2);
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
    expect(await readRunManifest(runs, start.runId)).toMatchObject({ state: 'incomplete', runId: start.runId });
  });

  it('rejects a manifest whose status is not proven by its canonical journal', () => {
    const start = provenance();
    const passed = manifest(start);
    expect(parseManifest(JSON.stringify({ ...passed, status: 'failed' })).state).toBe('corrupt');
    expect(parseManifest(JSON.stringify({ ...passed, status: 'incomplete' })).state).toBe('corrupt');
    const correction = new RunEventProducer({ producerId: createRunId('producer'), epoch: 0 }).emit({
      eventClass: 'authoritative', type: 'run.persistence-failed',
      identity: { invocationId: start.invocationId, runId: start.runId },
      payload: { stage: 'canonical-run-history', detail: 'fault' },
    });
    expect(parseManifest(JSON.stringify({ ...passed, status: 'incomplete', events: [...passed.events, correction] })).state)
      .toBe('complete');
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
    invocationId: createRunId('invocation'), runId: createRunId('run'), startedAt: Date.now(),
    engine: { name: 'vitest', version: '3.2.7', certification: 'termwright-vitest-3.2.7' },
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    resources: {
      profile: 'test',
      scheduler: { pool: 'forks', maxWorkers: 2, fileParallelism: true },
      capacities: { ptySession: 2 },
      perTerminal: { ptySession: 1 },
    },
    timeouts: { totalRunMs: 60_000, finalizationReserveMs: 5_000 },
    ci: {}, git: null,
  };
}

function manifest(start: RunStartProvenance): RunManifest {
  const projectId = createRunId('project');
  const specId = createRunId('spec');
  const runnerTaskId = createRunId('runner-task');
  const attemptId = createRunId('attempt');
  const executionId = createRunId('execution');
  let clock = 0;
  const producer = new RunEventProducer({ producerId: createRunId('producer'), epoch: 0, monotonicNow: () => {
    clock += clock === 1 ? 4 : 1;
    return clock;
  } });
  const identity = { invocationId: start.invocationId, runId: start.runId, projectId, specId, runnerTaskId, executionId, attemptId };
  return {
    ...start, v: RUN_MANIFEST_VERSION, finishedAt: start.startedAt + 5, status: 'passed',
    specs: [{ runnerTaskId, specId, projectId, nativeTaskId: 'native_0', file: 'example.test.ts', fullName: 'works' }],
    attempts: [{ attemptId, executionId, runnerTaskId,
      projectId, specId, nativeTaskId: 'native_0', repeat: 0, retry: 0, status: 'passed', durationMs: 4 }],
    events: [producer.emit({
      eventClass: 'authoritative', type: 'attempt.started', identity,
      payload: { nativeTaskId: 'native_0', repeat: 0, retry: 0 },
    }), producer.emit({
      eventClass: 'authoritative', type: 'attempt.finished', identity,
      payload: { nativeTaskId: 'native_0', repeat: 0, retry: 0, state: 'passed' },
    }), producer.emit({
      eventClass: 'authoritative', type: 'run.state',
      identity: { invocationId: start.invocationId, runId: start.runId }, payload: { state: 'passed' },
    })],
  };
}

function nodeWriter(): RunManifestWriter {
  return {
    async mkdir(path, options) { await mkdir(path, options); },
    async exists(path) { try { await stat(path); return true; } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    } },
    async writeExclusive(path, body) { await writeFile(path, body, { encoding: 'utf8', flag: 'wx' }); },
    async syncDirectory() {},
    async rename(source, destination) { await rename(source, destination); },
  };
}

function marker(digest: string): string { return `termwright-run-history-v1 sha256:${digest}\n`; }
