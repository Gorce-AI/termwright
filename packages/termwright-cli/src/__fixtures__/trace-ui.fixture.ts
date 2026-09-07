import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { configureTermwright, expect, test } from '@termwright/test';

configureTermwright({
  command: [
    process.execPath,
    fileURLToPath(new URL('../../../driver/test-fixtures/semantic-app.mjs', import.meta.url)),
  ],
  // The semantic fixture publishes geometry for an 80×24 grid.
  columns: 80,
  rows: 24,
  outputDir: join(tmpdir(), 'termwright-trace-ui-regression'),
  trace: 'on',
});

test('retained passing recording', async ({ terminal, step }) => {
  await step('before any terminal', () => expect(0).toBe(0));
  const app = await terminal.launch();
  await app.waitForText('Permission required');
  await app.press('Tab');
  await step('plain assertion', async () => {
    expect(await app.getByRole('listitem').count()).toBe(0);
  });
  await step('empty locator assertion', async () => {
    await expect(app.getByRole('listitem')).toHaveCount(0);
  });
  await step('one locator target', async () => {
    await expect(app.getByRole('button', { name: 'Approve' })).toHaveCount(1);
    await expect(app.getByRole('button', { name: 'Approve' })).toBeVisible();
  });
  await step('multiple locator targets', async () => {
    await expect(app.getByRole('button')).toHaveCount(2);
  });
});

let attempts = 0;

test('retry without a retained recording', { retry: 1 }, async ({ terminal }) => {
  const retry = attempts++;
  const app = await terminal.launch({ trace: retry === 0 ? 'on' : 'off' });
  await app.waitForText('Permission required');
  if (retry === 0) expect.soft(1).toBe(0);
});
