/** Exact-certified Vitest engine adapter and native per-try context boundary. */

import {
  RunEventProducer,
  createRunId,
  parseRunId,
  type InvocationId,
  type ProjectId,
  type RunId,
  type RunnerTaskId,
  type ShardId,
  type SpecId,
} from '@termwright/protocol';
import { VitestTestRunner } from 'vitest/runners';
import { installTerminalLaunchResourceProvider } from '@termwright/driver';
import type { ResourceVector } from '@termwright/resource-broker';
import {
  connectResourceBrokerWorker,
  type ResourceBrokerClient,
} from '@termwright/resource-broker/transport';
import {
  connectRunJournalWorker,
  type RunJournalClient,
} from '@termwright/run-journal-transport';
import {
  activateAttemptContext,
  clearAttemptContext,
  createAttemptContext,
  createAttemptBudget,
  currentAttemptContext,
  installAttemptEventRecorder,
  type AttemptEventRecorder,
  type AttemptEventRecord,
  type AttemptContext,
  type ExecutionId,
} from './attempt-context.js';
import { DEFAULT_ATTEMPT_BUDGET_RESERVES, type AttemptBudgetReserves } from './attempt-budget.js';
import {
  assertCertifiedVitestRuntime,
  CERTIFIED_VITEST_VERSION,
  TERMWRIGHT_RUNNER_CONTEXT_KEY,
} from './vitest-engine.js';

export {
  assertCertifiedVitestRuntime,
  CERTIFIED_VITEST_VERSION,
  installedVitestVersion,
  TERMWRIGHT_RUNNER_CONTEXT_KEY,
} from './vitest-engine.js';

export { currentAttemptContext } from './attempt-context.js';
export type { AttemptContext, AttemptTaskIdentity } from './attempt-context.js';
export {
  AttemptBudgetExceededError,
  DEFAULT_ATTEMPT_BUDGET_RESERVES,
  TestBudget,
} from './attempt-budget.js';
export type { AttemptBudgetReserves, AttemptPhase } from './attempt-budget.js';

interface NativeRunnerTask {
  readonly id: string;
  mode: string;
  readonly timeout: number;
}

interface NativeAttemptTask extends NativeRunnerTask {
  readonly result?: { readonly state?: string; readonly pending?: boolean };
  onFinished?: Array<() => unknown>;
  onFailed?: Array<() => unknown>;
}

/** Runtime-only second hook argument used by the certified Vitest implementation. */
export interface CertifiedNativeTryOrdinal {
  readonly retry: number;
  readonly repeats: number;
}

const executions = new WeakMap<object, Map<number, ExecutionId>>();
export interface TermwrightHostTaskIdentity {
  readonly runnerTaskId: RunnerTaskId;
  readonly projectId: ProjectId;
  readonly specId: SpecId;
  readonly shardId?: ShardId;
  /** Collected module path; used for source-owned artifacts, never as identity. */
  readonly file: string;
  /** Collected native full name; used for labels, never as identity. */
  readonly fullName: string;
  /** Atomic broker vector acquired before attempt.started is emitted. */
  readonly resourceReservation?: ResourceVector;
}
const taskIdentities = new WeakMap<object, TermwrightHostTaskIdentity>();
const taskBrokers = new WeakMap<object, ResourceBrokerClient>();
const taskJournals = new WeakMap<object, WorkerJournal>();

const MAX_HOST_TASKS = 100_000;
const MAX_NATIVE_TASK_ID_LENGTH = 4096;
const brokerConnections = new Map<string, Promise<ResourceBrokerClient>>();
const journalConnections = new Map<string, Promise<WorkerJournal>>();

// The provider is worker-global, but resolves the immutable ALS context only
// when a terminal is actually launched. This covers direct launchTerminal()
// calls in adapters and conformance, not merely the terminal fixture helper.
installTerminalLaunchResourceProvider(async () => {
  const attempt = currentAttemptContext();
  const profile = attempt.resources.profile;
  const lease = await attempt.resources.acquire(Object.freeze({
    ...profile,
    ptySession: Math.max(1, profile.ptySession ?? 0),
    externalProcess: Math.max(1, profile.externalProcess ?? 0),
    semanticEndpoint: Math.max(1, profile.semanticEndpoint ?? 0),
  }));
  return Object.freeze({
    attach: async (sessionId: string): Promise<void> => {
      await lease.attach([
        { resource: 'ptySession', sessionId },
        { resource: 'externalProcess', sessionId },
        { resource: 'semanticEndpoint', sessionId },
      ]);
    },
    release: () => lease.release(),
  });
});

