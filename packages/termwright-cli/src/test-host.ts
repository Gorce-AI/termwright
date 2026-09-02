/** First-class Termwright process host backed by the exact-certified Vitest engine. */

import { inspect } from 'node:util';
import { dirname } from 'node:path';
import { ResourceBroker, type ResourceVector } from '@termwright/resource-broker';
import {
  startResourceBrokerServer,
  type ResourceBrokerServer,
} from '@termwright/resource-broker/transport';
import { startRunJournalServer, type RunJournalServer } from '@termwright/run-journal-transport';
import {
  type NativeRunAttempt,
  type RunResourceTelemetry,
  type RunManifestWriter,
  type RunStartProvenance,
} from '@termwright/run-history';
import {
  DEFAULT_RUN_EVENT_LIMITS,
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
import type { UserConsoleLog } from 'vitest';
import type { TestCase, TestRunResult } from 'vitest/node';
import type { TermwrightResourceProfile } from './resource-profiles.js';
import { ResourceCostHistory, type ResourceCostEstimate } from './resource-history.js';
import { preflightTestHost, type TermwrightHostPreflightOptions } from './preflight.js';
import {
  classifyVitestResult,
  createCertifiedVitestEngine,
  hostRelativeFilters,
  assertCertifiedVitestRuntime,
  type TermwrightHostTaskIdentity,
  type TermwrightVitestEngine,
} from './test-host-engine.js';
import {
  HostRunBudget,
  RunEventPersistence,
  RunHistoryPersistence,
  SYSTEM_HOST_DEADLINE_RUNTIME,
  TermwrightHostStartupCleanupError,
  TermwrightHostTimeoutError,
  withinHostDeadline,
} from './test-host-persistence.js';
import { loadRepositorySkipDeclarations } from './skip-policy.js';

export {
  HostRunBudget,
  TermwrightHostStartupCleanupError,
  TermwrightHostTimeoutError,
} from './test-host-persistence.js';
export type { TermwrightHostDeadlineRuntime } from './test-host-persistence.js';
export type { TermwrightVitestEngine } from './test-host-engine.js';

export {
  TERMWRIGHT_RESOURCE_PROFILES,
  detectTermwrightHostCapacity,
  resolveTermwrightResourceProfile,
} from './resource-profiles.js';
export type {
  TermwrightHostCapacity,
  TermwrightResourceProfile,
  TermwrightResourceProfileName,
} from './resource-profiles.js';

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
  /** Whether concrete subleases must stay within an explicit declaration. */
  readonly strictResourceReservation?: boolean;
  /** Persisted admission rationale; contains no raw historical identity. */
  readonly resourceDecision: string;
}

export interface NativeTestCatalog {
  readonly runId: RunId;
  readonly tests: readonly NativeTestCase[];
}

/** One native case Vitest selected but deliberately did not execute. */
export interface NativeTestSkip {
  readonly runnerTaskId: RunnerTaskId;
  readonly nativeTaskId: string;
  readonly file: string;
  readonly fullName: string;
}

/** Exact repository policy entry allowed to explain a skipped native case. */
export interface NativeTestSkipDeclaration {
  readonly id: string;
  readonly file: string;
  /** Optional exact top-level suite, excluding only its dynamic `(skipped: …)` suffix. */
  readonly suite?: string;
  /** Full native name, or the exact leaf title used by the platform registry. */
  readonly fullName: string;
  /** A required rule must be observed whenever its case is selected. */
  readonly required: boolean;
}

export interface NativeTestSkipPolicyResult {
  readonly status: 'matched' | 'mismatch';
  readonly declarations: number;
  readonly issues: readonly string[];
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

export interface RunCompletion {
  readonly invocationId: InvocationId;
  readonly runId: RunId;
  readonly state: TerminalRunState;
  readonly catalog: NativeTestCatalog | undefined;
  /** Bounded recent evidence projection in canonical order; history owns the complete stream. */
  readonly events: readonly RunEvent[];
  readonly failures: readonly NativeTestFailure[];
  readonly skips: readonly NativeTestSkip[];
  readonly skipPolicy: NativeTestSkipPolicyResult;
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
  /** Explicit variables installed in Vitest workers without mutating host process state. */
  readonly workerEnv?: Readonly<Record<string, string>>;
  readonly filters?: readonly string[];
  /** Best-effort live batch projection; canonical run-history persistence is independent. */
  readonly journalSink?: (events: readonly RunEvent[]) => void | Promise<void>;
  /** Best-effort live projection. Canonical persistence never depends on it. */
  readonly eventObserver?: (event: RunEvent) => void;
  readonly timeouts?: Partial<TermwrightHostTimeouts>;
  /** Cheap, caller-declared prerequisites checked before the engine starts. */
  readonly preflight?: TermwrightHostPreflightOptions;
  /** Exact applicable skip declarations; an observed undeclared skip is non-certifying. */
  readonly skipDeclarations?: readonly NativeTestSkipDeclaration[];
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
  readonly persistence: RunEventPersistence;
  readonly history: Promise<RunHistoryPersistence>;
  readonly attempts: Map<AttemptId, ObservedAttempt>;
  readonly controlFailures: Error[];
  readonly budget: HostRunBudget;
  readonly telemetry: RunTelemetrySampler;
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
  readonly #resourceHistory: Promise<ResourceCostHistory>;
  readonly #cwd: string;
  readonly #runsDir: string;
  readonly #runManifestWriter: RunManifestWriter | undefined;
  readonly #gitProvenance: RunStartProvenance['git'] | undefined;
  readonly #timeouts: TermwrightHostTimeouts;
  readonly #skipDeclarations: readonly NativeTestSkipDeclaration[];
  readonly #projects = new Map<string, ProjectId>();
  readonly #tasks = new Map<
    string,
    {
      readonly signature: string;
      readonly runnerTaskId: RunnerTaskId;
      readonly specId: SpecId;
    }
  >();
  #active: ActiveRun | undefined;
  readonly #detachConsole: (() => void) | undefined;
  #closed = false;
  #closePromise: Promise<void> | undefined;

  private constructor(
    engine: TermwrightVitestEngine,
    options: TermwrightTestHostOptions,
    ids = new RunIdFactory(),
    gitProvenance: RunStartProvenance['git'] | undefined = undefined,
    resourceHistory: ResourceCostHistory = ResourceCostHistory.memory(),
  ) {
    this.#engine = engine;
    this.#filters = Object.freeze([...(options.filters ?? [])]);
    this.#sink = options.journalSink ?? (() => undefined);
    this.#eventObserver = options.eventObserver;
    this.#resourceProfile = options.resourceProfile;
    this.#resourceHistory = Promise.resolve(resourceHistory);
    this.#cwd = options.cwd;
    this.#runsDir = options.runsDir;
    this.#runManifestWriter = options.runManifestWriter;
    this.#gitProvenance = gitProvenance;
    this.#timeouts = resolveHostTimeouts(options.timeouts);
    this.#skipDeclarations = Object.freeze([...(options.skipDeclarations ?? [])]);
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
    assertFirstWorkflowAttempt(process.env);
    await preflightTestHost(options);
    const skipDeclarations =
      options.skipDeclarations ?? (await loadRepositorySkipDeclarations(options.cwd));
    const timeouts = resolveHostTimeouts(options.timeouts);
    const creation = createCertifiedVitestEngine(options);
    let created;
    try {
      created = await withinHostDeadline(
        creation,
        performance.now() + timeouts.startupMs,
        'engine startup',
        timeouts.startupMs,
        SYSTEM_HOST_DEADLINE_RUNTIME,
      );
    } catch (error) {
      // createVitest has no AbortSignal. If it resolves after our public
      // deadline, immediately close the orphaned engine instead of letting a
      // late Vite server survive the failed open().
      void creation.then(({ engine }) => engine.close()).catch(() => undefined);
      throw error;
    }
    return new TermwrightTestHost(
      created.engine,
      {
        ...options,
        skipDeclarations,
        filters: hostRelativeFilters([...(options.filters ?? []), ...created.filters], options.cwd),
      },
      new RunIdFactory(),
      undefined,
      await ResourceCostHistory.load(dirname(options.runsDir)),
    );
  }

