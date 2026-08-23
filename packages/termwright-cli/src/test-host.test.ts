import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createRunId,
  RunEventProducer,
  RunIdFactory,
  type RunnerTaskId,
} from '@termwright/protocol';
import { connectRunJournalWorker } from '@termwright/run-journal-transport';
import { connectResourceBrokerWorker } from '@termwright/resource-broker/transport';
import { NODE_RUN_MANIFEST_WRITER, readRunManifest } from '@termwright/run-history';
import type { TermwrightRunnerContext } from '@termwright/test/runner';
import type { UserConsoleLog } from 'vitest';
import type { TestCase, TestRunResult } from 'vitest/node';
import {
  TermwrightTestHost,
  TERMWRIGHT_RESOURCE_PROFILES,
  describeFailure,
  type TermwrightVitestEngine,
} from './test-host.js';
import { CERTIFIED_VITEST_VERSION } from '@termwright/test/vitest-engine';

class FakeEngine implements TermwrightVitestEngine {
  readonly version = CERTIFIED_VITEST_VERSION;
  contexts: TermwrightRunnerContext[] = [];
  cancellations = 0;
  closes = 0;
  collectionErrors: unknown[] = [];
  tests: TestCase[] = [];
  runResult: TestRunResult = result([]);
  blockRun: Promise<void> | undefined;
  omitFinished = false;
  leakLease = false;
  sourceListener: ((file: string) => void) | undefined;
  consoleListener: ((log: UserConsoleLog) => void) | undefined;
  consoleContent: string | undefined;

  setRunnerContext(context: TermwrightRunnerContext): void {
    this.contexts.push(context);
  }

  async collect(): Promise<{ result: TestRunResult; tests: readonly TestCase[] }> {
    return { result: result(this.tests, this.collectionErrors), tests: this.tests };
  }

  async run(): Promise<TestRunResult> {
    await this.blockRun;
    const context = this.contexts.at(-1);
    if (context === undefined) throw new Error('fake engine has no runner context');
    const now = performance.timeOrigin + performance.now();
    const client = await connectRunJournalWorker({
      endpoint: context.journal.endpoint,
      token: context.journal.token,
      runId: context.runId,
      workerId: 'fake-engine:pool:worker:1',
      workerEpoch: context.broker.workerEpoch,
      handshakeDeadline: now + context.journal.handshakeTimeoutMs,
    });
    const producer = new RunEventProducer({
      producerId: client.binding.producerId,
      epoch: client.binding.producerEpoch,
    });
    const broker = await connectResourceBrokerWorker({
      endpoint: context.broker.endpoint,
      token: context.broker.token,
      runId: context.runId,
      workerId: 'fake-engine:pool:worker:1',
      workerEpoch: context.broker.workerEpoch,
      handshakeDeadline: now + context.broker.handshakeTimeoutMs,
    });
    const ids = new RunIdFactory();
    try {
      for (const [nativeTaskId, identity] of Object.entries(context.tasks)) {
        const executionId = ids.create('execution');
        const attemptId = ids.create('attempt');
        const eventIdentity = {
          invocationId: context.invocationId,
          runId: context.runId,
          projectId: identity.projectId,
          specId: identity.specId,
          runnerTaskId: identity.runnerTaskId,
          executionId,
          attemptId,
        } as const;
        await client.append(producer.emit({
          eventClass: 'authoritative',
          type: 'attempt.started',
          identity: eventIdentity,
          payload: { nativeTaskId, repeat: 0, retry: 0 },
        }), performance.timeOrigin + performance.now() + context.journal.acknowledgementTimeoutMs);
        if (this.consoleContent !== undefined) {
          this.consoleListener?.({
            content: this.consoleContent,
            type: 'stdout',
            taskId: nativeTaskId,
            time: Date.now(),
            size: Buffer.byteLength(this.consoleContent),
          });
        }
        if (this.leakLease) {
          await broker.acquire({
            attemptId,
            resources: { semanticEndpoint: 1 },
            deadline: performance.timeOrigin + performance.now() + 5_000,
          });
        }
        const state = this.tests.find((test) => test.id === nativeTaskId)?.result()?.state === 'failed' ? 'failed' : 'passed';
        if (!this.omitFinished) {
          await client.append(producer.emit({
            eventClass: 'authoritative',
            type: 'attempt.finished',
            identity: eventIdentity,
            payload: { nativeTaskId, repeat: 0, retry: 0, state },
          }), performance.timeOrigin + performance.now() + context.journal.acknowledgementTimeoutMs);
        }
      }
    } finally {
      await client.close();
      await broker.close();
    }
    return this.runResult;
  }

