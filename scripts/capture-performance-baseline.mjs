import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  capturePerformanceBaseline,
  validateBaselinePolicy,
} from '../packages/performance/dist/index.js';
import { loadPerformanceObservations } from './performance-observations.mjs';

const options = parseArgs(process.argv.slice(2));
const policy = JSON.parse(await readFile(resolve(options.policy), 'utf8'));
validateBaselinePolicy(policy);
const { observations, provenance } = await loadPerformanceObservations(options);
const baseline = capturePerformanceBaseline(policy, observations, provenance);
const output = resolve(options.output);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');

const summary = [
  '## Measured performance baseline candidate',
  '',
  `Runner class: \`${baseline.environment}\``,
  `Candidate: \`${options.output}\``,
  '',
  'This artifact is not active configuration. Download it, review the raw reports and measured values,',
  'then commit it at the qualified baseline path before running the normal observation proof.',
  '',
].join('\n');
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary, 'utf8');
else process.stdout.write(summary);

function parseArgs(argv) {
  const required = ['policy', 'environment', 'quality', 'semantic', 'charm', 'opentui', 'output'];
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]?.replace(/^--/u, '');
    const value = argv[index + 1];
    if (!required.includes(name) || !value) throw new Error(`invalid capture option ${String(argv[index])}`);
    result[name] = value;
  }
  for (const name of required) if (!result[name]) throw new Error(`--${name} is required`);
  return result;
}
