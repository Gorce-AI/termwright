import { createRunId } from '@termwright/protocol';
import type { ResourceBrokerClient } from '@termwright/resource-broker/transport';
import { TestBudget } from '../attempt-budget.js';

const broker: ResourceBrokerClient = Object.freeze({
  identity: Object.freeze({ runId: createRunId('run'), workerId: 'unit-worker', workerEpoch: 0 }),
  acquire: async () => {
    throw new Error('unit attempt did not provision terminal resources');
  },
  snapshot: async () => {
    throw new Error('unit attempt did not request a broker snapshot');
  },
  close: async () => undefined,
});

/** Explicit unit-only authority; production AttemptContext never has a fallback broker. */
export function unitAttemptOptions() {
  return Object.freeze({
    budget: new TestBudget(5_000),
    broker,
    resourceProfile: Object.freeze({}),
  });
}
