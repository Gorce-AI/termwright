/** Authoritative identity and async context for one native Vitest try. */

import { AsyncLocalStorage } from 'node:async_hooks';
import {
  createRunId,
  type AttemptId,
  type ExecutionId,
  type InvocationId,
  type ProjectId,
  type RunId,
  type RunnerTaskId,
  type ShardId,
  type SpecId,
  type ActionId,
  type RunEventClass,
  type RunEventJson,
  type SessionId,
  type StepId,
} from '@termwright/protocol';
import {
  RESOURCE_CLASSES,
  ResourceBrokerError,
  type ResourceClass,
  type ResourceAttachment,
  type ResourceVector,
} from '@termwright/resource-broker';
import type { RemoteResourceLease, ResourceBrokerClient } from '@termwright/resource-broker/transport';
import { TestBudget, type AttemptBudgetReserves, type AttemptPhase } from './attempt-budget.js';

export type { AttemptId, ExecutionId, RunnerTaskId } from '@termwright/protocol';

/** One execution is one Vitest repeat; retries are attempts of that execution. */
export interface AttemptContext {
  readonly invocationId: InvocationId;
  readonly runId: RunId;
  readonly projectId: ProjectId;
  readonly shardId?: ShardId;
  readonly specId: SpecId;
  readonly runnerTaskId: RunnerTaskId;
  /** Exact Vitest 3.2.7 collection id; never reconstructed from a title. */
  readonly nativeTaskId: string;
  /** Authoritative collected module path supplied by TermwrightTestHost. */
  readonly file: string;
  /** Authoritative native Vitest full name; display/snapshot label, never identity. */
  readonly fullName: string;
  readonly executionId: ExecutionId;
  readonly attemptId: AttemptId;
  /** Zero-based native Vitest repeat ordinal. */
  readonly repeat: number;
  /** Zero-based native Vitest retry ordinal within {@link repeat}. */
  readonly retry: number;
  readonly budget: TestBudget;
  /** Host-owned broker connection and certified resources for this native try. */
  readonly resources: AttemptResources;
  /** Current budget phase; read dynamically from the attempt-local budget. */
  currentPhase(): AttemptPhase;
}

export interface AttemptResources {
  readonly profile: ResourceVector;
  readonly reservation: ResourceVector;
  acquire(resources: ResourceVector): Promise<RemoteResourceLease>;
  /** Releases the atomic reservation only after every local sublease closed. */
  releaseReservation(): Promise<boolean>;
}

export interface AttemptTaskIdentity {
  readonly invocationId: InvocationId;
  readonly runId: RunId;
  readonly projectId: ProjectId;
  readonly shardId?: ShardId;
  readonly specId: SpecId;
  readonly runnerTaskId: RunnerTaskId;
  readonly nativeTaskId: string;
  readonly file: string;
  readonly fullName: string;
}

/** @internal mutable attempt-local services. */
export interface AttemptRuntime {
  readonly context: AttemptContext;
  readonly snapshotCounters: Map<string, number>;
  scope?: unknown;
  events?: AttemptEventRecorder;
}

export interface AttemptEventRecord {
  readonly eventClass: Exclude<RunEventClass, 'state'>;
  readonly type: string;
  readonly payload: RunEventJson;
  readonly sessionId?: SessionId;
  readonly stepId?: StepId;
  readonly actionId?: ActionId;
  readonly phase?: 'operation' | 'cleanup';
}

/** Ordered worker-to-host evidence owned by the current native attempt. */
export interface AttemptEventRecorder {
  record(event: AttemptEventRecord): void;
  flush(): Promise<void>;
}

const STORAGE_KEY = Symbol.for('termwright.test.attempt-context.v3');
const globals = globalThis as typeof globalThis & { [STORAGE_KEY]?: AsyncLocalStorage<AttemptRuntime | undefined> };
// The custom runner is loaded by Vitest's worker bootstrap while test modules
// are transformed by Vite. They can therefore evaluate this module through two
// module graphs in the same realm; Symbol.for keeps one authoritative carrier.
const storage = globals[STORAGE_KEY] ??= new AsyncLocalStorage<AttemptRuntime | undefined>();

/** Creates opaque identities; neither titles nor file paths participate. */
export function createAttemptContext(
  identity: AttemptTaskIdentity,
  repeat: number,
  retry: number,
  options: {
    readonly executionId?: ExecutionId;
    readonly attemptId?: AttemptId;
    readonly budget: TestBudget;
    readonly broker: ResourceBrokerClient;
    readonly resourceProfile: ResourceVector;
    readonly reservedLease?: Promise<RemoteResourceLease>;
    readonly resourceReservation?: ResourceVector;
  },
): AttemptContext {
  if (!Number.isInteger(repeat) || repeat < 0) throw new TypeError('repeat must be a non-negative integer');
  if (!Number.isInteger(retry) || retry < 0) throw new TypeError('retry must be a non-negative integer');
  const executionId = options.executionId ?? createRunId('execution');
  const { budget, broker, resourceProfile } = options;
  const attemptId = options.attemptId ?? createRunId('attempt');
  const resources = createAttemptResources(
    attemptId,
    budget,
    broker,
    resourceProfile,
    options.reservedLease,
    options.resourceReservation,
  );
  return Object.freeze({
    ...identity,
    executionId,
    attemptId,
    repeat,
    retry,
    budget,
    resources,
    currentPhase: () => budget.phase,
  });
}

