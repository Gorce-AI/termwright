import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { AttemptId, RunId } from '@termwright/protocol/run-events';

export const RESOURCE_CLASSES = Object.freeze([
  'ptySession',
  'externalProcess',
  'semanticEndpoint',
  'nativeHostPressure',
  'traceWriter',
] as const);

export type ResourceClass = (typeof RESOURCE_CLASSES)[number];
export type ResourceVector = Readonly<Partial<Record<ResourceClass, number>>>;
export type ResourceCapacities = Readonly<Record<ResourceClass, number>>;

export interface WorkerIdentity {
  readonly runId: RunId;
  readonly workerId: string;
  readonly workerEpoch: number;
}

export interface AttemptIdentity extends WorkerIdentity {
  readonly attemptId: AttemptId;
}

export interface ResourceAttachment {
  readonly resource: ResourceClass;
  readonly pid?: number;
  readonly sessionId?: string;
}

export interface ResourceLeaseSnapshot extends AttemptIdentity {
  readonly leaseId: string;
  readonly resources: ResourceVector;
  readonly attachments: readonly ResourceAttachment[];
}

export interface ResourceBrokerSnapshot {
  readonly runId: RunId;
  readonly capacities: ResourceCapacities;
  readonly used: ResourceCapacities;
  readonly active: readonly ResourceLeaseSnapshot[];
  readonly queue: readonly (AttemptIdentity & {
    readonly position: number;
    readonly resources: ResourceVector;
    readonly deadline: number;
  })[];
}

export type ResourceBrokerErrorCode =
  | 'aborted'
  | 'attempt-owner-mismatch'
  | 'deadline-exceeded'
  | 'invalid-request'
  | 'queue-full'
  | 'resource-unavailable'
  | 'stale-lease'
  | 'stale-run'
  | 'stale-worker';

export class ResourceBrokerError extends Error {
  readonly code: ResourceBrokerErrorCode;

  constructor(code: ResourceBrokerErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ResourceBrokerError';
    this.code = code;
  }
}

export interface AcquireResourcesOptions extends AttemptIdentity {
  readonly resources: ResourceVector;
  /** Absolute deadline from a monotonic epoch clock. */
  readonly deadline: number;
  readonly signal?: AbortSignal;
}

export interface ResourceLease extends ResourceLeaseSnapshot {
  readonly token: string;
  attach(attachments: readonly ResourceAttachment[]): Promise<void>;
  release(): Promise<void>;
}

interface TimerApi {
  readonly set: (callback: () => void, delayMs: number) => unknown;
  readonly clear: (timer: unknown) => void;
}

export interface ResourceBrokerOptions {
  readonly runId: RunId;
  readonly capacities: ResourceCapacities;
  readonly maxQueued?: number;
  readonly monotonicNow?: () => number;
  readonly randomUUID?: () => string;
  readonly timers?: TimerApi;
}

interface WorkerState {
  readonly epoch: number;
}

interface AttemptState {
  readonly identity: AttemptIdentity;
  readonly leases: Map<string, LeaseRecord>;
  /** Exact sum of live leases; never a per-attempt maximum. */
  reservation: Record<ResourceClass, number>;
  queued: number;
}

interface LeaseRecord {
  readonly leaseId: string;
  readonly token: string;
  readonly identity: AttemptIdentity;
  readonly resources: Record<ResourceClass, number>;
  attachments: readonly ResourceAttachment[];
  released: boolean;
  releasePromise: Promise<void> | null;
}

interface PendingAcquire {
  readonly sequence: number;
  readonly identity: AttemptIdentity;
  readonly resources: Record<ResourceClass, number>;
  readonly deadline: number;
  readonly resolve: (lease: ResourceLease) => void;
  readonly reject: (error: ResourceBrokerError) => void;
  readonly signal: AbortSignal | undefined;
  readonly onAbort: (() => void) | undefined;
  timer: unknown;
  settled: boolean;
}

