import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./performance-environment.mjs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    validatePerformanceEnvironment: (value) => actual.validatePerformanceEnvironment(value),
  };
});
import {
  aggregateObservations,
  comparePairedPerformance as comparePairedPerformanceImpl,
  hashControllerClosure,
} from './compare-paired-performance.mjs';
import { fingerprintPerformanceHarness } from './performance-harness-fingerprint.mjs';
import { sealPerformanceRound } from './seal-performance-round.mjs';

const roots = [];
const policy = new URL(
  '../packages/performance/baselines/darwin-arm64-node24-go1.25-bun1.2.15.policy.json',
  import.meta.url,
);
const policyPath = fileURLToPath(policy);
const reports = new URL('../packages/performance/reports/', import.meta.url);
const collector = new URL('./collect-quality-performance.mjs', import.meta.url);
const referenceSha = 'a'.repeat(40);
const candidateSha = 'b'.repeat(40);
let sampleSequence = 0;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('paired performance comparator', () => {
  it('aggregates two fixed samples and emits a hard paired comparison with raw provenance', async () => {
    const reference = [
      await sample(referenceSha, { firstRun: 100, orchestration: 200, memory: 300, descriptors: 40 }),
      await sample(referenceSha, { firstRun: 120, orchestration: 220, memory: 350, descriptors: 42 }),
    ];
    const candidate = [
      await sample(candidateSha, { firstRun: 110, orchestration: 210, memory: 340, descriptors: 41 }),
      await sample(candidateSha, { firstRun: 130, orchestration: 230, memory: 360, descriptors: 43 }),
    ];
    const harness = await harnessFile();
    const { output, comparisons } = await comparePairedPerformance({
      policy: policyPath,
      referenceHarness: harness,
      candidateHarness: harness,
      referenceSha,
      reference,
      candidateSha,
      candidate,
      output: 'unused.json',
    });
    expect(output).toMatchObject({
      kind: 'termwright-paired-performance-comparison',
      schemaVersion: 1,
      gate: 'performance-regression-fail',
      subjects: { reference: referenceSha, candidate: candidateSha },
      policy: { sha256: expect.stringMatching(/^[a-f0-9]{64}$/u) },
      samples: {
        aggregatedReference: {
          metrics: {
            firstRunPreAttemptMs: { value: 110 },
            peakMemoryFootprintBytes: { value: 350 },
          },
        },
        aggregatedCandidate: {
          metrics: {
            firstRunPreAttemptMs: { value: 120 },
            peakMemoryFootprintBytes: { value: 360 },
          },
        },
      },
    });
    expect(output.provenance.reference).toHaveLength(2);
    expect(output.provenance.reference[0].rawInputs.environment).toMatch(/^[a-f0-9]{64}$/u);
    expect(output.provenance.reference[0].rawInputs.quality).toMatch(/^[a-f0-9]{64}$/u);
    expect(output.provenance.controller).toMatchObject({
      algorithm: 'sha256',
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    for (const path of [
      'scripts/compare-paired-performance.mjs',
      'scripts/performance-observations.mjs',
      'scripts/performance-harness-fingerprint.mjs',
      'scripts/seal-performance-round.mjs',
      'packages/performance/dist/controller/baseline-controller.js',
    ]) {
      const entry = output.provenance.controller.files.find((file) => file.path === path);
      expect(entry?.sha256).toMatch(/^[a-f0-9]{64}$/u);
    }
    expect(output.provenance.controller.sha256).toBe(createHash('sha256')
      .update(JSON.stringify(output.provenance.controller.files)).digest('hex'));
    expect(output.provenance.harness.reference.sha256).toBe(output.provenance.harness.candidate.sha256);
    expect(comparisons.every((comparison) => comparison.status === 'ok')).toBe(true);
  });

  it('returns a blocking failure for the max exact cleanup observation', async () => {
    const reference = [await sample(referenceSha, {}), await sample(referenceSha, {})];
    const candidate = [await sample(candidateSha, {}), await sample(candidateSha, { leakedProcesses: 1 })];
    const harness = await harnessFile();
    const { output, comparisons } = await comparePairedPerformance({
      policy: policyPath, referenceSha, reference, referenceHarness: harness,
      candidateSha, candidate, candidateHarness: harness, output: 'unused.json',
    });
    expect(comparisons).toContainEqual(expect.objectContaining({
      metric: 'leakedProcesses', status: 'failure', current: 1,
    }));
    expect(output.gate).toBe('performance-regression-fail');
  });

  it('rejects unequal or internally forged harness fingerprints', async () => {
    const validPath = await harnessFile();
    const forgedPath = await harnessFile((value) => ({ ...value, sha256: '0'.repeat(64) }));
    const reference = [await sample(referenceSha, {}), await sample(referenceSha, {})];
    const candidate = [await sample(candidateSha, {}), await sample(candidateSha, {})];
    await expect(comparePairedPerformance({
      policy: policyPath, referenceSha, reference, referenceHarness: validPath,
      candidateSha, candidate, candidateHarness: forgedPath, output: 'unused.json',
    })).rejects.toThrow(/canonical digest is invalid/u);
  });

  it('requires byte-identical canonical harness evidence', async () => {
    const referenceHarness = await harnessFile();
    const candidateHarness = await harnessFile((value) => value, true);
    const reference = [await sample(referenceSha, {}), await sample(referenceSha, {})];
    const candidate = [await sample(candidateSha, {}), await sample(candidateSha, {})];
    await expect(comparePairedPerformance({
      policy: policyPath, referenceSha, reference, referenceHarness,
      candidateSha, candidate, candidateHarness, output: 'unused.json',
    })).rejects.toThrow(/fingerprints differ/u);
  });

  it('binds the exact policy bytes to the policy entry in the harness fingerprint', async () => {
    const harness = await harnessFile();
    const changedPolicy = await policyFile((value) => ({
      ...value,
      metrics: {
        ...value.metrics,
        firstRunPreAttemptMs: { ...value.metrics.firstRunPreAttemptMs, absoluteTolerance: 251 },
      },
    }));
    const reference = [await sample(referenceSha, {}), await sample(referenceSha, {})];
    const candidate = [await sample(candidateSha, {}), await sample(candidateSha, {})];
    await expect(comparePairedPerformance({
      policy: changedPolicy, referenceSha, reference, referenceHarness: harness,
      candidateSha, candidate, candidateHarness: harness, output: 'unused.json',
    })).rejects.toThrow(/policy bytes differ/u);
  });

  it('rejects duplicate raw samples and reused host evidence globally', async () => {
    const harness = await harnessFile();
    const repeated = await sample(referenceSha, {});
    const duplicatedDirectory = await mkdtemp(join(tmpdir(), 'termwright-paired-duplicate-'));
    roots.push(duplicatedDirectory);
    await cp(repeated, duplicatedDirectory, { recursive: true });
    const candidate = [await sample(candidateSha, {}), await sample(candidateSha, {})];
    await expect(comparePairedPerformance({
      policy: policyPath,
      referenceSha,
      reference: [repeated, duplicatedDirectory],
      referenceHarness: harness,
      candidateSha, candidate, candidateHarness: harness, output: 'unused.json',
    })).rejects.toThrow(/globally distinct raw input sets/u);

    const reusedIdentity = '000000000001';
    const reference = [
      await sample(referenceSha, { provenanceSeed: reusedIdentity }),
      await sample(referenceSha, { firstRun: 101, provenanceSeed: reusedIdentity }),
    ];
    await expect(comparePairedPerformance({
      policy: policyPath, referenceSha, reference, referenceHarness: harness,
      candidateSha, candidate, candidateHarness: harness, output: 'unused.json',
    })).rejects.toThrow(/globally distinct host invocations/u);

    const runReference = [await sample(referenceSha, {}), await sample(referenceSha, { firstRun: 102 })];
    const firstQuality = JSON.parse(await readFile(join(runReference[0], 'quality.json'), 'utf8'));
    const secondQualityPath = join(runReference[1], 'quality.json');
    const secondQuality = JSON.parse(await readFile(secondQualityPath, 'utf8'));
    secondQuality.provenance.roles.timing.runs[0].runId =
      firstQuality.provenance.roles.timing.runs[0].runId;
    await writeFile(secondQualityPath, JSON.stringify(secondQuality));
    await expect(comparePairedPerformance({
      policy: policyPath, referenceSha, reference: runReference, referenceHarness: harness,
      candidateSha, candidate, candidateHarness: harness, output: 'unused.json',
    })).rejects.toThrow(/globally distinct certified runs/u);
  });

  it('rejects a benchmark report swapped after its subject/round seal', async () => {
    const harness = await harnessFile();
    const options = {
      policy: policyPath,
      referenceSha,
      reference: [await sample(referenceSha, {}), await sample(referenceSha, {})],
      referenceHarness: harness,
      candidateSha,
      candidate: [await sample(candidateSha, {}), await sample(candidateSha, {})],
      candidateHarness: harness,
      output: 'unused.json',
    };
    await sealOptions(options);
    await writeFile(join(options.candidate[1], 'opentui-marker-route.json'), '{}');
    await expect(comparePairedPerformanceImpl(options)).rejects.toThrow(/input opentui differs/u);
  });

  it('records an exact dependency runtime per subject and rejects within-subject drift', async () => {
    const harness = await harnessFile();
    const reference = [await sample(referenceSha, {}), await sample(referenceSha, {})];
    const candidate = [await sample(candidateSha, {}), await sample(candidateSha, {})];
    for (const directory of candidate) await replaceOpenTuiVersion(directory, '0.5.4');
    const options = {
      policy: policyPath, referenceSha, reference, referenceHarness: harness,
      candidateSha, candidate, candidateHarness: harness, output: 'unused.json',
    };
    const { output } = await comparePairedPerformance(options);
    expect(output.provenance.reference[0].reportRuntimes.opentui).toContain('@opentui/core 0.5.3');
    expect(output.provenance.candidate[0].reportRuntimes.opentui).toContain('@opentui/core 0.5.4');

    await replaceOpenTuiVersion(candidate[1], '0.5.5');
    await expect(comparePairedPerformance(options)).rejects.toThrow(/different benchmark runtimes/u);
  });

  it('requires two compatible samples with reviewed aggregation rules', () => {
    const first = observation({ custom: metric(1, 'count', 'same') });
    expect(() => aggregateObservations([first, first])).toThrow(/no reviewed aggregation rule/u);
    expect(() => aggregateObservations([observation(), observation({
      firstRunPreAttemptMs: metric(1, 'milliseconds', 'different'),
    })])).toThrow(/unit or source differs/u);
    expect(() => aggregateObservations([observation()])).toThrow(/exactly two/u);
  });

  it('closes side-effect and dynamic relative imports and rejects unresolved bare imports', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'termwright-controller-closure-'));
    roots.push(directory);
    const entry = join(directory, 'entry.mjs');
    await writeFile(join(directory, 'side-effect.mjs'), 'export const side = true;\n');
    await writeFile(join(directory, 'dynamic.mjs'), 'export const dynamic = true;\n');
    await writeFile(entry, "import './side-effect.mjs';\nawait import('./dynamic.mjs');\n");
    const closure = await hashControllerClosure([pathToFileURL(entry)]);
    expect(closure.files.map((file) => file.path).sort()).toEqual(expect.arrayContaining([
      expect.stringMatching(/entry\.mjs$/u),
      expect.stringMatching(/side-effect\.mjs$/u),
      expect.stringMatching(/dynamic\.mjs$/u),
    ]));

    await writeFile(entry, "import 'unresolved-controller-package';\n");
    await expect(hashControllerClosure([pathToFileURL(entry)]))
      .rejects.toThrow(/unresolved bare import/u);
  });
});