  /** Test seam; production callers use {@link open}. */
  static fromEngine(
    engine: TermwrightVitestEngine,
    options: TermwrightTestHostOptions,
    dependencies: {
      readonly gitProvenance?: RunStartProvenance['git'];
      readonly resourceHistory?: ResourceCostHistory;
    } = {},
  ): TermwrightTestHost {
    assertCertifiedVitestRuntime(engine.version);
    return new TermwrightTestHost(
      engine,
      options,
      new RunIdFactory(),
      dependencies.gitProvenance,
      dependencies.resourceHistory,
    );
  }

  requestRun(request: RunRequest = {}): RunHandle {
    if (this.#closed) throw new Error('TermwrightTestHost is closed');
    if (this.#active !== undefined) throw new Error(`run ${this.#active.runId} is still active`);

    const runId = this.#ids.create('run');
    let settle!: (completion: RunCompletion) => void;
    const completed = new Promise<RunCompletion>((resolve) => {
      settle = resolve;
    });
    const startedAt = Date.now();
    const budget = new HostRunBudget(
      request.timeoutMs ?? this.#timeouts.runMs,
      this.#timeouts.finalizationReserveMs,
    );
    const history = this.#beginHistory(runId, startedAt, budget);
    const persistence = new RunEventPersistence({
      invocationId: this.invocationId,
      runId,
      gapProducer: this.#gapProducer,
      sink: async (events) => (await history).appendEvents(events),
      projectionSink: this.#sink,
      ...(this.#eventObserver === undefined ? {} : { observer: this.#eventObserver }),
    });
    const active: ActiveRun = {
      runId,
      state: 'requested',
      cancellationRequested: false,
      persistence,
      history,
      attempts: new Map(),
      controlFailures: [],
      budget,
      telemetry: new RunTelemetrySampler(),
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
      void handle.completed
        .then((completion) => onCompletion?.(completion))
        .finally(() => {
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
    let skips: readonly NativeTestSkip[] = Object.freeze([]);
    let skipPolicy: NativeTestSkipPolicyResult = Object.freeze({
      status: 'matched',
      declarations: 0,
      issues: Object.freeze([]),
    });
    let brokerServer: ResourceBrokerServer | undefined;
    let journalServer: RunJournalServer | undefined;
    const expectedTasks = new Set<RunnerTaskId>();
    const skippedTasks = new Set<RunnerTaskId>();
    const attempts = active.attempts;
    let resourceFailure: Error | undefined;
    let resourceCancellation: Promise<void> | undefined;
    let history: RunHistoryPersistence | undefined;
    let ptySlotsPeak = 0;
    try {
      history = await active.budget.execution('run history startup', () => active.history);
      const broker = new ResourceBroker({
        runId: active.runId,
        capacities: this.#resourceProfile.capacities,
      });
      brokerServer = await active.budget.startResource('resource broker startup', (signal) =>
        startResourceBrokerServer({ broker, runId: active.runId, signal }),
      );
      journalServer = await active.budget.startResource('run journal startup', (signal) =>
        startRunJournalServer({
          runId: active.runId,
          signal,
          append: (event) => {
            observeAttemptEvent(event, expectedTasks, attempts, active.budget.elapsedMs());
            const appended = active.persistence.append(event);
            if (!appended.ok) {
              throw new Error(
                `run journal rejected worker event: ${appended.code}: ${appended.detail}`,
              );
            }
            const usage = broker.snapshot().used;
            ptySlotsPeak = Math.max(ptySlotsPeak, usage.ptySession);
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
                resourceCancellation ??= new Promise<void>((resolve) => setImmediate(resolve)).then(
                  () => this.#engine.cancel(),
                );
              }
            }
          },
        }),
      );
      const brokerContext = {
        endpoint: brokerServer.endpoint,
        token: brokerServer.token,
        workerEpoch: 0,
        workerIdPrefix: this.invocationId,
        handshakeTimeoutMs: 5_000,
        // Host execution cancellation is the causal owner of admission. This
        // later total-run deadline is only a backstop if worker cancellation
        // fails; using the execution instant here makes two processes race to
        // classify the same timeout. The epoch form is comparable across forks.
        admissionDeadline:
          performance.timeOrigin + performance.now() + active.budget.finalizationRemainingMs(),
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
      const collection = await active.budget.execution('Vitest collection', () =>
        this.#engine.collect(this.#filters),
      );
      const collectionErrors = collectVitestCollectionErrors(collection.result);
      if (collectionErrors.length > 0) {
        throw new AggregateError(collectionErrors, 'Vitest collection failed');
      }
      if (collection.tests.length === 0 && this.#filters.length > 0) {
        // A filter that selects nothing is a caller error, not an empty run.
        // Reporting it as `skipped` made a misdirected filter look like a
        // passing suite, which is the failure mode this host exists to remove.
        throw new Error(
          `no test matched the host filters [${this.#filters.join(', ')}] under root ${this.#cwd}`,
        );
      }
      const resourceHistory = await active.budget.execution(
        'resource history load',
        () => this.#resourceHistory,
      );
      const catalog = this.#catalog(active.runId, collection.tests, resourceHistory);
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
        const tasks: Record<string, TermwrightHostTaskIdentity> = Object.create(null) as Record<
          string,
          TermwrightHostTaskIdentity
        >;
        const modules = new Set<string>();
        for (const test of selected) {
          expectedTasks.add(test.runnerTaskId);
          tasks[test.nativeTaskId] = {
            runnerTaskId: test.runnerTaskId,
            projectId: test.projectId,
            specId: test.specId,
            file: test.file,
            fullName: test.fullName,
            resourceDecision: test.resourceDecision,
            ...(test.resourceReservation === undefined
              ? {}
              : {
                  resourceReservation: test.resourceReservation,
                  ...(test.strictResourceReservation ? { strictResourceReservation: true } : {}),
                }),
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
          const result = await active.budget.execution('Vitest execution', () =>
            this.#engine.run(modules),
          );
          const selectedByNativeId = new Map(
            selected.map((test) => [test.nativeTaskId, test.runnerTaskId]),
          );
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
                  errors: describeTestErrors(nativeResult.errors),
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
            try {
              await active.budget.finalization(
                'resource leak cancellation',
                () => resourceCancellation!,
              );
            } catch (error) {
              throw new AggregateError(
                [resourceFailure, error],
                'resource leak cancellation failed',
              );
            }
          }
          if (resourceFailure !== undefined) throw resourceFailure;
          this.#transition(active, active.cancellationRequested ? 'cancelling' : 'finalizing');
          terminal = active.cancellationRequested
            ? 'cancelled'
            : classifyVitestResult(result, new Set(selectedByNativeId.keys()));
          // An unhandled error is the one classification that carries its own
          // evidence. Without lifting it into `failure` the run reports
          // infrastructure-failed with nothing to read: the reason exists, and
          // only this assignment puts it in the journal and the CLI output.
          if (terminal === 'infrastructure-failed' && result.unhandledErrors.length > 0) {
            failure = new AggregateError(
              result.unhandledErrors.map((error) =>
                error instanceof Error ? error : new Error(describeFailure(error)),
              ),
              `vitest reported ${result.unhandledErrors.length} unhandled error(s) outside any test`,
            );
          }
        }
      }
    } catch (error) {
      failure = error;
      terminal =
        isNoSpace(error) || error instanceof TermwrightHostStartupCleanupError
          ? 'incomplete'
          : active.cancellationRequested
            ? 'cancelled'
            : 'infrastructure-failed';
      if (canTransitionRunState(active.state, 'finalizing')) this.#transition(active, 'finalizing');
      if (error instanceof TermwrightHostTimeoutError) {
        try {
          await active.budget.finalization('Vitest timeout cancellation', () =>
            this.#engine.cancel(),
          );
        } catch (cancelError) {
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
        failure =
          failure === undefined
            ? leak
            : new AggregateError([failure, leak], 'run left resource leases');
        terminal = 'infrastructure-failed';
      }
      try {
        await active.budget.finalization('resource broker close', () => brokerServer.close());
      } catch (error) {
        failure =
          failure === undefined
            ? error
            : new AggregateError([failure, error], 'run broker cleanup failed');
        terminal = 'incomplete';
      }
    }

    if (journalServer !== undefined) {
      try {
        await active.budget.finalization('run journal close', () => journalServer.close());
      } catch (error) {
        failure =
          failure === undefined
            ? error
            : new AggregateError([failure, error], 'run journal transport cleanup failed');
        terminal = 'incomplete';
      }
    }

    if (!active.cancellationRequested && resourceFailure === undefined && expectedTasks.size > 0) {
      const unfinished = [...attempts.entries()].filter(([, attempt]) => !attempt.finished);
      const observedTasks = new Set(
        [...attempts.values()].filter((attempt) => attempt.finished).map((attempt) => attempt.task),
      );
      // A runner/setup failure can happen before an authored Attempt exists
      // (notably scheduler admission). Vitest's failed task plus its recorded
      // test.failed event is complete evidence for that path; inventing an
      // attempt.started event would falsely claim admission had succeeded.
      const failedTasks = new Set(testFailures.map((test) => test.runnerTaskId));
      const missingTasks = [...expectedTasks].filter(
        (task) => !observedTasks.has(task) && !skippedTasks.has(task) && !failedTasks.has(task),
      );
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
          const activity = active.persistence.attemptActivity(attemptId);
          return activity === undefined
            ? 'no events'
            : `${activity.count} events, last ${activity.lastType}`;
        };
        const lifecycleFailure = new Error(
          `authoritative attempt journal incomplete: ${unfinished.length} attempts unfinished` +
            `${
              unfinished.length === 0
                ? ''
                : ` (${unfinished
                    .slice(0, 8)
                    .map(
                      ([attemptId, attempt]) => `${named(attempt.task)} [${lastSeen(attemptId)}]`,
                    )
                    .join('; ')})`
            }` +
            `, ${missingTasks.length} executed tasks without a finished attempt` +
            `${missingTasks.length === 0 ? '' : ` (${missingTasks.slice(0, 8).map(named).join('; ')})`}`,
        );
        failure =
          failure === undefined
            ? lifecycleFailure
            : new AggregateError(
                [failure, lifecycleFailure],
                'run attempt finalization barrier failed',
              );
        terminal = 'infrastructure-failed';
      }
    }

    if (active.controlFailures.length > 0) {
      const outputFailure = new AggregateError(
        active.controlFailures,
        'structured test output could not be attributed authoritatively',
      );
      failure =
        failure === undefined
          ? outputFailure
          : new AggregateError([failure, outputFailure], 'run control-plane evidence failed');
      terminal = 'infrastructure-failed';
    }

    skips = Object.freeze(
      [...skippedTasks].map((runnerTaskId): NativeTestSkip => {
        const test = active.catalog?.tests.find(
          (candidate) => candidate.runnerTaskId === runnerTaskId,
        );
        if (test === undefined)
          throw new Error(`skipped task ${runnerTaskId} disappeared from the native catalog`);
        return Object.freeze({
          runnerTaskId,
          nativeTaskId: test.nativeTaskId,
          file: test.file,
          fullName: test.fullName,
        });
      }),
    );
    skipPolicy = assessSkipPolicy(
      request.execute === false ? [] : (active.selected ?? []),
      skips,
      this.#skipDeclarations,
      request.runnerTaskIds === undefined &&
        request.execute !== false &&
        this.#filters.length === 0 &&
        this.#engine.catalogueScope === 'full'
        ? 'full'
        : 'targeted',
    );
    try {
      this.#recordSkipEvidence(active, skips, skipPolicy);
    } catch (error) {
      failure =
        failure === undefined
          ? error
          : new AggregateError([failure, error], 'run skip evidence failed');
      terminal = 'incomplete';
    }

    if (
      failure !== undefined &&
      (terminal === 'infrastructure-failed' ||
        terminal === 'crashed' ||
        failure instanceof TermwrightHostStartupCleanupError)
    ) {
      this.#recordInfrastructureFailure(active, failure);
    }

    try {
      // Persist every causal fact through finalization before appending a
      // successful terminal state. A failed sink therefore cannot leave a
      // durable journal that says "passed" while the returned run is
      // incomplete.
      await active.budget.finalization('pre-terminal journal flush', () =>
        active.persistence.flush(),
      );
    } catch (error) {
      failure =
        failure === undefined
          ? error
          : new AggregateError([failure, error], 'run and journal finalization failed');
      terminal = 'incomplete';
    }

    // Resource ownership and durable pre-terminal events are both part of the
    // certified result. Only now may the terminal state enter the journal.
    if (canTransitionRunState(active.state, terminal)) this.#transition(active, terminal);

    try {
      await active.budget.finalization('terminal journal flush', () => active.persistence.flush());
    } catch (error) {
      failure =
        failure === undefined
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
        failure = new AggregateError(
          [failure, recordError],
          'external projection and canonical failure recording failed',
        );
      }
      // A projection is not a competing source of truth. Retry once so it can
      // receive both the retained terminal event and the explicit failure.
      await active.persistence.flush().catch(() => undefined);
    }

    if (history !== undefined) {
      try {
        // The manifest embeds the canonical journal, including terminal and
        // projection-failure events. The rename is the only certification
        // commit; a staging directory is always read as incomplete.
        await active.budget.finalization('run history prepare', () =>
          history.prepare(this.#manifestInput(active, attempts, terminal, ptySlotsPeak)),
        );
        await active.budget.finalization('run history commit', () => history.commitPrepared());
        await active.budget
          .finalization('resource history update', () =>
            this.#updateResourceHistory(active, attempts),
          )
          .catch((error: unknown) => {
            process.stderr.write(
              `termwright: resource history update failed: ${describeFailure(error)}\n`,
            );
          });
      } catch (error) {
        failure =
          failure === undefined
            ? error
            : new AggregateError([failure, error], 'run history commit failed');
        terminal = 'incomplete';
        try {
          this.#recordPersistenceFailure(active, 'canonical-run-history', error);
          // The canonical store remains staging/incomplete. This best-effort
          // projection corrects any observer that already saw run.state=passed.
          await active.persistence.flush();
        } catch (projectionError) {
          failure = new AggregateError(
            [failure, projectionError],
            'canonical run history failed and its projection could not be corrected',
          );
        }
      }
    }

    if (this.#active === active) this.#active = undefined;
    active.telemetry.stop();

    return Object.freeze({
      invocationId: this.invocationId,
      runId: active.runId,
      state: terminal,
      catalog: active.catalog,
      events: Object.freeze([...active.persistence.recorded]),
      failures: Object.freeze([...testFailures]),
      skips,
      skipPolicy,
      ...(failure === undefined ? {} : { error: failure }),
    });
  }

  #catalog(
    runId: RunId,
    tests: readonly TestCase[],
    resourceHistory: ResourceCostHistory,
  ): NativeTestCatalog {
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
      const costIdentity = ResourceCostHistory.identity({
        project,
        file: testCase.module.moduleId,
        fullName: testCase.fullName,
        ...(testCase.location === undefined ? {} : testCase.location),
      });
      const estimate = resourceHistory.estimate(costIdentity);
      const declaredReservation = resourceReservationFromMetadata(
        metadata,
        this.#resourceProfile.capacities,
        this.#resourceProfile.perAttempt ?? {},
      );
      const resourceReservation = applyHistoricalMemoryCost(
        declaredReservation,
        estimate,
        this.#resourceProfile,
      );
      const strictResourceReservation = hasExplicitResourceMetadata(metadata);
      return Object.freeze({
        runnerTaskId: identity.runnerTaskId,
        nativeTaskId: testCase.id,
        projectId,
        specId: identity.specId,
        project,
        file: testCase.module.moduleId,
        fullName: testCase.fullName,
        ...(testCase.location === undefined
          ? {}
          : { location: Object.freeze({ ...testCase.location }) }),
        metadata,
        resourceDecision: resourceDecision(estimate, resourceReservation),
        ...(resourceReservation === undefined ? {} : { resourceReservation }),
        ...(strictResourceReservation ? { strictResourceReservation: true } : {}),
      });
    });
    if (new Set(catalog.map((test) => test.nativeTaskId)).size !== catalog.length) {
      throw new Error('Vitest collection returned duplicate native test ids');
    }
    return Object.freeze({ runId, tests: Object.freeze(catalog) });
  }

  async #updateResourceHistory(
    active: ActiveRun,
    attempts: ReadonlyMap<AttemptId, ObservedAttempt>,
  ): Promise<void> {
    const history = await this.#resourceHistory;
    const byTask = new Map(
      (active.selected ?? []).map((test) => [test.runnerTaskId, test] as const),
    );
    for (const attempt of attempts.values()) {
      if (attempt.finished === undefined) continue;
      const test = byTask.get(attempt.task);
      if (test === undefined) continue;
      history.observe(
        ResourceCostHistory.identity({
          project: test.project,
          file: test.file,
          fullName: test.fullName,
          ...(test.location === undefined ? {} : test.location),
        }),
        {
          durationMs: Math.max(0, attempt.finished.monotonicTime - attempt.startedAt),
          workerPeakRssBytes: attempt.finished.worker.peakSampledRssBytes,
        },
      );
    }
    await history.save();
  }