const ZERO = (): Record<ResourceClass, number> => ({
  ptySession: 0,
  externalProcess: 0,
  semanticEndpoint: 0,
  nativeHostPressure: 0,
  traceWriter: 0,
});

const DEFAULT_TIMERS: TimerApi = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

/**
 * Host-owned, deterministic resource scheduler.
 *
 * Requests reserve their complete vector or nothing. FIFO head-of-line order
 * prevents a stream of small requests from starving an older large request.
 */
export class ResourceBroker {
  readonly #runId: RunId;
  readonly #capacities: ResourceCapacities;
  readonly #maxQueued: number;
  readonly #now: () => number;
  readonly #randomUUID: () => string;
  readonly #timers: TimerApi;
  readonly #workers = new Map<string, WorkerState>();
  readonly #highestEpoch = new Map<string, number>();
  readonly #attempts = new Map<AttemptId, AttemptState>();
  readonly #leases = new Map<string, LeaseRecord>();
  readonly #queue: PendingAcquire[] = [];
  readonly #used = ZERO();
  #sequence = 0;

  constructor(options: ResourceBrokerOptions) {
    this.#runId = options.runId;
    this.#capacities = Object.freeze(normalizeCapacities(options.capacities));
    this.#maxQueued = positiveInteger(options.maxQueued ?? 1_000, 'maxQueued');
    this.#now = options.monotonicNow ?? monotonicEpochNow;
    this.#randomUUID = options.randomUUID ?? randomUUID;
    this.#timers = options.timers ?? DEFAULT_TIMERS;
  }

  registerWorker(identity: WorkerIdentity): void {
    this.#assertRun(identity.runId);
    assertWorker(identity.workerId, identity.workerEpoch);
    const highest = this.#highestEpoch.get(identity.workerId);
    if (highest !== undefined && identity.workerEpoch <= highest) {
      throw new ResourceBrokerError(
        'stale-worker',
        `worker ${identity.workerId} epoch ${identity.workerEpoch} is not newer than ${highest}`,
      );
    }
    const current = this.#workers.get(identity.workerId);
    if (current !== undefined) this.#reclaimWorker(identity.workerId, current.epoch);
    this.#workers.set(identity.workerId, { epoch: identity.workerEpoch });
    this.#highestEpoch.set(identity.workerId, identity.workerEpoch);
    if (current !== undefined) this.#drain();
  }

  disconnectWorker(identity: WorkerIdentity): void {
    this.#assertRun(identity.runId);
    const current = this.#workers.get(identity.workerId);
    if (current?.epoch !== identity.workerEpoch) return;
    this.#reclaimWorker(identity.workerId, identity.workerEpoch);
    this.#workers.delete(identity.workerId);
    this.#drain();
  }