async function sample(subjectSha, values = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'termwright-paired-performance-'));
  roots.push(directory);
  await Promise.all([
    cp(new URL('semantic-pipeline.json', reports), join(directory, 'semantic-pipeline.json')),
    cp(new URL('charm-immediate.json', reports), join(directory, 'charm-immediate.json')),
    cp(new URL('opentui-marker-route.json', reports), join(directory, 'opentui-marker-route.json')),
  ]);
  await writeFile(join(directory, 'environment.json'), JSON.stringify({
    kind: 'termwright-performance-environment',
    schemaVersion: 1,
    class: 'darwin-arm64-node24-go1.25-bun1.2.15',
    runner: { image: 'macos-15', platform: 'darwin', arch: 'arm64' },
    toolchains: {
      node: { qualified: '24', resolved: '24.1.0' },
      go: { qualified: '1.25', resolved: '1.25.0' },
      bun: { qualified: '1.2.15', resolved: '1.2.15' },
    },
  }));
  await writeFile(join(directory, 'quality.json'), JSON.stringify({
    ...observation({
      firstRunPreAttemptMs: metric(values.firstRun ?? 100, 'milliseconds', SOURCES.firstRunPreAttemptMs),
      postStartupRunOrchestrationMs: metric(values.orchestration ?? 200, 'milliseconds', SOURCES.postStartupRunOrchestrationMs),
      peakMemoryFootprintBytes: metric(values.memory ?? 300, 'bytes', SOURCES.peakMemoryFootprintBytes),
      peakOpenFileDescriptors: metric(values.descriptors ?? 40, 'count', SOURCES.peakOpenFileDescriptors),
      leakedFileDescriptors: metric(values.leakedDescriptors ?? 0, 'count', SOURCES.leakedFileDescriptors),
      leakedProcesses: metric(values.leakedProcesses ?? 0, 'count', SOURCES.leakedProcesses),
    }),
    provenance: await qualityProvenance(subjectSha, values.provenanceSeed),
    resourceSnapshot: {
      kind: 'termwright-quality-resource-snapshot', schemaVersion: 1,
      memoryMeasurement: 'darwin-summary-footprint',
      stress: { expectedSessions: 16, processCount: 18 },
    },
  }));
  return directory;
}

