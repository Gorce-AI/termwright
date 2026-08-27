import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  capturePerformanceBaseline,
  comparePerformanceBaseline,
  formatGitHubError,
  validateBaselinePolicy,
} from '../packages/performance/dist/controller/baseline-controller.js';
import { loadPerformanceObservations } from './performance-observations.mjs';
import {
  PERFORMANCE_HARNESS_FILES,
  PERFORMANCE_HARNESS_FINGERPRINT_KIND,
  PERFORMANCE_HARNESS_FINGERPRINT_VERSION,
} from './performance-harness-fingerprint.mjs';
import { loadPerformanceRoundSeal } from './seal-performance-round.mjs';

const MEAN_METRICS = new Set([
  'firstRunPreAttemptMs',
  'postStartupRunOrchestrationMs',
  'semanticHotPathP95Us',
  'charmOverheadRatio',
  'opentuiOverheadRatio',
]);
const MAX_METRICS = new Set([
  'peakMemoryFootprintBytes',
  'peakOpenFileDescriptors',
  'leakedFileDescriptors',
  'leakedProcesses',
]);
const REPORT_FILES = {
  environment: 'environment.json',
  quality: 'quality.json',
  semantic: 'semantic-pipeline.json',
  charm: 'charm-immediate.json',
  opentui: 'opentui-marker-route.json',
};
const POLICY_HARNESS_PATH =
  'packages/performance/baselines/darwin-arm64-node24-go1.25-bun1.2.15.policy.json';
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const nodeBuiltins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

export async function comparePairedPerformance(options) {
  validateSha(options.referenceSha, 'reference');
  validateSha(options.candidateSha, 'candidate');
  if (options.referenceSha === options.candidateSha) {
    throw new Error('paired performance subjects must be different commits');
  }
  if (options.reference.length !== 2 || options.candidate.length !== 2) {
    throw new Error('paired performance requires exactly two reference and two candidate samples');
  }

  const policyBytes = await readFile(resolve(options.policy));
  const policy = JSON.parse(policyBytes.toString('utf8'));
  validateBaselinePolicy(policy);
  const [referenceHarness, candidateHarness, controller] = await Promise.all([
    loadHarnessFingerprint(options.referenceHarness, 'reference'),
    loadHarnessFingerprint(options.candidateHarness, 'candidate'),
    controllerProvenance(),
  ]);
  if (
    referenceHarness.fingerprint.sha256 !== candidateHarness.fingerprint.sha256 ||
    referenceHarness.canonicalIdentity !== candidateHarness.canonicalIdentity ||
    referenceHarness.fingerprint.fileSha256 !== candidateHarness.fingerprint.fileSha256
  ) {
    throw new Error('reference and candidate performance harness fingerprints differ');
  }
  const policySha256 = sha256(policyBytes);
  const harnessPolicy = referenceHarness.fingerprint.files.find(
    (file) => file.path === POLICY_HARNESS_PATH,
  );
  if (harnessPolicy?.sha256 !== policySha256) {
    throw new Error('paired performance policy bytes differ from the certified harness policy');
  }
  const [reference, candidate] = await Promise.all([
    loadSide(options.reference, options.referenceSha, 'reference', [1, 4]),
    loadSide(options.candidate, options.candidateSha, 'candidate', [2, 3]),
  ]);
  assertStableSubjectRuntimes(reference, 'reference');
  assertStableSubjectRuntimes(candidate, 'candidate');
  assertCompatibleSamples([...reference, ...candidate]);

  const referenceObservations = aggregateObservations(
    reference.map((sample) => sample.observations),
  );
  const candidateObservations = aggregateObservations(
    candidate.map((sample) => sample.observations),
  );
  const referenceBaseline = capturePerformanceBaseline(
    policy,
    referenceObservations,
    aggregateBaselineProvenance(reference.map((sample) => sample.provenance)),
  );
  const comparisons = comparePerformanceBaseline(referenceBaseline, candidateObservations);
  const output = {
    kind: 'termwright-paired-performance-comparison',
    schemaVersion: 1,
    gate: 'performance-regression-fail',
    generatedAt: new Date().toISOString(),
    policy: {
      path: options.policy,
      sha256: policySha256,
    },
    subjects: {
      reference: options.referenceSha,
      candidate: options.candidateSha,
    },
    provenance: {
      controller,
      harness: {
        reference: referenceHarness.fingerprint,
        candidate: candidateHarness.fingerprint,
      },
      reference: reference.map((sample) => sample.provenance),
      candidate: candidate.map((sample) => sample.provenance),
    },
    samples: {
      reference: reference.map((sample) => sample.observations),
      candidate: candidate.map((sample) => sample.observations),
      aggregatedReference: referenceObservations,
      aggregatedCandidate: candidateObservations,
    },
    comparisons,
  };
  return { output, comparisons };
}