  #select(
    catalog: NativeTestCatalog,
    ids: readonly RunnerTaskId[] | undefined,
  ): readonly NativeTestCase[] {
    if (ids === undefined) return catalog.tests;
    const byId = new Map(catalog.tests.map((test) => [test.runnerTaskId, test]));
    const seen = new Set<RunnerTaskId>();
    return ids.map((id) => {
      if (seen.has(id)) throw new TypeError(`duplicate selected RunnerTaskId ${id}`);
      seen.add(id);
      const test = byId.get(id);
      if (test === undefined)
        throw new TypeError(`RunnerTaskId ${id} is not part of run ${catalog.runId}`);
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
    const appended = active.persistence.append(event);
    if (!appended.ok)
      throw new Error(`run journal rejected state event: ${appended.code}: ${appended.detail}`);
  }

  #recordSkipEvidence(
    active: ActiveRun,
    skips: readonly NativeTestSkip[],
    policy: NativeTestSkipPolicyResult,
  ): void {
    for (const declaration of this.#skipDeclarations) {
      this.#appendAuthoritative(active, 'run.skip-declaration', {
        id: declaration.id,
        file: declaration.file,
        ...(declaration.suite === undefined ? {} : { suite: declaration.suite }),
        fullName: declaration.fullName,
        required: declaration.required,
      });
    }
    for (const skip of skips) {
      const test = active.catalog?.tests.find(
        (candidate) => candidate.runnerTaskId === skip.runnerTaskId,
      );
      if (test === undefined)
        throw new Error(`skipped task ${skip.runnerTaskId} disappeared from the native catalog`);
      this.#appendAuthoritative(
        active,
        'test.skipped',
        {
          nativeTaskId: skip.nativeTaskId,
          file: skip.file,
          fullName: skip.fullName,
        },
        {
          projectId: test.projectId,
          specId: test.specId,
          runnerTaskId: test.runnerTaskId,
        },
      );
    }
    for (const issue of policy.issues)
      this.#appendAuthoritative(active, 'run.skip-policy-issue', { detail: issue });
    this.#appendAuthoritative(active, 'run.skip-policy', {
      status: policy.status,
      declarations: policy.declarations,
      observed: skips.length,
      issues: policy.issues.length,
    });
  }

  #appendAuthoritative(
    active: ActiveRun,
    type: string,
    payload: RunEvent['payload'],
    identity: Readonly<Partial<RunEvent['identity']>> = {},
  ): void {
    const event = this.#producer.emit({
      eventClass: 'authoritative',
      type,
      identity: { invocationId: this.invocationId, runId: active.runId, ...identity },
      payload,
    });
    const appended = active.persistence.append(event);
    if (!appended.ok)
      throw new Error(`run journal rejected ${type}: ${appended.code}: ${appended.detail}`);
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
    const appended = active.persistence.append(event);
    if (!appended.ok)
      throw new Error(
        `run journal rejected test failure event: ${appended.code}: ${appended.detail}`,
      );
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
          perAttempt: { ...(this.#resourceProfile.perAttempt ?? {}) },
          perTerminal: { ...this.#resourceProfile.perTerminal },
          ...(this.#resourceProfile.hostCapacity === undefined
            ? {}
            : {
                hostCapacity: {
                  ...this.#resourceProfile.hostCapacity,
                  sources: { ...this.#resourceProfile.hostCapacity.sources },
                },
              }),
        },
        timeouts: {
          totalRunMs: active.budget.totalMs,
          finalizationReserveMs: active.budget.finalizationReserveMs,
        },
      },
    });
    const appended = active.persistence.append(event);
    if (!appended.ok)
      throw new Error(
        `run journal rejected configuration event: ${appended.code}: ${appended.detail}`,
      );
  }

  #recordPersistenceFailure(active: ActiveRun, stage: string, error: unknown): void {
    const event = this.#producer.emit({
      eventClass: 'authoritative',
      type: 'run.persistence-failed',
      identity: { invocationId: this.invocationId, runId: active.runId },
      payload: { stage, detail: truncateRunEventString(describeFailure(error)) },
    });
    const appended = active.persistence.append(event);
    if (!appended.ok)
      throw new Error(
        `run journal rejected persistence failure: ${appended.code}: ${appended.detail}`,
      );
  }

  #recordInfrastructureFailure(active: ActiveRun, error: unknown): void {
    const event = this.#producer.emit({
      eventClass: 'authoritative',
      type: 'run.infrastructure-failed',
      identity: { invocationId: this.invocationId, runId: active.runId },
      payload: {
        category: infrastructureFailureCategory(error),
        detail: truncateRunEventString(describeFailure(error)),
      },
    });
    const appended = active.persistence.append(event);
    if (!appended.ok)
      throw new Error(
        `run journal rejected infrastructure failure: ${appended.code}: ${appended.detail}`,
      );
  }

  #recordUserConsoleLog(log: UserConsoleLog): void {
    const active = this.#active;
    if (active === undefined) return;
    const test =
      log.taskId === undefined
        ? undefined
        : active.catalog?.tests.find((candidate) => candidate.nativeTaskId === log.taskId);
    const forTask =
      log.taskId === undefined
        ? []
        : [...active.attempts.entries()].filter(
            ([, attempt]) => attempt.nativeTaskId === log.taskId,
          );
    const running = forTask.filter(([, attempt]) => attempt.finished === undefined);
    // Vitest delivers console output on its own schedule, so a line written
    // just before a test returns can arrive after that attempt has finished.
    // That is a race, not a defect: the output is still recorded, but it
    // cannot carry the finished attempt's id, because the journal forbids any
    // event after attempt.finished. It is journalled against the run instead,
    // flagged unattributed. Only genuine ambiguity — no attempt for the task
    // at all, or several running at once — is a control-plane failure.
    if (test !== undefined && running.length > 1) {
      active.controlFailures.push(
        new Error(
          `console ${log.type} for native task ${log.taskId} matched ${running.length} concurrent attempts`,
        ),
      );
    }
    if (test !== undefined && forTask.length === 0) {
      active.controlFailures.push(
        new Error(`console ${log.type} for native task ${log.taskId} matched no recorded attempt`),
      );
    }
    const attempt = running.length === 1 ? running[0] : undefined;
    for (const [index, content] of splitDiagnosticContent(log.content)) {
      const event = this.#producer.emit({
        eventClass: 'diagnostic',
        type: 'test.output',
        identity: {
          invocationId: this.invocationId,
          runId: active.runId,
          ...(test === undefined
            ? {}
            : {
                projectId: test.projectId,
                specId: test.specId,
                runnerTaskId: test.runnerTaskId,
              }),
          ...(attempt === undefined
            ? {}
            : {
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
      const appended = active.persistence.append(event);
      if (!appended.ok) {
        active.controlFailures.push(
          new Error(
            `run journal rejected structured test output: ${appended.code}: ${appended.detail}`,
          ),
        );
        continue;
      }
    }
  }

  #beginHistory(
    runId: RunId,
    startedAt: number,
    budget: HostRunBudget,
  ): Promise<RunHistoryPersistence> {
    return RunHistoryPersistence.begin({
      invocationId: this.invocationId,
      runId,
      startedAt,
      cwd: this.#cwd,
      runsDir: this.#runsDir,
      engineVersion: this.#engine.version,
      resourceProfile: this.#resourceProfile,
      totalRunMs: budget.totalMs,
      finalizationReserveMs: budget.finalizationReserveMs,
      ...(this.#runManifestWriter === undefined ? {} : { writer: this.#runManifestWriter }),
      ...(this.#gitProvenance === undefined ? {} : { gitProvenance: this.#gitProvenance }),
    });
  }

  #manifestInput(
    active: ActiveRun,
    attempts: ReadonlyMap<AttemptId, ObservedAttempt>,
    status: TerminalRunState,
    ptySlotsPeak: number,
  ): Parameters<RunHistoryPersistence['prepare']>[0] {
    const specs = (active.selected ?? []).map((test) =>
      Object.freeze({
        runnerTaskId: test.runnerTaskId,
        specId: test.specId,
        projectId: test.projectId,
        nativeTaskId: test.nativeTaskId,
        file: test.file,
        fullName: test.fullName,
      }),
    );
    const completedAttempts: NativeRunAttempt[] = [];
    for (const [attemptId, attempt] of attempts) {
      completedAttempts.push(
        Object.freeze({
          attemptId,
          executionId: attempt.executionId,
          runnerTaskId: attempt.task,
          projectId: attempt.projectId,
          specId: attempt.specId,
          nativeTaskId: attempt.nativeTaskId,
          repeat: attempt.repeat,
          retry: attempt.retry,
          status: attempt.finished?.state ?? 'incomplete',
          startedAfterRunMs: attempt.startedAfterRunMs,
          finishedAfterRunMs: attempt.finished?.observedAfterRunMs ?? null,
          durationMs:
            attempt.finished === undefined
              ? null
              : Math.max(0, attempt.finished.monotonicTime - attempt.startedAt),
        }),
      );
    }
    return {
      status,
      specs,
      attempts: completedAttempts,
      telemetry: active.telemetry.finish(active.persistence.metrics(), ptySlotsPeak, attempts),
      durationMs: active.budget.elapsedMs(),
    };
  }
}

interface JournalTelemetrySnapshot {
  readonly acceptedEvents: number;
  readonly acceptedBytes: number;
  readonly sinkCalls: number;
  readonly peakBacklogEvents: number;
  readonly peakBacklogBytes: number;
}

class RunTelemetrySampler {
  readonly #cpuStart = process.cpuUsage();
  readonly #rssStart = process.memoryUsage().rss;
  readonly #timer: ReturnType<typeof setInterval>;
  #peakRss = this.#rssStart;
  #result: RunResourceTelemetry | undefined;

  constructor() {
    this.#timer = setInterval(() => this.#sample(), 50);
    this.#timer.unref?.();
  }

  stop(): void {
    clearInterval(this.#timer);
  }

  finish(
    journal: JournalTelemetrySnapshot,
    ptySlotsPeak: number,
    attempts: ReadonlyMap<AttemptId, ObservedAttempt>,
  ): RunResourceTelemetry {
    if (this.#result !== undefined) return this.#result;
    this.stop();
    const rssEnd = this.#sample();
    const cpu = process.cpuUsage(this.#cpuStart);
    const worker = [...attempts.values()]
      .map((attempt) => attempt.finished?.worker)
      .filter((value): value is AttemptWorkerResources => value !== undefined);
    this.#result = Object.freeze({
      coordinatorCpuUserMicros: cpu.user,
      coordinatorCpuSystemMicros: cpu.system,
      coordinatorRssStartBytes: this.#rssStart,
      coordinatorRssEndBytes: rssEnd,
      coordinatorPeakSampledRssBytes: this.#peakRss,
      workerPeakRssBytes:
        worker.length === 0
          ? 'unavailable'
          : Math.max(...worker.map((value) => value.peakSampledRssBytes)),
      workerCpuUserMicros:
        worker.length === 0
          ? 'unavailable'
          : worker.reduce((total, value) => total + value.cpuUserMicros, 0),
      workerCpuSystemMicros:
        worker.length === 0
          ? 'unavailable'
          : worker.reduce((total, value) => total + value.cpuSystemMicros, 0),
      ownedProcessPeakRssBytes: 'unavailable',
      ownedProcessCountPeak: 'unavailable',
      ptySlotsPeak,
      terminalOutputBytes: 'unavailable',
      semanticBytes: 'unavailable',
      semanticFullCount: 'unavailable',
      semanticDeltaCount: 'unavailable',
      journalAcceptedEvents: journal.acceptedEvents,
      journalAcceptedBytes: journal.acceptedBytes,
      journalSinkCalls: journal.sinkCalls,
      journalPeakBacklogEvents: journal.peakBacklogEvents,
      journalPeakBacklogBytes: journal.peakBacklogBytes,
      traceBytes: 'unavailable',
      tempDiskPeakBytes: 'unavailable',
      finalArtifactBytes: 'unavailable',
    });
    return this.#result;
  }

  #sample(): number {
    const rss = process.memoryUsage().rss;
    this.#peakRss = Math.max(this.#peakRss, rss);
    return rss;
  }
}

export function assessSkipPolicy(
  selected: readonly NativeTestCase[],
  skipped: readonly NativeTestSkip[],
  declarations: readonly NativeTestSkipDeclaration[],
  selection: 'full' | 'targeted',
): NativeTestSkipPolicyResult {
  const issues: string[] = [];
  const matches = (
    test: Pick<NativeTestCase, 'file' | 'fullName'>,
    declaration: NativeTestSkipDeclaration,
  ): boolean => {
    const file = test.file.replaceAll('\\', '/');
    const declaredFile = declaration.file.replaceAll('\\', '/');
    const fileMatches = file === declaredFile || file.endsWith(`/${declaredFile}`);
    const leafName = test.fullName.split(' > ').at(-1);
    const nameMatches = test.fullName === declaration.fullName || leafName === declaration.fullName;
    const topLevelSuite = test.fullName.split(' > ')[0]?.replace(/ \(skipped: .*\)$/u, '');
    const suiteMatches = declaration.suite === undefined || topLevelSuite === declaration.suite;
    return fileMatches && suiteMatches && nameMatches;
  };
  for (const skip of skipped) {
    const found = declarations.filter((declaration) => matches(skip, declaration));
    if (found.length !== 1) {
      issues.push(
        found.length === 0
          ? `undeclared skip: ${skip.file} > ${skip.fullName}`
          : `ambiguous skip declaration: ${skip.file} > ${skip.fullName}`,
      );
      continue;
    }
  }
  for (const declaration of declarations) {
    const selectedMatches = selected.filter((test) => matches(test, declaration));
    if (selectedMatches.length > 1) {
      issues.push(
        `skip declaration matches ${selectedMatches.length} selected cases instead of one exact case: ${declaration.id}`,
      );
      continue;
    }
    if (declaration.required && selection === 'full' && selectedMatches.length === 0) {
      issues.push(
        `stale required skip declaration has no exact case in the full catalogue: ${declaration.id}`,
      );
      continue;
    }
    if (declaration.required && selectedMatches.length === 1) {
      const missing = selectedMatches.filter(
        (test) =>
          !skipped.some(
            (skip) => skip.runnerTaskId === test.runnerTaskId && matches(skip, declaration),
          ),
      );
      if (missing.length > 0) {
        issues.push(
          `required skip was not observed for ${missing.length} selected case(s): ${declaration.id}`,
        );
      }
    }
  }
  return Object.freeze({
    status: issues.length === 0 ? 'matched' : 'mismatch',
    declarations: declarations.length,
    issues: Object.freeze(issues),
  });
}

/** Refuse to turn a failed GitHub certification run into a later green attempt. */
export function assertFirstWorkflowAttempt(
  env: Readonly<Record<string, string | undefined>>,
): void {
  const required = env['TERMWRIGHT_REQUIRE_FIRST_WORKFLOW_ATTEMPT'];
  if (
    required === undefined ||
    required === '' ||
    required === '0' ||
    required.toLowerCase() === 'false'
  )
    return;
  if (required !== '1' && required.toLowerCase() !== 'true') {
    throw new Error('TERMWRIGHT_REQUIRE_FIRST_WORKFLOW_ATTEMPT must be 0, 1, false, or true');
  }
  if (env['GITHUB_RUN_ATTEMPT'] !== '1') {
    throw new Error(
      'certification requires the first GitHub workflow attempt; start a new run instead of rerunning failed tests',
    );
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
    const head = nested.length === 0 ? error.message : `${error.message}: ${nested.join('; ')}`;
    return withCause(error, head);
  }
  if (error instanceof Error) return withCause(error, error.message);
  return inspect(error, { depth: 16, breakLength: Infinity });
}

/**
 * A failed module import is attached to the module, not to the run's global
 * `unhandledErrors`. Checking both surfaces prevents a partially collected
 * directory from certifying only the modules that happened to import.
 */
function collectVitestCollectionErrors(result: TestRunResult): Error[] {
  const failures = result.unhandledErrors.map((error) =>
    error instanceof Error ? error : new Error(describeFailure(error)),
  );
  for (const module of result.testModules) {
    const moduleErrors = module.errors();
    for (const error of moduleErrors) {
      failures.push(
        new Error(`Vitest collection module ${module.moduleId} failed: ${describeFailure(error)}`, {
          cause: error,
        }),
      );
    }
    if (module.state() === 'failed' && moduleErrors.length === 0) {
      failures.push(
        new Error(
          `Vitest collection module ${module.moduleId} failed without structured error evidence`,
        ),
      );
    }
  }
  return failures;
}

/**
 * Appends the chain a message hides.
 *
 * A wrapper's own text is usually the least informative part of a failure —
 * "Worker forks emitted error" says which layer noticed, not what happened —
 * and the layer that knows is attached as `cause`.
 */
function withCause(error: Error, described: string): string {
  const cause = (error as { readonly cause?: unknown }).cause;
  if (cause === undefined || cause === null) return described;
  const detail = describeFailure(cause);
  return detail.length === 0 || described.includes(detail)
    ? described
    : `${described} <- ${detail}`;
}

function infrastructureFailureCategory(error: unknown): string {
  if (containsHostTimeout(error)) return 'timeout';
  const detail = describeFailure(error).toLowerCase();
  if (detail.includes('collection')) return 'collection';
  if (detail.includes('resource lease') || detail.includes('resource broker')) return 'resource';
  if (detail.includes('journal')) return 'journal';
  if (detail.includes('worker') || detail.includes('channel closed') || detail.includes('ipc'))
    return 'worker';
  return 'engine';
}

function containsHostTimeout(error: unknown): boolean {
  if (error instanceof TermwrightHostTimeoutError) return true;
  if (error instanceof AggregateError) return [...error.errors].some(containsHostTimeout);
  return (
    typeof error === 'object' &&
    error !== null &&
    containsHostTimeout((error as { cause?: unknown }).cause)
  );
}

function describeTestError(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    const stack = record['stack'];
    if (typeof stack === 'string' && stack.length > 0) {
      const message = typeof record['message'] === 'string' ? record['message'] : '';
      const rendered = inspect(error, {
        depth: 16,
        breakLength: Infinity,
        maxArrayLength: 100,
        maxStringLength: 2_048,
      });
      const diagnostic = rendered === message || stack.includes(rendered) ? '' : `\n${rendered}`;
      return truncateRunEventString(`${stack}${diagnostic}`);
    }
    const message = record['message'];
    if (typeof message === 'string' && message.length > 0) return truncateRunEventString(message);
  }
  return truncateRunEventString(
    inspect(error, {
      depth: 16,
      breakLength: Infinity,
      maxArrayLength: 100,
      maxStringLength: 2_048,
    }),
  );
}