async function harnessFile(transform = (value) => value, compact = false) {
  const directory = await mkdtemp(join(tmpdir(), 'termwright-paired-harness-'));
  roots.push(directory);
  const fingerprint = await fingerprintPerformanceHarness({ root: fileURLToPath(new URL('..', import.meta.url)) });
  const path = join(directory, 'harness.json');
  await writeFile(path, compact
    ? JSON.stringify(transform(fingerprint))
    : `${JSON.stringify(transform(fingerprint), null, 2)}\n`);
  return path;
}

function observation(overrides = {}) {
  return {
    generatedAt: '2026-08-25T03:00:00.000Z',
    environment: 'darwin-arm64-node24-go1.25-bun1.2.15',
    metrics: {
      firstRunPreAttemptMs: metric(100, 'milliseconds', SOURCES.firstRunPreAttemptMs),
      postStartupRunOrchestrationMs: metric(200, 'milliseconds', SOURCES.postStartupRunOrchestrationMs),
      peakMemoryFootprintBytes: metric(300, 'bytes', SOURCES.peakMemoryFootprintBytes),
      peakOpenFileDescriptors: metric(40, 'count', SOURCES.peakOpenFileDescriptors),
      leakedFileDescriptors: metric(0, 'count', SOURCES.leakedFileDescriptors),
      leakedProcesses: metric(0, 'count', SOURCES.leakedProcesses),
      ...overrides,
    },
  };
}