async function loadHarnessFingerprint(path, label) {
  const bytes = await readFile(resolve(path));
  const value = JSON.parse(bytes.toString('utf8'));
  exactKeys(
    value,
    ['kind', 'schemaVersion', 'algorithm', 'files', 'sha256'],
    `${label} harness fingerprint`,
  );
  if (
    value.kind !== PERFORMANCE_HARNESS_FINGERPRINT_KIND ||
    value.schemaVersion !== PERFORMANCE_HARNESS_FINGERPRINT_VERSION ||
    value.algorithm !== 'sha256'
  ) {
    throw new Error(`${label} harness fingerprint kind, schema or algorithm is unsupported`);
  }
  if (!Array.isArray(value.files) || value.files.length !== PERFORMANCE_HARNESS_FILES.length) {
    throw new Error(`${label} harness fingerprint has an incomplete file contract`);
  }
  for (let index = 0; index < value.files.length; index += 1) {
    const file = value.files[index];
    exactKeys(file, ['path', 'sha256'], `${label} harness file`);
    if (
      file.path !== PERFORMANCE_HARNESS_FILES[index] ||
      !/^[0-9a-f]{64}$/u.test(file.sha256 ?? '')
    ) {
      throw new Error(`${label} harness fingerprint has a non-canonical file identity`);
    }
  }
  const identity = {
    kind: value.kind,
    schemaVersion: value.schemaVersion,
    algorithm: value.algorithm,
    files: value.files,
  };
  const canonicalIdentity = JSON.stringify(identity);
  if (value.sha256 !== sha256(canonicalIdentity)) {
    throw new Error(`${label} harness fingerprint canonical digest is invalid`);
  }
  return {
    canonicalIdentity,
    fingerprint: { ...value, fileSha256: sha256(bytes) },
  };
}

async function loadSide(directories, expectedSubjectSha, subject, sequences) {
  return Promise.all(
    directories.map(async (directory, index) => {
      const round = index + 1;
      const [sample, roundSeal] = await Promise.all([
        loadPerformanceObservations(
          Object.fromEntries(
            Object.entries(REPORT_FILES).map(([name, file]) => [name, resolve(directory, file)]),
          ),
          expectedSubjectSha,
        ),
        loadPerformanceRoundSeal(resolve(directory, 'round-seal.json'), {
          directory,
          subject,
          round,
          sequence: sequences[index],
          subjectSha: expectedSubjectSha,
        }),
      ]);
      if (
        Object.entries(sample.provenance.rawInputs).some(
          ([name, digest]) => roundSeal.inputs[name] !== digest,
        )
      ) {
        throw new Error('performance round seal and validated raw-input provenance differ');
      }
      return {
        ...sample,
        provenance: { ...sample.provenance, roundSeal },
      };
    }),
  );
}

export function aggregateObservations(samples) {
  if (samples.length !== 2) throw new Error('paired aggregation requires exactly two samples');
  const [first, second] = samples;
  assertCompatibleObservation(first, second, 'sample 1', 'sample 2');
  const metrics = Object.fromEntries(
    Object.keys(first.metrics).map((name) => {
      const left = first.metrics[name];
      const right = second.metrics[name];
      let value;
      if (MEAN_METRICS.has(name)) value = (left.value + right.value) / 2;
      else if (MAX_METRICS.has(name)) value = Math.max(left.value, right.value);
      else throw new Error(`paired performance metric ${name} has no reviewed aggregation rule`);
      return [name, { value, unit: left.unit, source: left.source }];
    }),
  );
  return {
    generatedAt: [first.generatedAt, second.generatedAt].sort().at(-1),
    environment: first.environment,
    metrics,
  };
}

function assertCompatibleSamples(samples) {
  const first = samples[0];
  if (first === undefined) throw new Error('paired performance produced no samples');
  for (let index = 1; index < samples.length; index += 1) {
    assertCompatibleObservation(
      first.observations,
      samples[index].observations,
      'sample 1',
      `sample ${index + 1}`,
    );
    if (
      JSON.stringify(first.provenance.environment) !==
      JSON.stringify(samples[index].provenance.environment)
    ) {
      throw new Error(
        `paired performance sample ${index + 1} uses a different measured environment`,
      );
    }
  }
  const rawSets = samples.map((sample) =>
    sha256(
      Object.entries(sample.provenance.rawInputs)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, digest]) => `${name}:${digest}`)
        .join('\n'),
    ),
  );
  if (new Set(rawSets).size !== samples.length) {
    throw new Error('paired performance samples must have globally distinct raw input sets');
  }
  const roles = samples.flatMap((sample) => Object.values(sample.provenance.quality.roles));
  const invocationIds = roles.map((role) => role.invocationId);
  if (new Set(invocationIds).size !== invocationIds.length) {
    throw new Error('paired performance samples must use globally distinct host invocations');
  }
  const runIds = roles.flatMap((role) => role.runs.map((run) => run.runId));
  if (new Set(runIds).size !== runIds.length) {
    throw new Error('paired performance samples must use globally distinct certified runs');
  }
}

function assertStableSubjectRuntimes(samples, subject) {
  const [first, second] = samples;
  if (
    first === undefined ||
    second === undefined ||
    JSON.stringify(first.provenance.reportRuntimes) !==
      JSON.stringify(second.provenance.reportRuntimes)
  ) {
    throw new Error(`${subject} performance rounds resolved different benchmark runtimes`);
  }
}