const MAX_TEST_FAILURE_ERROR_ENTRIES = 64;
const MAX_TEST_FAILURE_ERRORS_JSON_BYTES = Math.floor(DEFAULT_RUN_EVENT_LIMITS.maxEventBytes / 4);

function describeTestErrors(errors: readonly unknown[]): readonly string[] {
  const described: string[] = [];
  const maxDetailed =
    errors.length > MAX_TEST_FAILURE_ERROR_ENTRIES
      ? MAX_TEST_FAILURE_ERROR_ENTRIES - 1
      : MAX_TEST_FAILURE_ERROR_ENTRIES;
  let consumed = 0;
  while (consumed < errors.length && described.length < maxDetailed) {
    const rendered = describeTestError(errors[consumed]);
    const remaining = errors.length - consumed - 1;
    const candidate =
      remaining === 0
        ? [...described, rendered]
        : [...described, rendered, omittedTestErrors(remaining)];
    if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > MAX_TEST_FAILURE_ERRORS_JSON_BYTES)
      break;
    described.push(rendered);
    consumed += 1;
  }
  const omitted = errors.length - consumed;
  if (omitted > 0) described.push(omittedTestErrors(omitted));
  return Object.freeze(described);
}

function omittedTestErrors(count: number): string {
  return `...[${count} additional test error${count === 1 ? '' : 's'} omitted to fit the run-event budget]`;
}

