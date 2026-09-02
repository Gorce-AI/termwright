import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { hostFileId } from './host-task-id.js';
import { createRunId, parseRunId } from '@termwright/protocol';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const fixture = fileURLToPath(new URL('attempt-context.fixture.ts', import.meta.url));
const fileId = hostFileId(root, fixture);
const projectId = createRunId('project');
const brokerEndpoint = process.env['TERMWRIGHT_TEST_BROKER_ENDPOINT'];
const brokerToken = process.env['TERMWRIGHT_TEST_BROKER_TOKEN'];
const configuredRunId = process.env['TERMWRIGHT_TEST_RUN_ID'];
const journalEndpoint = process.env['TERMWRIGHT_TEST_JOURNAL_ENDPOINT'];
const journalToken = process.env['TERMWRIGHT_TEST_JOURNAL_TOKEN'];
if (
  brokerEndpoint === undefined ||
  brokerToken === undefined ||
  configuredRunId === undefined ||
  journalEndpoint === undefined ||
  journalToken === undefined
) {
  throw new Error('runner fixture requires its authoritative broker context');
}
const task = () => ({
  runnerTaskId: createRunId('runner-task'),
  projectId,
  specId: createRunId('spec'),
  file: fixture,
  fullName: 'attempt context fixture',
  resourceDecision: 'history=miss; conservative fixture reservation',
});

export default defineConfig({
  test: {
    include: ['packages/test/src/__fixtures__/attempt-context.fixture.ts'],
    environment: 'node',
    runner: fileURLToPath(new URL('../runner.ts', import.meta.url)),
    provide: {
      'termwright.runner.context.v3': {
        invocationId: createRunId('invocation'),
        runId: parseRunId('run', configuredRunId),
        tasks: {
          [`${fileId}_0`]: task(),
          [`${fileId}_1`]: task(),
          [`${fileId}_2_0`]: task(),
          [`${fileId}_3`]: task(),
          [`${fileId}_4`]: task(),
          [`${fileId}_5`]: task(),
          [`${fileId}_6`]: task(),
        },
        broker: {
          endpoint: brokerEndpoint,
          token: brokerToken,
          workerEpoch: 0,
          workerIdPrefix: 'runner-fixture',
          handshakeTimeoutMs: 5_000,
          admissionDeadline: performance.timeOrigin + performance.now() + 30_000,
          resourceProfile: {},
        },
        journal: {
          endpoint: journalEndpoint,
          token: journalToken,
          handshakeTimeoutMs: 5_000,
          acknowledgementTimeoutMs: 5_000,
          binding: 'host-assigned-worker',
        },
      },
    },
    fileParallelism: false,
  },
});
