import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const roots = [];
const script = new URL('./capture-performance-baseline.mjs', import.meta.url);
const policy = new URL(
  '../packages/performance/baselines/darwin-arm64-node24-go1.25-bun1.2.15.policy.json',
  import.meta.url,
);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('performance baseline capture command', () => {
  it('writes current measured values without reading the legacy baseline', async () => {
    const fixture = await reports(0);
    await execute(process.execPath, command(fixture));
    const baseline = JSON.parse(await readFile(fixture.output, 'utf8'));
    expect(baseline).toMatchObject({
      environment: 'darwin-arm64-node24-go1.25-bun1.2.15',
      metrics: {
        startupMs: { value: 701, relativeTolerance: 0.5, absoluteTolerance: 250 },
        semanticHotPathP95Us: { value: 44 },
        charmOverheadRatio: { value: 1.2 },
        opentuiOverheadRatio: { value: 1.05 },
        leakedProcesses: { value: 0, direction: 'exact' },
      },
      provenance: {
        environment: { class: 'darwin-arm64-node24-go1.25-bun1.2.15' },
        rawInputs: {
          quality: expect.stringMatching(/^[a-f0-9]{64}$/u),
          semantic: expect.stringMatching(/^[a-f0-9]{64}$/u),
          charm: expect.stringMatching(/^[a-f0-9]{64}$/u),
          opentui: expect.stringMatching(/^[a-f0-9]{64}$/u),
        },
      },
    });
  });

  it('fails exact cleanup capture before creating a candidate', async () => {
    const fixture = await reports(1);
    await expect(execute(process.execPath, command(fixture))).rejects.toThrow(/exact cleanup invariant/u);
    await expect(stat(fixture.output)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a raw report from a different qualified toolchain', async () => {
    const fixture = await reports(0, { charmRuntime: 'node v24.1.0; go version go1.24.4 darwin/arm64' });
    await expect(execute(process.execPath, command(fixture))).rejects.toThrow(/charm report Node\/Go runtime/u);
    await expect(stat(fixture.output)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a mislabeled scenario even when its id and metric are expected', async () => {
    const fixture = await reports(0, { charmFramework: 'opentui' });
    await expect(execute(process.execPath, command(fixture))).rejects.toThrow(
      /charm report scenario must be charm-v2-immediate-e2e\/charm\/immediate/u,
    );
    await expect(stat(fixture.output)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a secondary expected Go token appended to the wrong runtime', async () => {
    const fixture = await reports(0, {
      charmRuntime: 'node v24.1.0; go version go1.24.4 darwin/arm64; expected go1.25.1 ',
    });
    await expect(execute(process.execPath, command(fixture))).rejects.toThrow(/charm report Node\/Go runtime/u);
    await expect(stat(fixture.output)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects suffixes on the otherwise exact semantic Node runtime', async () => {
    const fixture = await reports(0, { semanticRuntime: 'node v24.1.0; node v22.0.0' });
    await expect(execute(process.execPath, command(fixture))).rejects.toThrow(/semantic report Node runtime/u);
    await expect(stat(fixture.output)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects runtime suffixes instead of accepting a matching Bun prefix', async () => {
    const fixture = await reports(0, {
      opentuiRuntime: 'bun 1.2.15; @opentui/core 9.9.9; @opentui/core 0.5.3',
    });
    await expect(execute(process.execPath, command(fixture))).rejects.toThrow(/opentui report Bun\/package runtime/u);
    await expect(stat(fixture.output)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

function command(fixture) {
  return [fileURLToPath(script),
    '--policy', fileURLToPath(policy),
    '--environment', fixture.environment,
    '--quality', fixture.quality,
    '--semantic', fixture.semantic,
    '--charm', fixture.charm,
    '--opentui', fixture.opentui,
    '--output', fixture.output,
  ];
}

async function reports(leakedProcesses, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'termwright-performance-capture-'));
  roots.push(root);
  const paths = Object.fromEntries(['environment', 'quality', 'semantic', 'charm', 'opentui', 'output']
    .map((name) => [name, join(root, `${name}.json`)]));
  await Promise.all([
    writeFile(paths.environment, JSON.stringify({
      kind: 'termwright-performance-environment',
      schemaVersion: 1,
      class: 'darwin-arm64-node24-go1.25-bun1.2.15',
      runner: { image: 'macos-15', platform: 'darwin', arch: 'arm64' },
      toolchains: {
        node: { qualified: '24', resolved: '24.1.0' },
        go: { qualified: '1.25', resolved: '1.25.1' },
        bun: { qualified: '1.2.15', resolved: '1.2.15' },
      },
    })),
    writeFile(paths.quality, JSON.stringify({
      generatedAt: '2026-08-25T03:00:00.000Z',
      environment: 'darwin-arm64-node24-go1.25-bun1.2.15',
      metrics: {
        startupMs: metric(701, 'milliseconds'),
        perTestOverheadMs: metric(402, 'milliseconds'),
        peakRssBytes: metric(400_000_000, 'bytes'),
        peakOpenFileDescriptors: metric(60, 'count'),
        leakedFileDescriptors: metric(0, 'count'),
        leakedProcesses: metric(leakedProcesses, 'count'),
      },
    })),
    writeFile(paths.semantic, JSON.stringify(report({
      id: 'opentui-retained-tree', framework: 'opentui', renderingMode: 'retained',
    }, {
      probeHotPathTime: { status: 'measured', value: 40, p95: 44, unit: 'microseconds/frame' },
    }, options.semanticRuntime ?? 'node v24.1.0'))),
    writeFile(paths.charm, JSON.stringify(report({
      id: 'charm-v2-immediate-e2e',
      framework: options.charmFramework ?? 'charm',
      renderingMode: 'immediate',
    }, {
      applicationOverheadRatio: { status: 'measured', value: 1.2, unit: 'ratio' },
    }, options.charmRuntime ?? 'node v24.1.0; go version go1.25.1 darwin/arm64'))),
    writeFile(paths.opentui, JSON.stringify(report({
      id: 'opentui-threaded-marker-route', framework: 'opentui', renderingMode: 'retained',
    }, {
      applicationOverheadRatio: { status: 'measured', value: 1.05, unit: 'ratio' },
    }, options.opentuiRuntime ?? 'bun 1.2.15; @opentui/core 0.5.3'))),
  ]);
  return paths;
}

function metric(value, unit) {
  return { value, unit, source: 'synthetic command contract fixture' };
}

function report(identity, overrides, runtime) {
  const units = {
    probeEventsPerFrame: 'events/frame', bytesPerFrame: 'bytes/frame', fullSnapshots: 'count',
    droppedEvents: 'count', coalescedEvents: 'count', semanticNodesPerFrame: 'nodes/frame',
    unknownFrameworkNodesPerFrame: 'nodes/frame', renderCorrelationRate: 'ratio',
    probeSerializationTime: 'microseconds/frame', parentNormalizationTime: 'microseconds/frame',
    parentProtocolValidationTime: 'microseconds/frame', probeHotPathTime: 'microseconds/frame',
    applicationOverheadRatio: 'ratio',
  };
  const metrics = Object.fromEntries(Object.entries(units).map(([name, unit]) => [
    name, { status: 'unavailable', value: null, unit, reason: 'not measured by fixture' },
  ]));
  Object.assign(metrics, overrides);
  return {
    kind: 'termwright-performance-report', schemaVersion: 2,
    generatedAt: '2026-08-25T03:00:00.000Z',
    environment: { runtime, platform: 'darwin', architecture: 'arm64' },
    scenarios: [{
      ...identity, description: 'fixture',
      workload: { frames: 1, warmupFrames: 0, targetNodesPerFrame: 1 }, metrics,
    }],
    caveats: [],
  };
}
