#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runOpenTuiMarkerBenchmark } from './opentui-marker.js';

const args = process.argv.slice(2);
let repetitions: number | undefined;
let windowMs: number | undefined;
let output: string | undefined;
let pretty = false;
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === '--repetitions') {
    repetitions = Number(args[index + 1]);
    index += 1;
  } else if (argument === '--window-ms') {
    windowMs = Number(args[index + 1]);
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

const report = await runOpenTuiMarkerBenchmark({
  ...(repetitions === undefined ? {} : { repetitions }),
  ...(windowMs === undefined ? {} : { windowMs }),
});
const json = `${JSON.stringify(report, null, pretty ? 2 : undefined)}\n`;
if (output === undefined) {
  process.stdout.write(json);
} else {
  await writeFile(resolve(output), json, 'utf8');
}