function truncateRunEventString(value: string): string {
  const maxBytes = DEFAULT_RUN_EVENT_LIMITS.maxStringBytes;
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  const suffix = '\n...[truncated to run-event string budget]';
  const contentBudget = maxBytes - Buffer.byteLength(suffix, 'utf8');
  let used = 0;
  let prefix = '';
  for (const codePoint of value) {
    const bytes = Buffer.byteLength(codePoint, 'utf8');
    if (used + bytes > contentBudget) break;
    prefix += codePoint;
    used += bytes;
  }
  return `${prefix}${suffix}`;
}

interface ObservedAttempt {
  readonly task: RunnerTaskId;
  readonly executionId: NativeRunAttempt['executionId'];
  readonly projectId: ProjectId;
  readonly specId: SpecId;
  readonly nativeTaskId: string;
  readonly repeat: number;
  readonly retry: number;
  readonly startedAfterRunMs: number;
  readonly startedAt: number;
  finished?: {
    readonly state: NativeRunAttempt['status'];
    readonly monotonicTime: number;
    readonly observedAfterRunMs: number;
    readonly worker: AttemptWorkerResources;
  };
}

interface AttemptWorkerResources {
  readonly capability: 'worker-process';
  readonly cpuUserMicros: number;
  readonly cpuSystemMicros: number;
  readonly peakSampledRssBytes: number;
}

