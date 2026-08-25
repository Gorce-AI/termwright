import { expect, test } from '@termwright/test';
import { currentAttemptContext } from '@termwright/test/runner';

test.resources({ terminals: 2 })('duplicate title', async () => {
  await Promise.resolve();
  const attempt = currentAttemptContext();
  console.log(`native-host-output:${attempt.attemptId}`);
  expect(attempt.nativeTaskId).toBeTruthy();
  expect(attempt.runId).toMatch(/^run:/u);
  expect(attempt.resources.reservation).toEqual({
    ptySession: 2,
    externalProcess: 2,
    semanticEndpoint: 2,
    traceWriter: 2,
  });
});

test('duplicate title', () => {
  const attempt = currentAttemptContext();
  console.error(`native-host-error:${attempt.attemptId}`);
  expect(attempt.attemptId).toMatch(/^attempt:/u);
  expect(attempt.runnerTaskId).toMatch(/^runner-task:/u);
});
