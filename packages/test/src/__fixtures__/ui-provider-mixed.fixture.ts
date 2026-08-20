import { appendFileSync } from 'node:fs';
import { describe, test as plainTest } from 'vitest';
import { it, test } from '../index.js';

const effects = process.env['TERMWRIGHT_PROVIDER_EFFECTS'];
const record = (value: string): void => {
  if (effects !== undefined) appendFileSync(effects, `${value}\n`, 'utf8');
};

describe('mixed providers', () => {
  test('owned direct', () => record('owned direct'));

  test.each([1, 2])('owned each %s', (value) => record(`owned each ${value}`));

  test.for([{ label: 'for' }])('owned for $label', ({ label }) => record(`owned ${label}`));

  test.skipIf(false)('owned conditional', () => record('owned conditional'));

  it('owned alias', () => record('owned alias'));

  test.skip('owned skip', () => record('OWNED SKIP RAN'));

  test.todo('owned todo');

  const extended = test.extend<{ label: string }>({ label: 'extended' });
  extended('owned extended', ({ label }) => record(`owned ${label}`));

  plainTest.only('foreign only', () => record('FOREIGN'));
});
