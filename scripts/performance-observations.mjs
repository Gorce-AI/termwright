import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  validateObservationSet,
  validatePerformanceReport,
} from '../packages/performance/dist/index.js';
import { validatePerformanceEnvironment } from './performance-environment.mjs';

const execute = promisify(execFile);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const collectorUrl = new URL('./collect-quality-performance.mjs', import.meta.url);

/** Combine the four independently retained raw reports into one comparable observation set. */
export async function loadPerformanceObservations(options) {
  const descriptor = JSON.parse(await readFile(resolve(options.environment), 'utf8'));
  validatePerformanceEnvironment(descriptor, {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.versions.node,
  });
  const raw = Object.fromEntries(await Promise.all(
    ['quality', 'semantic', 'charm', 'opentui'].map(async (name) => [name, await readFile(resolve(options[name]))]),
  ));
  const quality = JSON.parse(raw.quality.toString('utf8'));
  validateObservationSet(quality);
  await validateQualityProvenance(quality.provenance);
  validateQualityResourceSnapshot(quality.resourceSnapshot, descriptor);
  if (quality.environment !== descriptor.class) {
    throw new Error(`quality environment ${quality.environment} differs from descriptor ${descriptor.class}`);
  }
  const semantic = report(raw.semantic, 'semantic', descriptor);
  const charm = report(raw.charm, 'charm', descriptor);
  const opentui = report(raw.opentui, 'opentui', descriptor);
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
  validateObservationSet(current);
  return {
    observations: current,
    provenance: {
      environment: descriptor,
      rawInputs: Object.fromEntries(Object.entries(raw).map(([name, bytes]) => [
        name,
        createHash('sha256').update(bytes).digest('hex'),
      ])),
    },
  };
}

async function validateQualityProvenance(value) {
  exactKeys(
    value,
    ['kind', 'schemaVersion', 'collectorSha256', 'gitCommit', 'ci', 'roles'],
    'quality provenance',
  );
  if (value.kind !== 'termwright-quality-provenance' || value.schemaVersion !== 1) {
    throw new Error('quality provenance kind or schema is unsupported');
  }
  const collectorSha256 = createHash('sha256').update(await readFile(collectorUrl)).digest('hex');
  if (value.collectorSha256 !== collectorSha256) {
    throw new Error('quality provenance collector SHA-256 differs from the executing collector');
  }
  const { stdout } = await execute('git', ['rev-parse', '--verify', 'HEAD^{commit}'], { cwd: root });
  const gitCommit = stdout.trim();
  if (!/^[0-9a-f]{40}$/u.test(value.gitCommit) || value.gitCommit !== gitCommit) {
    throw new Error('quality provenance Git commit differs from the current checkout');
  }
  validateQualityCi(value.ci, gitCommit);
  exactKeys(value.roles, ['timing', 'resourceSoak', 'stress'], 'quality provenance roles');
  const timing = validateQualityRole(value.roles.timing, 'timing');
  const resourceSoak = validateQualityRole(value.roles.resourceSoak, 'resourceSoak');
  const stress = validateQualityRole(value.roles.stress, 'stress');
  if (timing.runs.length < 2 || timing.runs.length > 100
    || resourceSoak.runs.length !== timing.runs.length || stress.runs.length !== 1) {
    throw new Error('quality provenance roles do not contain the certified timing/resource run counts');
  }
  if (new Set([timing.invocationId, resourceSoak.invocationId, stress.invocationId]).size !== 3) {
    throw new Error('quality provenance roles must use distinct host invocations');
  }
  const allRunIds = [...timing.runs, ...resourceSoak.runs, ...stress.runs].map((run) => run.runId);
  if (new Set(allRunIds).size !== allRunIds.length) {
    throw new Error('quality provenance assigns one run to more than one evidence role');
  }
}

function validateQualityRole(value, role) {
  exactKeys(value, ['invocationId', 'runs'], `quality ${role} provenance`);
  if (!/^invocation:[0-9a-f-]+$/u.test(value.invocationId ?? '')
    || !Array.isArray(value.runs) || value.runs.length === 0) {
    throw new Error(`quality ${role} provenance has no valid invocation or runs`);
  }
  for (const run of value.runs) {
    exactKeys(run, ['runId', 'manifestSha256'], `quality ${role} run provenance`);
    if (!/^run:[0-9a-f-]+$/u.test(run.runId ?? '')
      || !/^[0-9a-f]{64}$/u.test(run.manifestSha256 ?? '')) {
      throw new Error(`quality ${role} run provenance is invalid`);
    }
  }
  if (new Set(value.runs.map((run) => run.runId)).size !== value.runs.length) {
    throw new Error(`quality ${role} provenance contains duplicate runs`);
  }
  return value;
}

