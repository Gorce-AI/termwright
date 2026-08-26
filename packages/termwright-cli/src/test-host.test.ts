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
import type { TestCase, TestModule, TestRunResult } from 'vitest/node';
import {
  TermwrightTestHost,
  HostRunBudget,
  TERMWRIGHT_RESOURCE_PROFILES,
  TermwrightHostStartupCleanupError,
  TermwrightHostTimeoutError,
  assessSkipPolicy,
  assertFirstWorkflowAttempt,
  describeFailure,
  type TermwrightHostDeadlineRuntime,
  type TermwrightVitestEngine,
} from './test-host.js';
import { CERTIFIED_VITEST_VERSION } from '@termwright/test/vitest-engine';

describe('workflow attempt certification', () => {
  it('accepts only the first GitHub attempt when certification requires it', () => {
    expect(() => assertFirstWorkflowAttempt({})).not.toThrow();
    expect(() => assertFirstWorkflowAttempt({
      TERMWRIGHT_REQUIRE_FIRST_WORKFLOW_ATTEMPT: '1',
      GITHUB_RUN_ATTEMPT: '1',
    })).not.toThrow();
    expect(() => assertFirstWorkflowAttempt({
      TERMWRIGHT_REQUIRE_FIRST_WORKFLOW_ATTEMPT: '1',
      GITHUB_RUN_ATTEMPT: '2',
    })).toThrow(/start a new run instead of rerunning/u);
  });
});

class FakeEngine implements TermwrightVitestEngine {
  readonly version = CERTIFIED_VITEST_VERSION;
  catalogueScope: 'full' | 'targeted' = 'full';
  contexts: TermwrightRunnerContext[] = [];
  cancellations = 0;
  closes = 0;
  collectionErrors: unknown[] = [];
  collectionModules: TestModule[] | undefined;
  tests: TestCase[] = [];
  runResult: TestRunResult = result([]);
  blockRun: Promise<void> | undefined;
  runError: unknown;
  omitFinished = false;
  leakLease = false;
  runStarted: (() => void) | undefined;
  sourceListener: ((file: string) => void) | undefined;
  consoleListener: ((log: UserConsoleLog) => void) | undefined;
  consoleContent: string | undefined;

  setRunnerContext(context: TermwrightRunnerContext): void {
    this.contexts.push(context);
  }

  async collect(): Promise<{ result: TestRunResult; tests: readonly TestCase[] }> {
    return {
      result: result(this.tests, this.collectionErrors, this.collectionModules),
      tests: this.tests,
    };
  }

