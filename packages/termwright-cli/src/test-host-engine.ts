/** Exact-certified Vitest boundary used by the native host coordinator. */

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { UserConsoleLog } from 'vitest';
import {
  createVitest,
  parseCLI,
  type Reporter,
  type TestCase,
  type TestRunResult,
  type Vitest,
} from 'vitest/node';
import {
  RunIdFactory,
  type InvocationId,
  type ProjectId,
  type RunId,
  type RunnerTaskId,
  type ShardId,
  type SpecId,
  type TerminalRunState,
} from '@termwright/protocol';
import type { ResourceVector } from '@termwright/resource-broker';
import type { TermwrightResourceProfile } from './resource-profiles.js';
import { uiVitestViteOverrides } from './ui-vitest-config.js';

interface AttemptBudgetReserves {
  readonly diagnosticsMs: number;
  readonly traceFlushMs: number;
  readonly teardownMs: number;
}

/** Private host/worker contract. It is deliberately absent from package exports. */
export interface TermwrightHostTaskIdentity {
  readonly runnerTaskId: RunnerTaskId;
  readonly projectId: ProjectId;
  readonly specId: SpecId;
  readonly shardId?: ShardId;
  readonly file: string;
  readonly fullName: string;
  readonly resourceReservation?: ResourceVector;
  readonly strictResourceReservation?: boolean;
  readonly resourceDecision: string;
}

export interface TermwrightRunnerContext {
  readonly invocationId: InvocationId;
  readonly runId: RunId;
  readonly tasks: Readonly<Record<string, TermwrightHostTaskIdentity>>;
  readonly budgetReserves?: AttemptBudgetReserves;
  readonly broker: {
    readonly endpoint: string;
    readonly token: string;
    readonly workerEpoch: number;
    readonly workerIdPrefix: string;
    readonly handshakeTimeoutMs: number;
    readonly admissionDeadline: number;
    readonly resourceProfile: ResourceVector;
  };
  readonly journal: {
    readonly endpoint: string;
    readonly token: string;
    readonly handshakeTimeoutMs: number;
    readonly acknowledgementTimeoutMs: number;
    readonly binding: 'host-assigned-worker';
  };
}

export const CERTIFIED_VITEST_VERSION = '4.1.11' as const;
const TERMWRIGHT_RUNNER_CONTEXT_KEY = 'termwright.runner.context.v3' as const;

export function assertCertifiedVitestRuntime(version = installedVitestVersion()): void {
  if (version !== CERTIFIED_VITEST_VERSION) {
    throw new Error(
      `unsupported Vitest runtime ${version}; Termwright is exact-certified for ${CERTIFIED_VITEST_VERSION}`,
    );
  }
}

function installedVitestVersion(): string {
  const manifest = createRequire(import.meta.url)('vitest/package.json') as {
    readonly version?: unknown;
  };
  if (typeof manifest.version !== 'string' || manifest.version === '') {
    throw new Error('the installed Vitest package has no valid version');
  }
  return manifest.version;
}

export interface EngineCollection {
  readonly result: TestRunResult;
  readonly tests: readonly TestCase[];
}

/** Narrow contract around the exact engine APIs certified by Termwright. */
export interface TermwrightVitestEngine {
  readonly version: string;
  /** Whether Vitest collected the repository default catalogue or an explicit subset. */
  readonly catalogueScope: 'full' | 'targeted';
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

interface VitestAsyncLeak {
  readonly type: string;
  readonly filename: string;
  readonly projectName?: string;
  readonly stack: string;
}

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
  const parsed = parseCLI(['vitest', 'run', ...(options.vitestArgs ?? [])], {
    allowUnknownOptions: true,
  });
  const testEntry = fileURLToPath(import.meta.resolve('@termwright/test'));
  const runner = resolve(dirname(testEntry), 'runner.js');
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
      admissionDeadline: performance.timeOrigin + performance.now() + 60_000,
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
  const vitest = await createVitest(
    'test',
    {
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
    },
    uiVitestViteOverrides(),
  );
  removeEmbeddedDefaultReporter(vitest);
  await vitest.standalone();
  return {
    engine: new ExactVitestEngine(
      vitest,
      vitestCatalogueScope(parsed.filter, parsed.options as Readonly<Record<string, unknown>>),
    ),
    filters: parsed.filter,
  };
}