  acquire(options: AcquireResourcesOptions): Promise<ResourceLease> {
    this.#assertIdentity(options);
    const resources = normalizeVector(options.resources, this.#capacities);
    if (!Number.isFinite(options.deadline)) {
      return Promise.reject(new ResourceBrokerError('invalid-request', 'resource deadline must be finite'));
    }
    if (options.signal?.aborted === true) {
      return Promise.reject(new ResourceBrokerError('aborted', 'resource acquisition was aborted'));
    }
    if (options.deadline <= this.#now()) {
      return Promise.reject(new ResourceBrokerError('deadline-exceeded', 'resource deadline already expired'));
    }

    const attempt = this.#attempt(options);
    if (this.#queue.length === 0 && this.#fits(resources)) {
      return Promise.resolve(this.#grant(attempt, resources));
    }
    if (this.#queue.length >= this.#maxQueued) {
      this.#deleteAttemptIfEmpty(attempt);
      return Promise.reject(new ResourceBrokerError('queue-full', `resource queue reached ${this.#maxQueued}`));
    }

    return new Promise<ResourceLease>((resolve, reject) => {
      const pending: PendingAcquire = {
        sequence: ++this.#sequence,
        identity: options,
        resources,
        deadline: options.deadline,
        resolve,
        reject,
        signal: options.signal,
        onAbort: options.signal === undefined ? undefined : () => {
          this.#cancel(pending, new ResourceBrokerError('aborted', 'resource acquisition was aborted'));
        },
        timer: undefined,
        settled: false,
      };
      attempt.queued += 1;
      this.#queue.push(pending);
      if (pending.onAbort !== undefined) options.signal?.addEventListener('abort', pending.onAbort, { once: true });
      pending.timer = this.#timers.set(() => {
        this.#cancel(pending, new ResourceBrokerError('deadline-exceeded', 'resource acquisition deadline expired'));
      }, Math.max(0, options.deadline - this.#now()));
      this.#drain();
    });
  }

  snapshot(): ResourceBrokerSnapshot {
    return Object.freeze({
      runId: this.#runId,
      capacities: this.#capacities,
      used: Object.freeze({ ...this.#used }),
      active: Object.freeze([...this.#leases.values()].map((lease) => freezeLeaseSnapshot(lease))),
      queue: Object.freeze(this.#queue.map((pending, index) => Object.freeze({
        ...pending.identity,
        position: index + 1,
        resources: Object.freeze({ ...pending.resources }),
        deadline: pending.deadline,
      }))),
    });
  }

  #attempt(identity: AttemptIdentity): AttemptState {
    const existing = this.#attempts.get(identity.attemptId);
    if (existing !== undefined) {
      if (!sameWorker(existing.identity, identity)) {
        throw new ResourceBrokerError(
          'attempt-owner-mismatch',
          `attempt ${identity.attemptId} is already owned by another worker epoch`,
        );
      }
      return existing;
    }
    const created: AttemptState = {
      identity: Object.freeze({ ...identity }),
      leases: new Map(),
      reservation: ZERO(),
      queued: 0,
    };
    this.#attempts.set(identity.attemptId, created);
    return created;
  }

  #grant(attempt: AttemptState, resources: Record<ResourceClass, number>): ResourceLease {
    for (const resource of RESOURCE_CLASSES) {
      this.#used[resource] += resources[resource];
      attempt.reservation[resource] += resources[resource];
    }
    const leaseId = this.#freshLeaseId();
    const lease: LeaseRecord = {
      leaseId,
      token: this.#randomUUID(),
      identity: attempt.identity,
      resources,
      attachments: Object.freeze([]),
      released: false,
      releasePromise: null,
    };
    attempt.leases.set(lease.leaseId, lease);
    this.#leases.set(lease.leaseId, lease);
    return this.#publicLease(lease);
  }

  #freshLeaseId(): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const leaseId = `lease:${this.#randomUUID()}`;
      if (!this.#leases.has(leaseId)) return leaseId;
    }
    throw new ResourceBrokerError('invalid-request', 'resource lease id source repeatedly collided');
  }