async function qualityProvenance(subjectSha, requestedSeed) {
  const collectorSha256 = createHash('sha256').update(await readFile(collector)).digest('hex');
  const seed = requestedSeed ?? (++sampleSequence).toString(16).padStart(12, '0');
  const role = (prefix, count) => ({
    invocationId: `invocation:${prefix.repeat(8)}-${prefix.repeat(4)}-4${prefix.repeat(3)}-8${prefix.repeat(3)}-${seed}`,
    runs: Array.from({ length: count }, (_, index) => ({
      runId: `run:${prefix.repeat(8)}-${prefix.repeat(4)}-4${prefix.repeat(3)}-8${prefix.repeat(3)}-${seed}-${index}`,
      manifestSha256: createHash('sha256').update(`${prefix}-${seed}-${index}`).digest('hex'),
    })),
  });
  return {
    kind: 'termwright-quality-provenance', schemaVersion: 1, collectorSha256,
    gitCommit: subjectSha,
    ci: process.env.GITHUB_ACTIONS === 'true'
      ? {
          runId: process.env.GITHUB_RUN_ID,
          runAttempt: process.env.GITHUB_RUN_ATTEMPT,
          sha: subjectSha,
        }
      : null,
    roles: {
      timing: role('a', 2),
      resourceSoak: role('b', 2),
      stress: role('c', 1),
    },
  };
}

async function policyFile(transform) {
  const directory = await mkdtemp(join(tmpdir(), 'termwright-paired-policy-'));
  roots.push(directory);
  const path = join(directory, 'policy.json');
  await writeFile(path, JSON.stringify(transform(JSON.parse(await readFile(policy, 'utf8')))));
  return path;
}

async function replaceOpenTuiVersion(directory, version) {
  const path = join(directory, 'opentui-marker-route.json');
  const value = JSON.parse(await readFile(path, 'utf8'));
  value.environment.runtime = value.environment.runtime.replace(/@opentui\/core \S+$/u, `@opentui/core ${version}`);
  await writeFile(path, JSON.stringify(value));
}

async function comparePairedPerformance(options) {
  await sealOptions(options);
  return comparePairedPerformanceImpl(options);
}

async function sealOptions(options) {
  const matrix = [
    ...options.reference.map((directory, index) => ({
      directory, subject: 'reference', round: index + 1, sequence: index === 0 ? 1 : 4,
      subjectSha: options.referenceSha,
    })),
    ...options.candidate.map((directory, index) => ({
      directory, subject: 'candidate', round: index + 1, sequence: index + 2,
      subjectSha: options.candidateSha,
    })),
  ];
  for (const entry of matrix) {
    const seal = await sealPerformanceRound({
      ...entry,
      env: { ...process.env, GITHUB_SHA: entry.subjectSha },
    });
    await writeFile(join(entry.directory, 'round-seal.json'), JSON.stringify(seal));
  }
}

function metric(value, unit, source) { return { value, unit, source }; }

const SOURCES = {
  firstRunPreAttemptMs: 'quality/soak first run: host-monotonic run start to first attempt',
  postStartupRunOrchestrationMs: 'quality/soak 1 post-startup runs: host-monotonic collection, scheduling and finalization outside the test attempt',
  peakMemoryFootprintBytes: 'maximum sampled aggregate physical footprint across the separately instrumented lifecycle soak and certified 16-session stress tree',
  peakOpenFileDescriptors: 'maximum open descriptors across the separately instrumented lifecycle soak and certified stress tree',
  leakedFileDescriptors: 'descriptors owned by observed lifecycle or stress descendants still alive after certified host exit',
  leakedProcesses: 'observed lifecycle or stress descendants still alive after certified host exit',
};