const VITEST_CATALOGUE_SELECTORS = Object.freeze([
  'changed',
  'config',
  'dir',
  'exclude',
  'include',
  'project',
  'related',
  'shard',
  'tags',
  'tagsFilter',
  'testNamePattern',
] as const);

/** Classifies only selection-affecting CLI input; execution/reporting flags preserve the full catalogue. */
export function vitestCatalogueScope(
  filters: readonly string[],
  options: Readonly<Record<string, unknown>>,
): 'full' | 'targeted' {
  if (filters.length > 0) return 'targeted';
  return VITEST_CATALOGUE_SELECTORS.some(
    (key) => options[key] !== undefined && options[key] !== false,
  )
    ? 'targeted'
    : 'full';
}

/** Removes only Vitest's implicit human reporter; explicit reporters retain order. */
export function removeEmbeddedDefaultReporter(
  vitest: Pick<Vitest, 'version'> & { readonly reporters?: Reporter[] },
): void {
  if (!Array.isArray(vitest.reporters))
    throw new Error(`Vitest ${CERTIFIED_VITEST_VERSION} reporter surface changed`);
  for (let index = vitest.reporters.length - 1; index >= 0; index -= 1) {
    if (vitest.reporters[index]?.constructor?.name === 'DefaultReporter')
      vitest.reporters.splice(index, 1);
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

export function classifyVitestResult(
  result: TestRunResult,
  selectedNativeTaskIds: ReadonlySet<string>,
): TerminalRunState {
  if (result.unhandledErrors.length > 0) return 'infrastructure-failed';
  // Vitest keeps prior TestModule objects in its persistent state and may
  // return them again from a later runTestSpecifications() call. A host cycle
  // is authoritative only for the native tasks selected for that cycle.
  const selectedCounts = new Map<string, number>();
  const tests = result.testModules
    .flatMap((module) => [...module.children.allTests()])
    .filter((testCase) => {
      if (!selectedNativeTaskIds.has(testCase.id)) return false;
      selectedCounts.set(testCase.id, (selectedCounts.get(testCase.id) ?? 0) + 1);
      return true;
    });
  const missing = [...selectedNativeTaskIds].filter((id) => !selectedCounts.has(id));
  const duplicates = [...selectedCounts].filter(([, count]) => count !== 1).map(([id]) => id);
  if (missing.length > 0 || duplicates.length > 0) {
    throw new Error(
      `Vitest result does not exactly cover the selected native tasks: ` +
        `${missing.length} missing${missing.length === 0 ? '' : ` (${missing.join(', ')})`}, ` +
        `${duplicates.length} duplicated${duplicates.length === 0 ? '' : ` (${duplicates.join(', ')})`}`,
    );
  }
  if (tests.length === 0) return 'skipped';
  if (tests.every((testCase) => testCase.result().state === 'skipped')) return 'skipped';
  if (tests.some((testCase) => testCase.result().state === 'failed')) return 'failed';
  if (
    tests.some((testCase) => {
      const native = testCase.result() as { readonly state: string; readonly retryCount?: number };
      return native.state === 'passed' && (native.retryCount ?? 0) > 0;
    })
  )
    return 'flaky';
  if (tests.some((testCase) => testCase.result().state === 'skipped')) return 'passed-with-skips';
  return 'passed';
}

/** @internal Concrete adapter pinned to the certified Vitest runtime surface. */
export class ExactVitestEngine implements TermwrightVitestEngine {
  readonly version: string;
  readonly catalogueScope: 'full' | 'targeted';
  readonly #vitest: Vitest;
  readonly #consoleListeners = new Set<(log: UserConsoleLog) => void>();

  constructor(vitest: Vitest, catalogueScope: 'full' | 'targeted' = 'full') {
    this.#vitest = vitest;
    this.version = vitest.version;
    this.catalogueScope = catalogueScope;
    assertCertifiedVitestRuntime(this.version);
    const reporter: Reporter = {
      onUserConsoleLog: (log) => {
        for (const listener of this.#consoleListeners) listener(log);
      },
    };
    const reporters = (vitest as Vitest & { readonly reporters?: Reporter[] }).reporters;
    if (!Array.isArray(reporters))
      throw new Error(`Vitest ${CERTIFIED_VITEST_VERSION} reporter surface changed`);
    if (!(vitest.state.leakSet instanceof Set)) {
      throw new Error(`Vitest ${CERTIFIED_VITEST_VERSION} async-leak state surface changed`);
    }
    reporters.push(reporter);
  }

  setRunnerContext(context: TermwrightRunnerContext): void {
    (this.#vitest.provide as (key: string, value: unknown) => void)(
      TERMWRIGHT_RUNNER_CONTEXT_KEY,
      context,
    );
  }

  async collect(filters: readonly string[]): Promise<EngineCollection> {
    const result = await this.#runAndDrainWorkers(() => this.#vitest.collect([...filters]));
    return {
      result,
      tests: result.testModules.flatMap((module) => [...module.children.allTests()]),
    };
  }

  async run(nativeModuleIds: ReadonlySet<string>): Promise<TestRunResult> {
    const specifications = await this.#vitest.globTestSpecifications([...nativeModuleIds]);
    return await this.#runAndDrainWorkers(() =>
      this.#vitest.runTestSpecifications(specifications, true),
    );
  }

  /**
   * Vitest resolves collect/run when every worker has reported its file result,
   * but its default pool deliberately terminates those workers in the
   * background. Termwright's worker teardown closes the journal and broker
   * transports, so the host must drain the pool before it can close either
   * server or start the next phase with a fresh runner context.
   *
   * `pool` is an exact-certified Vitest 4.1.11 runtime surface even though its
   * declaration is private. Resetting it mirrors Vitest.close() and lets a
   * later collection/run create a fresh default pool without closing Vite.
   */
  async #runAndDrainWorkers(operation: () => Promise<TestRunResult>): Promise<TestRunResult> {
    let result!: TestRunResult;
    let operationFailed = false;
    let operationError: unknown;
    try {
      result = await operation();
    } catch (error) {
      operationFailed = true;
      operationError = error;
    }

    const runtime = this.#vitest as unknown as {
      pool?: { close(): Promise<void> } | undefined;
    };
    const pool = runtime.pool;
    let teardownFailed = false;
    let teardownError: unknown;
    if (pool !== undefined) {
      try {
        await pool.close();
      } catch (error) {
        teardownFailed = true;
        teardownError = error;
      } finally {
        runtime.pool = undefined;
      }
    }
    if (operationFailed) {
      if (teardownFailed) {
        throw new AggregateError(
          [operationError, teardownError],
          'Vitest operation and worker-pool teardown both failed',
          { cause: operationError },
        );
      }
      throw operationError;
    }
    if (teardownFailed) throw teardownError;

    // Worker-context cleanup can publish a teardown error while pool.close()
    // drains runner.stop(). The native result took its error snapshot before
    // that barrier, so refresh it after the barrier instead of certifying a
    // teardown failure as green.
    const observedLeaks = new Map<string, VitestAsyncLeak>();
    for (const leak of this.#vitest.state.leakSet) {
      const evidence = leak as VitestAsyncLeak;
      observedLeaks.set(
        `${evidence.type}\0${evidence.filename}\0${evidence.projectName ?? ''}`,
        evidence,
      );
    }
    // Vitest owns the detailed stack reporter. Keep canonical host evidence
    // bounded: embedding every captured async-hook stack in an AggregateError
    // can exceed the protocol's maximum event string and hide the leak behind
    // a secondary journal validation failure.
    const leakGroups = [...observedLeaks.values()];
    const reportedGroups = leakGroups.slice(0, 8);
    const asyncLeakErrors =
      observedLeaks.size === 0
        ? []
        : [
            new Error(
              `Vitest detected ${this.#vitest.state.leakSet.size} async leak(s) across ` +
                reportedGroups
                  .map((evidence) => {
                    const project =
                      evidence.projectName === undefined
                        ? ''
                        : ` in project ${evidence.projectName}`;
                    return `${evidence.type} from ${evidence.filename}${project}`;
                  })
                  .join('; ') +
                (leakGroups.length > reportedGroups.length
                  ? `; ${leakGroups.length - reportedGroups.length} additional source group(s)`
                  : ''),
            ),
          ];
    const unhandledErrors = [...this.#vitest.state.getUnhandledErrors(), ...asyncLeakErrors];
    if (
      unhandledErrors.length === result.unhandledErrors.length &&
      unhandledErrors.every((error, index) => error === result.unhandledErrors[index])
    ) {
      return result;
    }
    return { ...result, unhandledErrors };
  }

  async cancel(): Promise<void> {
    await this.#vitest.cancelCurrentRun(
      'termwright-host-cancel' as Parameters<Vitest['cancelCurrentRun']>[0],
    );
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

  async close(): Promise<void> {
    await this.#vitest.close();
  }
}
