import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { configureTermwright, test } from '@termwright/test';

configureTermwright({
  command: [
    process.execPath,
    fileURLToPath(new URL('../../../driver/test-fixtures/semantic-app.mjs', import.meta.url)),
  ],
  outputDir: join(tmpdir(), 'termwright-trace-ui-regression'),
  trace: 'on',
});

test('retained passing recording', async ({ terminal }) => {
  const app = await terminal.launch();
  await app.waitForText('Permission required');
  await app.press('Tab');
});

let attempts = 0;

test('retry without a retained recording', { retry: 1 }, async ({ terminal }) => {
  const retry = attempts++;
  const app = await terminal.launch({ trace: retry === 0 ? 'on' : 'off' });
  await app.waitForText('Permission required');
  if (retry === 0) throw new Error('retain this failed attempt only');
});
