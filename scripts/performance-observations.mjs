import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  validateObservationSet,
  validatePerformanceReport,
} from '../packages/performance/dist/index.js';
import { validatePerformanceEnvironment } from './performance-environment.mjs';

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