  #publicLease(record: LeaseRecord): ResourceLease {
    const broker = this;
    return Object.freeze({
      ...freezeLeaseSnapshot(record),
      token: record.token,
      attach(attachments: readonly ResourceAttachment[]): Promise<void> {
        return broker.#attach(record.identity, record.leaseId, record.token, attachments);
      },
      release(): Promise<void> {
        record.releasePromise ??= broker.#release(record.identity, record.leaseId, record.token);
        return record.releasePromise;
      },
    });
  }

  async #attach(
    identity: AttemptIdentity,
    leaseId: string,
    token: string,
    attachments: readonly ResourceAttachment[],
  ): Promise<void> {
    const lease = this.#authenticatedLease(identity, leaseId, token);
    lease.attachments = Object.freeze(attachments.map((attachment) => {
      if (!RESOURCE_CLASSES.includes(attachment.resource)) {
        throw new ResourceBrokerError('invalid-request', `unknown attachment resource ${String(attachment.resource)}`);
      }
      if (lease.resources[attachment.resource] === 0) {
        throw new ResourceBrokerError('invalid-request', `lease ${leaseId} does not own ${attachment.resource}`);
      }
      if (attachment.pid !== undefined && (!Number.isInteger(attachment.pid) || attachment.pid <= 0)) {
        throw new ResourceBrokerError('invalid-request', 'attachment pid must be a positive integer');
      }
      if (attachment.sessionId !== undefined && attachment.sessionId.length === 0) {
        throw new ResourceBrokerError('invalid-request', 'attachment sessionId cannot be empty');
      }
      return Object.freeze({ ...attachment });
    }));
  }

  async #release(identity: AttemptIdentity, leaseId: string, token: string): Promise<void> {
    const lease = this.#authenticatedLease(identity, leaseId, token);
    if (lease.released) return;
    lease.released = true;
    this.#leases.delete(lease.leaseId);
    const attempt = this.#attempts.get(lease.identity.attemptId);
    attempt?.leases.delete(lease.leaseId);
    if (attempt !== undefined) this.#recomputeReservation(attempt);
    this.#deleteAttemptIfEmpty(attempt);
    this.#drain();
  }

  #authenticatedLease(identity: AttemptIdentity, leaseId: string, token: string): LeaseRecord {
    this.#assertIdentity(identity);
    const lease = this.#leases.get(leaseId);
    if (lease === undefined || lease.token !== token || !sameAttempt(lease.identity, identity)) {
      throw new ResourceBrokerError('stale-lease', 'lease token or owner is stale');
    }
    return lease;
  }

  #drain(): void {
    for (;;) {
      const pending = this.#queue[0];
      if (pending === undefined) return;
      if (pending.deadline <= this.#now()) {
        this.#cancel(pending, new ResourceBrokerError('deadline-exceeded', 'resource acquisition deadline expired'));
        continue;
      }
      const attempt = this.#attempts.get(pending.identity.attemptId);
      if (attempt === undefined) {
        this.#cancel(pending, new ResourceBrokerError('stale-worker', 'attempt owner disappeared'));
        continue;
      }
      if (!this.#fits(pending.resources)) return;
      this.#queue.shift();
      this.#settlePending(pending, attempt);
      pending.resolve(this.#grant(attempt, pending.resources));
    }
  }

  #settlePending(pending: PendingAcquire, attempt: AttemptState): void {
    if (pending.settled) return;
    pending.settled = true;
    attempt.queued -= 1;
    this.#timers.clear(pending.timer);
    if (pending.onAbort !== undefined) pending.signal?.removeEventListener('abort', pending.onAbort);
  }

  #cancel(pending: PendingAcquire, error: ResourceBrokerError): void {
    if (pending.settled) return;
    const index = this.#queue.indexOf(pending);
    if (index >= 0) this.#queue.splice(index, 1);
    const attempt = this.#attempts.get(pending.identity.attemptId);
    if (attempt !== undefined) this.#settlePending(pending, attempt);
    else pending.settled = true;
    this.#deleteAttemptIfEmpty(attempt);
    pending.reject(error);
    this.#drain();
  }

  #recomputeReservation(attempt: AttemptState): void {
    const next = ZERO();
    for (const lease of attempt.leases.values()) {
      for (const resource of RESOURCE_CLASSES) next[resource] += lease.resources[resource];
    }
    for (const resource of RESOURCE_CLASSES) this.#used[resource] += next[resource] - attempt.reservation[resource];
    attempt.reservation = next;
  }

  #reclaimWorker(workerId: string, epoch: number): void {
    const pending = this.#queue.filter((entry) =>
      entry.identity.workerId === workerId && entry.identity.workerEpoch === epoch,
    );
    for (const entry of pending) {
      this.#cancel(entry, new ResourceBrokerError('stale-worker', 'worker disconnected while waiting for resources'));
    }
    const attempts = [...this.#attempts.values()].filter((attempt) =>
      attempt.identity.workerId === workerId && attempt.identity.workerEpoch === epoch,
    );
    for (const attempt of attempts) {
      for (const lease of [...attempt.leases.values()]) {
        lease.released = true;
        this.#leases.delete(lease.leaseId);
        attempt.leases.delete(lease.leaseId);
      }
      this.#recomputeReservation(attempt);
      this.#deleteAttemptIfEmpty(attempt);
    }
  }

  #deleteAttemptIfEmpty(attempt: AttemptState | undefined): void {
    if (attempt !== undefined && attempt.leases.size === 0 && attempt.queued === 0) {
      this.#attempts.delete(attempt.identity.attemptId);
    }
  }

  #fits(additional: Record<ResourceClass, number>): boolean {
    return RESOURCE_CLASSES.every((resource) =>
      this.#used[resource] + additional[resource] <= this.#capacities[resource],
    );
  }

  #assertIdentity(identity: WorkerIdentity): void {
    this.#assertRun(identity.runId);
    assertWorker(identity.workerId, identity.workerEpoch);
    const current = this.#workers.get(identity.workerId);
    if (current?.epoch !== identity.workerEpoch) {
      throw new ResourceBrokerError('stale-worker', `worker ${identity.workerId} epoch ${identity.workerEpoch} is not active`);
    }
  }

  #assertRun(runId: RunId): void {
    if (runId !== this.#runId) throw new ResourceBrokerError('stale-run', `run ${runId} is not active`);
  }
}

