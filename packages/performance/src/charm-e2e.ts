#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runCharmPerformanceBenchmark } from './charm.js';

const args = process.argv.slice(2);
let iterations: number | undefined;
let output: string | undefined;
let pretty = false;
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === '--iterations') {
    iterations = Number(args[index + 1]);
    index += 1;
  } else if (argument === '--output') {
    output = args[index + 1];
    index += 1;
  } else if (argument === '--pretty') {
    pretty = true;
  } else {
    throw new Error(`unknown option ${String(argument)}`);
  }
}

const report = await runCharmPerformanceBenchmark({
  ...(iterations === undefined ? {} : { iterations }),
});
const json = `${JSON.stringify(report, null, pretty ? 2 : undefined)}\n`;
if (output === undefined) {
  process.stdout.write(json);
} else {
  await writeFile(resolve(output), json, 'utf8');
}