function observeAttemptEvent(
  event: RunEvent,
  expectedTasks: ReadonlySet<RunnerTaskId>,
  attempts: Map<AttemptId, ObservedAttempt>,
  observedAfterRunMs: number,
): void {
  if (event.type !== 'attempt.started' && event.type !== 'attempt.finished') return;
  const attemptId = event.identity.attemptId;
  const { runnerTaskId: task, executionId, projectId, specId } = event.identity;
  if (
    attemptId === undefined ||
    task === undefined ||
    executionId === undefined ||
    projectId === undefined ||
    specId === undefined
  ) {
    throw new Error(`${event.type} is missing its authoritative attempt identity`);
  }
  if (!expectedTasks.has(task))
    throw new Error(`${event.type} belongs to unassigned RunnerTaskId ${task}`);
  const current = attempts.get(attemptId);
  if (event.type === 'attempt.started') {
    if (current !== undefined) throw new Error(`attempt ${attemptId} started more than once`);
    const payload = attemptPayload(event.payload, false);
    attempts.set(attemptId, {
      task,
      executionId,
      projectId,
      specId,
      nativeTaskId: payload.nativeTaskId,
      repeat: payload.repeat,
      retry: payload.retry,
      startedAfterRunMs: observedAfterRunMs,
      startedAt: event.monotonicTime,
    });
    return;
  }
  if (current === undefined) throw new Error(`attempt ${attemptId} finished before it started`);
  if (current.task !== task)
    throw new Error(`attempt ${attemptId} changed RunnerTaskId during execution`);
  if (current.finished !== undefined)
    throw new Error(`attempt ${attemptId} finished more than once`);
  if (
    current.executionId !== executionId ||
    current.projectId !== projectId ||
    current.specId !== specId
  ) {
    throw new Error(`attempt ${attemptId} changed hierarchical identity during execution`);
  }
  const payload = attemptPayload(event.payload, true);
  if (
    payload.nativeTaskId !== current.nativeTaskId ||
    payload.repeat !== current.repeat ||
    payload.retry !== current.retry
  ) {
    throw new Error(`attempt ${attemptId} changed native identity or ordinal during execution`);
  }
  current.finished = {
    state: payload.state,
    monotonicTime: event.monotonicTime,
    observedAfterRunMs,
    worker: payload.worker,
  };
}