function validateQualityCi(value, gitCommit) {
  if (value === null) {
    if (process.env.GITHUB_ACTIONS === 'true') {
      throw new Error('quality GitHub Actions provenance is missing from a CI observation');
    }
    return;
  }
  exactKeys(value, ['runId', 'runAttempt', 'sha'], 'quality GitHub Actions provenance');
  if (!/^[1-9][0-9]*$/u.test(value.runId ?? '') || !/^[1-9][0-9]*$/u.test(value.runAttempt ?? '')
    || value.sha !== gitCommit) {
    throw new Error('recorded quality GitHub Actions provenance is invalid');
  }
  if (process.env.GITHUB_ACTIONS === 'true' && (value.runId !== process.env.GITHUB_RUN_ID
    || value.runAttempt !== process.env.GITHUB_RUN_ATTEMPT || value.sha !== process.env.GITHUB_SHA)) {
    throw new Error('quality GitHub Actions provenance is missing or differs from the current run');
  }
}

function validateQualityResourceSnapshot(value, descriptor) {
  exactKeys(value, ['kind', 'schemaVersion', 'memoryMeasurement', 'stress'], 'quality resource snapshot');
  if (value.kind !== 'termwright-quality-resource-snapshot' || value.schemaVersion !== 1) {
    throw new Error('quality resource snapshot kind or schema is unsupported');
  }
  const expectedMeasurement = descriptor.runner.platform === 'darwin'
    ? 'darwin-summary-footprint'
    : 'linux-proportional-set-size';
  if (value.memoryMeasurement !== expectedMeasurement) {
    throw new Error(`quality memory measurement must be ${expectedMeasurement}`);
  }
  exactKeys(value.stress, ['expectedSessions', 'processCount'], 'quality stress snapshot');
  if (value.stress.expectedSessions !== 16
    || !Number.isSafeInteger(value.stress.processCount)
    || value.stress.processCount < value.stress.expectedSessions + 2) {
    throw new Error('quality stress snapshot does not prove the complete 16-session process tree');
  }
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

const REPORT_CONTRACTS = {
  semantic: {
    id: 'opentui-retained-tree',
    framework: 'opentui',
    renderingMode: 'retained',
    runtime: (descriptor) => `node v${descriptor.toolchains.node.resolved}`,
  },
  charm: {
    id: 'charm-v2-burst-e2e',
    framework: 'charm',
    renderingMode: 'immediate',
    runtime: (descriptor) => {
      return `node v${descriptor.toolchains.node.resolved}; go compiler go${descriptor.toolchains.go.resolved}`;
    },
  },
  opentui: {
    id: 'opentui-threaded-marker-route',
    framework: 'opentui',
    renderingMode: 'retained',
    runtime: (descriptor) => `bun ${descriptor.toolchains.bun.resolved}; @opentui/core 0.5.3`,
  },
};

function report(bytes, input, descriptor) {
  const value = JSON.parse(bytes.toString('utf8'));
  validatePerformanceReport(value);
  correlateReportEnvironment(value, input, descriptor);
  const contract = REPORT_CONTRACTS[input];
  if (value.scenarios.length !== 1) {
    throw new Error(`${input} report must contain exactly one scenario ${contract.id}`);
  }
  const [scenario] = value.scenarios;
  if (scenario.id !== contract.id
    || scenario.framework !== contract.framework
    || scenario.renderingMode !== contract.renderingMode) {
    throw new Error(
      `${input} report scenario must be ${contract.id}/${contract.framework}/${contract.renderingMode}`,
    );
  }
  return scenario.metrics;
}

function correlateReportEnvironment(report, input, descriptor) {
  if (report.environment.platform !== descriptor.runner.platform
    || report.environment.architecture !== descriptor.runner.arch) {
    throw new Error(`${input} report platform does not match the performance environment descriptor`);
  }
  const runtime = report.environment.runtime;
  if (runtime !== REPORT_CONTRACTS[input].runtime(descriptor)) {
    const runtimeName = input === 'semantic' ? 'Node' : input === 'charm' ? 'Node/Go' : 'Bun/package';
    throw new Error(`${input} report ${runtimeName} runtime does not match the performance environment descriptor`);
  }
}

function reportMetric(metrics, name, field, source) {
  const metric = metrics[name];
  if (metric?.status !== 'measured' || !Number.isFinite(metric[field])) {
    throw new Error(`${source} did not measure ${name}.${field}`);
  }
  return { value: metric[field], unit: metric.unit, source };
}
