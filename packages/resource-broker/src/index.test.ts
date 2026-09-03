import { describe, expect, it } from 'vitest';
import type { AttemptId, RunId } from '@termwright/protocol/run-events';
import {
  ResourceBroker,
  ResourceBrokerError,
  type AttemptIdentity,
  type ResourceCapacities,
  type WorkerIdentity,
} from './index.js';

const RUN = 'run:00000000-0000-4000-8000-000000000001' as RunId;
const OTHER_RUN = 'run:00000000-0000-4000-8000-000000000002' as RunId;
const CAPACITIES: ResourceCapacities = {
  ptySession: 1,
  externalProcess: 1,
  semanticEndpoint: 1,
  nativeHostPressure: 1,
  traceWriter: 1,
};

class ManualClock {
  now = 1_000;
  #nextId = 0;
  readonly #timers = new Map<number, { readonly at: number; readonly callback: () => void }>();

  readonly timers = {
    set: (callback: () => void, delayMs: number): number => {
      const id = ++this.#nextId;
      this.#timers.set(id, { at: this.now + delayMs, callback });
      return id;
    },
    clear: (timer: unknown): void => {
      this.#timers.delete(timer as number);
    },
  };

  advance(ms: number): void {
    this.now += ms;
    for (;;) {
      const due = [...this.#timers.entries()]
        .filter(([, timer]) => timer.at <= this.now)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
      if (due === undefined) return;
      this.#timers.delete(due[0]);
      due[1].callback();
    }
  }
}

function worker(workerId: string, workerEpoch = 1, runId = RUN): WorkerIdentity {
  return { runId, workerId, workerEpoch };
}

function attempt(owner: WorkerIdentity, id: string): AttemptIdentity {
  return { ...owner, attemptId: id as AttemptId };
}

function broker(
  clock = new ManualClock(),
  maxQueued = 100,
  capacities = CAPACITIES,
): ResourceBroker {
  let id = 0;
  return new ResourceBroker({
    runId: RUN,
    capacities,
    maxQueued,
    monotonicNow: () => clock.now,
    timers: clock.timers,
    randomUUID: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
  });
}

async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
  return promise.then(
    () => undefined,
    (error: unknown) => (error as ResourceBrokerError).code,
  );
}

