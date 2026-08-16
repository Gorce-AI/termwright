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
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * The workspace's own vitest, as a script this Node runs directly.
 *
 * Two traps, both met the hard way. `npx vitest` downloads the latest release
 * when the local binary is not on its lookup path, so a workspace change
 * elsewhere silently runs the matrix on a different major. And
 * `node_modules/.bin/vitest` is a shell script on POSIX but a `.CMD` shim on
 * Windows, where spawning it without a shell is ENOENT. Resolving the package's
 * own `bin` entry and running it with `process.execPath` sidesteps both: no
 * download, no shim, no platform branch.
 */
function vitestEntry() {
  for (const root of [ROOT, join(ROOT, '..', '..')]) {
    const manifest = join(root, 'node_modules', 'vitest', 'package.json');
    if (!existsSync(manifest)) continue;
    const bin = JSON.parse(readFileSync(manifest, 'utf8')).bin;
    const relative = typeof bin === 'string' ? bin : bin?.vitest;
    if (typeof relative !== 'string') continue;
    const entry = join(root, 'node_modules', 'vitest', relative);
    if (existsSync(entry)) return entry;
  }
  throw new Error('conformance: vitest is not installed in this workspace; run `pnpm install` first');
}

const VITEST = vitestEntry();

/** Suite file → what it certifies, in the order the matrix prints them. */
const SUITES = [
  ['src/suites/driver-generic.test.ts', 'generic fallback', '§20.1'],
  ['src/suites/driver-semantic.test.ts', 'semantic matrix', '§20.2'],
  ['src/suites/component.test.ts', 'component harness', '§20.2a'],
  ['src/suites/adversarial.test.ts', 'hostile peer + deltas', '§20.3'],
  ['src/suites/interaction.test.ts', 'interaction', '§20.4'],
  ['src/suites/ready.test.ts', 'readiness + env', '§5.3'],
  ['src/suites/ink-adapter.test.ts', 'adapter contract (ink)', '§7'],
  ['src/suites/language-adapters.test.ts', 'adapter contract (py/go)', '§7'],
  ['src/suites/mcp-sessions.test.ts', 'concurrent MCP sessions', '§20.4'],
];

function run(args) {
  return new Promise((resolve) => {
    // Captured rather than discarded: when a suite fails, the matrix prints
    // tallies and the reason lives in this output. Throwing it away made a CI
    // failure unreadable without re-running locally.
    const child = spawn(process.execPath, [VITEST, 'run', ...args], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += String(chunk);
      process.stderr.write(chunk);
    });
    child.on('close', (code) => resolve({ code: code ?? 1, output }));
  });
}

