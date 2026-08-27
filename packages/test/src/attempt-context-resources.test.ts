import { describe, expect, it } from 'vitest';
import { createRunId } from '@termwright/protocol';
import type { RemoteResourceLease } from '@termwright/resource-broker/transport';
import { createAttemptContext } from './attempt-context.js';
import { unitAttemptOptions } from './__fixtures__/attempt-options.js';

describe('attempt resource diagnostics', () => {
  it('names the exact terminal reservation required by a concurrent launch', async () => {
    const runId = createRunId('run');
    const attemptId = createRunId('attempt');
    const reservedLease: RemoteResourceLease = {
      runId,
      attemptId,
      workerId: 'unit-worker',
      workerEpoch: 0,
      leaseId: 'unit-lease',
      resources: { ptySession: 1 },
      attachments: [],
      attach: async () => undefined,
      release: async () => undefined,
    };
    const context = createAttemptContext({
      invocationId: createRunId('invocation'),
      runId,
      projectId: createRunId('project'),
      specId: createRunId('spec'),
      runnerTaskId: createRunId('runner-task'),
      nativeTaskId: 'resource-diagnostic',
      file: '/repo/resource.test.ts',
      fullName: 'resource diagnostic',
    }, 0, 0, {
      ...unitAttemptOptions(),
      attemptId,
      reservedLease: Promise.resolve(reservedLease),
      resourceReservation: { ptySession: 1 },
    });

    const first = await context.resources.acquire({ ptySession: 1 });
    await expect(context.resources.acquire({ ptySession: 1 })).rejects.toThrow(
      /declared 1, already allocated 1, requested 1.*test\.resources\(\{ terminals: 2 \}\)/u,
    );
    await first.release();
  });
});