  async cancel(): Promise<void> {
    this.cancellations += 1;
  }

  onSourceChange(listener: (file: string) => void): () => void {
    this.sourceListener = listener;
    return () => { this.sourceListener = undefined; };
  }

  onUserConsoleLog(listener: (log: UserConsoleLog) => void): () => void {
    this.consoleListener = listener;
    return () => { this.consoleListener = undefined; };
  }

  async close(): Promise<void> {
    this.closes += 1;
  }
}

describe('TermwrightTestHost', () => {
  it('uses one total host deadline and reserves bounded cancellation/finalization time', async () => {
    const engine = new FakeEngine();
    engine.tests = [testCase('native-hung', 'hung worker')];
    engine.runResult = result(engine.tests);
    engine.blockRun = new Promise(() => undefined);
    const host = TermwrightTestHost.fromEngine(engine, {
      ...hostOptions(),
      // The budget under test is the one spent executing. Real run-history
      // I/O is not part of that and is slow enough on a loaded Windows runner
      // to consume the whole 250 ms before execution starts, which reported
      // the deadline against "run history startup" instead. An in-memory
      // writer removes that variable without touching what is asserted.
      runManifestWriter: MEMORY_RUN_MANIFEST_WRITER,
      timeouts: { runMs: 250, finalizationReserveMs: 100 },
    });
    const started = performance.now();

    const completion = await host.requestRun().completed;

    expect(completion.state).toBe('infrastructure-failed');
    expect(completion.events.find((event) => event.type === 'run.infrastructure-failed')?.payload)
      .toMatchObject({ category: 'timeout' });
    expect((completion.events.find((event) => event.type === 'run.infrastructure-failed')?.payload as { detail: string }).detail)
      .toContain('Vitest execution');
    expect(engine.cancellations).toBe(1);
    expect(performance.now() - started).toBeLessThan(1_000);
    await host.close();
  });

  it('journals structured test output with the exact active AttemptId and bounded chunks', async () => {
    const engine = new FakeEngine();
    engine.tests = [testCase('native-output', 'writes output')];
    engine.runResult = result(engine.tests);
    engine.consoleContent = `prefix:${'🧪'.repeat(7_000)}:suffix`;
    const host = TermwrightTestHost.fromEngine(engine, hostOptions());

    const completion = await host.requestRun().completed;

    expect(completion.state).toBe('passed');
    const started = completion.events.find((event) => event.type === 'attempt.started');
    const output = completion.events.filter((event) => event.type === 'test.output');
    expect(output.length).toBeGreaterThan(1);
    expect(output.map((event) => String((event.payload as { content: string }).content)).join(''))
      .toBe(engine.consoleContent);
    expect(output.map((event) => event.identity.attemptId)).toEqual(
      output.map(() => started?.identity.attemptId),
    );
    expect(output.every((event) => event.identity.runnerTaskId === started?.identity.runnerTaskId)).toBe(true);
    expect(output.every((event) => (event.payload as { taskAttributed: boolean }).taskAttributed)).toBe(true);
    expect(output.every((event) => Buffer.byteLength(JSON.stringify(event)) < 256 * 1024)).toBe(true);
    await host.close();
  });

  it('uses native task ids and keeps duplicate titles distinct across runs', async () => {
    const engine = new FakeEngine();
    engine.tests = [testCase('native-a', 'duplicate title'), testCase('native-b', 'duplicate title')];
    engine.runResult = result(engine.tests);
    const host = TermwrightTestHost.fromEngine(engine, hostOptions());
    const firstHandle = host.requestRun();
    expect(firstHandle.runId).toMatch(/^run:/u);
    const first = await firstHandle.completed;
    expect(first.state).toBe('passed');
    expect(first.catalog?.tests.map((test) => test.fullName)).toEqual(['duplicate title', 'duplicate title']);
    expect(new Set(first.catalog?.tests.map((test) => test.runnerTaskId)).size).toBe(2);

    const selected = first.catalog?.tests[1]?.runnerTaskId as RunnerTaskId;
    const second = await host.requestRun({ runnerTaskIds: [selected] }).completed;
    expect(second.state).toBe('passed');
    const execution = engine.contexts.at(-1);
    expect(Object.keys(execution?.tasks ?? {})).toEqual(['native-b']);
    expect(execution?.tasks['native-b']?.runnerTaskId).toBe(selected);
    expect(second.runId).not.toBe(first.runId);
    expect(second.invocationId).toBe(first.invocationId);
    expect(second.events
      .filter((event) => event.type === 'run.configuration' || event.type === 'run.state')
      .map((event) => event.payload)).toEqual([
      {
        engine: { name: 'vitest', version: CERTIFIED_VITEST_VERSION },
        runtime: { node: process.version, platform: process.platform, arch: process.arch },
        resourceProfile: {
          name: 'local',
          scheduler: { pool: 'forks', maxWorkers: 4, fileParallelism: true },
          capacities: { ptySession: 4, externalProcess: 4, semanticEndpoint: 4, traceWriter: 4 },
          perTerminal: { semanticEndpoint: 1 },
        },
        timeouts: { totalRunMs: 600_000, finalizationReserveMs: 30_000 },
      },
      { state: 'requested' },
      { state: 'collecting' },
      { state: 'scheduled' },
      { state: 'running' },
      { state: 'finalizing' },
      { state: 'passed' },
    ]);
    expect(second.events.filter((event) => event.type.startsWith('attempt.')).map((event) => event.type))
      .toEqual(['attempt.started', 'attempt.finished']);
    await host.close();
  });

  it('collects and executes pure Vitest cases without Termwright provider metadata', async () => {
    const engine = new FakeEngine();
    const pureUnit = testCase('native-unit', 'pure unit', 'passed', 0, false);
    engine.tests = [pureUnit];
    engine.runResult = result([pureUnit]);
    const host = TermwrightTestHost.fromEngine(engine, hostOptions());
    const completion = await host.requestRun().completed;
    expect(completion.state).toBe('passed');
    expect(completion.catalog?.tests).toHaveLength(1);
    expect(completion.catalog?.tests[0]).toMatchObject({
      nativeTaskId: 'native-unit',
      fullName: 'pure unit',
      metadata: {},
    });
    expect(Object.keys(engine.contexts.at(-1)?.tasks ?? {})).toEqual(['native-unit']);
    await host.close();
  });

  it('collects without execution through the legal scheduled/finalizing lifecycle', async () => {
    const engine = new FakeEngine();
    engine.tests = [testCase('native-discovery', 'discovered only')];
    const host = TermwrightTestHost.fromEngine(engine, hostOptions());
    const completion = await host.requestRun({ execute: false }).completed;
    expect(completion.state).toBe('skipped');
    expect(engine.contexts.at(-1)?.tasks).toEqual({});
    expect(completion.events.filter((event) => event.type === 'run.state').map((event) => event.payload)).toEqual([
      { state: 'requested' },
      { state: 'collecting' },
      { state: 'scheduled' },
      { state: 'finalizing' },
      { state: 'skipped' },
    ]);
    await host.close();
  });

  it('returns flaky instead of certifying a retry-green result', async () => {
    const engine = new FakeEngine();
    const retried = testCase('native-retry', 'eventually passes', 'passed', 1);
    engine.tests = [retried];
    engine.runResult = result([retried]);
    const host = TermwrightTestHost.fromEngine(engine, hostOptions());
    expect((await host.requestRun().completed).state).toBe('flaky');
    await host.close();
  });

  it('does not report an all-skipped native run as passed', async () => {
    const engine = new FakeEngine();
    const skipped = testCase('native-skipped', 'not applicable', 'skipped');
    engine.tests = [skipped];
    engine.runResult = result([skipped]);
    const host = TermwrightTestHost.fromEngine(engine, hostOptions());
    expect((await host.requestRun().completed).state).toBe('skipped');
    await host.close();
  });

  it('preserves Vitest transport errors without coercing null-prototype objects', async () => {
    const engine = new FakeEngine();
    const transported = Object.assign(Object.create(null) as Record<string, unknown>, {
      message: 'assertion transported from worker',
      stack: 'AssertionError: assertion transported from worker\n    at example.test.ts:1:1',
    });
    const failed = testCase('native-failed', 'failed case', 'failed', 0, true, [transported]);
    engine.tests = [failed];
    engine.runResult = result([failed]);
    const host = TermwrightTestHost.fromEngine(engine, hostOptions());
    const completion = await host.requestRun().completed;
    expect(completion.state).toBe('failed');
    expect(completion.failures[0]?.errors[0]).toContain('assertion transported from worker');
    await host.close();
  });

  it('atomically commits native identity, attempts and the canonical terminal journal', async () => {
    const engine = new FakeEngine();
    engine.tests = [testCase('native-history', 'persist me')];
    engine.runResult = result(engine.tests);
    const options = hostOptions();
    const host = TermwrightTestHost.fromEngine(engine, options);
    const completion = await host.requestRun().completed;
    const record = await readRunManifest(options.runsDir, completion.runId);
    expect(record.state).toBe('complete');
    if (record.state !== 'complete') throw new Error('expected committed history');
    expect(record.manifest).toMatchObject({
      runId: completion.runId,
      invocationId: completion.invocationId,
      status: 'passed',
      engine: { name: 'vitest', version: CERTIFIED_VITEST_VERSION },
      runtime: { node: process.version, platform: process.platform, arch: process.arch },
    });
    expect(record.manifest.attempts[0]?.attemptId).toMatch(/^attempt:/u);
    expect(record.manifest.events.at(-1)).toMatchObject({ type: 'run.state', payload: { state: 'passed' } });
    await host.close();
  });

  it('classifies collection faults as infrastructure and journal faults as incomplete', async () => {
    const collectionEngine = new FakeEngine();
    collectionEngine.collectionErrors = [new Error('worker channel closed')];
    const collectionHost = TermwrightTestHost.fromEngine(collectionEngine, hostOptions());
    const failed = await collectionHost.requestRun().completed;
    expect(failed.state).toBe('infrastructure-failed');
    expect(failed.error).toBeInstanceOf(AggregateError);
    expect(failed.events).toContainEqual(expect.objectContaining({
      type: 'run.infrastructure-failed',
      payload: expect.objectContaining({ category: 'collection', detail: expect.stringContaining('Vitest collection failed') }),
    }));
    await collectionHost.close();

    const sinkEngine = new FakeEngine();
    sinkEngine.tests = [testCase('native-a', 'passes')];
    sinkEngine.runResult = result(sinkEngine.tests);
    const sinkOptions = hostOptions();
    const sinkHost = TermwrightTestHost.fromEngine(sinkEngine, {
      ...sinkOptions,
      journalSink: () => {
        throw new Error('ENOSPC');
      },
    });
    const incomplete = await sinkHost.requestRun().completed;
    expect(incomplete.state).toBe('incomplete');
    expect(String(incomplete.error)).toContain('ENOSPC');
    const sinkRecord = await readRunManifest(sinkOptions.runsDir, incomplete.runId);
    expect(sinkRecord.state).toBe('complete');
    if (sinkRecord.state !== 'complete') throw new Error('expected canonical history despite projection failure');
    expect(sinkRecord.manifest.status).toBe('incomplete');
    expect(sinkRecord.manifest.events.some((event) => event.type === 'run.persistence-failed')).toBe(true);
    await sinkHost.close();
  });

  it('leaves staging history and returns incomplete when manifest finalization hits ENOSPC', async () => {
    const engine = new FakeEngine();
    engine.tests = [testCase('native-full-disk', 'disk fills')];
    engine.runResult = result(engine.tests);
    const options = hostOptions();
    const host = TermwrightTestHost.fromEngine(engine, {
      ...options,
      runManifestWriter: {
        ...NODE_RUN_MANIFEST_WRITER,
        async writeExclusive(path, body) {
          if (path.endsWith('manifest.json')) {
            const error = new Error('disk full') as NodeJS.ErrnoException;
            error.code = 'ENOSPC';
            throw error;
          }
          await NODE_RUN_MANIFEST_WRITER.writeExclusive(path, body);
        },
      },
    });
    const completion = await host.requestRun().completed;
    expect(completion.state).toBe('incomplete');
    expect(completion.events.at(-1)).toMatchObject({
      type: 'run.persistence-failed', payload: { stage: 'canonical-run-history' },
    });
    expect(await readRunManifest(options.runsDir, completion.runId)).toMatchObject({ state: 'incomplete' });
    await host.close();
  });

  it('cannot certify a run whose worker never closes an authoritative attempt', async () => {
    const engine = new FakeEngine();
    engine.tests = [testCase('native-lost-worker', 'worker disappears')];
    engine.runResult = result(engine.tests);
    engine.omitFinished = true;
    const host = TermwrightTestHost.fromEngine(engine, hostOptions());
    const completion = await host.requestRun().completed;
    expect(completion.state).toBe('infrastructure-failed');
    expect(String(completion.error)).toContain('attempt journal incomplete');
    expect(completion.events.some((event) => event.type === 'attempt.started')).toBe(true);
    expect(completion.events.some((event) => event.type === 'attempt.finished')).toBe(false);
    await host.close();
  });

  it('reports why a run with unhandled errors could not be certified', async () => {
    const engine = new FakeEngine();
    engine.tests = [testCase('native-unhandled', 'passes while the process throws')];
    engine.runResult = result(engine.tests, [
      new Error('listener leaked past its test'),
      'a rejection that was never an Error',
    ]);
    const host = TermwrightTestHost.fromEngine(engine, hostOptions());
    const completion = await host.requestRun().completed;
    expect(completion.state).toBe('infrastructure-failed');
    // Vitest owns the only copy of these errors. If the host does not lift them
    // into the completion, the CLI exits non-zero with nothing to read and the
    // journal records a category without a cause.
    expect(describeFailure(completion.error)).toContain('listener leaked past its test');
    expect(describeFailure(completion.error)).toContain('a rejection that was never an Error');
    expect(completion.events.filter((event) => event.type === 'run.infrastructure-failed')).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ detail: expect.stringContaining('listener leaked past its test') }),
      }),
    ]);
    await host.close();
  });

  it('cancels and classifies an attempt that finishes while retaining a resource lease', async () => {
    const engine = new FakeEngine();
    engine.tests = [testCase(
      'native-leak',
      'leaks a terminal resource',
      'failed',
      0,
      true,
      [new Error('fixture teardown could not verify process exit')],
    )];
    engine.runResult = result(engine.tests);
    engine.leakLease = true;
    const host = TermwrightTestHost.fromEngine(engine, hostOptions());
    const completion = await host.requestRun().completed;
    expect(completion.state).toBe('infrastructure-failed');
    expect(String(completion.error)).toContain('finished with 1 active resource leases');
    expect(completion.failures).toEqual([
      expect.objectContaining({
        nativeTaskId: 'native-leak',
        errors: [expect.stringContaining('fixture teardown could not verify process exit')],
      }),
    ]);
    expect(engine.cancellations).toBe(1);
    expect(completion.events.some((event) => event.type === 'attempt.finished')).toBe(true);
    await host.close();
  });

  it('cancels only the exact active RunId and closes through one host barrier', async () => {
    const engine = new FakeEngine();
    engine.tests = [testCase('native-a', 'slow')];
    engine.runResult = result(engine.tests);
    let release!: () => void;
    engine.blockRun = new Promise<void>((resolve) => {
      release = resolve;
    });
    const host = TermwrightTestHost.fromEngine(engine, hostOptions());
    const run = host.requestRun();
    await until(() => engine.contexts.length >= 2);
    expect(await host.stop(createRunId('run'))).toBe(false);
    expect(engine.cancellations).toBe(0);
    expect(await host.stop(run.runId)).toBe(true);
    expect(engine.cancellations).toBe(1);
    release();
    expect((await run.completed).state).toBe('cancelled');
    await Promise.all([host.close(), host.close()]);
    expect(engine.closes).toBe(1);
  });

  it('coalesces source changes into one later RunId in the same host', async () => {
    const engine = new FakeEngine();
    engine.tests = [testCase('native-a', 'case')];
    engine.runResult = result(engine.tests);
    let release!: () => void;
    engine.blockRun = new Promise<void>((resolve) => { release = resolve; });
    const host = TermwrightTestHost.fromEngine(engine, hostOptions());
    const watching = host.watch();
    await until(() => engine.contexts.length >= 2);
    engine.sourceListener?.('/workspace/a.ts');
    engine.sourceListener?.('/workspace/a.ts');
    release();
    await watching.initial.completed;
    await until(() => engine.contexts.length >= 4);
    expect(engine.contexts.at(-1)?.runId).not.toBe(watching.initial.runId);
    await watching.close();
    await host.close();
  });
});