/** Runs vitest with the JSON reporter and returns per-file tallies. */
async function tally(configArgs, files) {
  const output = join(tmpdir(), `termwright-conformance-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  const { code, output: runnerOutput } = await run([
    ...configArgs,
    ...files,
    '--reporter=json',
    `--outputFile=${output}`,
  ]);
  let report;
  try {
    report = JSON.parse(await readFile(output, 'utf8'));
  } catch {
    // No report at all: a crashed or killed runner, where the child's own
    // output is the only evidence left of what happened.
    process.stdout.write(`\n--- vitest produced no report (exit ${code}) ---\n${runnerOutput}\n`);
    return { code, files: new Map() };
  } finally {
    await rm(output, { force: true });
  }

  const results = new Map();
  const failures = [];
  for (const file of report.testResults ?? []) {
    const key = basename(file.name ?? '');
    const entry = results.get(key) ?? { passed: 0, failed: 0, skipped: 0, ms: 0 };
    for (const assertion of file.assertionResults ?? []) {
      if (assertion.status === 'passed') entry.passed += 1;
      else if (assertion.status === 'failed') {
        entry.failed += 1;
        failures.push({
          file: key,
          name: assertion.fullName ?? assertion.title ?? '(unnamed)',
          message: (assertion.failureMessages ?? []).join('\n').split('\n')[0] ?? '',
        });
      } else entry.skipped += 1;
      entry.ms += assertion.duration ?? 0;
    }
    results.set(key, entry);
  }

  // The JSON reporter replaces the readable one, so a failing run used to print
  // tallies and whatever the child happened to write to stdout — on Windows
  // that was pages of node-pty noise and not one test name. The report already
  // carries the names; printing them is what makes a remote failure diagnosable
  // without reproducing it.
  if (failures.length > 0) {
    process.stdout.write(`\nfailing tests (${failures.length})\n`);
    for (const failure of failures) {
      process.stdout.write(`  ${failure.file} › ${failure.name}\n      ${failure.message}\n`);
    }
    process.stdout.write('\n');
  }
  return { code, files: results, output: runnerOutput };
}

function verdict(entry) {
  if (entry === undefined) return 'not run';
  if (entry.failed > 0) return `FAIL (${entry.failed})`;
  if (entry.passed === 0) return 'skipped';
  // A partly-skipped area is not a clean pass: the language adapters skip
  // whole registrations when their toolchain is absent, and a matrix that
  // hid that would claim coverage this machine never produced.
  return entry.skipped > 0 ? `pass, ${entry.skipped} skip` : 'pass';
}

function pad(text, width) {
  return String(text).padEnd(width);
}

/**
 * Per-adapter roll-up of the deviations each adapter declares in its own
 * README, written by the contract suite as it runs.
 *
 * It lives here rather than in a normative document because a hand-maintained
 * table of per-adapter gaps went stale within one round of being written, and a
 * stale overview in a document people trust is worse than none. This one is
 * regenerated by every run or it is not printed at all.
 */
function printDeclaredDeviations() {
  const directory = join(tmpdir(), 'termwright-conformance-conventions');
  if (!existsSync(directory)) return;
  const files = readdirSync(directory).filter((name) => name.endsWith('.json'));
  if (files.length === 0) return;

  // Only adapters that actually ran appear: an adapter whose toolchain was
  // missing is absent from this list, which is not the same as having nothing
  // to declare.
  process.stdout.write('declared deviations, per adapter README (adapters that ran)\n');
  for (const file of files.sort()) {
    let summary;
    try {
      summary = JSON.parse(readFileSync(join(directory, file), 'utf8'));
    } catch {
      continue;
    }
    const rules = Object.entries(summary.declared ?? {});
    if (rules.length === 0) {
      process.stdout.write(`  ${summary.adapter}: none declared\n`);
      continue;
    }
    process.stdout.write(`  ${summary.adapter}\n`);
    // `other` holds entries that name no rule; it sorts last rather than
    // turning the comparison into NaN.
    const order = (key) => (/^\d+$/.test(key) ? Number(key) : Number.MAX_SAFE_INTEGER);
    for (const [rule, titles] of rules.sort(([left], [right]) => order(left) - order(right))) {
      const outcomes = (summary.outcomes ?? []).filter((entry) => entry.rule === rule);
      // What the suite can say about a declared rule, honestly: it either
      // could not check it, checked it and agrees the adapter cannot comply,
      // or checked some aspect of it that passes anyway — which is a prompt to
      // re-read the README, not proof that it is wrong.
      const note =
        rule === 'other'
          ? 'names no rule'
          : outcomes.length === 0
            ? 'not checkable from outside'
          : outcomes.some((entry) => entry.status === 'documented')
            ? 'confirmed by the checks'
            : 'the checks that run for this rule pass';
      process.stdout.write(`    rule ${rule}: ${titles.join('; ')}  [${note}]\n`);
    }
  }
  process.stdout.write('\n');
}

// `--deviations` prints the roll-up from the last run and exits. Useful on its
// own — the declarations are what a reader wants when deciding whether an
// adapter's gap is known — and it makes the report's formatting checkable
// without paying for a full matrix.
if (process.argv.includes('--deviations')) {
  printDeclaredDeviations();
  process.exit(0);
}

const main = await tally([], SUITES.map(([file]) => file));
const hostile = await tally(
  ['--config', 'vitest.hostile.config.ts'],
  ['src/suites/adversarial.test.ts', 'src/suites/mcp-sessions.test.ts'],
);

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

for (const [file, area] of [
  ['adversarial.test.ts', 'hostile peer @ 128 MB heap'],
  ['mcp-sessions.test.ts', 'MCP sessions @ 128 MB heap'],
]) {
  const entry = hostile.files.get(file);
  rows.push({
    area,
    section: '§10',
    verdict: verdict(entry),
    tests: entry === undefined ? 0 : entry.passed + entry.failed + entry.skipped,
    passed: entry?.passed ?? 0,
    seconds: ((entry?.ms ?? 0) / 1000).toFixed(1),
  });
}

const width = Math.max(...rows.map((row) => row.area.length), 4);
process.stdout.write('\ntermwright conformance matrix\n');
process.stdout.write(`${'-'.repeat(width + 37)}\n`);
process.stdout.write(`${pad('area', width)}  ${pad('spec', 7)}  ${pad('result', 13)}  ${pad('tests', 7)}  time\n`);
for (const row of rows) {
  process.stdout.write(
    `${pad(row.area, width)}  ${pad(row.section, 7)}  ${pad(row.verdict, 13)}  ` +
      `${pad(`${row.passed}/${row.tests}`, 7)}  ${row.seconds}s\n`,
  );
}
process.stdout.write(`${'-'.repeat(width + 37)}\n`);

// An area that did not run is not a pass. Before this, a crashed or killed
// vitest produced a table of `not run` rows under a cheerful "passed".
printDeclaredDeviations();

const failed = rows.some((row) => row.verdict.startsWith('FAIL') || row.verdict === 'not run');
const skipped = rows.every((row) => row.verdict === 'skipped');
if (skipped) process.stdout.write('no pseudo-terminal available: every suite skipped\n');
if (rows.some((row) => row.verdict === 'not run')) {
  process.stdout.write('some areas produced no result at all: the runner exited before reporting\n');
}

// A runner can exit non-zero with every test passing — an unhandled error in a
// worker, or a child that dies during teardown, both do it. That is still a
// failure, but printing "passed" above the non-zero exit made the summary
// contradict the exit code, and left the reason nowhere. Name it and show the
// tail, so the next reader debugs the crash instead of the report.
const crashed = [
  ['the main suites', main],
  ['the 128 MB gate', hostile],
].filter(([, run]) => run.code !== 0 && !failed);

for (const [label, run] of crashed) {
  process.stdout.write(
    `\n${label}: every test reported a result, but the runner exited ${run.code} — ` +
      'something failed outside the tests\n',
  );
  const tail = (run.output ?? '').trimEnd().split('\n').slice(-20);
  for (const line of tail) process.stdout.write(`  ${line}\n`);
}

const broken = failed || crashed.length > 0;
process.stdout.write(broken ? '\nconformance: FAILED\n\n' : 'conformance: passed\n\n');
process.exit(broken ? 1 : 0);