function attemptPayload(
  payload: unknown,
  terminal: false,
): { readonly nativeTaskId: string; readonly repeat: number; readonly retry: number };
function attemptPayload(
  payload: unknown,
  terminal: true,
): {
  readonly nativeTaskId: string;
  readonly repeat: number;
  readonly retry: number;
  readonly state: NativeRunAttempt['status'];
  readonly worker: AttemptWorkerResources;
};
function attemptPayload(payload: unknown, terminal: boolean) {
  if (typeof payload !== 'object' || payload === null)
    throw new Error('attempt event payload is not an object');
  const record = payload as Record<string, unknown>;
  if (
    typeof record['nativeTaskId'] !== 'string' ||
    record['nativeTaskId'] === '' ||
    !nonNegativeInteger(record['repeat']) ||
    !nonNegativeInteger(record['retry'])
  ) {
    throw new Error('attempt event payload has invalid native identity or ordinal');
  }
  const state = record['state'];
  if (terminal && state !== 'passed' && state !== 'failed' && state !== 'skipped') {
    throw new Error('attempt.finished payload has invalid state');
  }
  const worker = record['worker'];
  if (
    terminal &&
    (typeof worker !== 'object' ||
      worker === null ||
      (worker as Record<string, unknown>)['capability'] !== 'worker-process' ||
      !nonNegativeInteger((worker as Record<string, unknown>)['cpuUserMicros']) ||
      !nonNegativeInteger((worker as Record<string, unknown>)['cpuSystemMicros']) ||
      !nonNegativeInteger((worker as Record<string, unknown>)['peakSampledRssBytes']))
  ) {
    throw new Error('attempt.finished payload has invalid worker resource telemetry');
  }
  return terminal
    ? {
        nativeTaskId: record['nativeTaskId'],
        repeat: record['repeat'],
        retry: record['retry'],
        state,
        worker: Object.freeze({ ...(worker as AttemptWorkerResources) }),
      }
    : { nativeTaskId: record['nativeTaskId'], repeat: record['repeat'], retry: record['retry'] };
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

/** Converts the closed public hint into the broker's complete atomic vector. */
function resourceReservationFromMetadata(
  metadata: unknown,
  capacities: Readonly<Record<string, number | undefined>>,
  perAttempt: ResourceVector,
): ResourceVector {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata))
    return perAttempt;
  const termwright = (metadata as Record<string, unknown>)['termwright'];
  if (typeof termwright !== 'object' || termwright === null || Array.isArray(termwright))
    return perAttempt;
  const resources = (termwright as Record<string, unknown>)['resources'];
  if (resources === undefined) return perAttempt;
  if (typeof resources !== 'object' || resources === null || Array.isArray(resources)) {
    throw new TypeError('collected termwright.resources metadata is not an object');
  }
  const record = resources as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (
      key !== 'terminals' &&
      key !== 'traceWriters' &&
      key !== 'nativeHost' &&
      key !== 'hostPressure' &&
      key !== 'load'
    ) {
      throw new TypeError(`collected termwright.resources contains unknown key ${key}`);
    }
  }
  const terminals = boundedResourceAmount(record['terminals'], 'terminals');
  // A terminal may retain a trace even on an otherwise passing run. Reserving
  // the writer with the terminal is the safe default; tests configured with
  // trace:'off' can opt out explicitly with traceWriters:0.
  const traceWriters =
    record['traceWriters'] === undefined
      ? terminals
      : boundedResourceAmount(record['traceWriters'], 'traceWriters');
  const nativeHost = record['nativeHost'];
  if (nativeHost !== undefined && nativeHost !== 'shared' && nativeHost !== 'exclusive') {
    throw new TypeError('collected termwright.resources.nativeHost must be shared or exclusive');
  }
  if (nativeHost === 'exclusive' && terminals === 0) {
    throw new TypeError('collected termwright.resources.nativeHost exclusive requires a terminal');
  }
  const hostPressure = record['hostPressure'];
  if (hostPressure !== undefined && hostPressure !== 'exclusive') {
    throw new TypeError('collected termwright.resources.hostPressure must be exclusive');
  }
  if (nativeHost !== undefined && hostPressure !== undefined) {
    throw new TypeError(
      'collected termwright.resources cannot combine nativeHost and hostPressure',
    );
  }
  const load = record['load'];
  if (
    load !== undefined &&
    load !== 'light' &&
    load !== 'normal' &&
    load !== 'heavy' &&
    load !== 'exclusive'
  ) {
    throw new TypeError(
      'collected termwright.resources.load must be light, normal, heavy or exclusive',
    );
  }
  const weighted = resourceLoadVector(load ?? 'normal', capacities);
  const nativeHostPressure =
    nativeHost === 'exclusive' || hostPressure === 'exclusive'
      ? (capacities['nativeHostPressure'] ?? 0)
      : terminals;
  return Object.freeze({
    ...perAttempt,
    ...weighted,
    ...(terminals === 0
      ? {}
      : {
          ptySession: terminals,
          externalProcess: terminals,
          semanticEndpoint: terminals,
        }),
    ...(nativeHostPressure === 0 ? {} : { nativeHostPressure }),
    ...(traceWriters === 0 ? {} : { traceWriter: traceWriters }),
  });
}

