#!/usr/bin/env node
/** Contract matrix executed by one certified Termwright/Vitest host. */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TermwrightTestHost, TERMWRIGHT_RESOURCE_PROFILES } from '../../termwright-cli/dist/host.js';

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REPOSITORY_ROOT = join(PACKAGE_ROOT, '..', '..');
const PYTHON_SOURCE = join(REPOSITORY_ROOT, 'clients', 'python', 'src');
const PYTHON_ENV = Object.freeze({
  PYTHONPATH: [PYTHON_SOURCE, process.env.PYTHONPATH].filter(Boolean).join(delimiter),
});
const REQUIRE_NO_SKIPPED_AREAS = process.argv.includes('--require-no-skipped-areas');
const REQUIRE_DECLARED_SKIPS = process.argv.includes('--require-declared-skips');
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
process.env.TERMWRIGHT_UPDATE_SNAPSHOTS = 'none';
const host = await TermwrightTestHost.open({
  cwd: REPOSITORY_ROOT,
  runsDir: join(REPOSITORY_ROOT, '.termwright', 'conformance-runs'),
  resourceProfile: process.platform === 'win32'
    ? TERMWRIGHT_RESOURCE_PROFILES['windows-ci']
    : TERMWRIGHT_RESOURCE_PROFILES.ci,
  preflight: {
    requiredToolchains: [
      { name: 'Go', commands: [['go', 'version']] },
      {
        name: 'Python with the Termwright and Textual clients',
        commands: [
          ['python3', '-c', 'import termwright, textual'],
          ['python', '-c', 'import termwright, textual'],
        ],
        env: PYTHON_ENV,
      },
    ],
  },
  filters: SUITES.map(([file]) => file),
});

const rows = [];
const catalogTests = [];
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
    catalogTests.push({ file: suite[0], fullName: test.fullName });
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
    const skippedTests = runnerTaskIds
      .filter((runnerTaskId) => !finishedTasks.has(runnerTaskId))
      .map((runnerTaskId) => {
        const test = discovery.catalog.tests.find((candidate) => candidate.runnerTaskId === runnerTaskId);
        if (test === undefined) throw new Error(`conformance task ${runnerTaskId} disappeared from its catalog`);
        return `${file}::${test.fullName}`;
      });
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
    rows.push({ area, section, verdict, tests: runnerTaskIds.length, passed, skipped, skippedTests,
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

const observedSkips = rows.flatMap((row) => row.skippedTests ?? []).sort();
const expectedSkips = REQUIRE_NO_SKIPPED_AREAS
  ? declaredApplicabilitySkips().sort()
  : REQUIRE_DECLARED_SKIPS
    ? [...declaredApplicabilitySkips(), ...declaredPlatformSkips(catalogTests)].sort()
    : null;
const missingRequired = expectedSkips !== null && JSON.stringify(observedSkips) !== JSON.stringify(expectedSkips);
const broken = infrastructureFailure || missingRequired || rows.some((row) => row.verdict === 'not run' || row.verdict.startsWith('FAIL'));
if (missingRequired) {
  process.stdout.write(`conformance skip mismatch:\n  expected ${JSON.stringify(expectedSkips)}\n  observed ${JSON.stringify(observedSkips)}\n`);
}
process.stdout.write(broken ? '\nconformance: FAILED\n\n' : 'conformance: passed\n\n');
process.exit(broken ? 1 : 0);

function pad(text, width) { return String(text).padEnd(width); }

function declaredPlatformSkips(catalog) {
  const registry = JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'quality', 'platform-deviations.json'), 'utf8'));
  const suiteFiles = new Set(SUITES.map(([file]) => file));
  const platformDeclarations = registry.deviations
    .filter(({ predicate }) => predicate === (process.platform === 'win32' ? 'win32' : 'non-win32'))
    .flatMap(({ tests }) => tests)
    .filter(([file]) => suiteFiles.has(file));
  return platformDeclarations.map(([file, title]) => {
    const matches = catalog.filter((test) =>
      test.file === file && test.fullName.split(' > ').at(-1) === title);
    if (matches.length !== 1) {
      throw new Error(`declared skip ${file}::${title} matched ${matches.length} catalog tests`);
    }
    return `${file}::${matches[0].fullName}`;
  });
}

function declaredApplicabilitySkips() {
  // These are deliberate applicability branches in the reusable adapter
  // suite, with multiplicity preserved. Exact comparison means removing an
  // advertised capability or silently adding one changes the observed list
  // and fails certification instead of shrinking the test catalogue.
  return [
    'packages/conformance/src/suites/language-adapters.test.ts::adapter conformance: termwright (Textual) > the dormant rule > produces the same bytes as a build without the adapter',
    'packages/conformance/src/suites/language-adapters.test.ts::adapter conformance: termwright (Textual) > an instrumented session > carries a log record without printing it',
    'packages/conformance/src/suites/language-adapters.test.ts::adapter conformance: termwright (tview) > an instrumented session > carries a log record without printing it',
    ...(process.platform === 'win32'
      ? []
      : ['packages/conformance/src/suites/driver-generic.test.ts::a generic session > fails closed when ConPTY hides terminal input modes']),
  ];
}

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
