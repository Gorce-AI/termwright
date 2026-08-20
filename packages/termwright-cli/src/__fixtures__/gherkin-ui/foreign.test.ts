import { appendFileSync } from 'node:fs';
import { test } from 'vitest';

test.only('foreign case must never enter the Termwright UI', () => {
  const effects = process.env['TERMWRIGHT_GHERKIN_UI_EFFECTS'];
  if (effects !== undefined) appendFileSync(effects, 'FOREIGN\n', 'utf8');
});