function hasExplicitResourceMetadata(metadata: unknown): boolean {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) return false;
  const termwright = (metadata as Record<string, unknown>)['termwright'];
  return (
    typeof termwright === 'object' &&
    termwright !== null &&
    !Array.isArray(termwright) &&
    (termwright as Record<string, unknown>)['resources'] !== undefined
  );
}

function resourceLoadVector(
  load: 'light' | 'normal' | 'heavy' | 'exclusive',
  capacities: Readonly<Record<string, number | undefined>>,
): ResourceVector {
  const factor = load === 'heavy' ? 2 : 1;
  const value = (resource: 'cpuWeight' | 'memoryWeight' | 'ioWeight'): number => {
    const capacity = capacities[resource] ?? 0;
    if (load === 'exclusive') return capacity;
    return Math.min(capacity, factor);
  };
  return Object.freeze({
    cpuWeight: value('cpuWeight'),
    memoryWeight: value('memoryWeight'),
    ioWeight: value('ioWeight'),
  });
}

function applyHistoricalMemoryCost(
  declared: ResourceVector,
  estimate: ResourceCostEstimate | undefined,
  profile: TermwrightResourceProfile,
): ResourceVector {
  const capacity = profile.capacities.memoryWeight ?? 0;
  const budget = profile.hostCapacity?.memoryBudgetBytes;
  if (estimate === undefined || budget === undefined || capacity === 0) return declared;
  const bytesPerWeight = budget / capacity;
  const historicalWeight = Math.max(1, Math.ceil(estimate.workerPeakRssP95Bytes / bytesPerWeight));
  return Object.freeze({
    ...declared,
    memoryWeight: Math.min(capacity, Math.max(declared.memoryWeight ?? 0, historicalWeight)),
  });
}

function resourceDecision(
  estimate: ResourceCostEstimate | undefined,
  reservation: ResourceVector,
): string {
  if (estimate === undefined) {
    return `history=miss; conservative reservation=${JSON.stringify(reservation)}`;
  }
  return (
    `history=samples:${estimate.samples},duration-p50:${estimate.durationP50Ms},` +
    `duration-p95:${estimate.durationP95Ms},rss-p95:${estimate.workerPeakRssP95Bytes}; ` +
    `reservation=${JSON.stringify(reservation)}`
  );
}

function boundedResourceAmount(value: unknown, label: string): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 1_024) {
    throw new RangeError(
      `collected termwright.resources.${label} must be an integer between 0 and 1024`,
    );
  }
  return value as number;
}

function isNoSpace(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ((error as NodeJS.ErrnoException).code === 'ENOSPC') return true;
  return isNoSpace((error as { cause?: unknown }).cause);
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

function resolveHostTimeouts(
  input: Partial<TermwrightHostTimeouts> | undefined,
): TermwrightHostTimeouts {
  const resolved = Object.freeze({ ...DEFAULT_TERMWRIGHT_HOST_TIMEOUTS, ...input });
  positiveFinite(resolved.startupMs, 'host startup timeout');
  positiveFinite(resolved.runMs, 'host run timeout');
  positiveFinite(resolved.finalizationReserveMs, 'host finalization reserve');
  if (resolved.finalizationReserveMs >= resolved.runMs) {
    throw new TypeError('host finalization reserve must be smaller than the default run timeout');
  }
  return resolved;
}

function positiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0)
    throw new TypeError(`${label} must be a positive finite number`);
}
