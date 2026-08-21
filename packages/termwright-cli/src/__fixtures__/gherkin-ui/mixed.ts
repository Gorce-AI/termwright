import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import type { TerminalHarness } from '@termwright/driver';
import { configureTermwright } from '@termwright/test';
import { After, Before, Given, Then, When, defineSteps } from '@termwright/gherkin';

const semanticApp = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', '..',
  'driver', 'test-fixtures', 'semantic-app.mjs',
);

configureTermwright({
  outputDir: process.env['TERMWRIGHT_GHERKIN_UI_OUTPUT'] ?? join(tmpdir(), 'termwright-gherkin-ui-artifacts'),
});

function app(world: Record<string, unknown>): TerminalHarness {
  const value = world['app'];
  if (value === undefined) throw new Error('permission terminal was not launched');
  return value as TerminalHarness;
}

export default defineSteps(
  Before(({ world, defer }) => {
    world['hookReady'] = true;
    defer(() => {
      world['cleaned'] = true;
    });
  }),
  After(({ world }) => {
    if (world['hookReady'] !== true) throw new Error('Before hook did not initialize this scenario');
  }),
  Given('a permission terminal is running', async ({ terminal, world }) => {
    const effects = process.env['TERMWRIGHT_GHERKIN_UI_EFFECTS'];
    if (effects !== undefined) appendFileSync(effects, 'FEATURE\n', 'utf8');
    const launched = await terminal.launch({
      command: [process.execPath, semanticApp],
      columns: 60,
      rows: 10,
      trace: 'on',
    });
    world['app'] = launched;
    await launched.waitForText('Permission required');
  }),
  When('I move focus to Reject', async ({ world }) => {
    await app(world).press('Tab');
  }),
  Then('Reject is focused', async ({ expect, world }) => {
    await expect(app(world).getByRole('button', { name: 'Reject' })).toBeFocused();
  }),
  Given('the approval policy is already recorded', () => {
    const effects = process.env['TERMWRIGHT_GHERKIN_UI_EFFECTS'];
    if (effects !== undefined) appendFileSync(effects, 'ACTIONLESS RULE\n', 'utf8');
  }),
);
