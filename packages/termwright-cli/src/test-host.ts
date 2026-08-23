/** First-class Termwright process host backed by the exact-certified Vitest engine. */

import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { inspect, promisify } from 'node:util';
import { ResourceBroker, type ResourceVector } from '@termwright/resource-broker';
import { startResourceBrokerServer, type ResourceBrokerServer } from '@termwright/resource-broker/transport';
import { startRunJournalServer, type RunJournalServer } from '@termwright/run-journal-transport';
import {
  RUN_MANIFEST_VERSION,
  beginRunManifest,
  type NativeRunAttempt,
  type RunManifest,
  type RunManifestTransaction,
  type RunManifestWriter,
  type RunStartProvenance,
} from '@termwright/run-history';
import {
  RunEventJournal,
  RunEventProducer,
  RunIdFactory,
  canTransitionRunState,
  type InvocationId,
  type AttemptId,
  type ProjectId,
  type RunEvent,
  type RunId,
  type RunState,
  type RunnerTaskId,
  type SpecId,
  type TerminalRunState,
} from '@termwright/protocol';
import type {
  TermwrightHostTaskIdentity,
  TermwrightRunnerContext,
} from '@termwright/test/runner';
import {
  CERTIFIED_VITEST_VERSION,
  TERMWRIGHT_RUNNER_CONTEXT_KEY,
  assertCertifiedVitestRuntime,
} from '@termwright/test/vitest-engine';
import type { UserConsoleLog } from 'vitest';
import { createVitest, parseCLI, type Reporter, type TestCase, type TestRunResult, type Vitest } from 'vitest/node';
import { uiVitestViteOverrides } from './ui-vitest-config.js';
import type { TermwrightResourceProfile } from './resource-profiles.js';

const executeFile = promisify(execFile);
const CI_PROVENANCE_KEYS = [
  'CI', 'GITHUB_ACTIONS', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_WORKFLOW', 'GITHUB_JOB',
  'GITLAB_CI', 'CI_PIPELINE_ID', 'CI_JOB_ID', 'BUILDKITE', 'BUILDKITE_BUILD_ID',
  'TF_BUILD', 'BUILD_BUILDID', 'JENKINS_URL', 'BUILD_ID',
] as const;

export { TERMWRIGHT_RESOURCE_PROFILES } from './resource-profiles.js';
export type { TermwrightResourceProfile, TermwrightResourceProfileName } from './resource-profiles.js';

export interface NativeTestCase {
  readonly runnerTaskId: RunnerTaskId;
  readonly nativeTaskId: string;
  readonly projectId: ProjectId;
  readonly specId: SpecId;
  readonly project: string;
  readonly file: string;
  readonly fullName: string;
  readonly location?: { readonly line: number; readonly column: number };
  readonly metadata: unknown;
  /** Atomic pre-Attempt reservation declared through test.resources(). */
  readonly resourceReservation?: ResourceVector;
}

export interface NativeTestCatalog {
  readonly runId: RunId;
  readonly tests: readonly NativeTestCase[];
}

export interface RunRequest {
  /** Omit to execute the entire freshly collected native catalogue. */
  readonly runnerTaskIds?: readonly RunnerTaskId[];
  /** Collection is a host operation too; it never starts an assigned attempt. */
  readonly execute?: boolean;
  /** One total monotonic budget for collection, execution and finalization. */
  readonly timeoutMs?: number;
}

export interface TermwrightHostTimeouts {
  readonly startupMs: number;
  readonly runMs: number;
  readonly finalizationReserveMs: number;
}

export const DEFAULT_TERMWRIGHT_HOST_TIMEOUTS: TermwrightHostTimeouts = Object.freeze({
  startupMs: 30_000,
  runMs: 10 * 60_000,
  finalizationReserveMs: 30_000,
});

export class TermwrightHostTimeoutError extends Error {
  readonly code = 'TW_HOST_TIMEOUT';
  constructor(
    readonly phase: string,
    readonly totalMs: number,
  ) {
    super(`Termwright native host exceeded its ${totalMs} ms total deadline during ${phase}`);
    this.name = 'TermwrightHostTimeoutError';
  }
}

export interface RunCompletion {
  readonly invocationId: InvocationId;
  readonly runId: RunId;
  readonly state: TerminalRunState;
  readonly catalog: NativeTestCatalog | undefined;
  readonly events: readonly RunEvent[];
  readonly failures: readonly NativeTestFailure[];
  readonly error?: unknown;
}

export interface NativeTestFailure {
  readonly runnerTaskId: RunnerTaskId;
  readonly nativeTaskId: string;
  readonly file: string;
  readonly fullName: string;
  readonly errors: readonly string[];
}

export interface RunHandle {
  readonly invocationId: InvocationId;
  readonly runId: RunId;
  readonly completed: Promise<RunCompletion>;
}

export interface TermwrightTestHostOptions {
  readonly cwd: string;
  /** Explicit, recorded resource envelope. There is no host-dependent auto mode. */
  readonly resourceProfile: TermwrightResourceProfile;
  /** Required native-host history root. Every RunId gets one transaction. */
  readonly runsDir: string;
  /** Alternate durable backend; chiefly useful for deterministic host fault tests. */
  readonly runManifestWriter?: RunManifestWriter;
  /** Normal Vitest/Vite arguments. Termwright owns only certification-critical overrides. */
  readonly vitestArgs?: readonly string[];
  readonly filters?: readonly string[];
  readonly journalSink?: (events: readonly RunEvent[]) => void | Promise<void>;
  /** Best-effort live projection. Canonical persistence never depends on it. */
  readonly eventObserver?: (event: RunEvent) => void;
  readonly timeouts?: Partial<TermwrightHostTimeouts>;
}

interface EngineCollection {
  readonly result: TestRunResult;
  readonly tests: readonly TestCase[];
}

/** Narrow seam around the exact Vitest 3.2.7 APIs certified by this host. */
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

export interface WatchHandle {
  readonly initial: RunHandle;
  close(): Promise<void>;
}

interface ActiveRun {
  readonly runId: RunId;
  state: RunState;
  cancellationRequested: boolean;
  catalog?: NativeTestCatalog;
  readonly journal: RunEventJournal;
  /** Canonical accepted log, independent of best-effort external projections. */
  readonly recorded: RunEvent[];
  readonly persisted: RunEvent[];
  readonly history: Promise<RunManifestTransaction>;
  readonly attempts: Map<AttemptId, ObservedAttempt>;
  readonly controlFailures: Error[];
  readonly budget: HostRunBudget;
  selected?: readonly NativeTestCase[];
  readonly completed: Promise<RunCompletion>;
}

/**
 * Owns one persistent Vitest universe and serializes all collection/execution.
 *
 * A request receives its collision-safe RunId synchronously. Cancellation is
 * exact-run only; a stale UI request can never stop the next run.
 */
