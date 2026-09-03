import { describe, expect, it } from 'vitest';
import type { AttemptId, RunId } from '@termwright/protocol/run-events';
import {
  RESOURCE_CLASSES,
  ResourceBroker,
  type ResourceCapacities,
  type ResourceClass,
  type ResourceLease,
  type ResourceVector,
} from './index.js';

const RUN = 'run:00000000-0000-4000-8000-000000000099' as RunId;
const TEST_RESOURCES = ['ptySession', 'externalProcess', 'traceWriter'] as const;

interface Scenario {
  readonly capacities: ResourceCapacities;
  readonly requests: readonly ResourceVector[];
}

interface ModelState {
  readonly used: Record<ResourceClass, number>;
  readonly active: number[];
  readonly queue: number[];
}

describe('ResourceBroker reference model', () => {
  it('matches strict FIFO admission and preserves safety and liveness for generated workloads', async () => {
    for (let seed = 1; seed <= 64; seed += 1) {
      const scenario = generateScenario(seed);
      const first = await executeScenario(seed, scenario);
      const second = await executeScenario(seed, scenario);
      expect(first, `scheduler is not deterministic for seed ${seed}`).toEqual(second);
      expect(first.completed, `an admissible request starved for seed ${seed}`).toBe(
        scenario.requests.length,
      );
    }
  });
});

async function executeScenario(
  seed: number,
  scenario: Scenario,
): Promise<{ readonly waves: readonly (readonly number[])[]; readonly completed: number }> {
  let nextUuid = 0;
  const broker = new ResourceBroker({
    runId: RUN,
    capacities: scenario.capacities,
    monotonicNow: () => 1_000,
    randomUUID: () => `00000000-0000-4000-8000-${String(++nextUuid).padStart(12, '0')}`,
  });
  const barrierWorker = { runId: RUN, workerId: `barrier-${seed}`, workerEpoch: 1 };
  broker.registerWorker(barrierWorker);
  const barrier = await broker.acquire({
    ...barrierWorker,
    attemptId: `barrier-${seed}` as AttemptId,
    resources: scenario.capacities,
    deadline: 10_000,
  });

  const leases = new Map<number, ResourceLease>();
  const pending = scenario.requests.map((resources, index) => {
    const identity = { runId: RUN, workerId: `worker-${seed}-${index}`, workerEpoch: 1 };
    broker.registerWorker(identity);
    return broker
      .acquire({
        ...identity,
        attemptId: `attempt-${seed}-${index}` as AttemptId,
        resources,
        deadline: 10_000,
      })
      .then((lease) => {
        leases.set(index, lease);
        return lease;
      });
  });

  const model = createModel(scenario);
  const waves: number[][] = [];
  await barrier.release();
  releaseModelBarrier(model, scenario);

  while (model.active.length > 0 || model.queue.length > 0) {
    drainModel(model, scenario);
    await Promise.resolve();
    assertEquivalent(seed, broker, model, scenario.capacities);
    waves.push([...model.active]);

    const released = model.active.shift();
    if (released === undefined) {
      throw new Error(`reference scheduler made no progress for seed ${seed}`);
    }
    subtract(model.used, requestAt(scenario, released));
    const lease = leases.get(released);
    if (lease === undefined) throw new Error(`broker omitted grant ${released} for seed ${seed}`);
    await lease.release();
  }

  await Promise.all(pending);
  assertEquivalent(seed, broker, model, scenario.capacities);
  return { waves, completed: leases.size };
}

function createModel(scenario: Scenario): ModelState {
  const used = zeroVector();
  add(used, scenario.capacities);
  return { used, active: [], queue: scenario.requests.map((_request, index) => index) };
}

function releaseModelBarrier(model: ModelState, scenario: Scenario): void {
  subtract(model.used, scenario.capacities);
}

function drainModel(model: ModelState, scenario: Scenario): void {
  for (;;) {
    const index = model.queue[0];
    if (index === undefined) return;
    const request = requestAt(scenario, index);
    if (!fits(model.used, request, scenario.capacities)) return;
    model.queue.shift();
    model.active.push(index);
    add(model.used, request);
  }
}

function requestAt(scenario: Scenario, index: number): ResourceVector {
  const request = scenario.requests[index];
  if (request === undefined) throw new Error(`reference request ${index} is missing`);
  return request;
}

function assertEquivalent(
  seed: number,
  broker: ResourceBroker,
  model: ModelState,
  capacities: ResourceCapacities,
): void {
  const snapshot = broker.snapshot();
  for (const resource of RESOURCE_CLASSES) {
    expect(snapshot.used[resource], `usage differs for ${resource}, seed ${seed}`).toBe(
      model.used[resource],
    );
    expect(
      snapshot.used[resource],
      `capacity exceeded for ${resource}, seed ${seed}`,
    ).toBeLessThanOrEqual(capacities[resource] ?? 0);
  }
  expect(snapshot.active.map((entry) => attemptIndex(entry.attemptId))).toEqual(model.active);
  expect(snapshot.queue.map((entry) => attemptIndex(entry.attemptId))).toEqual(model.queue);
}

function generateScenario(seed: number): Scenario {
  const random = mulberry32(seed);
  const capacities = Object.fromEntries(
    TEST_RESOURCES.map((resource) => [resource, 1 + Math.floor(random() * 3)]),
  ) as ResourceCapacities;
  const count = 8 + Math.floor(random() * 17);
  const requests = Array.from({ length: count }, () => {
    const request: Partial<Record<ResourceClass, number>> = {};
    do {
      for (const resource of TEST_RESOURCES) {
        request[resource] = Math.floor(random() * ((capacities[resource] ?? 0) + 1));
      }
    } while (TEST_RESOURCES.every((resource) => request[resource] === 0));
    return request;
  });
  return { capacities, requests };
}

function fits(
  used: Readonly<Record<ResourceClass, number>>,
  request: ResourceVector,
  capacities: ResourceCapacities,
): boolean {
  return RESOURCE_CLASSES.every(
    (resource) => used[resource] + (request[resource] ?? 0) <= (capacities[resource] ?? 0),
  );
}

function add(target: Record<ResourceClass, number>, vector: ResourceVector): void {
  for (const resource of RESOURCE_CLASSES) target[resource] += vector[resource] ?? 0;
}

function subtract(target: Record<ResourceClass, number>, vector: ResourceVector): void {
  for (const resource of RESOURCE_CLASSES) target[resource] -= vector[resource] ?? 0;
}

function zeroVector(): Record<ResourceClass, number> {
  return Object.fromEntries(RESOURCE_CLASSES.map((resource) => [resource, 0])) as Record<
    ResourceClass,
    number
  >;
}

function attemptIndex(attemptId: AttemptId): number {
  const match = /-(\d+)$/u.exec(attemptId);
  if (match === null) throw new Error(`unexpected generated attempt id ${attemptId}`);
  return Number(match[1]);
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}
