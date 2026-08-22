#!/usr/bin/env node
/** Contract matrix executed by one certified Termwright/Vitest host. */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TermwrightTestHost, TERMWRIGHT_RESOURCE_PROFILES } from '../../termwright-cli/dist/host.js';

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REPOSITORY_ROOT = join(PACKAGE_ROOT, '..', '..');
const REQUIRE_NO_SKIPPED_AREAS = process.argv.includes('--require-no-skipped-areas');
const SUITES = [
  ['packages/conformance/src/suites/driver-generic.test.ts', 'generic fallback', '§20.1'],
  ['packages/conformance/src/suites/adversarial.test.ts', 'hostile peer + full snapshots', '§20.3'],
  ['packages/conformance/src/suites/interaction.test.ts', 'interaction', '§20.4'],
  ['packages/conformance/src/suites/ready.test.ts', 'readiness + env', '§5.3'],
  ['packages/conformance/src/suites/language-adapters.test.ts', 'adapter contract (py/go)', '§7'],
  ['packages/conformance/src/suites/mcp-sessions.test.ts', 'concurrent MCP sessions', '§20.4'],
];

if (process.argv.includes('--deviations')) {
  printDeclaredDeviations();
  process.exit(0);
}

process.env.TERMWRIGHT_RETRIES = '0';
const host = await TermwrightTestHost.open({
  cwd: REPOSITORY_ROOT,
  runsDir: join(REPOSITORY_ROOT, '.termwright', 'conformance-runs'),
  resourceProfile: process.platform === 'win32'
    ? TERMWRIGHT_RESOURCE_PROFILES['windows-ci']
    : TERMWRIGHT_RESOURCE_PROFILES.ci,
  filters: SUITES.map(([file]) => file),
});

const rows = [];
let infrastructureFailure = false;
try {
  const discovery = await host.requestRun({ execute: false }).completed;
  if (discovery.catalog === undefined || discovery.error !== undefined) {
    throw discovery.error ?? new Error('conformance collection produced no native catalog');
  }
  const byFile = new Map();
  for (const test of discovery.catalog.tests) {
    const normalized = test.file.replaceAll('\\', '/');
    const suite = SUITES.find(([file]) => basename(normalized) === basename(file));
    if (suite === undefined) continue;
    const selected = byFile.get(suite[0]) ?? [];
    selected.push(test.runnerTaskId);
    byFile.set(suite[0], selected);
  }
  if (byFile.size === 0) {
    throw new Error(
      `native conformance catalog contained ${discovery.catalog.tests.length} tests but none matched the declared suites; ` +
      `first module: ${discovery.catalog.tests[0]?.file ?? '<empty>'}`,
    );
  }

  for (const [file, area, section] of SUITES) {
    const runnerTaskIds = byFile.get(file) ?? [];
    if (runnerTaskIds.length === 0) {
      rows.push({ area, section, verdict: 'not run', tests: 0, passed: 0, seconds: '0.0', runId: null });
      continue;
    }
    const started = performance.now();
    const completion = await host.requestRun({ runnerTaskIds }).completed;
    const finishedTasks = new Set(
      completion.events
        .filter((event) => event.type === 'attempt.finished' && event.identity.runnerTaskId !== undefined)
        .map((event) => event.identity.runnerTaskId),
    );
    const failed = completion.failures.length;
    const passed = Math.max(0, finishedTasks.size - failed);
    const skipped = Math.max(0, runnerTaskIds.length - finishedTasks.size);
    const verdict = completion.state === 'infrastructure-failed' || completion.state === 'incomplete' || completion.state === 'crashed'
      ? 'INFRASTRUCTURE'
      : failed > 0 || completion.state === 'failed' || completion.state === 'flaky'
        ? `FAIL (${Math.max(1, failed)})`
        : passed === 0
          ? 'skipped'
          : skipped > 0
            ? `pass, ${skipped} skip`
            : 'pass';
    if (verdict === 'INFRASTRUCTURE') infrastructureFailure = true;
    rows.push({ area, section, verdict, tests: runnerTaskIds.length, passed,
      seconds: ((performance.now() - started) / 1000).toFixed(1), runId: completion.runId });
    for (const failure of completion.failures) {
      process.stdout.write(`FAIL ${basename(failure.file)} › ${failure.fullName}\n`);
      for (const error of failure.errors) process.stdout.write(`  ${error.split('\n')[0]}\n`);
    }
    if (completion.error !== undefined) process.stdout.write(`INFRASTRUCTURE ${String(completion.error)}\n`);
  }
} finally {
  await host.close();
}

const width = Math.max(...rows.map((row) => row.area.length), 4);
process.stdout.write('\ntermwright conformance matrix (native host)\n');
process.stdout.write(`${'-'.repeat(width + 82)}\n`);
process.stdout.write(`${pad('area', width)}  ${pad('spec', 7)}  ${pad('result', 16)}  ${pad('tests', 7)}  ${pad('time', 7)}  RunId\n`);
for (const row of rows) {
  process.stdout.write(`${pad(row.area, width)}  ${pad(row.section, 7)}  ${pad(row.verdict, 16)}  ` +
    `${pad(`${row.passed}/${row.tests}`, 7)}  ${pad(`${row.seconds}s`, 7)}  ${row.runId ?? '-'}\n`);
}
process.stdout.write(`${'-'.repeat(width + 82)}\n`);
printDeclaredDeviations();

const missingRequired = REQUIRE_NO_SKIPPED_AREAS && rows.some((row) => row.verdict !== 'pass');
const broken = infrastructureFailure || missingRequired || rows.some((row) => row.verdict === 'not run' || row.verdict.startsWith('FAIL'));
if (missingRequired) process.stdout.write('required conformance area skipped or partial: certification is incomplete\n');
process.stdout.write(broken ? '\nconformance: FAILED\n\n' : 'conformance: passed\n\n');
process.exit(broken ? 1 : 0);

function pad(text, width) { return String(text).padEnd(width); }

function printDeclaredDeviations() {
  const directory = join(tmpdir(), 'termwright-conformance-conventions');
  if (!existsSync(directory)) return;
  const files = readdirSync(directory).filter((name) => name.endsWith('.json'));
  if (files.length === 0) return;
  process.stdout.write('declared deviations from adapters that actually ran\n');
  for (const file of files.sort()) {
    let summary;
    try { summary = JSON.parse(readFileSync(join(directory, file), 'utf8')); }
    catch { continue; }
    const rules = Object.entries(summary.declared ?? {});
    if (rules.length === 0) process.stdout.write(`  ${summary.adapter}: none declared\n`);
    else {
      process.stdout.write(`  ${summary.adapter}\n`);
      for (const [rule, titles] of rules) process.stdout.write(`    rule ${rule}: ${titles.join('; ')}\n`);
    }
  }
  process.stdout.write('\n');
}