export class TermwrightTestHost {
  readonly invocationId: InvocationId;
  readonly #engine: TermwrightVitestEngine;
  readonly #ids: RunIdFactory;
  readonly #producer: RunEventProducer;
  readonly #gapProducer: RunEventProducer;
  readonly #filters: readonly string[];
  readonly #sink: (events: readonly RunEvent[]) => void | Promise<void>;
  readonly #eventObserver: ((event: RunEvent) => void) | undefined;
  readonly #resourceProfile: TermwrightResourceProfile;
  readonly #cwd: string;
  readonly #runsDir: string;
  readonly #runManifestWriter: RunManifestWriter | undefined;
  readonly #timeouts: TermwrightHostTimeouts;
  readonly #projects = new Map<string, ProjectId>();
  readonly #tasks = new Map<string, {
    readonly signature: string;
    readonly runnerTaskId: RunnerTaskId;
    readonly specId: SpecId;
  }>();
  #active: ActiveRun | undefined;
  readonly #detachConsole: (() => void) | undefined;
  #closed = false;
  #closePromise: Promise<void> | undefined;

  private constructor(
    engine: TermwrightVitestEngine,
    options: TermwrightTestHostOptions,
    ids = new RunIdFactory(),
  ) {
    this.#engine = engine;
    this.#filters = Object.freeze([...(options.filters ?? [])]);
    this.#sink = options.journalSink ?? (() => undefined);
    this.#eventObserver = options.eventObserver;
    this.#resourceProfile = options.resourceProfile;
    this.#cwd = options.cwd;
    this.#runsDir = options.runsDir;
    this.#runManifestWriter = options.runManifestWriter;
    this.#timeouts = resolveHostTimeouts(options.timeouts);
    this.#ids = ids;
    this.invocationId = ids.create('invocation');
    this.#producer = new RunEventProducer({
      producerId: ids.create('producer'),
      epoch: 0,
      wallNow: Date.now,
    });
    this.#gapProducer = new RunEventProducer({
      producerId: ids.create('producer'),
      epoch: 0,
      wallNow: Date.now,
    });
    this.#detachConsole = engine.onUserConsoleLog?.((log) => this.#recordUserConsoleLog(log));
  }

  static async open(options: TermwrightTestHostOptions): Promise<TermwrightTestHost> {
    const timeouts = resolveHostTimeouts(options.timeouts);
    const creation = createCertifiedVitestEngine(options);
    let created;
    try {
      created = await withinHostDeadline(
        creation,
        performance.now() + timeouts.startupMs,
        'engine startup',
        timeouts.startupMs,
      );
    } catch (error) {
      // createVitest has no AbortSignal. If it resolves after our public
      // deadline, immediately close the orphaned engine instead of letting a
      // late Vite server survive the failed open().
      void creation.then(({ engine }) => engine.close()).catch(() => undefined);
      throw error;
    }
    return new TermwrightTestHost(created.engine, {
      ...options,
      filters: hostRelativeFilters([...(options.filters ?? []), ...created.filters], options.cwd),
    });
  }

  /** Test seam; production callers use {@link open}. */
  static fromEngine(engine: TermwrightVitestEngine, options: TermwrightTestHostOptions): TermwrightTestHost {
    assertCertifiedVitestRuntime(engine.version);
    return new TermwrightTestHost(engine, options);
  }

  requestRun(request: RunRequest = {}): RunHandle {
    if (this.#closed) throw new Error('TermwrightTestHost is closed');
    if (this.#active !== undefined) throw new Error(`run ${this.#active.runId} is still active`);

    const runId = this.#ids.create('run');
    const journal = new RunEventJournal({
      invocationId: this.invocationId,
      runId,
      gapProducer: this.#gapProducer,
    });
    let settle!: (completion: RunCompletion) => void;
    const completed = new Promise<RunCompletion>((resolve) => {
      settle = resolve;
    });
    const startedAt = Date.now();
    const budget = new HostRunBudget(
      request.timeoutMs ?? this.#timeouts.runMs,
      this.#timeouts.finalizationReserveMs,
    );
    const active: ActiveRun = {
      runId,
      state: 'requested',
      cancellationRequested: false,
      journal,
      recorded: [],
      persisted: [],
      history: this.#beginHistory(runId, startedAt, budget),
      attempts: new Map(),
      controlFailures: [],
      budget,
      completed,
    };
    this.#active = active;
    this.#recordConfiguration(active);
    this.#recordState(active, 'requested');
    void this.#drive(active, request).then(settle);
    return Object.freeze({ invocationId: this.invocationId, runId, completed });
  }

  /**
   * Watches through the same Vite server owned by this host. Changes coalesce
   * to one subsequent RunId while a run is active; no sibling engine exists.
   */
  watch(request: RunRequest = {}, onCompletion?: (completion: RunCompletion) => void): WatchHandle {
    if (this.#closed) throw new Error('TermwrightTestHost is closed');
    let closed = false;
    let queued = false;
    let running: RunHandle;
    const launch = (): RunHandle => {
      const handle = this.requestRun(request);
      void handle.completed.then((completion) => onCompletion?.(completion)).finally(() => {
        if (!closed && queued) {
          queued = false;
          running = launch();
        }
      });
      return handle;
    };
    const detach = this.#engine.onSourceChange(() => {
      if (closed) return;
      if (this.#active !== undefined) queued = true;
      else running = launch();
    });
    running = launch();
    return Object.freeze({
      initial: running,
      async close(): Promise<void> {
        if (closed) return;
        closed = true;
        queued = false;
        detach();
      },
    });
  }

  async stop(runId: RunId): Promise<boolean> {
    const active = this.#active;
    if (active === undefined || active.runId !== runId) return false;
    if (active.cancellationRequested) return true;
    active.cancellationRequested = true;
    if (canTransitionRunState(active.state, 'cancelling')) this.#transition(active, 'cancelling');
    await this.#engine.cancel();
    return true;
  }

  close(): Promise<void> {
    this.#closePromise ??= this.#close();
    return this.#closePromise;
  }

  async #close(): Promise<void> {
    this.#closed = true;
    const active = this.#active;
    if (active !== undefined) {
      await this.stop(active.runId);
      await active.completed;
    }
    await this.#engine.close();
    this.#detachConsole?.();
  }

  async #drive(active: ActiveRun, request: RunRequest): Promise<RunCompletion> {
    let terminal: TerminalRunState = 'infrastructure-failed';
    let failure: unknown;
    const testFailures: NativeTestFailure[] = [];
    let brokerServer: ResourceBrokerServer | undefined;
    let journalServer: RunJournalServer | undefined;
    const expectedTasks = new Set<RunnerTaskId>();
    const skippedTasks = new Set<RunnerTaskId>();
    const attempts = active.attempts;
    let resourceFailure: Error | undefined;
    let resourceCancellation: Promise<void> | undefined;
    let history: RunManifestTransaction | undefined;
    try {
      history = await active.budget.execution('run history startup', () => active.history);
      const broker = new ResourceBroker({ runId: active.runId, capacities: this.#resourceProfile.capacities });
      brokerServer = await active.budget.execution('resource broker startup', () => startResourceBrokerServer({ broker, runId: active.runId }));
      journalServer = await active.budget.execution('run journal startup', () => startRunJournalServer({
        runId: active.runId,
        append: (event) => {
          observeAttemptEvent(event, expectedTasks, attempts);
          const appended = active.journal.append(event);
          if (!appended.ok) {
            throw new Error(`run journal rejected worker event: ${appended.code}: ${appended.detail}`);
          }
          active.recorded.push(event);
          this.#observe(event);
          if (event.type === 'attempt.finished' && event.identity.attemptId !== undefined) {
            const snapshot = broker.snapshot();
            const attemptId = event.identity.attemptId;
            const activeLeases = snapshot.active.filter((lease) => lease.attemptId === attemptId);
            const queued = snapshot.queue.filter((request) => request.attemptId === attemptId);
            if (activeLeases.length > 0 || queued.length > 0) {
              resourceFailure ??= new Error(
                `attempt ${attemptId} finished with ${activeLeases.length} active resource leases and ${queued.length} queued requests` +
                (activeLeases.length === 0 ? '' : `: ${JSON.stringify(activeLeases)}`),
              );
              // The transport ACK is written in the current poll phase. A
              // managed setImmediate task requests cancellation afterwards,
              // so the worker never deadlocks waiting for its final journal
              // ACK and the host never leaves a fire-and-forget rejection.
              resourceCancellation ??= new Promise<void>((resolve) => setImmediate(resolve))
                .then(() => this.#engine.cancel());
            }
          }
        },
      }));
      const brokerContext = {
        endpoint: brokerServer.endpoint,
        token: brokerServer.token,
        workerEpoch: 0,
        workerIdPrefix: this.invocationId,
        handshakeTimeoutMs: 5_000,
        resourceProfile: this.#resourceProfile.perTerminal,
      } as const;
      const journalContext = {
        endpoint: journalServer.endpoint,
        token: journalServer.token,
        handshakeTimeoutMs: 5_000,
        acknowledgementTimeoutMs: 5_000,
        binding: 'host-assigned-worker',
      } as const;
      this.#transition(active, 'collecting');
      // Collection constructs the certified runner but executes no task. An
      // empty assignment is therefore the only truthful bootstrap context.
      this.#engine.setRunnerContext({
        invocationId: this.invocationId,
        runId: active.runId,
        tasks: {},
        broker: brokerContext,
        journal: journalContext,
      });
      const collection = await active.budget.execution('Vitest collection', () => this.#engine.collect(this.#filters));
      if (collection.result.unhandledErrors.length > 0) {
        throw new AggregateError(collection.result.unhandledErrors, 'Vitest collection failed');
      }
      if (collection.tests.length === 0 && this.#filters.length > 0) {
        // A filter that selects nothing is a caller error, not an empty run.
        // Reporting it as `skipped` made a misdirected filter look like a
        // passing suite, which is the failure mode this host exists to remove.
        throw new Error(
          `no test matched the host filters [${this.#filters.join(', ')}] under root ${this.#cwd}`,
        );
      }
      const catalog = this.#catalog(active.runId, collection.tests);
      active.catalog = catalog;
      const selected = this.#select(catalog, request.runnerTaskIds);
      active.selected = selected;
      if (active.cancellationRequested) {
        terminal = 'cancelled';
      } else if (request.execute === false) {
        // Collection-only is still a scheduled host operation with a durable
        // result. Keep the closed state machine truthful instead of inventing
        // a collecting -> finalizing shortcut.
        this.#transition(active, 'scheduled');
        this.#transition(active, 'finalizing');
        terminal = 'skipped';
      } else {
        this.#transition(active, 'scheduled');
        const tasks: Record<string, TermwrightHostTaskIdentity> = Object.create(null) as Record<string, TermwrightHostTaskIdentity>;
        const modules = new Set<string>();
        for (const test of selected) {
          expectedTasks.add(test.runnerTaskId);
          tasks[test.nativeTaskId] = {
            runnerTaskId: test.runnerTaskId,
            projectId: test.projectId,
            specId: test.specId,
            file: test.file,
            fullName: test.fullName,
            ...(test.resourceReservation === undefined
              ? {}
              : { resourceReservation: test.resourceReservation }),
          };
          modules.add(test.file);
        }
        this.#engine.setRunnerContext({
          invocationId: this.invocationId,
          runId: active.runId,
          tasks,
          broker: brokerContext,
          journal: journalContext,
        });
        if (selected.length === 0) {
          this.#transition(active, 'finalizing');
          terminal = 'skipped';
        } else {
          this.#transition(active, 'running');
          const result = await active.budget.execution('Vitest execution', () => this.#engine.run(modules));
          const selectedByNativeId = new Map(selected.map((test) => [test.nativeTaskId, test.runnerTaskId]));
          const selectedCases = new Map(selected.map((test) => [test.nativeTaskId, test]));
          for (const module of result.testModules) {
            for (const testCase of module.children.allTests()) {
              const nativeResult = testCase.result();
              if (nativeResult.state !== 'passed' && nativeResult.state !== 'failed') {
                const task = selectedByNativeId.get(testCase.id);
                if (task !== undefined) skippedTasks.add(task);
              } else if (nativeResult.state === 'failed') {
                const identity = selectedCases.get(testCase.id);
                if (identity === undefined) continue;
                const observed = Object.freeze<NativeTestFailure>({
                  runnerTaskId: identity.runnerTaskId,
                  nativeTaskId: identity.nativeTaskId,
                  file: identity.file,
                  fullName: identity.fullName,
                  errors: Object.freeze(nativeResult.errors.map((error) => describeTestError(error))),
                });
                testFailures.push(observed);
                this.#recordTestFailure(active, identity, observed.errors);
              }
            }
          }
          // A leaked lease is infrastructure evidence, but it must not erase
          // the test/fixture error that caused teardown to become unverifiable.
          // Capture the exact native result first; only then fail the run at
          // the resource barrier. This ordering is diagnostic, not a fallback:
          // the final state remains infrastructure-failed and the lease stays
          // held until its worker is reclaimed.
          if (resourceCancellation !== undefined) {
            try { await active.budget.finalization('resource leak cancellation', () => resourceCancellation!); }
            catch (error) {
              throw new AggregateError([resourceFailure, error], 'resource leak cancellation failed');
            }
          }
          if (resourceFailure !== undefined) throw resourceFailure;
          this.#transition(active, active.cancellationRequested ? 'cancelling' : 'finalizing');
          terminal = active.cancellationRequested ? 'cancelled' : classifyVitestResult(result);
          // An unhandled error is the one classification that carries its own
          // evidence. Without lifting it into `failure` the run reports
          // infrastructure-failed with nothing to read: the reason exists, and
          // only this assignment puts it in the journal and the CLI output.
          if (terminal === 'infrastructure-failed' && result.unhandledErrors.length > 0) {
            failure = new AggregateError(
              result.unhandledErrors.map((error) => (error instanceof Error ? error : new Error(describeFailure(error)))),
              `vitest reported ${result.unhandledErrors.length} unhandled error(s) outside any test`,
            );
          }
        }
      }
    } catch (error) {
      failure = error;
      terminal = active.cancellationRequested ? 'cancelled' : isNoSpace(error) ? 'incomplete' : 'infrastructure-failed';
      if (canTransitionRunState(active.state, 'finalizing')) this.#transition(active, 'finalizing');
      if (error instanceof TermwrightHostTimeoutError) {
        try { await active.budget.finalization('Vitest timeout cancellation', () => this.#engine.cancel()); }
        catch (cancelError) {
          failure = new AggregateError([error, cancelError], 'host timeout cancellation failed');
          terminal = 'incomplete';
        }
      }
    }

    if (active.state === 'cancelling' && canTransitionRunState(active.state, 'finalizing')) {
      this.#transition(active, 'finalizing');
    }

    if (brokerServer !== undefined) {
      const leaked = brokerServer.snapshot();
      if ((leaked.active.length > 0 || leaked.queue.length > 0) && resourceFailure === undefined) {
        const leak = new Error(
          `run ${active.runId} reached finalization with ${leaked.active.length} active resource leases and ${leaked.queue.length} queued requests`,
        );
        failure = failure === undefined ? leak : new AggregateError([failure, leak], 'run left resource leases');
        terminal = 'infrastructure-failed';
      }
      try {
        await active.budget.finalization('resource broker close', () => brokerServer.close());
      } catch (error) {
        failure = failure === undefined ? error : new AggregateError([failure, error], 'run broker cleanup failed');
        terminal = 'incomplete';
      }
    }

    if (journalServer !== undefined) {
      try {
        await active.budget.finalization('run journal close', () => journalServer.close());
      } catch (error) {
        failure = failure === undefined ? error : new AggregateError([failure, error], 'run journal transport cleanup failed');
        terminal = 'incomplete';
      }
    }

    if (!active.cancellationRequested && resourceFailure === undefined && expectedTasks.size > 0) {
      const unfinished = [...attempts.entries()].filter(([, attempt]) => !attempt.finished);
      const observedTasks = new Set([...attempts.values()].filter((attempt) => attempt.finished).map((attempt) => attempt.task));
      const missingTasks = [...expectedTasks].filter((task) => !observedTasks.has(task) && !skippedTasks.has(task));
      if (unfinished.length > 0 || missingTasks.length > 0) {
        // Name the tasks. A RunnerTaskId identifies the attempt to the journal
        // but tells a reader nothing about which test stopped short, and this
        // barrier fires exactly when the run cannot explain itself.
        const named = (task: RunnerTaskId): string => {
          const test = active.catalog?.tests.find((candidate) => candidate.runnerTaskId === task);
          return test === undefined ? task : `${test.file} > ${test.fullName}`;
        };
        // The last event the run did see for an attempt separates "the worker
        // stopped talking right after it started" from "it kept reporting and
        // only the terminal event is missing". Those have different causes and
        // the barrier is where a reader finds out which one happened.
        const lastSeen = (attemptId: string): string => {
          const events = active.recorded.filter((event) => event.identity.attemptId === attemptId);
          const last = events.at(-1);
          return last === undefined ? 'no events' : `${events.length} events, last ${last.type}`;
        };
        const lifecycleFailure = new Error(
          `authoritative attempt journal incomplete: ${unfinished.length} attempts unfinished` +
          `${unfinished.length === 0 ? '' : ` (${unfinished.slice(0, 8).map(([attemptId, attempt]) => `${named(attempt.task)} [${lastSeen(attemptId)}]`).join('; ')})`}` +
          `, ${missingTasks.length} executed tasks without a finished attempt` +
          `${missingTasks.length === 0 ? '' : ` (${missingTasks.slice(0, 8).map(named).join('; ')})`}`,
        );
        failure = failure === undefined
          ? lifecycleFailure
          : new AggregateError([failure, lifecycleFailure], 'run attempt finalization barrier failed');
        terminal = 'infrastructure-failed';
      }
    }

    if (active.controlFailures.length > 0) {
      const outputFailure = new AggregateError(
        active.controlFailures,
        'structured test output could not be attributed authoritatively',
      );
      failure = failure === undefined
        ? outputFailure
        : new AggregateError([failure, outputFailure], 'run control-plane evidence failed');
      terminal = 'infrastructure-failed';
    }

    if (failure !== undefined && (terminal === 'infrastructure-failed' || terminal === 'crashed')) {
      this.#recordInfrastructureFailure(active, failure);
    }

    try {
      // Persist every causal fact through finalization before appending a
      // successful terminal state. A failed sink therefore cannot leave a
      // durable journal that says "passed" while the returned run is
      // incomplete.
      await active.budget.finalization('pre-terminal journal flush', () => this.#flush(active));
    } catch (error) {
      failure = failure === undefined ? error : new AggregateError([failure, error], 'run and journal finalization failed');
      terminal = 'incomplete';
    }

    // Resource ownership and durable pre-terminal events are both part of the
    // certified result. Only now may the terminal state enter the journal.
    if (canTransitionRunState(active.state, terminal)) this.#transition(active, terminal);

    try {
      await active.budget.finalization('terminal journal flush', () => this.#flush(active));
    } catch (error) {
      failure = failure === undefined
        ? error
        : new AggregateError(
            [failure, error],
            `${describeFailure(failure)}; terminal run state persistence also failed`,
            { cause: failure },
          );
      terminal = 'incomplete';
      try {
        this.#recordPersistenceFailure(active, 'external-journal-projection', error);
      } catch (recordError) {
        failure = new AggregateError([failure, recordError], 'external projection and canonical failure recording failed');
      }
      // A projection is not a competing source of truth. Retry once so it can
      // receive both the retained terminal event and the explicit failure.
      await this.#flush(active).catch(() => undefined);
    }

    if (history !== undefined) {
      try {
        // The manifest embeds the canonical journal, including terminal and
        // projection-failure events. The rename is the only certification
        // commit; a staging directory is always read as incomplete.
        await active.budget.finalization(
          'run history prepare',
          () => history.prepare(this.#manifest(active, attempts, terminal, history.start)),
        );
        await active.budget.finalization('run history commit', () => history.commitPrepared());
      } catch (error) {
        failure = failure === undefined ? error : new AggregateError([failure, error], 'run history commit failed');
        terminal = 'incomplete';
        try {
          this.#recordPersistenceFailure(active, 'canonical-run-history', error);
          // The canonical store remains staging/incomplete. This best-effort
          // projection corrects any observer that already saw run.state=passed.
          await this.#flush(active);
        } catch (projectionError) {
          failure = new AggregateError(
            [failure, projectionError],
            'canonical run history failed and its projection could not be corrected',
          );
        }
      }
    }

    if (this.#active === active) this.#active = undefined;

    return Object.freeze({
      invocationId: this.invocationId,
      runId: active.runId,
      state: terminal,
      catalog: active.catalog,
      events: Object.freeze([...active.recorded]),
      failures: Object.freeze([...testFailures]),
      ...(failure === undefined ? {} : { error: failure }),
    });
  }

  #catalog(runId: RunId, tests: readonly TestCase[]): NativeTestCatalog {
    // The native host owns the complete Vitest graph. Terminal-aware metadata
    // enriches a case; it must never act as a filter that silently drops pure
    // unit tests from certification.
    const catalog = tests.map((testCase): NativeTestCase => {
      const project = testCase.project.name;
      let projectId = this.#projects.get(project);
      if (projectId === undefined) {
        projectId = this.#ids.create('project');
        this.#projects.set(project, projectId);
      }
      const signature = JSON.stringify({
        project,
        file: testCase.module.moduleId,
        fullName: testCase.fullName,
        location: testCase.location ?? null,
      });
      let identity = this.#tasks.get(testCase.id);
      if (identity === undefined || identity.signature !== signature) {
        identity = {
          signature,
          runnerTaskId: this.#ids.create('runner-task'),
          specId: this.#ids.create('spec'),
        };
        this.#tasks.set(testCase.id, identity);
      }
      const metadata = testCase.meta();
      const resourceReservation = resourceReservationFromMetadata(metadata);
      return Object.freeze({
        runnerTaskId: identity.runnerTaskId,
        nativeTaskId: testCase.id,
        projectId,
        specId: identity.specId,
        project,
        file: testCase.module.moduleId,
        fullName: testCase.fullName,
        ...(testCase.location === undefined ? {} : { location: Object.freeze({ ...testCase.location }) }),
        metadata,
        ...(resourceReservation === undefined ? {} : { resourceReservation }),
      });
    });
    if (new Set(catalog.map((test) => test.nativeTaskId)).size !== catalog.length) {
      throw new Error('Vitest collection returned duplicate native test ids');
    }
    return Object.freeze({ runId, tests: Object.freeze(catalog) });
  }

  #select(catalog: NativeTestCatalog, ids: readonly RunnerTaskId[] | undefined): readonly NativeTestCase[] {
    if (ids === undefined) return catalog.tests;
    const byId = new Map(catalog.tests.map((test) => [test.runnerTaskId, test]));
    const seen = new Set<RunnerTaskId>();
    return ids.map((id) => {
      if (seen.has(id)) throw new TypeError(`duplicate selected RunnerTaskId ${id}`);
      seen.add(id);
      const test = byId.get(id);
      if (test === undefined) throw new TypeError(`RunnerTaskId ${id} is not part of run ${catalog.runId}`);
      return test;
    });
  }

  #transition(active: ActiveRun, next: RunState): void {
    if (active.state === next) return;
    if (!canTransitionRunState(active.state, next)) {
      throw new Error(`illegal run transition ${active.state} -> ${next}`);
    }
    active.state = next;
    this.#recordState(active, next);
  }

  #recordState(active: ActiveRun, state: RunState): void {
    const event = this.#producer.emit({
      eventClass: 'authoritative',
      type: 'run.state',
      identity: { invocationId: this.invocationId, runId: active.runId },
      payload: { state },
    });
    const appended = active.journal.append(event);
    if (!appended.ok) throw new Error(`run journal rejected state event: ${appended.code}: ${appended.detail}`);
    active.recorded.push(event);
    this.#observe(event);
  }

  #recordTestFailure(active: ActiveRun, test: NativeTestCase, errors: readonly string[]): void {
    const event = this.#producer.emit({
      eventClass: 'authoritative',
      type: 'test.failed',
      identity: {
        invocationId: this.invocationId,
        runId: active.runId,
        projectId: test.projectId,
        specId: test.specId,
        runnerTaskId: test.runnerTaskId,
      },
      payload: {
        nativeTaskId: test.nativeTaskId,
        file: test.file,
        fullName: test.fullName,
        errors,
      },
    });
    const appended = active.journal.append(event);
    if (!appended.ok) throw new Error(`run journal rejected test failure event: ${appended.code}: ${appended.detail}`);
    active.recorded.push(event);
    this.#observe(event);
  }

  #recordConfiguration(active: ActiveRun): void {
    const event = this.#producer.emit({
      eventClass: 'authoritative',
      type: 'run.configuration',
      identity: { invocationId: this.invocationId, runId: active.runId },
      payload: {
        engine: { name: 'vitest', version: this.#engine.version },
        runtime: { node: process.version, platform: process.platform, arch: process.arch },
        resourceProfile: {
          name: this.#resourceProfile.name,
          scheduler: { ...this.#resourceProfile.scheduler },
          capacities: { ...this.#resourceProfile.capacities },
          perTerminal: { ...this.#resourceProfile.perTerminal },
        },
        timeouts: {
          totalRunMs: active.budget.totalMs,
          finalizationReserveMs: active.budget.finalizationReserveMs,
        },
      },
    });
    const appended = active.journal.append(event);
    if (!appended.ok) throw new Error(`run journal rejected configuration event: ${appended.code}: ${appended.detail}`);
    active.recorded.push(event);
    this.#observe(event);
  }

  async #flush(active: ActiveRun): Promise<void> {
    const barrier = active.journal.barrier();
    await active.journal.flushThrough(barrier, async (events) => {
      await this.#sink(events);
      active.persisted.push(...events);
    });
  }

  #recordPersistenceFailure(active: ActiveRun, stage: string, error: unknown): void {
    const event = this.#producer.emit({
      eventClass: 'authoritative',
      type: 'run.persistence-failed',
      identity: { invocationId: this.invocationId, runId: active.runId },
      payload: { stage, detail: describeFailure(error) },
    });
    const appended = active.journal.append(event);
    if (!appended.ok) throw new Error(`run journal rejected persistence failure: ${appended.code}: ${appended.detail}`);
    active.recorded.push(event);
    this.#observe(event);
  }

  #recordInfrastructureFailure(active: ActiveRun, error: unknown): void {
    const event = this.#producer.emit({
      eventClass: 'authoritative',
      type: 'run.infrastructure-failed',
      identity: { invocationId: this.invocationId, runId: active.runId },
      payload: {
        category: infrastructureFailureCategory(error),
        detail: describeFailure(error).slice(0, 32 * 1024),
      },
    });
    const appended = active.journal.append(event);
    if (!appended.ok) throw new Error(`run journal rejected infrastructure failure: ${appended.code}: ${appended.detail}`);
    active.recorded.push(event);
    this.#observe(event);
  }

  #recordUserConsoleLog(log: UserConsoleLog): void {
    const active = this.#active;
    if (active === undefined) return;
    const test = log.taskId === undefined
      ? undefined
      : active.catalog?.tests.find((candidate) => candidate.nativeTaskId === log.taskId);
    const forTask = log.taskId === undefined
      ? []
      : [...active.attempts.entries()].filter(([, attempt]) => attempt.nativeTaskId === log.taskId);
    const running = forTask.filter(([, attempt]) => attempt.finished === undefined);
    // Vitest delivers console output on its own schedule, so a line written
    // just before a test returns can arrive after that attempt has finished.
    // That is a race, not a defect: the output is still recorded, but it
    // cannot carry the finished attempt's id, because the journal forbids any
    // event after attempt.finished. It is journalled against the run instead,
    // flagged unattributed. Only genuine ambiguity — no attempt for the task
    // at all, or several running at once — is a control-plane failure.
    if (test !== undefined && running.length > 1) {
      active.controlFailures.push(new Error(
        `console ${log.type} for native task ${log.taskId} matched ${running.length} concurrent attempts`,
      ));
    }
    if (test !== undefined && forTask.length === 0) {
      active.controlFailures.push(new Error(
        `console ${log.type} for native task ${log.taskId} matched no recorded attempt`,
      ));
    }
    const attempt = running.length === 1 ? running[0] : undefined;
    for (const [index, content] of splitDiagnosticContent(log.content)) {
      const event = this.#producer.emit({
        eventClass: 'diagnostic',
        type: 'test.output',
        identity: {
          invocationId: this.invocationId,
          runId: active.runId,
          ...(test === undefined ? {} : {
            projectId: test.projectId,
            specId: test.specId,
            runnerTaskId: test.runnerTaskId,
          }),
          ...(attempt === undefined ? {} : {
            executionId: attempt[1].executionId,
            attemptId: attempt[0],
          }),
        },
        payload: {
          stream: log.type,
          content,
          chunk: index,
          taskAttributed: test !== undefined && attempt !== undefined,
          ...(log.taskId === undefined ? {} : { nativeTaskId: log.taskId }),
          ...(log.origin === undefined ? {} : { origin: log.origin }),
          ...(log.browser === undefined ? {} : { browser: Boolean(log.browser) }),
        },
      });
      const appended = active.journal.append(event);
      if (!appended.ok) {
        active.controlFailures.push(new Error(
          `run journal rejected structured test output: ${appended.code}: ${appended.detail}`,
        ));
        continue;
      }
      active.recorded.push(event);
      this.#observe(event);
    }
  }

  #observe(event: RunEvent): void {
    try {
      this.#eventObserver?.(event);
    } catch {
      // The UI is a projection of the canonical journal. A broken tab or
      // embedding callback cannot change the certified test result.
    }
  }

  async #beginHistory(runId: RunId, startedAt: number, budget: HostRunBudget): Promise<RunManifestTransaction> {
    const start: RunStartProvenance = Object.freeze({
      invocationId: this.invocationId,
      runId,
      startedAt,
      engine: Object.freeze({
        name: 'vitest' as const,
        version: this.#engine.version,
        certification: `termwright-vitest-${CERTIFIED_VITEST_VERSION}`,
      }),
      runtime: Object.freeze({ node: process.version, platform: process.platform, arch: process.arch }),
      resources: Object.freeze({
        profile: this.#resourceProfile.name,
        scheduler: Object.freeze({ ...this.#resourceProfile.scheduler }),
        capacities: Object.freeze({ ...this.#resourceProfile.capacities }),
        perTerminal: Object.freeze({ ...this.#resourceProfile.perTerminal }),
      }),
      timeouts: Object.freeze({
        totalRunMs: budget.totalMs,
        finalizationReserveMs: budget.finalizationReserveMs,
      }),
      ci: Object.freeze(captureCiProvenance()),
      git: await captureGitProvenance(this.#cwd),
    });
    return beginRunManifest(this.#runsDir, start, {
      ...(this.#runManifestWriter === undefined ? {} : { writer: this.#runManifestWriter }),
    });
  }

  #manifest(
    active: ActiveRun,
    attempts: ReadonlyMap<AttemptId, ObservedAttempt>,
    status: TerminalRunState,
    start: RunStartProvenance,
  ): RunManifest {
    const specs = (active.selected ?? []).map((test) => Object.freeze({
      runnerTaskId: test.runnerTaskId,
      specId: test.specId,
      projectId: test.projectId,
      nativeTaskId: test.nativeTaskId,
      file: test.file,
      fullName: test.fullName,
    }));
    const completedAttempts: NativeRunAttempt[] = [];
    for (const [attemptId, attempt] of attempts) {
      completedAttempts.push(Object.freeze({
        attemptId,
        executionId: attempt.executionId,
        runnerTaskId: attempt.task,
        projectId: attempt.projectId,
        specId: attempt.specId,
        nativeTaskId: attempt.nativeTaskId,
        repeat: attempt.repeat,
        retry: attempt.retry,
        status: attempt.finished?.state ?? 'incomplete',
        durationMs: attempt.finished === undefined
          ? null
          : Math.max(0, attempt.finished.monotonicTime - attempt.startedAt),
      }));
    }
    return Object.freeze({
      ...start,
      v: RUN_MANIFEST_VERSION,
      finishedAt: Date.now(),
      status,
      specs: Object.freeze(specs),
      attempts: Object.freeze(completedAttempts),
      events: Object.freeze([...active.recorded]),
    });
  }
}

/**
 * Flattens an aggregate into a single readable line. Every infrastructure
 * failure this host raises is an AggregateError, so reading only `.message`
 * loses the actual cause.
 */
export function describeFailure(error: unknown): string {
  if (error instanceof AggregateError) {
    const nested = [...error.errors].map(describeFailure).filter((detail) => detail.length > 0);
    return nested.length === 0 ? error.message : `${error.message}: ${nested.join('; ')}`;
  }
  return error instanceof Error ? error.message : inspect(error, { depth: 16, breakLength: Infinity });
}

function infrastructureFailureCategory(error: unknown): string {
  if (containsHostTimeout(error)) return 'timeout';
  const detail = describeFailure(error).toLowerCase();
  if (detail.includes('collection')) return 'collection';
  if (detail.includes('resource lease') || detail.includes('resource broker')) return 'resource';
  if (detail.includes('journal')) return 'journal';
  if (detail.includes('worker') || detail.includes('channel closed') || detail.includes('ipc')) return 'worker';
  return 'engine';
}

function containsHostTimeout(error: unknown): boolean {
  if (error instanceof TermwrightHostTimeoutError) return true;
  if (error instanceof AggregateError) return [...error.errors].some(containsHostTimeout);
  return typeof error === 'object' && error !== null && containsHostTimeout((error as { cause?: unknown }).cause);
}

function describeTestError(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    const stack = record['stack'];
    if (typeof stack === 'string' && stack.length > 0) {
      const message = typeof record['message'] === 'string' ? record['message'] : '';
      const rendered = inspect(error, { depth: 16, breakLength: Infinity });
      const diagnostic = rendered === message || stack.includes(rendered) ? '' : `\n${rendered}`;
      return `${stack}${diagnostic}`.slice(0, 32 * 1024);
    }
    const message = record['message'];
    if (typeof message === 'string' && message.length > 0) return message.slice(0, 32 * 1024);
  }
  return inspect(error, { depth: 16, breakLength: Infinity }).slice(0, 32 * 1024);
}

interface ObservedAttempt {
  readonly task: RunnerTaskId;
  readonly executionId: NativeRunAttempt['executionId'];
  readonly projectId: ProjectId;
  readonly specId: SpecId;
  readonly nativeTaskId: string;
  readonly repeat: number;
  readonly retry: number;
  readonly startedAt: number;
  finished?: { readonly state: NativeRunAttempt['status']; readonly monotonicTime: number };
}

function observeAttemptEvent(
  event: RunEvent,
  expectedTasks: ReadonlySet<RunnerTaskId>,
  attempts: Map<AttemptId, ObservedAttempt>,
): void {
  if (event.type !== 'attempt.started' && event.type !== 'attempt.finished') return;
  const attemptId = event.identity.attemptId;
  const { runnerTaskId: task, executionId, projectId, specId } = event.identity;
  if (attemptId === undefined || task === undefined || executionId === undefined ||
      projectId === undefined || specId === undefined) {
    throw new Error(`${event.type} is missing its authoritative attempt identity`);
  }
  if (!expectedTasks.has(task)) throw new Error(`${event.type} belongs to unassigned RunnerTaskId ${task}`);
  const current = attempts.get(attemptId);
  if (event.type === 'attempt.started') {
    if (current !== undefined) throw new Error(`attempt ${attemptId} started more than once`);
    const payload = attemptPayload(event.payload, false);
    attempts.set(attemptId, {
      task, executionId, projectId, specId,
      nativeTaskId: payload.nativeTaskId,
      repeat: payload.repeat,
      retry: payload.retry,
      startedAt: event.monotonicTime,
    });
    return;
  }
  if (current === undefined) throw new Error(`attempt ${attemptId} finished before it started`);
  if (current.task !== task) throw new Error(`attempt ${attemptId} changed RunnerTaskId during execution`);
  if (current.finished !== undefined) throw new Error(`attempt ${attemptId} finished more than once`);
  if (current.executionId !== executionId || current.projectId !== projectId || current.specId !== specId) {
    throw new Error(`attempt ${attemptId} changed hierarchical identity during execution`);
  }
  const payload = attemptPayload(event.payload, true);
  if (payload.nativeTaskId !== current.nativeTaskId || payload.repeat !== current.repeat || payload.retry !== current.retry) {
    throw new Error(`attempt ${attemptId} changed native identity or ordinal during execution`);
  }
  current.finished = { state: payload.state, monotonicTime: event.monotonicTime };
}

function attemptPayload(payload: unknown, terminal: false): { readonly nativeTaskId: string; readonly repeat: number; readonly retry: number };
function attemptPayload(payload: unknown, terminal: true): { readonly nativeTaskId: string; readonly repeat: number; readonly retry: number; readonly state: NativeRunAttempt['status'] };
function attemptPayload(payload: unknown, terminal: boolean) {
  if (typeof payload !== 'object' || payload === null) throw new Error('attempt event payload is not an object');
  const record = payload as Record<string, unknown>;
  if (typeof record['nativeTaskId'] !== 'string' || record['nativeTaskId'] === '' ||
      !nonNegativeInteger(record['repeat']) || !nonNegativeInteger(record['retry'])) {
    throw new Error('attempt event payload has invalid native identity or ordinal');
  }
  const state = record['state'];
  if (terminal && state !== 'passed' && state !== 'failed' && state !== 'skipped') {
    throw new Error('attempt.finished payload has invalid state');
  }
  return terminal
    ? { nativeTaskId: record['nativeTaskId'], repeat: record['repeat'], retry: record['retry'], state }
    : { nativeTaskId: record['nativeTaskId'], repeat: record['repeat'], retry: record['retry'] };
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

/** Converts the closed public hint into the broker's complete atomic vector. */
function resourceReservationFromMetadata(metadata: unknown): ResourceVector | undefined {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) return undefined;
  const termwright = (metadata as Record<string, unknown>)['termwright'];
  if (typeof termwright !== 'object' || termwright === null || Array.isArray(termwright)) return undefined;
  const resources = (termwright as Record<string, unknown>)['resources'];
  if (resources === undefined) return undefined;
  if (typeof resources !== 'object' || resources === null || Array.isArray(resources)) {
    throw new TypeError('collected termwright.resources metadata is not an object');
  }
  const record = resources as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== 'terminals' && key !== 'traceWriters') {
      throw new TypeError(`collected termwright.resources contains unknown key ${key}`);
    }
  }
  const terminals = boundedResourceAmount(record['terminals'], 'terminals');
  // A terminal may retain a trace even on an otherwise passing run. Reserving
  // the writer with the terminal is the safe default; tests configured with
  // trace:'off' can opt out explicitly with traceWriters:0.
  const traceWriters = record['traceWriters'] === undefined
    ? terminals
    : boundedResourceAmount(record['traceWriters'], 'traceWriters');
  if (terminals === 0 && traceWriters === 0) {
    throw new TypeError('collected termwright.resources must reserve at least one resource');
  }
  return Object.freeze({
    ...(terminals === 0 ? {} : {
      ptySession: terminals,
      externalProcess: terminals,
      semanticEndpoint: terminals,
    }),
    ...(traceWriters === 0 ? {} : { traceWriter: traceWriters }),
  });
}

function boundedResourceAmount(value: unknown, label: string): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 1_024) {
    throw new RangeError(`collected termwright.resources.${label} must be an integer between 0 and 1024`);
  }
  return value as number;
}

