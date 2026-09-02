import { expect, test } from '@termwright/test';

const workerEnvAtModuleEvaluation = process.env['TERMWRIGHT_WORKER_ENV_PROBE'];
const requiredGoAtModuleEvaluation = process.env['TERMWRIGHT_REQUIRE_GO'];

test.resources({ terminals: 2 })('duplicate title', async () => {
  await Promise.resolve();
  expect(workerEnvAtModuleEvaluation).toBe('exact');
  expect(requiredGoAtModuleEvaluation).toBe('1');
  console.log('native-host-output');
});

test('duplicate title', () => {
  console.error('native-host-stderr-fixture');
});
