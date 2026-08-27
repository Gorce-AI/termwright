import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { configureTermwright, test } from '@termwright/test';

const semanticApp = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'driver',
  'test-fixtures',
  'semantic-app.mjs',
);
configureTermwright({ outputDir: join(tmpdir(), 'termwright-typescript-ui-artifacts') });

test('TypeScript opens the permission terminal', async ({ terminal, expect }) => {
  const effects = process.env['TERMWRIGHT_GHERKIN_UI_EFFECTS'];
  if (effects !== undefined) appendFileSync(effects, 'TYPESCRIPT\n', 'utf8');
  const app = await terminal.launch({
    command: [process.execPath, semanticApp],
    columns: 60,
    rows: 10,
    trace: 'on',
  });
  await app.waitForText('Permission required');
  await expect(app.getByRole('button', { name: 'Approve' })).toBeFocused();
});