function isNoSpace(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ((error as NodeJS.ErrnoException).code === 'ENOSPC') return true;
  return isNoSpace((error as { cause?: unknown }).cause);
}

function captureCiProvenance(): Record<string, string> {
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const key of CI_PROVENANCE_KEYS) {
    const value = process.env[key];
    if (value !== undefined && value !== '') result[key] = value.slice(0, 16_384);
  }
  return result;
}

async function captureGitProvenance(cwd: string): Promise<RunStartProvenance['git']> {
  const commit = await gitValue(cwd, ['rev-parse', 'HEAD']);
  if (commit === null) return null;
  // Resolve metadata by the captured commit, never by a second moving HEAD.
  const [details, branch] = await Promise.all([
    gitValue(cwd, ['show', '-s', '--format=%s%x00%an', commit]),
    gitValue(cwd, ['symbolic-ref', '--short', 'HEAD']),
  ]);
  if (details === null || branch === null) return null;
  const separator = details.indexOf('\0');
  if (separator <= 0 || separator === details.length - 1) return null;
  const message = details.slice(0, separator);
  const author = details.slice(separator + 1);
  return Object.freeze({ commit, message, author, branch });
}

async function gitValue(cwd: string, arguments_: readonly string[]): Promise<string | null> {
  try {
    const { stdout } = await executeFile('git', [...arguments_], {
      cwd, timeout: 2_000, windowsHide: true, maxBuffer: 64 * 1024,
    });
    const value = stdout.trim();
    return value === '' ? null : value;
  } catch {
    return null;
  }
}