function assertCompatibleObservation(left, right, leftName, rightName) {
  if (left.environment !== right.environment) {
    throw new Error(`${leftName} and ${rightName} use different performance environments`);
  }
  const leftNames = Object.keys(left.metrics).sort();
  const rightNames = Object.keys(right.metrics).sort();
  if (
    leftNames.length !== rightNames.length ||
    leftNames.some((name, index) => name !== rightNames[index])
  ) {
    throw new Error(`${leftName} and ${rightName} must contain the same metric set`);
  }
  for (const name of leftNames) {
    const expected = left.metrics[name];
    const actual = right.metrics[name];
    if (expected.unit !== actual.unit || expected.source !== actual.source) {
      throw new Error(`${name} unit or source differs between ${leftName} and ${rightName}`);
    }
  }
}

function aggregateBaselineProvenance(samples) {
  const first = samples[0];
  return {
    environment: first.environment,
    rawInputs: Object.fromEntries(
      ['quality', 'semantic', 'charm', 'opentui'].map((name) => [
        name,
        sha256(samples.map((sample) => sample.rawInputs[name]).join('\n')),
      ]),
    ),
  };
}

function parseArgs(argv) {
  const options = { reference: [], candidate: [] };
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]?.replace(/^--/u, '');
    const value = argv[index + 1];
    if (!value) throw new Error(`paired comparator option ${String(argv[index])} requires a value`);
    if (name === 'reference' || name === 'candidate') options[name].push(value);
    else if (
      [
        'policy',
        'reference-sha',
        'candidate-sha',
        'reference-harness',
        'candidate-harness',
        'output',
      ].includes(name)
    ) {
      const key = name.replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
      if (options[key] !== undefined)
        throw new Error(`paired comparator option --${name} occurs more than once`);
      options[key] = value;
    } else throw new Error(`invalid paired comparator option ${String(argv[index])}`);
  }
  for (const name of [
    'policy',
    'referenceSha',
    'candidateSha',
    'referenceHarness',
    'candidateHarness',
    'output',
  ]) {
    if (!options[name])
      throw new Error(
        `paired comparator requires --${name.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`,
      );
  }
  if (options.reference.length !== 2 || options.candidate.length !== 2) {
    throw new Error(
      'paired comparator requires exactly two --reference and two --candidate directories',
    );
  }
  return options;
}

function validateSha(value, label) {
  if (!/^[0-9a-f]{40}$/u.test(value ?? ''))
    throw new Error(`${label} subject must be one exact Git SHA`);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function controllerProvenance() {
  return hashControllerClosure([new URL('./compare-paired-performance.mjs', import.meta.url)]);
}

export async function hashControllerClosure(entryUrls) {
  const pending = [...entryUrls];
  const seen = new Map();
  while (pending.length > 0) {
    const url = pending.pop();
    const path = fileURLToPath(url);
    if (seen.has(path)) continue;
    const bytes = await readFile(url);
    seen.set(path, bytes);
    const source = bytes.toString('utf8');
    const specifiers = [
      ...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/gu),
      ...source.matchAll(/\bimport\s+['"]([^'"]+)['"]/gu),
      ...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu),
    ].map((match) => match[1]);
    for (const specifier of specifiers) {
      if (nodeBuiltins.has(specifier)) continue;
      if (!specifier.startsWith('.')) {
        throw new Error(`controller closure contains an unresolved bare import: ${specifier}`);
      }
      pending.push(new URL(specifier, url));
    }
  }
  const files = [...seen.entries()]
    .map(([path, bytes]) => ({
      path: relative(repositoryRoot, path).replaceAll('\\', '/'),
      sha256: sha256(bytes),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return {
    algorithm: 'sha256',
    files,
    sha256: sha256(JSON.stringify(files)),
  };
}

function exactKeys(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} must contain exactly ${expected.join(', ')}`);
  }
}

async function main(argv) {
  const options = parseArgs(argv);
  const { output, comparisons } = await comparePairedPerformance(options);
  const target = resolve(options.output);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  for (const comparison of comparisons) {
    if (comparison.status === 'failure')
      process.stdout.write(`${formatGitHubError(comparison, options.policy)}\n`);
  }
  const failureCount = comparisons.filter((comparison) => comparison.status === 'failure').length;
  const summary = [
    '## Paired performance comparison',
    '',
    `Reference: \`${options.referenceSha}\` (two fixed samples)`,
    `Candidate: \`${options.candidateSha}\` (two fixed samples)`,
    '',
    failureCount === 0
      ? 'Every paired performance threshold and exact cleanup invariant passed.'
      : `${failureCount} paired performance threshold or cleanup invariant failure(s); this gate is not green.`,
    '',
  ].join('\n');
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary, 'utf8');
  else process.stdout.write(summary);
  if (failureCount > 0) process.exitCode = 1;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main(process.argv.slice(2));
}