  async run(): Promise<TestRunResult> {
    this.runStarted?.();
    if (this.runError !== undefined) throw this.runError;
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
  it('cancels and classifies a Vitest execution deadline', async () => {
    const engine = new FakeEngine();
    engine.tests = [testCase('native-hung', 'hung worker')];
    engine.runResult = result(engine.tests);
    engine.runError = new TermwrightHostTimeoutError('Vitest execution', 250);
    const host = TermwrightTestHost.fromEngine(engine, hostOptions());

    const completion = await host.requestRun().completed;

    expect(completion.state).toBe('infrastructure-failed');
    expect(completion.events.find((event) => event.type === 'run.infrastructure-failed')?.payload)
      .toMatchObject({ category: 'timeout' });
    expect((completion.events.find((event) => event.type === 'run.infrastructure-failed')?.payload as { detail: string }).detail)
      .toContain('Vitest execution');
    expect(engine.cancellations).toBe(1);
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
          scheduler: { pool: 'forks', maxWorkers: 2, fileParallelism: true },
          capacities: { ptySession: 4, externalProcess: 4, semanticEndpoint: 4, nativeHostPressure: 4, traceWriter: 4 },
          perTerminal: { semanticEndpoint: 1, nativeHostPressure: 1 },
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

  it('expands exclusive native-host admission without inflating the terminal count', async () => {
    const engine = new FakeEngine();
    const pressure = testCase('native-pressure', 'native pressure', 'passed', 0, true, [], {
      termwright: {
        provider: { id: '@termwright/test', version: 1 },
        resources: { terminals: 1, traceWriters: 0, nativeHost: 'exclusive' },
      },
    });
    engine.tests = [pressure];
    engine.runResult = result([pressure]);
    const host = TermwrightTestHost.fromEngine(engine, hostOptions());
    await host.requestRun().completed;
    expect(engine.contexts.at(-1)?.tasks['native-pressure']?.resourceReservation).toEqual({
      ptySession: 1,
      externalProcess: 1,
      semanticEndpoint: 1,
      nativeHostPressure: 4,
    });
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

  it('reports missing current-cycle Vitest results as an evidenced infrastructure failure', async () => {
    const engine = new FakeEngine();
    engine.tests = [testCase('native-current', 'current test')];
    engine.runResult = result([testCase('native-previous', 'previous test')]);
    const host = TermwrightTestHost.fromEngine(engine, hostOptions());

    const completion = await host.requestRun().completed;

    expect(completion.state).toBe('infrastructure-failed');
    expect(completion.failures).toEqual([]);
    expect(completion.events.find((event) => event.type === 'run.infrastructure-failed')?.payload)
      .toMatchObject({ detail: expect.stringContaining('1 missing (native-current)') });
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

  it('reports a mixed pass/skip as yellow and assesses exact declarations', async () => {
    const engine = new FakeEngine();
    const passed = testCase('native-passed', 'works');
    const skipped = testCase('native-optional', 'platform-only', 'skipped');
    engine.tests = [passed, skipped];
    engine.runResult = result([passed, skipped]);
    const host = TermwrightTestHost.fromEngine(engine, {
      ...hostOptions(),
      skipDeclarations: [{
        id: 'declared-platform-case',
        file: skipped.module.moduleId,
        fullName: skipped.fullName,
        required: true,
      }],
    });
    const completion = await host.requestRun().completed;
    expect(completion.state).toBe('passed-with-skips');
    expect(completion.skips).toMatchObject([{
      nativeTaskId: 'native-optional',
      fullName: 'platform-only',
    }]);
    expect(completion.skipPolicy).toEqual({ status: 'matched', declarations: 1, issues: [] });
    expect(completion.events.at(-1)).toMatchObject({
      type: 'run.state',
      payload: { state: 'passed-with-skips' },
    });
    expect(completion.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'run.skip-declaration', payload: expect.objectContaining({ id: 'declared-platform-case' }) }),
      expect.objectContaining({ type: 'test.skipped', identity: expect.objectContaining({ runnerTaskId: completion.skips[0]?.runnerTaskId }) }),
      expect.objectContaining({ type: 'run.skip-policy', payload: { status: 'matched', declarations: 1, observed: 1, issues: 0 } }),
    ]));
    await host.close();
  });

  it('keeps an undeclared partial skip non-certifying', async () => {
    const engine = new FakeEngine();
    const passed = testCase('native-passed', 'works');
    const skipped = testCase('native-optional', 'silently disappeared', 'skipped');
    engine.tests = [passed, skipped];
    engine.runResult = result([passed, skipped]);
    const host = TermwrightTestHost.fromEngine(engine, hostOptions());
    const completion = await host.requestRun().completed;
    expect(completion.state).toBe('passed-with-skips');
    expect(completion.skipPolicy).toMatchObject({
      status: 'mismatch',
      issues: [expect.stringContaining('undeclared skip')],
    });
    await host.close();
  });

  it('checks stale required targets only when the host catalogue is unfiltered', async () => {
    const declaration = {
      id: 'stale-required-case',
      file: '/repo/removed.test.ts',
      fullName: 'removed case',
      required: true,
    } as const;
    const fullEngine = new FakeEngine();
    fullEngine.tests = [testCase('native-passed', 'works')];
    fullEngine.runResult = result(fullEngine.tests);
    const fullHost = TermwrightTestHost.fromEngine(fullEngine, {
      ...hostOptions(), skipDeclarations: [declaration],
    });
    expect((await fullHost.requestRun().completed).skipPolicy).toMatchObject({
      status: 'mismatch', issues: [expect.stringContaining('stale required')],
    });
    await fullHost.close();

    const targetedEngine = new FakeEngine();
    targetedEngine.tests = [testCase('native-passed', 'works')];
    targetedEngine.runResult = result(targetedEngine.tests);
    const targetedHost = TermwrightTestHost.fromEngine(targetedEngine, {
      ...hostOptions(), filters: ['packages/example.test.ts'], skipDeclarations: [declaration],
    });
    expect((await targetedHost.requestRun().completed).skipPolicy).toEqual({
      status: 'matched', declarations: 1, issues: [],
    });
    await targetedHost.close();
  });

  it('treats an explicitly configured Vitest catalogue as targeted without weakening exact skip matching', async () => {
    const engine = new FakeEngine();
    engine.catalogueScope = 'targeted';
    const skipped = testCase('native-docs-screenshot', 'captures documentation screenshots', 'skipped');
    engine.tests = [skipped];
    engine.runResult = result([skipped]);
    const host = TermwrightTestHost.fromEngine(engine, {
      ...hostOptions(),
      skipDeclarations: [{
        id: 'ui-doc-screenshot-capture-mode',
        file: skipped.module.moduleId,
        fullName: skipped.fullName,
        required: false,
      }, {
        id: 'uncollected-required-conpty-case',
        file: '/repo/packages/conformance/src/suites/driver-generic.test.ts',
        fullName: 'fails closed when an embedding hides terminal input modes',
        required: true,
      }],
    });
    expect((await host.requestRun().completed).skipPolicy).toEqual({
      status: 'matched', declarations: 2, issues: [],
    });
    await host.close();
  });

  it('requires one exact leaf declaration instead of allowing a suite prefix to cover descendants', () => {
    const selected = [
      testCase('native-one', 'Windows process lifecycle > keeps descendants alive'),
      testCase('native-two', 'Windows process lifecycle > kills the complete tree'),
    ];
    const skips = selected.map((test) => ({
      runnerTaskId: 'runner-task:00000000-0000-4000-8000-000000000001' as RunnerTaskId,
      nativeTaskId: test.id,
      file: test.module.moduleId,
      fullName: test.fullName,
    }));
    const nativeSelected = selected.map((test, index) => ({
      runnerTaskId: skips[index]!.runnerTaskId,
      nativeTaskId: test.id,
      projectId: 'project:00000000-0000-4000-8000-000000000001' as never,
      specId: 'spec:00000000-0000-4000-8000-000000000001' as never,
      project: 'test',
      file: test.module.moduleId,
      fullName: test.fullName,
      metadata: {},
    }));
    expect(assessSkipPolicy(nativeSelected, skips, [{
      id: 'windows-process-lifecycle',
      file: selected[0]!.module.moduleId,
      fullName: 'Windows process lifecycle',
      required: true,
    }], 'full')).toMatchObject({
      status: 'mismatch',
      issues: expect.arrayContaining([
        expect.stringContaining('undeclared skip'),
        expect.stringContaining('stale required'),
      ]),
    });
  });

  it('uses an exact normalized top-level suite without hiding duplicate leaves inside that scope', () => {
    const file = '/repo/language-adapters.test.ts';
    const cases = [
      testCase('textual-leaf', 'adapter conformance: termwright (Textual) (skipped: python unavailable) > contract > shared leaf'),
      testCase('tview-leaf', 'adapter conformance: termwright (tview) (skipped: go unavailable) > contract > shared leaf'),
    ];
    const selected = cases.map((test, index) => ({
      runnerTaskId: `runner-task:00000000-0000-4000-8000-00000000000${index + 1}` as RunnerTaskId,
      nativeTaskId: test.id,
      projectId: 'project:00000000-0000-4000-8000-000000000001' as never,
      specId: `spec:00000000-0000-4000-8000-00000000000${index + 1}` as never,
      project: 'test', file, fullName: test.fullName, metadata: {},
    }));
    const skipped = selected.map((test) => ({
      runnerTaskId: test.runnerTaskId, nativeTaskId: test.nativeTaskId, file, fullName: test.fullName,
    }));
    const declarations = [
      { id: 'textual-leaf', file, suite: 'adapter conformance: termwright (Textual)', fullName: 'shared leaf', required: false },
      { id: 'tview-leaf', file, suite: 'adapter conformance: termwright (tview)', fullName: 'shared leaf', required: false },
    ] as const;
    expect(assessSkipPolicy(selected, skipped, declarations, 'full')).toEqual({
      status: 'matched', declarations: 2, issues: [],
    });

    const duplicate = {
      ...selected[0]!,
      runnerTaskId: 'runner-task:00000000-0000-4000-8000-000000000003' as RunnerTaskId,
      nativeTaskId: 'textual-future-leaf',
      specId: 'spec:00000000-0000-4000-8000-000000000003' as never,
      fullName: 'adapter conformance: termwright (Textual) > future group > shared leaf',
    };
    expect(assessSkipPolicy(
      [...selected, duplicate],
      [...skipped, { runnerTaskId: duplicate.runnerTaskId, nativeTaskId: duplicate.nativeTaskId, file, fullName: duplicate.fullName }],
      declarations,
      'full',
    )).toMatchObject({
      status: 'mismatch',
      issues: expect.arrayContaining([expect.stringContaining('matches 2 selected cases instead of one exact case: textual-leaf')]),
    });
  });

  it('fails a stale required declaration closed for a full run but ignores it outside a targeted selection', () => {
    const declaration = {
      id: 'renamed-platform-case',
      file: '/repo/platform.test.ts',
      fullName: 'old exact case name',
      required: true,
    } as const;
    expect(assessSkipPolicy([], [], [declaration], 'full')).toEqual({
      status: 'mismatch',
      declarations: 1,
      issues: [expect.stringContaining('stale required')],
    });
    expect(assessSkipPolicy([], [], [declaration], 'targeted')).toEqual({
      status: 'matched', declarations: 1, issues: [],
    });
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
    expect(record.manifest.durationMs).toBeGreaterThanOrEqual(0);
    expect(record.manifest.attempts[0]?.attemptId).toMatch(/^attempt:/u);
    expect(record.manifest.attempts[0]?.startedAfterRunMs).toBeGreaterThanOrEqual(0);
    expect(record.manifest.attempts[0]?.startedAfterRunMs).toBeLessThanOrEqual(record.manifest.durationMs);
    expect(record.manifest.attempts[0]?.finishedAfterRunMs)
      .toBeGreaterThanOrEqual(record.manifest.attempts[0]?.startedAfterRunMs ?? Number.POSITIVE_INFINITY);
    expect(record.manifest.attempts[0]?.finishedAfterRunMs).toBeLessThanOrEqual(record.manifest.durationMs);
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

  it('fails closed when one module imports and another module fails during collection', async () => {
    const engine = new FakeEngine();
    const collected = testCase('native-collected', 'collected test');
    engine.catalogueScope = 'targeted';
    engine.tests = [collected];
    engine.collectionModules = [
      testModule('/workspace/mixed/good.test.ts', [collected], 'queued'),
      testModule('/workspace/mixed/import-failed.test.ts', [], 'failed', [
        { name: 'Error', message: 'dependency exploded during import' },
      ]),
    ];
    let started = false;
    engine.runStarted = () => { started = true; };
    const host = TermwrightTestHost.fromEngine(engine, { ...hostOptions(), filters: ['mixed'] });

    const completion = await host.requestRun().completed;

    expect(completion.state).toBe('infrastructure-failed');
    expect(started).toBe(false);
    expect(describeFailure(completion.error)).toContain('/workspace/mixed/import-failed.test.ts');
    expect(describeFailure(completion.error)).toContain('dependency exploded during import');
    await host.close();
  });

  it('fails closed when Vitest reports a failed collection module without error evidence', async () => {
    const engine = new FakeEngine();
    engine.collectionModules = [testModule('/workspace/opaque-failure.test.ts', [], 'failed')];
    const host = TermwrightTestHost.fromEngine(engine, hostOptions());

    const completion = await host.requestRun().completed;

    expect(completion.state).toBe('infrastructure-failed');
    expect(describeFailure(completion.error)).toContain(
      'Vitest collection module /workspace/opaque-failure.test.ts failed without structured error evidence',
    );
    await host.close();
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
    // The barrier fires when the run cannot explain itself, so it has to say
    // which test stopped short rather than quoting an opaque task id.
    expect(String(completion.error)).toContain('worker disappears');
    expect(completion.events.some((event) => event.type === 'attempt.started')).toBe(true);
    expect(completion.events.some((event) => event.type === 'attempt.finished')).toBe(false);
    await host.close();
  });

  it('follows an error to the layer that knows what happened', () => {
    // A wrapper's own text names which layer noticed, not what went wrong, and
    // the pool errors that end a Windows run are exactly that shape.
    const wrapped = new Error('worker pool reported a failure', {
      cause: new Error('the child exited with code 3221226505'),
    });
    expect(describeFailure(wrapped)).toBe(
      'worker pool reported a failure <- the child exited with code 3221226505',
    );
    expect(describeFailure(new AggregateError([wrapped], 'run failed'))).toContain('3221226505');
    expect(describeFailure(new Error('no cause here'))).toBe('no cause here');
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

describe('HostRunBudget', () => {
  it('uses one execution deadline and preserves the finalization reserve', async () => {
    const clock = new ManualDeadlineRuntime();
    const budget = new HostRunBudget(250, 100, clock);
    const execution = budget.execution('Vitest execution', () => new Promise<never>(() => undefined));

    clock.advance(150);
    await expect(execution).rejects.toMatchObject({
      code: 'TW_HOST_TIMEOUT',
      phase: 'Vitest execution',
    });

    const finalization = budget.finalization('bounded cleanup', () => new Promise<never>(() => undefined));
    clock.advance(99);
    expect(clock.now()).toBe(249);
    clock.advance(1);
    await expect(finalization).rejects.toMatchObject({
      code: 'TW_HOST_TIMEOUT',
      phase: 'bounded cleanup',
    });
  });

  it('aborts transport startup and waits for its cleanup', async () => {
    const clock = new ManualDeadlineRuntime();
    const budget = new HostRunBudget(250, 100, clock);
    let aborted = false;
    const startup = budget.startResource('resource broker startup', (signal) => new Promise<{ close(): Promise<void> }>((_, reject) => {
      signal.addEventListener('abort', () => {
        aborted = true;
        reject(signal.reason);
      }, { once: true });
    }));

    clock.advance(150);
    await expect(startup).rejects.toMatchObject({
      code: 'TW_HOST_TIMEOUT',
      phase: 'resource broker startup',
    });
    expect(aborted).toBe(true);
  });

  it('does not treat a startup-owned timeout as the host scheduler deadline', async () => {
    const clock = new ManualDeadlineRuntime();
    const budget = new HostRunBudget(250, 100, clock);
    const ownedFailure = new TermwrightHostTimeoutError('transport-owned timeout', 25);
    let signal: AbortSignal | undefined;

    await expect(budget.startResource('resource broker startup', (receivedSignal) => {
      signal = receivedSignal;
      return Promise.reject(ownedFailure);
    })).rejects.toBe(ownedFailure);
    expect(signal?.aborted).toBe(false);
  });

  it('closes a resource that resolves after startup was aborted', async () => {
    const clock = new ManualDeadlineRuntime();
    const budget = new HostRunBudget(250, 100, clock);
    let resolveStartup!: (resource: { close(): Promise<void> }) => void;
    let closes = 0;
    const startup = budget.startResource('run journal startup', () => new Promise<{ close(): Promise<void> }>((resolve) => {
      resolveStartup = resolve;
    }));

    clock.advance(150);
    resolveStartup({ async close() { closes += 1; } });
    await expect(startup).rejects.toMatchObject({ code: 'TW_HOST_TIMEOUT' });
    expect(closes).toBe(1);
  });

  it('fails cleanup closed when an aborted startup cannot release its resource', async () => {
    const clock = new ManualDeadlineRuntime();
    const budget = new HostRunBudget(250, 100, clock);
    let resolveStartup!: (resource: { close(): Promise<void> }) => void;
    const startup = budget.startResource('run journal startup', () => new Promise<{ close(): Promise<void> }>((resolve) => {
      resolveStartup = resolve;
    }));

    clock.advance(150);
    resolveStartup({ close: () => new Promise(() => undefined) });
    await new Promise<void>((resolve) => setImmediate(resolve));
    clock.advance(100);
    await expect(startup).rejects.toBeInstanceOf(TermwrightHostStartupCleanupError);
  });

  it('does not mistake a close failure for a successful startup abort', async () => {
    const clock = new ManualDeadlineRuntime();
    const budget = new HostRunBudget(250, 100, clock);
    let resolveStartup!: (resource: { close(): Promise<void> }) => void;
    const startup = budget.startResource('resource broker startup', () => new Promise<{ close(): Promise<void> }>((resolve) => {
      resolveStartup = resolve;
    }));

    clock.advance(150);
    resolveStartup({ async close() { throw new DOMException('close aborted', 'AbortError'); } });
    await expect(startup).rejects.toBeInstanceOf(TermwrightHostStartupCleanupError);
  });

  it('keeps cleanup attached when the event loop wakes after the total deadline', async () => {
    const clock = new ManualDeadlineRuntime();
    const budget = new HostRunBudget(250, 100, clock);
    let resolveStartup!: (resource: { close(): Promise<void> }) => void;
    let closes = 0;
    const startup = budget.startResource('resource broker startup', () => new Promise<{ close(): Promise<void> }>((resolve) => {
      resolveStartup = resolve;
    }));

    clock.advance(250);
    await expect(startup).rejects.toBeInstanceOf(TermwrightHostStartupCleanupError);
    resolveStartup({ async close() { closes += 1; } });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(closes).toBe(1);
  });
});

class ManualDeadlineRuntime implements TermwrightHostDeadlineRuntime {
  #now = 0;
  #nextId = 0;
  readonly #scheduled = new Map<number, { readonly at: number; readonly elapsed: () => void }>();

  readonly now = (): number => this.#now;

  readonly schedule = (delayMs: number, elapsed: () => void): (() => void) => {
    const id = this.#nextId++;
    this.#scheduled.set(id, { at: this.#now + delayMs, elapsed });
    return () => { this.#scheduled.delete(id); };
  };

  advance(ms: number): void {
    this.#now += ms;
    const elapsed = [...this.#scheduled.entries()]
      .filter(([, timer]) => timer.at <= this.#now)
      .sort((left, right) => left[1].at - right[1].at);
    for (const [id, timer] of elapsed) {
      if (!this.#scheduled.delete(id)) continue;
      timer.elapsed();
    }
  }
}

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
  metadata?: Readonly<Record<string, unknown>>,
): TestCase {
  const test = {
    id,
    fullName,
    location: { line: 1, column: 1 },
    project: { name: 'default' },
    module: { moduleId: '/workspace/example.test.ts' },
    meta: () => metadata ?? (withProviderMetadata
      ? { termwright: { provider: { id: '@termwright/test', version: 1 } } }
      : {}),
    result: () => ({ state, retryCount, errors }),
  };
  return test as unknown as TestCase;
}

function result(
  tests: readonly TestCase[],
  unhandledErrors: readonly unknown[] = [],
  testModules: readonly TestModule[] | undefined = undefined,
): TestRunResult {
  return {
    unhandledErrors: [...unhandledErrors],
    testModules: testModules === undefined ? (tests.length === 0
      ? []
      : [testModule('/workspace/example.test.ts', tests, 'queued')]) : [...testModules],
  };
}

function testModule(
  moduleId: string,
  tests: readonly TestCase[],
  state: 'queued' | 'failed',
  errors: readonly unknown[] = [],
): TestModule {
  return {
    moduleId,
    children: { allTests: function* () { yield* tests; } },
    errors: () => [...errors],
    state: () => state,
  } as unknown as TestModule;
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
