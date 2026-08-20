#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runPerformanceBenchmark } from './report.js';

interface CliOptions {
  readonly iterations?: number;
  readonly warmupIterations?: number;
  readonly nodeCount?: number;
  readonly output?: string;
  readonly pretty: boolean;
}

function numberAfter(args: readonly string[], index: number, option: string): number {
  const value = args[index + 1];
  if (value === undefined) throw new Error(`${option} requires a value`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${option} must be a positive safe integer`);
  }
  return parsed;
}

function parseArgs(args: readonly string[]): CliOptions {
  let iterations: number | undefined;
  let warmupIterations: number | undefined;
  let nodeCount: number | undefined;
  let output: string | undefined;
  let pretty = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    switch (argument) {
      case '--iterations':
        iterations = numberAfter(args, index, argument);
        index += 1;
        break;
      case '--warmup':
        warmupIterations = numberAfter(args, index, argument);
        index += 1;
        break;
      case '--nodes':
        nodeCount = numberAfter(args, index, argument);
        index += 1;
        break;
      case '--output':
        output = args[index + 1];
        if (output === undefined || output.length === 0) throw new Error('--output requires a path');
        index += 1;
        break;
      case '--pretty':
        pretty = true;
        break;
      default:
        throw new Error(`unknown option ${String(argument)}`);
    }
  }
  return {
    ...(iterations === undefined ? {} : { iterations }),
    ...(warmupIterations === undefined ? {} : { warmupIterations }),
    ...(nodeCount === undefined ? {} : { nodeCount }),
    ...(output === undefined ? {} : { output }),
    pretty,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const report = runPerformanceBenchmark(options);
  const json = `${JSON.stringify(report, null, options.pretty ? 2 : undefined)}\n`;
  if (options.output === undefined) {
    process.stdout.write(json);
    return;
  }
  await writeFile(resolve(options.output), json, 'utf8');
}

await main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(`termwright performance benchmark: ${detail}\n`);
  process.exitCode = 1;
});
