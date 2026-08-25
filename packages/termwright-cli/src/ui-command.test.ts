import { describe, expect, it, vi } from 'vitest';
import { createRunId, RunEventProducer, type RunEvent, type RunId, type RunnerTaskId } from '@termwright/protocol';
import { UiHub, type DiscoveredTest } from '@termwright/ui';
import { runUi, type NativeHostHandle, type UiRuntime } from './ui-command.js';

function nativeHost(): NativeHostHandle & {
  stopped: RunId[];
  closed: number;
  taskId: RunnerTaskId;
  emit(event: RunEvent): void;
} {
  const stopped: RunId[] = [];
  const taskId = createRunId('runner-task');
  const discovered = {
    id: taskId,
    title: 'duplicate title',
    file: '/repo/a.test.ts',
    provider: { id: '@termwright/test', version: 1 },
  } as const;
  const listeners = new Set<Parameters<NativeHostHandle['subscribe']>[0]>();
  return {
    stopped,
    closed: 0,
    taskId,
    discover: async () => [discovered],
    run: () => ({ runId: createRunId('run'), completed: Promise.resolve() }),
    async stop(runId) { stopped.push(runId); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    emit(event) { for (const listener of listeners) listener(event, discovered); },
    async shutdown() { this.closed += 1; },
  };
}

describe('native UI host', () => {
  it('uses one host for structured discovery, reruns and exact RunId cancellation', async () => {
    const host = nativeHost();
    let workerUiUrl: string | undefined;
    let options: Parameters<UiRuntime['startUi']>[0] | undefined;
    let interrupt!: () => void;
    const runtime: UiRuntime = {
      startHost: async (run) => {
        workerUiUrl = run.uiProducerUrl;
        return host;
      },
      startUi: async (value) => {
        options = value;
        return {
          url: 'http://127.0.0.1:1/?token=x', producerUrl: 'http://127.0.0.1:1/?token=p',
          port: 1, token: 'x', producerToken: 'p', mode: 'live',
          hub: {} as never, recorder: undefined, trace: undefined,
          attach: () => () => undefined, close: vi.fn(async () => undefined),
        };
      },
      waitForInterrupt: () => new Promise<void>((resolve) => { interrupt = resolve; }),
    };
    const running = runUi({
      trace: undefined, record: undefined, outFile: undefined, port: undefined,
      host: undefined, tags: undefined, watch: true, rest: [], cwd: '/repo', resourceProfile: 'local',
    }, runtime, () => undefined);
    await vi.waitFor(() => expect(options).toBeDefined());
    expect(workerUiUrl).toBe('http://127.0.0.1:1/?token=p');
    const tests = await options!.discovery!.load();
    expect(tests[0]?.id).toMatch(/^runner-task:/u);
    const handle = await options!.onRun!([tests[0]!.id]);
    await options!.onStop!(handle.runId);
    expect(host.stopped).toEqual([handle.runId]);
    interrupt();
    await running;
    expect(host.closed).toBe(1);
  });

  it('does not start the native host when the UI server cannot bind', async () => {
    const host = nativeHost();
    let pendingDiscovery!: Promise<readonly DiscoveredTest[]>;
    const runtime: UiRuntime = {
      startHost: async () => host,
      startUi: async (options) => {
        pendingDiscovery = options.discovery!.load();
        throw new Error('EADDRINUSE');
      },
      waitForInterrupt: async () => undefined,
    };
    await expect(runUi({
      trace: undefined, record: undefined, outFile: undefined, port: 7,
      host: undefined, tags: undefined, watch: true, rest: [], cwd: '/repo', resourceProfile: 'local',
    }, runtime, () => undefined)).rejects.toThrow('EADDRINUSE');
    await expect(pendingDiscovery).rejects.toThrow(/before the native host became available/u);
    expect(host.closed).toBe(0);
  });

  it('projects exact Run, Task, Execution and Attempt identity from the live host journal', async () => {
    const host = nativeHost();
    const hub = new UiHub();
    const runtime: UiRuntime = {
      startHost: async () => host,
      startUi: async () => ({
        url: 'http://127.0.0.1:1/?token=x', producerUrl: 'http://127.0.0.1:1/?token=p',
        port: 1, token: 'x', producerToken: 'p', mode: 'live', hub,
        recorder: undefined, trace: undefined, attach: () => () => undefined,
        close: async () => undefined,
      }),
      waitForInterrupt: () => new Promise<void>(() => undefined),
    };
    const ids = {
      invocationId: createRunId('invocation'),
      runId: createRunId('run'),
      projectId: createRunId('project'),
      specId: createRunId('spec'),
      executionId: createRunId('execution'),
      attemptId: createRunId('attempt'),
    };
    const producer = new RunEventProducer({ producerId: createRunId('producer'), epoch: 0, wallNow: () => 1_000 });
    const running = runUi({
      trace: undefined, record: undefined, outFile: undefined, port: undefined,
      host: undefined, tags: undefined, watch: true, rest: [], cwd: '/repo', resourceProfile: 'local',
    }, runtime, () => {
      host.emit(producer.emit({ eventClass: 'authoritative', type: 'run.state', identity: { invocationId: ids.invocationId, runId: ids.runId }, payload: { state: 'requested' } }));
      const identity = { ...ids, runnerTaskId: host.taskId };
      host.emit(producer.emit({ eventClass: 'authoritative', type: 'attempt.started', identity, payload: { nativeTaskId: 'native-a', retry: 0, repeat: 0 } }));
      host.emit(producer.emit({ eventClass: 'authoritative', type: 'attempt.finished', identity, payload: { nativeTaskId: 'native-a', retry: 0, repeat: 0, state: 'passed' } }));
      host.emit(producer.emit({ eventClass: 'authoritative', type: 'run.state', identity: { invocationId: ids.invocationId, runId: ids.runId }, payload: { state: 'passed' } }));
      return { closed: Promise.resolve(), close: async () => undefined };
    });
    await running;

    expect(hub.backlog).toMatchObject([
      { type: 'run-start', runId: ids.runId },
      { type: 'test-start', id: ids.attemptId, runnerTaskId: host.taskId, executionId: ids.executionId },
      { type: 'test-end', id: ids.attemptId, status: 'passed' },
      { type: 'run-end', summary: { verdict: 'passed', total: 1, passed: 1 } },
    ]);
  });

  it('projects a partial-skip verdict even when a declaratively skipped test has no attempt', async () => {
    const host = nativeHost();
    const hub = new UiHub();
    const producer = new RunEventProducer({ producerId: createRunId('producer'), epoch: 0, wallNow: () => 1_000 });
    const identity = { invocationId: createRunId('invocation'), runId: createRunId('run') };
    const skippedTaskId = createRunId('runner-task');
    const projectId = createRunId('project');
    const passedSpecId = createRunId('spec');
    const skippedSpecId = createRunId('spec');
    const attemptId = createRunId('attempt');
    const executionId = createRunId('execution');
    const runtime: UiRuntime = {
      startHost: async () => host,
      startUi: async () => ({
        url: 'http://127.0.0.1:1/?token=x', producerUrl: 'http://127.0.0.1:1/?token=p',
        port: 1, token: 'x', producerToken: 'p', mode: 'live', hub,
        recorder: undefined, trace: undefined, attach: () => () => undefined,
        close: async () => undefined,
      }),
      waitForInterrupt: () => new Promise<void>(() => undefined),
    };
    await runUi({
      trace: undefined, record: undefined, outFile: undefined, port: undefined,
      host: undefined, tags: undefined, watch: true, rest: [], cwd: '/repo', resourceProfile: 'local',
    }, runtime, () => {
      host.emit(producer.emit({ eventClass: 'authoritative', type: 'run.state', identity, payload: { state: 'requested' } }));
      const attemptIdentity = { ...identity, projectId, specId: passedSpecId, runnerTaskId: host.taskId, attemptId, executionId };
      host.emit(producer.emit({ eventClass: 'authoritative', type: 'attempt.started', identity: attemptIdentity, payload: { nativeTaskId: 'native-pass', retry: 0, repeat: 0 } }));
      host.emit(producer.emit({ eventClass: 'authoritative', type: 'attempt.finished', identity: attemptIdentity, payload: { nativeTaskId: 'native-pass', retry: 0, repeat: 0, state: 'passed' } }));
      host.emit(producer.emit({ eventClass: 'authoritative', type: 'test.skipped', identity: { ...identity, projectId, specId: skippedSpecId, runnerTaskId: skippedTaskId }, payload: { nativeTaskId: 'native-skip', file: '/repo/skipped.test.ts', fullName: 'platform case' } }));
      // Repeated observation of the same task identity must not inflate counters.
      host.emit(producer.emit({ eventClass: 'authoritative', type: 'test.skipped', identity: { ...identity, projectId, specId: skippedSpecId, runnerTaskId: skippedTaskId }, payload: { nativeTaskId: 'native-skip', file: '/repo/skipped.test.ts', fullName: 'platform case' } }));
      host.emit(producer.emit({ eventClass: 'authoritative', type: 'run.state', identity, payload: { state: 'passed-with-skips' } }));
      return { closed: Promise.resolve(), close: async () => undefined };
    });

    expect(hub.backlog).toMatchObject([
      { type: 'run-start', runId: identity.runId },
      { type: 'test-start', id: attemptId, runnerTaskId: host.taskId, executionId },
      { type: 'test-end', id: attemptId, status: 'passed' },
      { type: 'run-end', summary: { verdict: 'passed-with-skips', total: 2, passed: 1, skipped: 1 } },
    ]);
  });
});