interface WorkerJournal {
  readonly client: RunJournalClient;
  readonly producer: RunEventProducer;
}

/** Host-owned selection, keyed exclusively by Vitest's collected native task id. */
export interface TermwrightRunnerContext {
  readonly invocationId: InvocationId;
  readonly runId: RunId;
  readonly tasks: Readonly<Record<string, TermwrightHostTaskIdentity>>;
  readonly budgetReserves?: AttemptBudgetReserves;
  readonly broker: TermwrightRunnerBrokerContext;
  readonly journal: TermwrightRunnerJournalContext;
}

export interface TermwrightRunnerBrokerContext {
  readonly endpoint: string;
  readonly token: string;
  /** Host incarnation; a restarted exact Vitest worker with the same id fails closed. */
  readonly workerEpoch: number;
  readonly workerIdPrefix: string;
  readonly handshakeTimeoutMs: number;
  readonly resourceProfile: ResourceVector;
}

export interface TermwrightRunnerJournalContext {
  readonly endpoint: string;
  readonly token: string;
  readonly handshakeTimeoutMs: number;
  readonly acknowledgementTimeoutMs: number;
  /** Producer ids are assigned and bound by the authenticated host endpoint. */
  readonly binding: 'host-assigned-worker';
}

/** Validates the undocumented runtime argument instead of guessing ordinals. */
export function certifiedTryOrdinal(value: unknown): CertifiedNativeTryOrdinal {
  if (typeof value !== 'object' || value === null) return incompatibleTryHook(value);
  const record = value as Record<string, unknown>;
  if (!nonNegativeInteger(record['retry']) || !nonNegativeInteger(record['repeats'])) {
    return incompatibleTryHook(value);
  }
  return { retry: record['retry'], repeats: record['repeats'] } as CertifiedNativeTryOrdinal;
}

/**
 * The sole certified Termwright runner.
 *
 * Vitest 3.2.7 calls `onBeforeTryTask(test, {retry, repeats})` immediately
 * before resolving fixtures. Its public declaration omits the second argument,
 * so this override keeps it optional for TypeScript and rejects its absence at
 * runtime. The ALS value intentionally remains installed past
 * `onAfterTryTask`: Vitest runs afterEach and fixture cleanup afterwards.
 */
export class TermwrightTestRunner extends VitestTestRunner {
  readonly #hostContext: TermwrightRunnerContext;

