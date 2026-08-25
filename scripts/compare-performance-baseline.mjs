import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  comparePerformanceBaseline,
  formatGitHubError,
  formatGitHubWarning,
} from '../packages/performance/dist/index.js';
import { loadPerformanceObservations } from './performance-observations.mjs';

const options = parseArgs(process.argv.slice(2));
const baseline = JSON.parse(await readFile(resolve(options.baseline), 'utf8'));
const { observations, provenance } = await loadPerformanceObservations(options);
const comparisons = comparePerformanceBaseline(baseline, observations);
for (const comparison of comparisons) {
  if (comparison.status === 'warning') process.stdout.write(`${formatGitHubWarning(comparison, options.baseline)}\n`);
  if (comparison.status === 'failure') process.stdout.write(`${formatGitHubError(comparison, options.baseline)}\n`);
}

const output = {
  kind: 'termwright-performance-comparison',
  schemaVersion: 1,
  gate: 'performance-annotate-cleanup-fail',
  baseline: options.baseline,
  generatedAt: new Date().toISOString(),
  provenance,
  comparisons,
};
await writeFile(resolve(options.output), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
const warningCount = comparisons.filter((entry) => entry.status === 'warning').length;
const failureCount = comparisons.filter((entry) => entry.status === 'failure').length;
const summary = [
  '## Performance baseline observation',
  '',
  `Gate mode: **annotate-only** (${baseline.history.samples}/${baseline.history.blockingAfterSamples} historical samples required before reconsidering blocking).`,
  '',
  '| Metric | Current | Baseline | Allowed | Result |',
  '|---|---:|---:|---:|---|',
  ...comparisons.map((entry) => `| ${entry.metric} | ${entry.current} ${entry.unit} | ${entry.baseline} | ${entry.allowedMaximum} | ${entry.status} |`),
  '',
  warningCount === 0 ? 'No performance regression warnings.' : `${warningCount} performance regression warning(s); timing and footprint observations remain non-blocking by policy.`,
  failureCount === 0 ? 'Cleanup invariants passed.' : `${failureCount} exact cleanup invariant(s) failed; this observation is not green.`,
  '',
].join('\n');
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary, 'utf8');
else process.stdout.write(summary);
if (failureCount > 0) process.exitCode = 1;

function parseArgs(argv) {
  const required = ['baseline', 'environment', 'quality', 'semantic', 'charm', 'opentui', 'output'];
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]?.replace(/^--/u, '');
    const value = argv[index + 1];
    if (!required.includes(name) || !value) throw new Error(`invalid comparator option ${String(argv[index])}`);
    result[name] = value;
  }
  for (const name of required) if (!result[name]) throw new Error(`--${name} is required`);
  return result;
}