function normalizeCapacities(capacities: ResourceCapacities): Record<ResourceClass, number> {
  const normalized = ZERO();
  for (const resource of RESOURCE_CLASSES) normalized[resource] = positiveInteger(capacities[resource], resource, true);
  return normalized;
}

function normalizeVector(
  vector: ResourceVector,
  capacities: ResourceCapacities,
): Record<ResourceClass, number> {
  const normalized = ZERO();
  let total = 0;
  for (const resource of RESOURCE_CLASSES) {
    const units = positiveInteger(vector[resource] ?? 0, resource, true);
    if (units > capacities[resource]) {
      throw new ResourceBrokerError(
        'resource-unavailable',
        `${resource} request ${units} exceeds host capacity ${capacities[resource]}`,
      );
    }
    normalized[resource] = units;
    total += units;
  }
  if (total === 0) throw new ResourceBrokerError('invalid-request', 'resource request cannot be empty');
  for (const key of Object.keys(vector)) {
    if (!(RESOURCE_CLASSES as readonly string[]).includes(key)) {
      throw new ResourceBrokerError('invalid-request', `unknown resource class ${key}`);
    }
  }
  return normalized;
}

function positiveInteger(value: number, name: string, allowZero = false): number {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new ResourceBrokerError('invalid-request', `${name} must be a ${allowZero ? 'non-negative' : 'positive'} integer`);
  }
  return value;
}

function assertWorker(workerId: string, epoch: number): void {
  if (workerId.length === 0 || workerId.length > 256) {
    throw new ResourceBrokerError('invalid-request', 'workerId must contain 1..256 characters');
  }
  if (!Number.isSafeInteger(epoch) || epoch < 0) {
    throw new ResourceBrokerError('invalid-request', 'worker epoch must be a non-negative integer');
  }
}

function sameWorker(left: WorkerIdentity, right: WorkerIdentity): boolean {
  return left.runId === right.runId
    && left.workerId === right.workerId
    && left.workerEpoch === right.workerEpoch;
}

function sameAttempt(left: AttemptIdentity, right: AttemptIdentity): boolean {
  return sameWorker(left, right) && left.attemptId === right.attemptId;
}

function freezeLeaseSnapshot(lease: LeaseRecord): ResourceLeaseSnapshot {
  return Object.freeze({
    ...lease.identity,
    leaseId: lease.leaseId,
    resources: Object.freeze({ ...lease.resources }),
    attachments: Object.freeze([...lease.attachments]),
  });
}

function monotonicEpochNow(): number {
  return performance.timeOrigin + performance.now();
}
