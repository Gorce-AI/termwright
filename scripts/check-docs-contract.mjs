#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readQuickstartContract } from './docs-contract.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const [{ readme, gettingStarted, app, readmeTest, docsTest }, exampleApp, exampleTest] =
  await Promise.all([
    readQuickstartContract(),
    readFile(resolve(root, 'examples/getting-started/app.mjs'), 'utf8'),
    readFile(resolve(root, 'examples/getting-started/tests/permission.test.ts'), 'utf8'),
  ]);

if (readmeTest !== docsTest) throw new Error('README and Getting Started quick-start tests differ');
if (app !== exampleApp)
  throw new Error('Getting Started app snippet differs from executable source');
if (docsTest !== exampleTest)
  throw new Error('README/Getting Started test snippet differs from executable source');

for (const command of [
  'npm install --save-dev termwright',
  'npx termwright doctor',
  'npx termwright test',
]) {
  if (!gettingStarted.includes(command)) throw new Error(`Getting Started lacks ${command}`);
}
for (const command of ['npm install --save-dev termwright', 'npx termwright test']) {
  if (!readme.includes(command)) throw new Error(`README lacks ${command}`);
}

console.log('README and Getting Started contracts match their executable sources');
