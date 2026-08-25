/** Exact-certified Vitest boundary used by the native host coordinator. */

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { TermwrightRunnerContext } from '@termwright/test/runner';
import {
  CERTIFIED_VITEST_VERSION,
  TERMWRIGHT_RUNNER_CONTEXT_KEY,
  assertCertifiedVitestRuntime,
} from '@termwright/test/vitest-engine';
import type { UserConsoleLog } from 'vitest';
import { createVitest, parseCLI, type Reporter, type TestCase, type TestRunResult, type Vitest } from 'vitest/node';
import { RunIdFactory, type TerminalRunState } from '@termwright/protocol';
import type { TermwrightResourceProfile } from './resource-profiles.js';
import { uiVitestViteOverrides } from './ui-vitest-config.js';

export interface EngineCollection {
  readonly result: TestRunResult;
  readonly tests: readonly TestCase[];
}

/** Narrow contract around the exact engine APIs certified by Termwright. */
export interface TermwrightVitestEngine {
  readonly version: string;
  setRunnerContext(context: TermwrightRunnerContext): void;
  collect(filters: readonly string[]): Promise<EngineCollection>;
  run(nativeModuleIds: ReadonlySet<string>): Promise<TestRunResult>;
  cancel(): Promise<void>;
  onSourceChange(listener: (file: string) => void): () => void;
  /** Exact structured console channel; human reporter stdout is never parsed. */
  onUserConsoleLog?(listener: (log: UserConsoleLog) => void): () => void;
  close(): Promise<void>;
}

export interface CertifiedVitestEngineOptions {
  readonly cwd: string;
  readonly resourceProfile: TermwrightResourceProfile;
  readonly vitestArgs?: readonly string[];
  readonly workerEnv?: Readonly<Record<string, string>>;
}

type VitestSchedulerOverrides = Readonly<{
  pool: TermwrightResourceProfile['scheduler']['pool'];
  maxWorkers: number;
  fileParallelism?: false;
}>;

/**
 * Applies the host's resource ceilings without enabling concurrency that the
 * loaded Vitest project deliberately disabled. A profile value of `true`
 * means that file parallelism is permitted, not required; Vitest's config (or
 * an explicit CLI flag) remains authoritative in that case.
 */
export function vitestSchedulerOverrides(
  scheduler: TermwrightResourceProfile['scheduler'],
): VitestSchedulerOverrides {
  return {
    pool: scheduler.pool,
    maxWorkers: scheduler.maxWorkers,
    ...(scheduler.fileParallelism ? {} : { fileParallelism: false }),
  };
}

export async function createCertifiedVitestEngine(options: CertifiedVitestEngineOptions): Promise<{
  readonly engine: TermwrightVitestEngine;
  readonly filters: readonly string[];
}> {
  assertCertifiedVitestRuntime();
  const parsed = parseCLI(['vitest', 'run', ...(options.vitestArgs ?? [])], { allowUnknownOptions: true });
  const runner = createRequire(import.meta.url).resolve('@termwright/test/runner');
  const bootstrapIds = new RunIdFactory();
  const bootstrapContext: TermwrightRunnerContext = {
    invocationId: bootstrapIds.create('invocation'),
    runId: bootstrapIds.create('run'),
    tasks: {},
    broker: {
      endpoint: 'termwright://bootstrap-not-executable',
      token: 'bootstrap-not-executable-0000000000000000',
      workerEpoch: 0,
      workerIdPrefix: 'termwright-bootstrap',
      handshakeTimeoutMs: 1,
      resourceProfile: {},
    },
    journal: {
      endpoint: 'termwright://bootstrap-not-executable',
      token: 'bootstrap-not-executable-0000000000000000',
      handshakeTimeoutMs: 1,
      acknowledgementTimeoutMs: 1,
      binding: 'host-assigned-worker',
    },
  };
  const vitest = await createVitest('test', {
    ...parsed.options,
    env: { ...(parsed.options.env ?? {}), ...(options.workerEnv ?? {}) },
    root: options.cwd,
    watch: false,
    run: true,
    ...vitestSchedulerOverrides(options.resourceProfile.scheduler),
    includeTaskLocation: true,
    runner,
    provide: {
      ...(parsed.options.provide ?? {}),
      [TERMWRIGHT_RUNNER_CONTEXT_KEY]: bootstrapContext,
    },
  }, uiVitestViteOverrides());
  removeEmbeddedDefaultReporter(vitest);
  await vitest.standalone();
  return { engine: new ExactVitestEngine(vitest), filters: parsed.filter };
}