function createAttemptResources(
  attemptId: AttemptId,
  budget: TestBudget,
  broker: ResourceBrokerClient,
  resourceProfile: ResourceVector,
  reservedLease: Promise<RemoteResourceLease> | undefined,
  declaredReservation: ResourceVector | undefined,
): AttemptResources {
  const reservation = normalizeVector(declaredReservation ?? {});
  const allocated = normalizeVector({});
  const attachments: Array<{ resource: ResourceClass; pid?: number; sessionId?: string }> = [];
  let localLeaseSequence = 0;
  let reservationRelease: Promise<void> | null = null;

  return Object.freeze({
    profile: resourceProfile,
    reservation: Object.freeze({ ...reservation }),
    acquire: async (requested: ResourceVector): Promise<RemoteResourceLease> => {
      if (reservedLease === undefined) {
        const remaining = budget.operationTimeout(Number.MAX_SAFE_INTEGER, 'operation');
        return await broker.acquire({
          attemptId,
          resources: requested,
          deadline: performance.timeOrigin + performance.now() + remaining,
        });
      }
      const normalized = normalizeVector(requested);
      for (const resource of RESOURCE_CLASSES) {
        if (allocated[resource] + normalized[resource] > reservation[resource]) {
          throw new ResourceBrokerError(
            'resource-unavailable',
            `attempt ${attemptId} requested ${resource} beyond its atomic test.resources() reservation`,
          );
        }
      }
      for (const resource of RESOURCE_CLASSES) allocated[resource] += normalized[resource];
      const admitted = await reservedLease;
      let released = false;
      let releasePromise: Promise<void> | null = null;
      const localLeaseId = `${admitted.leaseId}:local:${++localLeaseSequence}`;
      return Object.freeze({
        ...admitted,
        leaseId: localLeaseId,
        resources: Object.freeze({ ...normalized }),
        attachments: Object.freeze([]),
        async attach(values: readonly ResourceAttachment[]): Promise<void> {
          attachments.push(...values.map((value) => ({ ...value })));
          await admitted.attach(attachments);
        },
        release(): Promise<void> {
          releasePromise ??= Promise.resolve().then(() => {
            if (released) return;
            released = true;
            for (const resource of RESOURCE_CLASSES) allocated[resource] -= normalized[resource];
          });
          return releasePromise;
        },
      });
    },
    releaseReservation(): Promise<boolean> {
      if (reservedLease === undefined) return Promise.resolve(true);
      if (RESOURCE_CLASSES.some((resource) => allocated[resource] !== 0)) return Promise.resolve(false);
      return reservedLease.then((admitted) => {
        reservationRelease ??= admitted.release();
        return reservationRelease;
      }).then(() => true);
    },
  });
}

function normalizeVector(value: ResourceVector): Record<ResourceClass, number> {
  const normalized = Object.fromEntries(RESOURCE_CLASSES.map((resource) => [resource, 0])) as Record<ResourceClass, number>;
  for (const resource of RESOURCE_CLASSES) {
    const amount = value[resource] ?? 0;
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new TypeError(`resource ${resource} must be a non-negative safe integer`);
    }
    normalized[resource] = amount;
  }
  return normalized;
}

export function createAttemptBudget(
  timeoutMs: number,
  reserves?: AttemptBudgetReserves,
  now?: () => number,
  deferred = false,
): TestBudget {
  return new TestBudget(timeoutMs, reserves, now, deferred);
}

export function attemptOperationTimeout(requestedMs: number, phase: 'operation' | 'assertion' = 'operation'): number {
  return currentAttemptContext().budget.operationTimeout(requestedMs, phase);
}

/** Runs a complete native try inside its immutable identity context. */
export function runWithAttemptContext<T>(context: AttemptContext, body: () => T): T {
  return storage.run(runtime(context), body);
}

/** @internal Executes an isolation assertion with the runner context suspended. */
export function runWithoutAttemptContextForTesting<T>(body: () => T): T {
  return storage.exit(body);
}

/**
 * Enters the context on Vitest's current per-try async chain.
 *
 * Vitest invokes `onBeforeTryTask`, then fixtures, the callback, afterEach and
 * fixture cleanup on that same chain. The runner replaces this value at the
 * next try and clears it only after the whole task has completed.
 */
export function activateAttemptContext(context: AttemptContext): void {
  storage.enterWith(runtime(context));
}

/** Clears the current runner chain after every repeat/retry has settled. */
export function clearAttemptContext(): void {
  storage.enterWith(undefined);
}

/** The current try; using Termwright test services outside it is an error. */
export function currentAttemptContext(): AttemptContext {
  return currentAttemptRuntime().context;
}

/** @internal mutable state owned by the current attempt. */
export function currentAttemptRuntime(): AttemptRuntime {
  const value = storage.getStore();
  if (value === undefined) {
    throw new Error(
      'Termwright test context is unavailable; run this code through the exact-certified Termwright runner',
    );
  }
  return value;
}

/** Installs the runner-owned journal projection for the active try. */
export function installAttemptEventRecorder(recorder: AttemptEventRecorder): void {
  const runtime = currentAttemptRuntime();
  if (runtime.events !== undefined) throw new Error('the current attempt already has an event recorder');
  runtime.events = recorder;
}

/** Exact current attempt journal; unavailable outside the certified runner. */
export function currentAttemptEventRecorder(): AttemptEventRecorder {
  const recorder = currentAttemptRuntime().events;
  if (recorder === undefined) throw new Error('the current attempt event recorder is unavailable');
  return recorder;
}

function runtime(context: AttemptContext): AttemptRuntime {
  return { context, snapshotCounters: new Map() };
}
