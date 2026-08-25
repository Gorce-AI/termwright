/** `termwright ui` backed by the same persistent native host as `termwright test`. */

import type { RunEvent, RunId, RunnerTaskId, TerminalRunState } from '@termwright/protocol';
import { join } from 'node:path';
import type { DiscoveredTest, UiRunHandle, UiServer, UiServerOptions } from '@termwright/ui';
import { TERMWRIGHT_RESOURCE_PROFILES, TermwrightTestHost, type NativeTestCase, type RunHandle } from './test-host.js';
import type { TermwrightResourceProfileName } from './resource-profiles.js';

export interface NativeHostRun {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly tags?: string;
  readonly resourceProfile: TermwrightResourceProfileName;
  readonly workerEnv?: Readonly<Record<string, string>>;
  /** Worker-only projection endpoint, installed through Vitest's explicit env. */
  readonly uiProducerUrl?: string;
}

export interface NativeHostHandle {
  discover(): Promise<readonly DiscoveredTest[]>;
  run(taskIds: readonly string[]): UiRunHandle;
  stop(runId: RunId): Promise<void>;
  subscribe(listener: (event: RunEvent, test: DiscoveredTest | undefined) => void): () => void;
  shutdown(): Promise<void>;
}

/** One Vitest engine for discovery, full runs, targeted reruns and cancellation. */
export async function startNativeHost(run: NativeHostRun): Promise<NativeHostHandle> {
  const listeners = new Set<(event: RunEvent, test: DiscoveredTest | undefined) => void>();
  const catalog = new Map<string, DiscoveredTest>();
  const host = await TermwrightTestHost.open({
    cwd: run.cwd,
    runsDir: join(run.cwd, '.termwright', 'runs'),
    vitestArgs: run.args,
    workerEnv: {
      ...(run.workerEnv ?? {}),
      ...(run.uiProducerUrl === undefined ? {} : { TERMWRIGHT_UI_URL: run.uiProducerUrl }),
    },
    resourceProfile: TERMWRIGHT_RESOURCE_PROFILES[run.resourceProfile],
    eventObserver: (event) => {
      const taskId = event.identity.runnerTaskId;
      const test = taskId === undefined ? undefined : catalog.get(taskId);
      for (const listener of listeners) listener(event, test);
    },
  });
  return {
    async discover(): Promise<readonly DiscoveredTest[]> {
      const completion = await host.requestRun({ execute: false }).completed;
      if (completion.state === 'infrastructure-failed' || completion.state === 'incomplete') {
        throw completion.error ?? new Error(`native collection ended as ${completion.state}`);
      }
      const tests = Object.freeze((completion.catalog?.tests ?? []).map(projectTest));
      catalog.clear();
      for (const test of tests) catalog.set(test.id, test);
      return tests;
    },
    run(taskIds: readonly string[]): UiRunHandle {
      const handle: RunHandle = host.requestRun({
        ...(taskIds.length === 0 ? {} : { runnerTaskIds: taskIds as readonly RunnerTaskId[] }),
      });
      return { runId: handle.runId, completed: handle.completed };
    },
    async stop(runId: RunId): Promise<void> {
      if (!await host.stop(runId)) throw new Error(`run ${runId} is not active`);
    },
    subscribe(listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    shutdown: () => host.close(),
  };
}

function projectTest(test: NativeTestCase): DiscoveredTest {
  const metadata = typeof test.metadata === 'object' && test.metadata !== null
    ? test.metadata as Record<string, unknown>
    : {};
  const provider = parseProvider(metadata['termwright']);
  return Object.freeze({
    id: test.runnerTaskId,
    title: test.fullName,
    file: test.file,
    ...(provider === undefined ? {} : { provider }),
    ...(test.location === undefined ? {} : {
      source: { file: test.file, line: test.location.line, column: test.location.column },
    }),
  });
}

function parseProvider(value: unknown): DiscoveredTest['provider'] {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const provider = record['provider'];
  if (typeof provider !== 'object' || provider === null) return undefined;
  const p = provider as Record<string, unknown>;
  if (typeof p['id'] !== 'string' || !Number.isInteger(p['version'])) return undefined;
  return { id: p['id'], version: p['version'] as number };
}

export interface UiRuntime {
  readonly startUi: (options: UiServerOptions) => Promise<UiServer>;
  readonly startHost: (run: NativeHostRun) => Promise<NativeHostHandle>;
  readonly waitForInterrupt: () => Promise<void>;
}

export interface UiRequest {
  readonly trace: string | undefined;
  readonly record: readonly string[] | undefined;
  readonly outFile: string | undefined;
  readonly port: number | undefined;
  readonly host: string | undefined;
  readonly tags: string | undefined;
  readonly watch: boolean;
  readonly rest: readonly string[];
  readonly cwd: string;
  readonly resourceProfile: TermwrightResourceProfileName;
  readonly workerEnv?: Readonly<Record<string, string>>;
}

export interface UiResult {
  readonly url: string;
  readonly port: number;
  readonly mode: UiServer['mode'];
  readonly runnerExitCode: number | undefined;
}

export interface UiSurfaceHandle {
  readonly closed: Promise<void>;
  close(): Promise<void>;
}

export async function runUi(
  request: UiRequest,
  runtime: UiRuntime,
  onReady: (result: Omit<UiResult, 'runnerExitCode'>) => void | UiSurfaceHandle | Promise<void | UiSurfaceHandle>,
): Promise<UiResult> {
  let host: NativeHostHandle | undefined;
  const live = request.trace === undefined && request.record === undefined;
  let resolveHost!: (value: NativeHostHandle) => void;
  let rejectHost!: (reason: unknown) => void;
  const hostReady = new Promise<NativeHostHandle>((resolve, reject) => {
    resolveHost = resolve;
    rejectHost = reject;
  });
  let hostReadySettled = false;
  // A custom embedding may not invoke discovery immediately. Keep the deferred
  // failure observed while preserving rejection for callbacks which do await it.
  void hostReady.catch(() => undefined);
  let server: UiServer | undefined;
  let surface: UiSurfaceHandle | undefined;
  let detachHostEvents: (() => void) | undefined;
  try {
    server = await runtime.startUi({
      ...(request.port === undefined ? {} : { port: request.port }),
      ...(request.host === undefined ? {} : { host: request.host }),
      ...(request.trace === undefined ? {} : { trace: request.trace }),
      ...(request.record === undefined ? {} : {
        record: {
          command: request.record,
          cwd: request.cwd,
          ...(request.outFile === undefined ? {} : { outFile: request.outFile }),
        },
      }),
      ...(!live ? {} : {
        discovery: { cwd: request.cwd, watch: request.watch, load: async () => (await hostReady).discover() },
        onRun: async (ids) => (await hostReady).run(ids ?? []),
        onStop: async (runId) => (await hostReady).stop(runId),
      }),
    });
    if (live) {
      try {
        host = await runtime.startHost({
          args: request.rest,
          cwd: request.cwd,
          resourceProfile: request.resourceProfile,
          ...(request.workerEnv === undefined ? {} : { workerEnv: request.workerEnv }),
          uiProducerUrl: server.producerUrl,
          ...(request.tags === undefined ? {} : { tags: request.tags }),
        });
      } catch (error) {
        hostReadySettled = true;
        rejectHost(error);
        throw error;
      }
      const projection = new NativeRunProjection(server.hub);
      detachHostEvents = host.subscribe((event, test) => projection.publish(event, test));
      hostReadySettled = true;
      resolveHost(host);
    }
    surface = (await onReady({ url: server.url, port: server.port, mode: server.mode })) ?? undefined;
    if (surface === undefined) await runtime.waitForInterrupt();
    else await Promise.race([runtime.waitForInterrupt(), surface.closed]);
    return { url: server.url, port: server.port, mode: server.mode, runnerExitCode: undefined };
  } finally {
    if (live && !hostReadySettled) {
      hostReadySettled = true;
      rejectHost(new Error('UI server stopped before the native host became available'));
    }
    const failures: unknown[] = [];
    // Stop discovery/network activity before closing the host it calls into.
    for (const cleanup of [() => detachHostEvents?.(), () => surface?.close(), () => server?.close(), () => host?.shutdown()]) {
      try { await cleanup(); } catch (error) { failures.push(error); }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'Termwright UI cleanup failed');
  }
}

interface ProjectedAttempt {
  readonly runnerTaskId: string;
  readonly startedAt: number;
  readonly monotonicTime: number;
  readonly retry: number;
  status?: 'passed' | 'failed' | 'skipped';
}

class NativeRunProjection {
  readonly #hub: UiServer['hub'];
  readonly #attempts = new Map<string, ProjectedAttempt>();
  readonly #declarativeSkips = new Set<string>();

  constructor(hub: UiServer['hub']) {
    this.#hub = hub;
  }

  publish(event: RunEvent, test: DiscoveredTest | undefined): void {
    const payload = asRecord(event.payload);
    if (event.type === 'run.state') {
      const state = payload['state'];
      const runId = event.identity.runId;
      if (runId === undefined || typeof state !== 'string') return;
      if (state === 'requested') {
        this.#attempts.clear();
        this.#declarativeSkips.clear();
        this.#hub.publish({
          v: 1,
          type: 'run-start',
          runId,
          mode: 'live',
          startedAt: event.wallTime ?? Date.now(),
        });
      } else if (isTerminalProjectionState(state)) {
        const latest = new Map<string, ProjectedAttempt>();
        for (const attempt of this.#attempts.values()) latest.set(attempt.runnerTaskId, attempt);
        const values = [...latest.values()];
        const skippedTasks = new Set([
          ...this.#declarativeSkips,
          ...values.filter((attempt) => attempt.status === 'skipped').map((attempt) => attempt.runnerTaskId),
        ]);
        const observedTasks = new Set([...latest.keys(), ...skippedTasks]);
        this.#hub.publish({
          v: 1,
          type: 'run-end',
          summary: {
            verdict: state,
            total: observedTasks.size,
            passed: values.filter((attempt) => attempt.status === 'passed').length,
            failed: values.filter((attempt) => attempt.status === 'failed').length,
            skipped: skippedTasks.size,
            flaky: values.filter((attempt) => attempt.status === 'passed' && attempt.retry > 0).length,
            durationMs: Math.max(0, ...values.map((attempt) =>
              attempt.status === undefined ? 0 : event.monotonicTime - attempt.monotonicTime)),
          },
        });
      }
      return;
    }
    if (event.type === 'test.skipped') {
      const runnerTaskId = event.identity.runnerTaskId;
      if (runnerTaskId !== undefined) this.#declarativeSkips.add(runnerTaskId);
      return;
    }
    if (event.type === 'run.infrastructure-failed') {
      if (event.identity.runId === undefined) return;
      this.#hub.publish({
        v: 1,
        type: 'run-infrastructure-failed',
        runId: event.identity.runId,
        error: typeof payload['detail'] === 'string' ? payload['detail'].slice(0, 256) : 'native host infrastructure failure',
      });
      return;
    }
    const attemptId = event.identity.attemptId;
    const runnerTaskId = event.identity.runnerTaskId;
    if (attemptId === undefined || runnerTaskId === undefined || test === undefined) return;
    const retry = nonNegative(payload['retry']);
    if (event.type === 'attempt.started') {
      this.#attempts.set(attemptId, {
        runnerTaskId,
        startedAt: event.wallTime ?? Date.now(),
        monotonicTime: event.monotonicTime,
        retry,
      });
      this.#hub.publish({
        v: 1,
        type: 'test-start',
        id: attemptId,
        runnerTaskId,
        ...(event.identity.executionId === undefined ? {} : { executionId: event.identity.executionId }),
        attempt: retry + 1,
        title: test.title,
        file: test.file,
        startedAt: event.wallTime ?? Date.now(),
      });
      return;
    }
    if (event.type !== 'attempt.finished') return;
    const attempt = this.#attempts.get(attemptId);
    const state = payload['state'];
    if (attempt === undefined || (state !== 'passed' && state !== 'failed' && state !== 'skipped')) return;
    attempt.status = state;
    this.#hub.publish({
      v: 1,
      type: 'test-end',
      id: attemptId,
      status: state,
      durationMs: Math.max(0, event.monotonicTime - attempt.monotonicTime),
      flaky: state === 'passed' && retry > 0,
      lostLogRecords: 0,
      attempt: retry + 1,
    });
  }
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function nonNegative(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0;
}

function isTerminalProjectionState(value: string): value is TerminalRunState {
  return value === 'passed' || value === 'passed-with-skips' || value === 'failed' || value === 'flaky' ||
    value === 'cancelled' || value === 'skipped' || value === 'infrastructure-failed' ||
    value === 'crashed' || value === 'incomplete';
}

export function waitForInterrupt(): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      process.off('SIGINT', done);
      process.off('SIGTERM', done);
      resolve();
    };
    process.once('SIGINT', done);
    process.once('SIGTERM', done);
  });
}
