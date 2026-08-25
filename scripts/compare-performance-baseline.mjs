import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  comparePerformanceBaseline,
  formatGitHubError,
  formatGitHubWarning,
  validateObservationSet,
} from '../packages/performance/dist/index.js';

const options = parseArgs(process.argv.slice(2));
const baseline = JSON.parse(await readFile(resolve(options.baseline), 'utf8'));
const quality = JSON.parse(await readFile(resolve(options.quality), 'utf8'));
validateObservationSet(quality);
const semantic = await report(options.semantic, 'opentui-retained-tree');
const charm = await report(options.charm, 'charm-v2-immediate-e2e');
const opentui = await report(options.opentui, 'opentui-threaded-marker-route');
const current = {
  ...quality,
  metrics: {
    ...quality.metrics,
    semanticHotPathP95Us: reportMetric(
      semantic,
      'probeHotPathTime',
      'p95',
      'packages/performance benchmark: semantic pipeline',
    ),
    charmOverheadRatio: reportMetric(
      charm,
      'applicationOverheadRatio',
      'value',
      'packages/performance benchmark: Charm E2E',
    ),
    opentuiOverheadRatio: reportMetric(
      opentui,
      'applicationOverheadRatio',
      'value',
      'packages/performance benchmark: OpenTUI marker route',
    ),
  },
};
const comparisons = comparePerformanceBaseline(baseline, current);
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

async function report(path, id) {
  const value = JSON.parse(await readFile(resolve(path), 'utf8'));
  const scenario = value.scenarios?.find((entry) => entry.id === id);
  if (!scenario) throw new Error(`${path} is missing scenario ${id}`);
  return scenario.metrics;
}

function reportMetric(metrics, name, field, source) {
  const metric = metrics[name];
  if (metric?.status !== 'measured' || !Number.isFinite(metric[field])) {
    throw new Error(`${source} did not measure ${name}.${field}`);
  }
  return { value: metric[field], unit: metric.unit, source };
}

function parseArgs(argv) {
  const required = ['baseline', 'quality', 'semantic', 'charm', 'opentui', 'output'];
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