describe('ResourceBroker', () => {
  it('reserves multi-resource vectors atomically and drains in deterministic FIFO order', async () => {
    const clock = new ManualClock();
    const resources = broker(clock);
    const firstWorker = worker('worker-1');
    const secondWorker = worker('worker-2');
    const thirdWorker = worker('worker-3');
    resources.registerWorker(firstWorker);
    resources.registerWorker(secondWorker);
    resources.registerWorker(thirdWorker);

    const first = await resources.acquire({
      ...attempt(firstWorker, 'attempt-1'),
      resources: { ptySession: 1, semanticEndpoint: 1 },
      deadline: clock.now + 1_000,
    });
    const secondPromise = resources.acquire({
      ...attempt(secondWorker, 'attempt-2'),
      resources: { ptySession: 1, semanticEndpoint: 1 },
      deadline: clock.now + 1_000,
    });
    const thirdPromise = resources.acquire({
      ...attempt(thirdWorker, 'attempt-3'),
      resources: { ptySession: 1 },
      deadline: clock.now + 1_000,
    });

    expect(resources.snapshot().queue.map((entry) => entry.attemptId)).toEqual([
      'attempt-2',
      'attempt-3',
    ]);
    expect(resources.snapshot().queue.map((entry) => entry.limitedBy)).toEqual([
      ['ptySession', 'semanticEndpoint'],
      ['fifo', 'ptySession'],
    ]);
    await first.release();
    const second = await secondPromise;
    expect(resources.snapshot().queue.map((entry) => entry.attemptId)).toEqual(['attempt-3']);
    await second.release();
    const third = await thirdPromise;
    expect(resources.snapshot().used.ptySession).toBe(1);
    await third.release();
    expect(resources.snapshot().used).toEqual({
      ptySession: 0,
      externalProcess: 0,
      semanticEndpoint: 0,
      nativeHostPressure: 0,
      traceWriter: 0,
      cpuWeight: 0,
      memoryWeight: 0,
      ioWeight: 0,
    });
  });

  it('does not let a younger fitting request bypass an older blocked request', async () => {
    const clock = new ManualClock();
    const resources = broker(clock);
    const owner = worker('owner');
    const older = worker('older');
    const younger = worker('younger');
    for (const identity of [owner, older, younger]) resources.registerWorker(identity);

    const held = await resources.acquire({
      ...attempt(owner, 'held'),
      resources: { ptySession: 1 },
      deadline: clock.now + 1_000,
    });
    const olderPromise = resources.acquire({
      ...attempt(older, 'older'),
      resources: { ptySession: 1 },
      deadline: clock.now + 1_000,
    });
    const youngerPromise = resources.acquire({
      ...attempt(younger, 'younger'),
      resources: { traceWriter: 1 },
      deadline: clock.now + 1_000,
    });
    expect(resources.snapshot().queue.map((entry) => entry.attemptId)).toEqual([
      'older',
      'younger',
    ]);

    await held.release();
    const [olderLease, youngerLease] = await Promise.all([olderPromise, youngerPromise]);
    await Promise.all([olderLease.release(), youngerLease.release()]);
  });

  it('lets an active attempt complete a fitting continuation ahead of a blocked waiter', async () => {
    const clock = new ManualClock();
    const resources = broker(clock, 100, { cpuWeight: 4, ptySession: 1 });
    const active = worker('active');
    const exclusive = worker('exclusive');
    resources.registerWorker(active);
    resources.registerWorker(exclusive);

    const baseLease = await resources.acquire({
      ...attempt(active, 'active'),
      resources: { cpuWeight: 1 },
      deadline: clock.now + 100,
    });
    const exclusivePromise = resources.acquire({
      ...attempt(exclusive, 'exclusive'),
      resources: { cpuWeight: 4 },
      deadline: clock.now + 100,
    });
    const continuationPromise = resources.acquire({
      ...attempt(active, 'active'),
      resources: { ptySession: 1 },
      deadline: clock.now + 100,
    });

    const continuationLease = await continuationPromise;
    expect(resources.snapshot().queue.map((entry) => entry.attemptId)).toEqual(['exclusive']);
    expect(resources.snapshot().active.map((entry) => entry.attemptId)).toEqual([
      'active',
      'active',
    ]);

    await continuationLease.release();
    await baseLease.release();
    const exclusiveLease = await exclusivePromise;
    await exclusiveLease.release();
  });

  it('accounts every live lease even when one attempt owns several and shares an exact release promise', async () => {
    const clock = new ManualClock();
    const resources = broker(clock, 100, { ...CAPACITIES, ptySession: 2 });
    const owner = worker('worker');
    const identity = attempt(owner, 'attempt');
    resources.registerWorker(owner);

    const first = await resources.acquire({
      ...identity,
      resources: { ptySession: 1 },
      deadline: clock.now + 1_000,
    });
    const second = await resources.acquire({
      ...identity,
      resources: { ptySession: 1 },
      deadline: clock.now + 1_000,
    });
    await first.attach([{ resource: 'ptySession', pid: 42, sessionId: 'session-42' }]);
    expect(resources.snapshot().used.ptySession).toBe(2);
    expect(resources.snapshot().active[0]?.attachments).toEqual([
      { resource: 'ptySession', pid: 42, sessionId: 'session-42' },
    ]);

    const release = first.release();
    expect(first.release()).toBe(release);
    await release;
    expect(resources.snapshot().used.ptySession).toBe(1);
    await second.release();
    expect(resources.snapshot().used.ptySession).toBe(0);
  });

  it('bounds an unreserved second terminal instead of silently overcommitting one attempt', async () => {
    const clock = new ManualClock();
    const resources = broker(clock);
    const owner = worker('worker');
    const identity = attempt(owner, 'multi-terminal-attempt');
    resources.registerWorker(owner);
    const first = await resources.acquire({
      ...identity,
      resources: { ptySession: 1 },
      deadline: clock.now + 1_000,
    });
    const second = resources.acquire({
      ...identity,
      resources: { ptySession: 1 },
      deadline: clock.now + 25,
    });
    expect(resources.snapshot().used.ptySession).toBe(1);
    expect(resources.snapshot().queue).toMatchObject([
      { attemptId: identity.attemptId, position: 1 },
    ]);
    const code = errorCode(second);
    clock.advance(25);
    expect(await code).toBe('deadline-exceeded');
    await first.release();
  });

  it('uses one absolute monotonic deadline and removes aborted requests from the queue', async () => {
    const clock = new ManualClock();
    const resources = broker(clock);
    const holder = worker('holder');
    const deadlineWorker = worker('deadline');
    const abortedWorker = worker('aborted');
    for (const identity of [holder, deadlineWorker, abortedWorker])
      resources.registerWorker(identity);
    const held = await resources.acquire({
      ...attempt(holder, 'holder'),
      resources: { ptySession: 1 },
      deadline: clock.now + 1_000,
    });

    const expires = resources.acquire({
      ...attempt(deadlineWorker, 'deadline'),
      resources: { ptySession: 1 },
      deadline: clock.now + 10,
    });
    const controller = new AbortController();
    const aborts = resources.acquire({
      ...attempt(abortedWorker, 'aborted'),
      resources: { ptySession: 1 },
      deadline: clock.now + 1_000,
      signal: controller.signal,
    });
    const expiresCode = errorCode(expires);
    const abortsCode = errorCode(aborts);
    clock.advance(10);
    controller.abort();
    expect(await expiresCode).toBe('deadline-exceeded');
    expect(await abortsCode).toBe('aborted');
    expect(resources.snapshot().queue).toHaveLength(0);
    await held.release();
  });

  it('bounds queued work before allocating another pending request', async () => {
    const clock = new ManualClock();
    const resources = broker(clock, 1);
    const holder = worker('holder');
    const queued = worker('queued');
    const rejected = worker('rejected');
    for (const identity of [holder, queued, rejected]) resources.registerWorker(identity);
    const held = await resources.acquire({
      ...attempt(holder, 'holder'),
      resources: { ptySession: 1 },
      deadline: clock.now + 1_000,
    });
    const waits = resources.acquire({
      ...attempt(queued, 'queued'),
      resources: { ptySession: 1 },
      deadline: clock.now + 1_000,
    });
    const refusal = resources.acquire({
      ...attempt(rejected, 'rejected'),
      resources: { ptySession: 1 },
      deadline: clock.now + 1_000,
    });
    expect(await errorCode(refusal)).toBe('queue-full');
    await held.release();
    await (await waits).release();
  });

  it('reclaims active and queued leases on epoch disconnect and rejects stale identities', async () => {
    const clock = new ManualClock();
    const resources = broker(clock);
    const oldWorker = worker('worker', 4);
    const waitingWorker = worker('waiting');
    resources.registerWorker(oldWorker);
    resources.registerWorker(waitingWorker);
    const lease = await resources.acquire({
      ...attempt(oldWorker, 'old-attempt'),
      resources: { ptySession: 1 },
      deadline: clock.now + 1_000,
    });
    const waits = resources.acquire({
      ...attempt(waitingWorker, 'waiting'),
      resources: { ptySession: 1 },
      deadline: clock.now + 1_000,
    });

    resources.disconnectWorker(oldWorker);
    const granted = await waits;
    expect(resources.snapshot().active.map((entry) => entry.attemptId)).toEqual(['waiting']);
    await expect(lease.attach([{ resource: 'ptySession', pid: 10 }])).rejects.toMatchObject({
      code: 'stale-worker',
    });
    expect(() => resources.registerWorker(oldWorker)).toThrowError(
      expect.objectContaining({ code: 'stale-worker' }),
    );
    const nextWorker = worker('worker', 5);
    resources.registerWorker(nextWorker);
    expect(() =>
      resources.acquire({
        ...attempt(nextWorker, 'wrong-run'),
        runId: OTHER_RUN,
        resources: { traceWriter: 1 },
        deadline: clock.now + 1_000,
      }),
    ).toThrowError(expect.objectContaining({ code: 'stale-run' }));
    await granted.release();
  });
});