async function createCertifiedVitestEngine(options: TermwrightTestHostOptions): Promise<{
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
    root: options.cwd,
    watch: false,
    run: true,
    pool: options.resourceProfile.scheduler.pool,
    maxWorkers: options.resourceProfile.scheduler.maxWorkers,
    fileParallelism: options.resourceProfile.scheduler.fileParallelism,
    includeTaskLocation: true,
    runner,
    provide: {
      ...(parsed.options.provide ?? {}),
      [TERMWRIGHT_RUNNER_CONTEXT_KEY]: bootstrapContext,
    },
  }, uiVitestViteOverrides());
  removeEmbeddedDefaultReporter(vitest);
  await vitest.init();
  return { engine: new ExactVitestEngine(vitest), filters: parsed.filter };
}

/**
 * Termwright owns its default human projection; Vitest's implicit default
 * reporter would create a second, unstructured stdout plane. Explicit custom
 * reporters remain composed in their original order.
 */
function removeEmbeddedDefaultReporter(vitest: Vitest): void {
  const exact = vitest as Vitest & { readonly reporters?: Reporter[] };
  if (!Array.isArray(exact.reporters)) {
    throw new Error(`Vitest ${CERTIFIED_VITEST_VERSION} reporter surface changed`);
  }
  for (let index = exact.reporters.length - 1; index >= 0; index -= 1) {
    if (exact.reporters[index]?.constructor?.name === 'DefaultReporter') {
      exact.reporters.splice(index, 1);
    }
  }
}