  constructor(...arguments_: ConstructorParameters<typeof VitestTestRunner>) {
    assertCertifiedVitestRuntime();
    super(...arguments_);
    this.#hostContext = validateHostContext(this.injectValue(TERMWRIGHT_RUNNER_CONTEXT_KEY));
    if (this.config.sequence.hooks === 'parallel') {
      throw new Error('Termwright certified execution requires ordered hooks; sequence.hooks="parallel" is unsupported');
    }
    this.onCleanupWorkerContext(async () => {
      await closeJournal(this.#hostContext);
      await closeBroker(this.#hostContext);
    });
  }

  override async onBeforeRunTask(test: Parameters<VitestTestRunner['onBeforeRunTask']>[0]): Promise<void> {
    const task = test as NativeRunnerTask;
    const identity = this.#hostContext.tasks[task.id];
    if (identity === undefined) task.mode = 'skip';
    else {
      taskIdentities.set(test as object, identity);
      const [broker, journal] = await Promise.all([brokerFor(this.#hostContext), journalFor(this.#hostContext)]);
      taskBrokers.set(test as object, broker);
      taskJournals.set(test as object, journal);
    }
    await super.onBeforeRunTask(test);
  }

  override async onBeforeTryTask(test: Parameters<VitestTestRunner['onBeforeTryTask']>[0], ordinal?: unknown): Promise<void> {
    const native = certifiedTryOrdinal(ordinal);
    const task = test as NativeRunnerTask;
    const identity = taskIdentities.get(test as object);
    if (identity === undefined) {
      throw new Error(`TermwrightTestHost did not assign native runner task ${task.id}`);
    }
    const broker = taskBrokers.get(test as object);
    if (broker === undefined) throw new Error(`Termwright worker broker was not connected for ${task.id}`);
    const journal = taskJournals.get(test as object);
    if (journal === undefined) throw new Error(`Termwright worker journal was not connected for ${task.id}`);
    let byRepeat = executions.get(test as object);
    if (byRepeat === undefined) {
      byRepeat = new Map();
      executions.set(test as object, byRepeat);
    }
    let executionId = byRepeat.get(native.repeats);
    if (executionId === undefined) {
      executionId = createRunId('execution');
      byRepeat.set(native.repeats, executionId);
    }
    const attemptId = createRunId('attempt');
    const reservationAdmission = identity.resourceReservation === undefined
      ? undefined
      : broker.acquire({
          attemptId,
          resources: identity.resourceReservation,
          deadline: performance.timeOrigin + performance.now() + task.timeout,
        });
    if (reservationAdmission !== undefined) {
      // Vitest 3.2.7 invokes onBeforeTryTask before beforeEach and before the
      // timeout-wrapped authored callback. This is the exact-certified
      // scheduler admission boundary: an atomic group wait is bounded, but it
      // cannot spend the Attempt's operation/diagnostic/teardown budget.
      void reservationAdmission.catch(() => undefined);
    }
    const reserves = this.#hostContext.budgetReserves ?? DEFAULT_ATTEMPT_BUDGET_RESERVES;
    const budget = createAttemptBudget(
      task.timeout + reserves.teardownMs,
      reserves,
      undefined,
      reservationAdmission !== undefined,
    );
    const context = createAttemptContext({
      invocationId: this.#hostContext.invocationId,
      runId: this.#hostContext.runId,
      nativeTaskId: task.id,
      ...identity,
    }, native.repeats, native.retry, {
      executionId,
      attemptId,
      // Vitest's task timeout bounds the authored callback. Its exact 3.2.7
      // runner executes fixture cleanup/onFinished afterwards under hook
      // budgets. Give that mandatory lifecycle phase only the explicit
      // teardown reserve: operation/diagnostic/trace cutoffs remain before the
      // authored callback deadline, while attempt.finished can still commit.
      budget,
      broker,
      resourceProfile: this.#hostContext.broker.resourceProfile,
      ...(reservationAdmission === undefined ? {} : {
        reservedLease: reservationAdmission,
        resourceReservation: identity.resourceReservation,
      }),
    });
    activateAttemptContext(context);
    const attemptEvents = createAttemptEventRecorder(
      context,
      journal,
      this.#hostContext.journal.acknowledgementTimeoutMs,
    );
    installAttemptEventRecorder(attemptEvents);
    try {
      if (reservationAdmission !== undefined) {
        await reservationAdmission;
        budget.start();
      }
      await journal.client.append(journal.producer.emit({
        eventClass: 'authoritative',
        type: 'attempt.started',
        identity: attemptIdentity(context),
        payload: { nativeTaskId: task.id, repeat: native.repeats, retry: native.retry },
      }), eventDeadline(context, this.#hostContext.journal.acknowledgementTimeoutMs, 'operation'));
      installAttemptFinalizer(test as NativeAttemptTask, context, journal, attemptEvents, this.config.sequence.hooks,
        this.#hostContext.journal.acknowledgementTimeoutMs);
      super.onBeforeTryTask(test);
    } catch (error) {
      const admitted = await reservationAdmission?.catch(() => undefined);
      await admitted?.release().catch(() => undefined);
      clearAttemptContext();
      throw error;
    }
  }

  override onAfterRunTask(test: Parameters<VitestTestRunner['onAfterRunTask']>[0]): void {
    try {
      super.onAfterRunTask(test);
    } finally {
      executions.delete(test as object);
      taskIdentities.delete(test as object);
      taskBrokers.delete(test as object);
      taskJournals.delete(test as object);
      clearAttemptContext();
    }
  }
}

export function validateHostContext(value: unknown): TermwrightRunnerContext {
  if (!plainDataObject(value, ['invocationId', 'runId', 'tasks', 'budgetReserves', 'broker', 'journal'])) return invalidHostContext();
  const record = value as Record<string, unknown>;
  if (!plainDataObject(record['tasks'])) {
    return invalidHostContext();
  }
  const invocationId = parseRunId('invocation', record['invocationId']);
  const runId = parseRunId('run', record['runId']);
  const entries = Object.entries(record['tasks'] as Record<string, unknown>);
  if (entries.length > MAX_HOST_TASKS) return invalidHostContext();
  const tasks: Record<string, TermwrightHostTaskIdentity> = Object.create(null) as Record<string, TermwrightHostTaskIdentity>;
  const runnerTaskIds = new Set<string>();
  const specIds = new Set<string>();
  for (const [nativeId, rawIdentity] of entries) {
    if (nativeId === '' || nativeId.length > MAX_NATIVE_TASK_ID_LENGTH) return invalidHostContext();
    if (!plainDataObject(rawIdentity, [
      'runnerTaskId', 'projectId', 'specId', 'shardId', 'file', 'fullName', 'resourceReservation',
    ])) return invalidHostContext();
    const identity = rawIdentity as Record<string, unknown>;
    const runnerTaskId = parseRunId('runner-task', identity['runnerTaskId']);
    const specId = parseRunId('spec', identity['specId']);
    if (runnerTaskIds.has(runnerTaskId) || specIds.has(specId)) return invalidHostContext();
    runnerTaskIds.add(runnerTaskId);
    specIds.add(specId);
    tasks[nativeId] = Object.freeze({
      runnerTaskId,
      projectId: parseRunId('project', identity['projectId']),
      specId,
      file: boundedString(identity['file'], 'task file', 4_096),
      fullName: boundedString(identity['fullName'], 'task full name', 16_384),
      ...(identity['shardId'] === undefined ? {} : { shardId: parseRunId('shard', identity['shardId']) }),
      ...(identity['resourceReservation'] === undefined
        ? {}
        : { resourceReservation: validateResourceVector(identity['resourceReservation']) }),
    });
  }
  const budgetReserves = validateBudgetReserves(record['budgetReserves']);
  const broker = validateBroker(record['broker']);
  const journal = validateJournal(record['journal']);
  return Object.freeze({
    invocationId,
    runId,
    tasks: Object.freeze(tasks),
    ...(budgetReserves === undefined ? {} : { budgetReserves }),
    broker,
    journal,
  });
}

function validateJournal(value: unknown): TermwrightRunnerJournalContext {
  if (!plainDataObject(value, ['endpoint', 'token', 'handshakeTimeoutMs', 'acknowledgementTimeoutMs', 'binding'])) return invalidHostContext();
  const record = value as Record<string, unknown>;
  const endpoint = boundedString(record['endpoint'], 'journal endpoint', 4_096);
  const token = boundedString(record['token'], 'journal token', 512);
  if (token.length < 32 || record['binding'] !== 'host-assigned-worker') return invalidHostContext();
  const handshakeTimeoutMs = record['handshakeTimeoutMs'];
  if (typeof handshakeTimeoutMs !== 'number' || !Number.isSafeInteger(handshakeTimeoutMs) || handshakeTimeoutMs <= 0) {
    return invalidHostContext();
  }
  const acknowledgementTimeoutMs = record['acknowledgementTimeoutMs'];
  if (typeof acknowledgementTimeoutMs !== 'number' || !Number.isSafeInteger(acknowledgementTimeoutMs) ||
      acknowledgementTimeoutMs <= 0) return invalidHostContext();
  return Object.freeze({ endpoint, token, handshakeTimeoutMs, acknowledgementTimeoutMs,
    binding: 'host-assigned-worker' });
}

function validateBroker(value: unknown): TermwrightRunnerBrokerContext {
  if (!plainDataObject(value, [
    'endpoint', 'token', 'workerEpoch', 'workerIdPrefix', 'handshakeTimeoutMs', 'resourceProfile',
  ])) return invalidHostContext();
  const record = value as Record<string, unknown>;
  const endpoint = boundedString(record['endpoint'], 'broker endpoint', 4_096);
  const token = boundedString(record['token'], 'broker token', 512);
  if (token.length < 32) return invalidHostContext();
  const workerIdPrefix = boundedString(record['workerIdPrefix'], 'worker id prefix', 128);
  if (!nonNegativeInteger(record['workerEpoch'])) return invalidHostContext();
  const handshakeTimeoutMs = record['handshakeTimeoutMs'];
  if (typeof handshakeTimeoutMs !== 'number' || !Number.isSafeInteger(handshakeTimeoutMs) || handshakeTimeoutMs <= 0) {
    return invalidHostContext();
  }
  const resourceProfile = validateResourceVector(record['resourceProfile']);
  return Object.freeze({ endpoint, token, workerIdPrefix, workerEpoch: record['workerEpoch'], handshakeTimeoutMs,
    resourceProfile });
}

function validateResourceVector(value: unknown): ResourceVector {
  const keys = ['ptySession', 'externalProcess', 'semanticEndpoint', 'traceWriter'] as const;
  if (!plainDataObject(value, keys)) return invalidHostContext();
  const record = value as Record<string, unknown>;
  const result: Partial<Record<(typeof keys)[number], number>> = {};
  for (const key of keys) {
    const amount = record[key];
    if (amount === undefined) continue;
    if (!nonNegativeInteger(amount)) return invalidHostContext();
    result[key] = amount;
  }
  return Object.freeze(result);
}

function validateBudgetReserves(value: unknown): AttemptBudgetReserves | undefined {
  if (value === undefined) return undefined;
  if (!plainDataObject(value, ['diagnosticsMs', 'traceFlushMs', 'teardownMs'])) return invalidHostContext();
  const record = value as Record<string, unknown>;
  for (const key of ['diagnosticsMs', 'traceFlushMs', 'teardownMs'] as const) {
    const number = record[key];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < 0) return invalidHostContext();
  }
  return Object.freeze({
    diagnosticsMs: record['diagnosticsMs'] as number,
    traceFlushMs: record['traceFlushMs'] as number,
    teardownMs: record['teardownMs'] as number,
  });
}

function brokerFor(context: TermwrightRunnerContext): Promise<ResourceBrokerClient> {
  const identity = workerIdentity(context.broker);
  const key = `${context.runId}\0${context.broker.endpoint}\0${identity.workerId}\0${identity.workerEpoch}`;
  let connection = brokerConnections.get(key);
  if (connection === undefined) {
    const now = performance.timeOrigin + performance.now();
    connection = connectResourceBrokerWorker({
      endpoint: context.broker.endpoint,
      token: context.broker.token,
      runId: context.runId,
      ...identity,
      handshakeDeadline: now + context.broker.handshakeTimeoutMs,
    });
    brokerConnections.set(key, connection);
    void connection.catch(() => brokerConnections.delete(key));
  }
  return connection;
}

function journalFor(context: TermwrightRunnerContext): Promise<WorkerJournal> {
  const identity = workerIdentity(context.broker);
  const key = `${context.runId}\0${context.journal.endpoint}\0${identity.workerId}\0${identity.workerEpoch}`;
  let connection = journalConnections.get(key);
  if (connection === undefined) {
    connection = (async () => {
      const now = performance.timeOrigin + performance.now();
      const client = await connectRunJournalWorker({
        endpoint: context.journal.endpoint,
        token: context.journal.token,
        runId: context.runId,
        ...identity,
        handshakeDeadline: now + context.journal.handshakeTimeoutMs,
      });
      return Object.freeze({
        client,
        producer: new RunEventProducer({
          producerId: client.binding.producerId,
          epoch: client.binding.producerEpoch,
          monotonicNow: () => performance.now(),
          wallNow: Date.now,
        }),
      });
    })();
    journalConnections.set(key, connection);
    void connection.catch(() => journalConnections.delete(key));
  }
  return connection;
}

async function closeBroker(context: TermwrightRunnerContext): Promise<void> {
  const identity = workerIdentity(context.broker);
  const key = `${context.runId}\0${context.broker.endpoint}\0${identity.workerId}\0${identity.workerEpoch}`;
  const connection = brokerConnections.get(key);
  if (connection === undefined) return;
  brokerConnections.delete(key);
  const client = await connection.catch(() => undefined);
  await client?.close();
}

async function closeJournal(context: TermwrightRunnerContext): Promise<void> {
  const identity = workerIdentity(context.broker);
  const key = `${context.runId}\0${context.journal.endpoint}\0${identity.workerId}\0${identity.workerEpoch}`;
  const connection = journalConnections.get(key);
  if (connection === undefined) return;
  journalConnections.delete(key);
  const journal = await connection.catch(() => undefined);
  if (journal === undefined) return;
  await journal.client.flush(performance.timeOrigin + performance.now() + 5_000);
  await journal.client.close();
}

function attemptIdentity(context: AttemptContext) {
  return Object.freeze({
    invocationId: context.invocationId,
    runId: context.runId,
    projectId: context.projectId,
    ...(context.shardId === undefined ? {} : { shardId: context.shardId }),
    specId: context.specId,
    runnerTaskId: context.runnerTaskId,
    executionId: context.executionId,
    attemptId: context.attemptId,
  });
}

function installAttemptFinalizer(
  test: NativeAttemptTask,
  context: AttemptContext,
  journal: WorkerJournal,
  attemptEvents: AttemptEventRecorder,
  sequence: string,
  acknowledgementTimeoutMs: number,
): void {
  let finalized = false;
  const emit = async (state: 'passed' | 'failed' | 'skipped'): Promise<void> => {
    if (finalized) throw new Error(`attempt ${context.attemptId} terminal event was requested more than once`);
    finalized = true;
    // This is the authoritative lifecycle commit after all user and fixture
    // cleanup, not optional diagnostics. It consumes the final cleanup reserve;
    // using the earlier diagnostics boundary made ordinary teardown capable of
    // expiring the event before it was even legally allowed to be emitted.
    context.budget.mark('cleanup');
    let resourceFailure: Error | undefined;
    try {
      const released = await context.resources.releaseReservation();
      if (!released) {
        resourceFailure = new Error(
          `attempt ${context.attemptId} finished with live subleases inside its atomic resource reservation`,
        );
      }
    } catch (error) {
      resourceFailure = new Error(
        `attempt ${context.attemptId} could not release its atomic resource reservation`,
        { cause: error },
      );
    }
    if (resourceFailure !== undefined) {
      attemptEvents.record({
        eventClass: 'authoritative',
        type: 'resource.release-failed',
        phase: 'cleanup',
        payload: { detail: resourceFailure.message },
      });
    }
    await attemptEvents.flush();
    await journal.client.append(journal.producer.emit({
      eventClass: 'authoritative',
      type: 'attempt.finished',
      identity: attemptIdentity(context),
      payload: {
        state: resourceFailure === undefined ? state : 'failed',
        nativeTaskId: context.nativeTaskId,
        repeat: context.repeat,
        retry: context.retry,
      },
    }), eventDeadline(context, acknowledgementTimeoutMs, 'cleanup'));
    if (resourceFailure !== undefined) throw resourceFailure;
  };
  const afterCleanup = async (): Promise<void> => {
    const state = attemptTerminalState(test);
    if (state !== 'failed') {
      await emit(state);
      return;
    }
    const afterFailures = async (): Promise<void> => emit('failed');
    const hooks = test.onFailed ??= [];
    // Vitest reverses stack hooks. Install at the opposite end so this runs
    // after every user onTestFailed callback, including callbacks that throw.
    if (sequence === 'stack') hooks.unshift(afterFailures);
    else hooks.push(afterFailures);
  };
  const hooks = test.onFinished ??= [];
  // onFinished is hard-coded to stack order by Vitest 3.2.7. Inserting first
  // makes the authoritative finalizer execute last, after user callbacks.
  hooks.unshift(afterCleanup);
}

function createAttemptEventRecorder(
  context: AttemptContext,
  journal: WorkerJournal,
  acknowledgementTimeoutMs: number,
): AttemptEventRecorder {
  let pending: Promise<void> = Promise.resolve();
  let sealed = false;
  return Object.freeze({
    record(event: AttemptEventRecord): void {
      if (sealed) throw new Error(`attempt ${context.attemptId} event recorder is sealed`);
      const emitted = journal.producer.emit({
        eventClass: event.eventClass,
        type: event.type,
        identity: {
          ...attemptIdentity(context),
          ...(event.sessionId === undefined ? {} : { sessionId: event.sessionId }),
          ...(event.stepId === undefined ? {} : { stepId: event.stepId }),
          ...(event.actionId === undefined ? {} : { actionId: event.actionId }),
        },
        payload: event.payload,
      });
      pending = pending.then(async () => {
        await journal.client.append(
          emitted,
          eventDeadline(
            context,
            acknowledgementTimeoutMs,
            event.phase ?? 'operation',
          ),
        );
      });
      // The finalizer owns the rejection. Attach a handler immediately so a
      // fast transport failure cannot become a process-level unhandled event.
      void pending.catch(() => undefined);
    },
    async flush(): Promise<void> {
      sealed = true;
      await pending;
    },
  });
}

function eventDeadline(
  context: AttemptContext,
  maximumMs: number,
  phase: 'operation' | 'cleanup',
): number {
  const now = performance.timeOrigin + performance.now();
  if (phase === 'cleanup') {
    return now + context.budget.finalizationTimeout(maximumMs);
  }
  const remaining = context.budget.remaining(phase);
  if (remaining > 0) return now + Math.min(maximumMs, remaining);
  context.budget.assertAvailable(phase);
  throw new Error('unreachable attempt budget state');
}

function attemptTerminalState(test: NativeAttemptTask): 'passed' | 'failed' | 'skipped' {
  if (test.result?.pending === true || test.result?.state === 'skip') return 'skipped';
  if (test.result?.state === 'pass') return 'passed';
  if (test.result?.state === 'fail') return 'failed';
  throw new Error(`Vitest attempt ${test.id} reached cleanup with unsettled state ${String(test.result?.state)}`);
}

function workerIdentity(context: TermwrightRunnerBrokerContext): { readonly workerId: string; readonly workerEpoch: number } {
  // Exact Vitest 3.2.7 assigns both values in its worker bootstrap. Combining
  // them with PID distinguishes process and thread pools without random ids.
  const pool = exactWorkerOrdinal('VITEST_POOL_ID');
  const worker = exactWorkerOrdinal('VITEST_WORKER_ID');
  return Object.freeze({
    workerId: `${context.workerIdPrefix}:pool-${pool}:worker-${worker}:pid-${process.pid}`,
    workerEpoch: context.workerEpoch,
  });
}

function exactWorkerOrdinal(name: 'VITEST_POOL_ID' | 'VITEST_WORKER_ID'): number {
  const value = process.env[name];
  if (value === undefined || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error(`Vitest ${CERTIFIED_VITEST_VERSION} did not publish ${name}; worker identity is unavailable`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} exceeds the safe integer range`);
  return parsed;
}

function boundedString(value: unknown, _label: string, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) return invalidHostContext();
  return value;
}

function plainDataObject(value: unknown, allowedKeys?: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!('value' in descriptor) || descriptor.enumerable !== true) return false;
    if (allowedKeys !== undefined && !allowedKeys.includes(key)) return false;
  }
  return true;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function incompatibleTryHook(value: unknown): never {
  throw new Error(
    `Vitest ${CERTIFIED_VITEST_VERSION} compatibility violation: ` +
      `onBeforeTryTask did not provide { retry, repeats }; received ${describe(value)}`,
  );
}

function invalidHostContext(): never {
  throw new Error(
    `${TERMWRIGHT_RUNNER_CONTEXT_KEY} is missing or invalid; execute tests through TermwrightTestHost`,
  );
}

function describe(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export default TermwrightTestRunner;