/** Run history without disk I/O, for tests measuring something other than it. */
const MEMORY_RUN_MANIFEST_WRITER = {
  async mkdir(): Promise<void> {},
  async exists(): Promise<boolean> { return false; },
  async writeExclusive(): Promise<void> {},
  async syncDirectory(): Promise<void> {},
  async rename(): Promise<void> {},
};

function hostOptions() {
  return {
    cwd: process.cwd(),
    runsDir: mkdtempSync(join(tmpdir(), 'termwright-host-history-')),
    resourceProfile: TERMWRIGHT_RESOURCE_PROFILES.local,
  } as const;
}

function testCase(
  id: string,
  fullName: string,
  state: 'passed' | 'failed' | 'skipped' = 'passed',
  retryCount = 0,
  withProviderMetadata = true,
  errors: readonly unknown[] = [],
): TestCase {
  const test = {
    id,
    fullName,
    location: { line: 1, column: 1 },
    project: { name: 'default' },
    module: { moduleId: '/workspace/example.test.ts' },
    meta: () => withProviderMetadata
      ? { termwright: { provider: { id: '@termwright/test', version: 1 } } }
      : {},
    result: () => ({ state, retryCount, errors }),
  };
  return test as unknown as TestCase;
}

function result(tests: readonly TestCase[], unhandledErrors: readonly unknown[] = []): TestRunResult {
  return {
    unhandledErrors: [...unhandledErrors],
    testModules: tests.length === 0
      ? []
      : [{ children: { allTests: function* () { yield* tests; } } } as never],
  };
}

async function until(predicate: () => boolean): Promise<void> {
  const deadline = performance.now() + 5_000;
  while (performance.now() < deadline) {
    if (predicate()) return;
    // Broker startup crosses a real socket-listen boundary. Yielding only to
    // the microtask queue makes this helper assert scheduler timing rather
    // than the host condition the test actually cares about.
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('condition was not reached');
}