/** Removes only Vitest's implicit human reporter; explicit reporters retain order. */
export function removeEmbeddedDefaultReporter(vitest: Pick<Vitest, 'version'> & { readonly reporters?: Reporter[] }): void {
  if (!Array.isArray(vitest.reporters)) throw new Error(`Vitest ${CERTIFIED_VITEST_VERSION} reporter surface changed`);
  for (let index = vitest.reporters.length - 1; index >= 0; index -= 1) {
    if (vitest.reporters[index]?.constructor?.name === 'DefaultReporter') vitest.reporters.splice(index, 1);
  }
}

/** Anchors existing path filters to the host cwd; substring filters stay unchanged. */
export function hostRelativeFilters(filters: readonly string[], cwd: string): readonly string[] {
  return filters.map((filter) => {
    if (filter === '' || isAbsolute(filter)) return filter;
    const anchored = resolve(cwd, filter);
    return existsSync(anchored) ? anchored : filter;
  });
}

export function classifyVitestResult(result: TestRunResult): TerminalRunState {
  if (result.unhandledErrors.length > 0) return 'infrastructure-failed';
  const tests = result.testModules.flatMap((module) => [...module.children.allTests()]);
  if (tests.length === 0) return 'skipped';
  if (tests.every((testCase) => testCase.result().state === 'skipped')) return 'skipped';
  if (tests.some((testCase) => testCase.result().state === 'failed')) return 'failed';
  if (tests.some((testCase) => {
    const native = testCase.result() as { readonly state: string; readonly retryCount?: number };
    return native.state === 'passed' && (native.retryCount ?? 0) > 0;
  })) return 'flaky';
  return 'passed';
}

/** @internal Concrete adapter pinned to the certified Vitest runtime surface. */
export class ExactVitestEngine implements TermwrightVitestEngine {
  readonly version: string;
  readonly #vitest: Vitest;
  readonly #consoleListeners = new Set<(log: UserConsoleLog) => void>();

  constructor(vitest: Vitest) {
    this.#vitest = vitest;
    this.version = vitest.version;
    assertCertifiedVitestRuntime(this.version);
    const reporter: Reporter = { onUserConsoleLog: (log) => {
      for (const listener of this.#consoleListeners) listener(log);
    } };
    const reporters = (vitest as Vitest & { readonly reporters?: Reporter[] }).reporters;
    if (!Array.isArray(reporters)) throw new Error(`Vitest ${CERTIFIED_VITEST_VERSION} reporter surface changed`);
    reporters.push(reporter);
  }

  setRunnerContext(context: TermwrightRunnerContext): void {
    (this.#vitest.provide as (key: string, value: unknown) => void)(TERMWRIGHT_RUNNER_CONTEXT_KEY, context);
  }

  async collect(filters: readonly string[]): Promise<EngineCollection> {
    const result = await this.#vitest.collect([...filters]);
    return { result, tests: result.testModules.flatMap((module) => [...module.children.allTests()]) };
  }

  async run(nativeModuleIds: ReadonlySet<string>): Promise<TestRunResult> {
    const specifications = await this.#vitest.globTestSpecifications([...nativeModuleIds]);
    return await this.#vitest.runTestSpecifications(specifications, true);
  }

  async cancel(): Promise<void> {
    await this.#vitest.cancelCurrentRun('termwright-host-cancel' as Parameters<Vitest['cancelCurrentRun']>[0]);
  }

  onSourceChange(listener: (file: string) => void): () => void {
    const watcher = this.#vitest.vite.watcher;
    const changed = (file: string): void => listener(file);
    watcher.on('change', changed);
    watcher.on('add', changed);
    watcher.on('unlink', changed);
    return () => {
      watcher.off('change', changed);
      watcher.off('add', changed);
      watcher.off('unlink', changed);
    };
  }

  onUserConsoleLog(listener: (log: UserConsoleLog) => void): () => void {
    this.#consoleListeners.add(listener);
    return () => this.#consoleListeners.delete(listener);
  }

  async close(): Promise<void> { await this.#vitest.close(); }
}
