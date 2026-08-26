import { TestRunner, describe, expect, it as vitestIt } from 'vitest';
import { it as resourceIt } from './vitest.js';

const sentinel = 'resource-aware collector sentinel';
const suite = TestRunner.getCurrentSuite();
resourceIt.resources({ terminals: 1, traceWriters: 0, nativeHost: 'exclusive' })(sentinel, () => {});
const collected = suite.tasks.find((task) => task.type === 'test' && task.name === sentinel);
const collectedMeta = collected !== undefined && 'meta' in collected ? collected.meta : undefined;

describe('resource-aware Vitest declaration', () => {
  vitestIt('marks the task owned by the active Vitest collector', () => {
    expect(collectedMeta).toMatchObject({
      termwright: {
        provider: { id: '@termwright/test', version: 1 },
        resources: { terminals: 1, traceWriters: 0, nativeHost: 'exclusive' },
        declaration: { mode: 'run', exclusive: false },
      },
    });
  });
});
