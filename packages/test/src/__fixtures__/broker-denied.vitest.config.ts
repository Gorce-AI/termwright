import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { hostFileId } from './host-task-id.js';
import { createRunId, parseRunId } from '@termwright/protocol';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const fixture = fileURLToPath(new URL('broker-denied.fixture.ts', import.meta.url));
const fileId = hostFileId(root, fixture);
const endpoint = process.env['TERMWRIGHT_TEST_BROKER_ENDPOINT'];
const token = process.env['TERMWRIGHT_TEST_BROKER_TOKEN'];
const runId = process.env['TERMWRIGHT_TEST_RUN_ID'];
const journalEndpoint = process.env['TERMWRIGHT_TEST_JOURNAL_ENDPOINT'];
const journalToken = process.env['TERMWRIGHT_TEST_JOURNAL_TOKEN'];
if (
  endpoint === undefined ||
  token === undefined ||
  runId === undefined ||
  journalEndpoint === undefined ||
  journalToken === undefined
) {
  throw new Error('denied runner fixture requires its authoritative broker context');
}

export default defineConfig({
  test: {
    include: ['packages/test/src/__fixtures__/broker-denied.fixture.ts'],
    environment: 'node',
    runner: fileURLToPath(new URL('../runner.ts', import.meta.url)),
    provide: {
      'termwright.runner.context.v3': {
        invocationId: createRunId('invocation'),
        runId: parseRunId('run', runId),
        tasks: {
          [`${fileId}_0`]: {
            runnerTaskId: createRunId('runner-task'),
            projectId: createRunId('project'),
            specId: createRunId('spec'),
            file: fixture,
            fullName: 'broker denied fixture',
            resourceDecision: 'fixture',
          },
        },
        broker: {
          endpoint,
          token,
          workerEpoch: 0,
          workerIdPrefix: 'denied-fixture',
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
