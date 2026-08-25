import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { PerformanceReport, ScenarioReport } from './report.js';

const BENCHMARK = fileURLToPath(
  new URL('../../probe-opentui/bench/marker-route.ts', import.meta.url),
);
const run = promisify(execFile);

type MarkerArm = 'native' | 'feed-quiet' | 'feed';

export interface OpenTuiMarkerOptions {
  readonly repetitions?: number;
  readonly windowMs?: number;
}

export interface MarkerRouteSample {
  readonly arm: MarkerArm;
  readonly useThread: boolean;
  readonly elapsedMs: number;
  readonly frames: number;
  readonly fps: number;
  readonly bytesSeenInJs: number;
  readonly markerWrites: number;
  readonly markerAfterFrame: boolean | null;
}

function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('cannot take the median of an empty sample');
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[middle] as number;
  return ((ordered[middle - 1] as number) + (ordered[middle] as number)) / 2;
}

async function sample(arm: MarkerArm, output: string, windowMs: number): Promise<MarkerRouteSample> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('bun', [BENCHMARK, arm, output, String(windowMs)], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`OpenTUI marker arm ${arm} exited ${String(code)}: ${stderr}`));
    });
  });
  return JSON.parse(await readFile(output, 'utf8')) as MarkerRouteSample;
}

/** Run the real threaded OpenTUI renderer through the three decisive arms. */
export async function runOpenTuiMarkerBenchmark(
  options: OpenTuiMarkerOptions = {},
): Promise<PerformanceReport> {
  const repetitions = options.repetitions ?? 3;
  const windowMs = options.windowMs ?? 1_000;
  if (!Number.isSafeInteger(repetitions) || repetitions <= 0 || repetitions > 20) {
    throw new Error('repetitions must be between 1 and 20');
  }
  if (!Number.isSafeInteger(windowMs) || windowMs < 250 || windowMs > 60_000) {
    throw new Error('windowMs must be between 250 and 60000');
  }

  const root = await mkdtemp(join(tmpdir(), 'termwright-opentui-marker-'));
  try {
    const arms: MarkerArm[] = ['native', 'feed-quiet', 'feed'];
    const samples = new Map<MarkerArm, MarkerRouteSample[]>();
    for (let repetition = 0; repetition < repetitions; repetition += 1) {
      // Rotate order to avoid always giving the last arm the warmest process
      // and shared-library cache.
      for (let offset = 0; offset < arms.length; offset += 1) {
        const arm = arms[(offset + repetition) % arms.length] as MarkerArm;
        const result = await sample(arm, join(root, `${arm}-${repetition}.json`), windowMs);
        const held = samples.get(arm) ?? [];
        held.push(result);
        samples.set(arm, held);
      }
    }

    const native = samples.get('native') as MarkerRouteSample[];
    const quiet = samples.get('feed-quiet') as MarkerRouteSample[];
    const feed = samples.get('feed') as MarkerRouteSample[];
    if (
      ![...native, ...quiet, ...feed].every((entry) => entry.useThread)
      || !feed.every((entry) => entry.markerAfterFrame === true)
    ) {
      throw new Error('the retained renderer benchmark did not prove threaded marker ordering');
    }
    const nativeFps = median(native.map((entry) => entry.fps));
    const quietFps = median(quiet.map((entry) => entry.fps));
    const feedFps = median(feed.map((entry) => entry.fps));
    const correlation = median(feed.map((entry) => entry.markerWrites / Math.max(1, entry.frames)));

    const unavailable = (unit: 'count' | 'events/frame' | 'bytes/frame' | 'nodes/frame' | 'microseconds/frame' | 'ratio', reason: string) => ({
      status: 'unavailable' as const,
      unit,
      value: null,
      reason,
    });
    const scenario: ScenarioReport = {
      id: 'opentui-threaded-marker-route',
      framework: 'opentui',
      renderingMode: 'retained',
      description: 'real OpenTUI 0.5.3 threaded renderer with a changing frame and three stdout/marker routes',
      workload: {
        frames: feed.reduce((total, entry) => total + entry.frames, 0),
        warmupFrames: 0,
        targetNodesPerFrame: 2,
      },
      metrics: {
        probeEventsPerFrame: unavailable('events/frame', 'The marker-route benchmark isolates renderer routing, not Probe IR observation.'),
        bytesPerFrame: unavailable('bytes/frame', 'bytesSeenInJs contains terminal render bytes and markers, not semantic-channel bytes.'),
        fullSnapshots: unavailable('count', 'The marker-route benchmark deliberately has no semantic driver.'),
        droppedEvents: unavailable('count', 'No semantic producer queue is active in this route-isolation benchmark.'),
        coalescedEvents: unavailable('count', 'OpenTUI does not expose skipped native renders as a counter here.'),
        semanticNodesPerFrame: unavailable('nodes/frame', 'No semantic snapshot is built in this route-isolation benchmark.'),
        unknownFrameworkNodesPerFrame: unavailable('nodes/frame', 'No semantic snapshot is built in this route-isolation benchmark.'),
        renderCorrelationRate: {
          status: 'measured',
          unit: 'ratio',
          value: correlation,
          note: 'Marker writes divided by rendered frames; every sampled first marker was structurally after frame bytes.',
        },
        probeSerializationTime: unavailable('microseconds/frame', 'No semantic snapshot is serialized in this route-isolation benchmark.'),
        parentNormalizationTime: unavailable('microseconds/frame', 'No semantic parent is connected.'),
        parentProtocolValidationTime: unavailable('microseconds/frame', 'No semantic parent is connected.'),
        probeHotPathTime: unavailable('microseconds/frame', 'The benchmark reports renderer throughput rather than isolating a per-frame CPU duration.'),
        applicationOverheadRatio: {
          status: 'measured',
          unit: 'ratio',
          value: nativeFps / feedFps,
          note: `Native/feed throughput ratio; 1.0 means equal. Feed-only routing was ${quietFps} fps versus ${nativeFps} native fps.`,
        },
      },
    };

    return {
      kind: 'termwright-performance-report',
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      environment: {
        runtime: `bun ${(await run('bun', ['--version'])).stdout.trim()}; @opentui/core 0.5.3`,
        platform: process.platform,
        architecture: process.arch,
      },
      scenarios: [scenario],
      caveats: [
        `Each arm ran ${repetitions} times for ${windowMs} ms with useThread=true and a changing frame.`,
        'This isolates native frame routing and marker placement; semantic payload cost is measured by semantic-pipeline.json.',
      ],
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
