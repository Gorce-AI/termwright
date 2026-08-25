import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

test('ordinary tests remain ordinary and the transform writes no generated module', async () => {
  const featureDirectory = resolve(import.meta.dirname, 'features');
  const files = await readdir(featureDirectory);

  expect(files.sort()).toEqual([
    'arithmetic.feature',
    'arithmetic.steps.ts',
    'custom-fixtures.feature',
    'custom-fixtures.steps.ts',
  ]);
});
