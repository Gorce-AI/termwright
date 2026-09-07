import { AsyncLocalStorage } from 'node:async_hooks';
import type { AssertRecord } from './trace-context.js';

/** One authored matcher call, including its internal comparisons and retries. */
export interface AssertionRecording {
  readonly api: string;
  record?: AssertRecord;
}

const key = Symbol.for('termwright.test.assertion-recording.v1');
const globals = globalThis as typeof globalThis & {
  [key]?: AsyncLocalStorage<AssertionRecording>;
};
export const assertionRecording = (globals[key] ??= new AsyncLocalStorage<AssertionRecording>());
