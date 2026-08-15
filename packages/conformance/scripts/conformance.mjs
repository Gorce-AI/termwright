#!/usr/bin/env node
/**
 * `pnpm conformance` — runs every suite and prints one matrix.
 *
 * The per-suite vitest output answers "did my change break something"; this
 * answers "which parts of the specification does this build satisfy", which is
 * the question a release, a new platform or a third-party adapter asks. The
 * adversarial suite is run twice: once normally and once with the worker heap
 * capped at 128 MB, because passing only on a roomy heap is not passing.
 */

import { spawn } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Suite file → what it certifies, in the order the matrix prints them. */
const SUITES = [
  ['src/suites/driver-generic.test.ts', 'generic fallback', '§20.1'],
  ['src/suites/driver-semantic.test.ts', 'semantic matrix', '§20.2'],
  ['src/suites/component.test.ts', 'component harness', '§20.2a'],
  ['src/suites/adversarial.test.ts', 'hostile peer', '§20.3'],
  ['src/suites/interaction.test.ts', 'interaction', '§20.4'],
  ['src/suites/ready.test.ts', 'readiness + env', '§5.3'],
  ['src/suites/ink-adapter.test.ts', 'adapter contract', '§7'],
];

function run(args) {
  return new Promise((resolve) => {
    const child = spawn('npx', ['vitest', 'run', ...args], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

/** Runs vitest with the JSON reporter and returns per-file tallies. */
async function tally(configArgs, files) {
  const output = join(tmpdir(), `termwright-conformance-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  const code = await run([...configArgs, ...files, '--reporter=json', `--outputFile=${output}`]);
  let report;
  try {
    report = JSON.parse(await readFile(output, 'utf8'));
  } catch {
    return { code, files: new Map() };
  } finally {
    await rm(output, { force: true });
  }

  const results = new Map();
  for (const file of report.testResults ?? []) {
    const key = basename(file.name ?? '');
    const entry = results.get(key) ?? { passed: 0, failed: 0, skipped: 0, ms: 0 };
    for (const assertion of file.assertionResults ?? []) {
      if (assertion.status === 'passed') entry.passed += 1;
      else if (assertion.status === 'failed') entry.failed += 1;
      else entry.skipped += 1;
      entry.ms += assertion.duration ?? 0;
    }
    results.set(key, entry);
  }
  return { code, files: results };
}

function verdict(entry) {
  if (entry === undefined) return 'not run';
  if (entry.failed > 0) return `FAIL (${entry.failed})`;
  if (entry.passed === 0) return 'skipped';
  return 'pass';
}

function pad(text, width) {
  return String(text).padEnd(width);
}

const main = await tally([], SUITES.map(([file]) => file));
const hostile = await tally(['--config', 'vitest.hostile.config.ts'], ['src/suites/adversarial.test.ts']);

const rows = SUITES.map(([file, title, section]) => {
  const entry = main.files.get(basename(file));
  return {
    area: title,
    section,
    verdict: verdict(entry),
    tests: entry === undefined ? 0 : entry.passed + entry.failed + entry.skipped,
    passed: entry?.passed ?? 0,
    seconds: ((entry?.ms ?? 0) / 1000).toFixed(1),
  };
});

const hostileEntry = hostile.files.get('adversarial.test.ts');
rows.push({
  area: 'hostile peer @ 128 MB heap',
  section: '§10',
  verdict: verdict(hostileEntry),
  tests: hostileEntry === undefined ? 0 : hostileEntry.passed + hostileEntry.failed + hostileEntry.skipped,
  passed: hostileEntry?.passed ?? 0,
  seconds: ((hostileEntry?.ms ?? 0) / 1000).toFixed(1),
});

const width = Math.max(...rows.map((row) => row.area.length), 4);
process.stdout.write('\ntermwright conformance matrix\n');
process.stdout.write(`${'-'.repeat(width + 34)}\n`);
process.stdout.write(`${pad('area', width)}  ${pad('spec', 7)}  ${pad('result', 10)}  ${pad('tests', 7)}  time\n`);
for (const row of rows) {
  process.stdout.write(
    `${pad(row.area, width)}  ${pad(row.section, 7)}  ${pad(row.verdict, 10)}  ` +
      `${pad(`${row.passed}/${row.tests}`, 7)}  ${row.seconds}s\n`,
  );
}
process.stdout.write(`${'-'.repeat(width + 34)}\n`);

const failed = rows.some((row) => row.verdict.startsWith('FAIL'));
const skipped = rows.every((row) => row.verdict === 'skipped');
if (skipped) process.stdout.write('no pseudo-terminal available: every suite skipped\n');
process.stdout.write(failed ? 'conformance: FAILED\n\n' : 'conformance: passed\n\n');
process.exit(failed || main.code !== 0 || hostile.code !== 0 ? 1 : 0);