/**
 * Anchors path filters to the host's declared `cwd`.
 *
 * Vitest resolves a relative filter with `relative(project.dir, filter)`, which
 * Node anchors to `process.cwd()`. The host declares its own root instead, so
 * the same options would otherwise select different tests depending on the
 * directory the host process happens to run in — `pnpm --filter` runs a script
 * from the package directory, and the filters then matched nothing. Absolute
 * filters take Vitest's `isAbsolute` branch, which no working directory can
 * reinterpret. Filters that do not name an existing path stay untouched: those
 * are substring patterns, not paths.
 */
function hostRelativeFilters(filters: readonly string[], cwd: string): readonly string[] {
  return filters.map((filter) => {
    if (filter === '' || isAbsolute(filter)) return filter;
    const anchored = resolve(cwd, filter);
    return existsSync(anchored) ? anchored : filter;
  });
}

class ExactVitestEngine implements TermwrightVitestEngine {
  readonly version: string;
  readonly #vitest: Vitest;
  readonly #consoleListeners = new Set<(log: UserConsoleLog) => void>();

  constructor(vitest: Vitest) {
    this.#vitest = vitest;
    this.version = vitest.version;
    assertCertifiedVitestRuntime(this.version);
    const reporter: Reporter = {
      onUserConsoleLog: (log) => {
        for (const listener of this.#consoleListeners) listener(log);
      },
    };
    const reporters = (vitest as Vitest & { readonly reporters?: Reporter[] }).reporters;
    if (!Array.isArray(reporters)) throw new Error(`Vitest ${CERTIFIED_VITEST_VERSION} reporter surface changed`);
    reporters.push(reporter);
  }

  setRunnerContext(context: TermwrightRunnerContext): void {
    // ProvidedContext is declaration-merged by consumer projects and is
    // therefore `never` inside the host package itself. The runtime API is the
    // exact-certified string-keyed transport verified by host integration.
    (this.#vitest.provide as (key: string, value: unknown) => void)(TERMWRIGHT_RUNNER_CONTEXT_KEY, context);
  }

  async collect(filters: readonly string[]): Promise<EngineCollection> {
    const result = await this.#vitest.collect([...filters]);
    const tests = result.testModules.flatMap((module) => [...module.children.allTests()]);
    return { result, tests };
  }

  async run(nativeModuleIds: ReadonlySet<string>): Promise<TestRunResult> {
    const specifications = await this.#vitest.globTestSpecifications([...nativeModuleIds]);
    return await this.#vitest.runTestSpecifications(specifications, true);
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

const MAX_DIAGNOSTIC_CONTENT_BYTES = 12 * 1024;

function splitDiagnosticContent(content: string): readonly (readonly [number, string])[] {
  if (Buffer.byteLength(content, 'utf8') <= MAX_DIAGNOSTIC_CONTENT_BYTES) return [[0, content]];
  const chunks: Array<readonly [number, string]> = [];
  let current = '';
  let bytes = 0;
  for (const character of content) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (bytes + characterBytes > MAX_DIAGNOSTIC_CONTENT_BYTES && current !== '') {
      chunks.push([chunks.length, current]);
      current = '';
      bytes = 0;
    }
    current += character;
    bytes += characterBytes;
  }
  if (current !== '' || chunks.length === 0) chunks.push([chunks.length, current]);
  return chunks;
}

class HostRunBudget {
  readonly #startedAt = performance.now();
  readonly #deadlineAt: number;
  readonly #executionDeadlineAt: number;

  constructor(
    readonly totalMs: number,
    readonly finalizationReserveMs: number,
  ) {
    positiveFinite(totalMs, 'run timeout');
    positiveFinite(finalizationReserveMs, 'host finalization reserve');
    if (finalizationReserveMs >= totalMs) {
      throw new TypeError('host finalization reserve must be smaller than the total run timeout');
    }
    this.#deadlineAt = this.#startedAt + totalMs;
    this.#executionDeadlineAt = this.#deadlineAt - finalizationReserveMs;
  }

  execution<T>(phase: string, operation: () => Promise<T>): Promise<T> {
    return startWithinHostDeadline(operation, this.#executionDeadlineAt, phase, this.totalMs);
  }

  finalization<T>(phase: string, operation: () => Promise<T>): Promise<T> {
    return startWithinHostDeadline(operation, this.#deadlineAt, phase, this.totalMs);
  }
}

function resolveHostTimeouts(input: Partial<TermwrightHostTimeouts> | undefined): TermwrightHostTimeouts {
  const resolved = Object.freeze({ ...DEFAULT_TERMWRIGHT_HOST_TIMEOUTS, ...input });
  positiveFinite(resolved.startupMs, 'host startup timeout');
  positiveFinite(resolved.runMs, 'host run timeout');
  positiveFinite(resolved.finalizationReserveMs, 'host finalization reserve');
  if (resolved.finalizationReserveMs >= resolved.runMs) {
    throw new TypeError('host finalization reserve must be smaller than the default run timeout');
  }
  return resolved;
}

async function withinHostDeadline<T>(
  operation: Promise<T>,
  deadlineAt: number,
  phase: string,
  totalMs: number,
): Promise<T> {
  const remaining = deadlineAt - performance.now();
  if (remaining <= 0) {
    void operation.catch(() => undefined);
    throw new TermwrightHostTimeoutError(phase, totalMs);
  }
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TermwrightHostTimeoutError(phase, totalMs)), remaining);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function startWithinHostDeadline<T>(
  operation: () => Promise<T>,
  deadlineAt: number,
  phase: string,
  totalMs: number,
): Promise<T> {
  if (performance.now() >= deadlineAt) {
    return Promise.reject(new TermwrightHostTimeoutError(phase, totalMs));
  }
  return withinHostDeadline(operation(), deadlineAt, phase, totalMs);
}

function positiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${label} must be a positive finite number`);
}

function classifyVitestResult(result: TestRunResult): TerminalRunState {
  if (result.unhandledErrors.length > 0) return 'infrastructure-failed';
  const tests = result.testModules.flatMap((module) => [...module.children.allTests()]);
  if (tests.length === 0) return 'skipped';
  if (tests.every((testCase) => testCase.result().state === 'skipped')) return 'skipped';
  if (tests.some((testCase) => testCase.result().state === 'failed')) return 'failed';
  if (tests.some((testCase) => {
    const result = testCase.result() as { readonly state: string; readonly retryCount?: number };
    return result.state === 'passed' && (result.retryCount ?? 0) > 0;
  })) return 'flaky';
  return 'passed';
}
