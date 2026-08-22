import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';
import { launchTerminal } from '@termwright/driver';
import { prepareInstrumentedBuild } from '@termwright/probe-charm';
import type { PerformanceMetric, PerformanceReport, ScenarioReport } from './report.js';

const run = promisify(execFile);
const FIXTURE = fileURLToPath(
  new URL('../../probe-charm/src/testing/fixture-v2/', import.meta.url),
);

export interface CharmBenchmarkOptions {
  readonly iterations?: number;
  readonly cacheDir?: string;
}

interface ApplicationRun {
  readonly durationMs: number;
  readonly screen: string;
  readonly latestSemanticRevision: number;
  readonly debug: CharmDebugMetrics | null;
}

export interface CharmDebugMetrics {
  readonly fullSnapshots: number;
  readonly droppedEvents: number;
  readonly bytes: readonly number[];
  readonly nodes: readonly number[];
  readonly unknownNodes: readonly number[];
  readonly serializationMicroseconds: readonly number[];
}

const measured = (
  unit: PerformanceMetric['unit'],
  value: number,
  note: string,
): PerformanceMetric => ({ status: 'measured', unit, value, note });

const unavailable = (
  unit: PerformanceMetric['unit'],
  reason: string,
): PerformanceMetric => ({ status: 'unavailable', unit, value: null, reason });

function average(values: readonly number[]): number {
  if (values.length === 0) throw new Error('cannot average an empty measurement');
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('cannot take the median of an empty measurement');
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[middle] as number;
  return ((ordered[middle - 1] as number) + (ordered[middle] as number)) / 2;
}

/** Parse adapter-side debug telemetry without treating missing facts as zero. */
export function parseCharmDebug(text: string): CharmDebugMetrics {
  const bytes: number[] = [];
  const nodes: number[] = [];
  const unknownNodes: number[] = [];
  const serializationMicroseconds: number[] = [];
  const line = /performance r\d+ bytes=(\d+) nodes=(\d+) unknown=(\d+) serialization_us=([\d.]+)/gu;
  for (const match of text.matchAll(line)) {
    bytes.push(Number(match[1]));
    nodes.push(Number(match[2]));
    unknownNodes.push(Number(match[3]));
    serializationMicroseconds.push(Number(match[4]));
  }
  const fullSnapshots = [...text.matchAll(/\br\d+ snapshot nodes=\d+/gu)].length;
  const close = /close r\d+ snapshots=(\d+) logs_dropped=\d+ performance_dropped=(\d+)/u.exec(text);
  const dropLines = [...text.matchAll(/performance_drop total=(\d+)/gu)];
  if (bytes.length === 0) throw new Error('Charm adapter debug log has no performance publications');
  return {
    fullSnapshots: close === null ? fullSnapshots : Number(close[1]),
    // Every failed publication emits its cumulative count immediately in
    // debug mode. A clean normal-exit log with publications and no such line
    // therefore proves zero even though the fixture does not call Close.
    droppedEvents: close === null
      ? Number(dropLines.at(-1)?.[1] ?? 0)
      : Number(close[2]),
    bytes,
    nodes,
    unknownNodes,
    serializationMicroseconds,
  };
}

async function runApplication(binary: string, debugFile?: string): Promise<ApplicationRun> {
  const terminal = await launchTerminal({
    command: [binary],
    columns: 80,
    rows: 12,
    envMode: 'inherit',
    ...(debugFile === undefined ? {} : { env: { TERMWRIGHT_DEBUG_FILE: debugFile } }),
  });
  try {
    await terminal.waitForText('Sign in', { timeout: 20_000 });
    await terminal.settled({ timeout: 20_000 });
    // Startup/build/negotiation are deliberately outside the comparison. The
    // measured window is the same steady-state input/render/exit workload.
    const started = performance.now();
    await terminal.type('termwright');
    await terminal.press('Tab');
    await terminal.type('abc');
    await terminal.waitForText('***', { timeout: 20_000 });
    await terminal.waitForQuiet({ quietMs: 100, timeout: 20_000 });
    const screen = terminal.screen().text();
    await terminal.press('Escape');
    const exit = await terminal.waitForExit({ timeout: 20_000 });
    if (exit.code !== 0) throw new Error(`Charm fixture exited with ${String(exit.code)}`);
    const durationMs = performance.now() - started;
    const latestSemanticRevision = terminal.semanticTree()?.revision ?? 0;
    const debug = debugFile === undefined
      ? null
      : parseCharmDebug(await readFile(debugFile, 'utf8'));
    return { durationMs, screen, latestSemanticRevision, debug };
  } finally {
    await terminal.close();
  }
}

/**
 * Compare a normal and instrumented build of the same zero-import Bubble Tea
 * fixture at ordinary input-driven frame rates.
 */
export async function runCharmPerformanceBenchmark(
  options: CharmBenchmarkOptions = {},
): Promise<PerformanceReport> {
  const iterations = options.iterations ?? 3;
  if (!Number.isSafeInteger(iterations) || iterations <= 0 || iterations > 20) {
    throw new Error('iterations must be a positive safe integer no greater than 20');
  }

  const root = await mkdtemp(join(tmpdir(), 'termwright-charm-performance-'));
  try {
    const app = join(root, 'app');
    await mkdir(app, { recursive: true });
    await cp(FIXTURE, app, { recursive: true });

    const vanillaBinary = join(root, 'charm-vanilla');
    await run('go', ['build', '-o', vanillaBinary, '.'], {
      cwd: app,
      env: { ...process.env, GOWORK: 'off' },
    });
    const prepared = await prepareInstrumentedBuild({
      moduleDir: app,
      env: {
        ...process.env,
        ...(options.cacheDir === undefined ? {} : { TERMWRIGHT_CACHE_DIR: options.cacheDir }),
      },
    });
    const instrumentedBinary = join(root, 'charm-instrumented');
    await run('go', ['build', '-o', instrumentedBinary, '.'], {
      cwd: app,
      env: prepared.env,
    });

    const vanilla: ApplicationRun[] = [];
    const instrumented: ApplicationRun[] = [];
    for (let index = 0; index < iterations; index += 1) {
      // Alternate order so a warm OS page cache does not always favour the
      // same arm.
      if (index % 2 === 0) {
        vanilla.push(await runApplication(vanillaBinary));
        instrumented.push(await runApplication(instrumentedBinary, join(root, `debug-${index}.log`)));
      } else {
        instrumented.push(await runApplication(instrumentedBinary, join(root, `debug-${index}.log`)));
        vanilla.push(await runApplication(vanillaBinary));
      }
    }

    for (let index = 0; index < iterations; index += 1) {
      if (vanilla[index]?.screen !== instrumented[index]?.screen) {
        throw new Error(`instrumented Charm output diverged from vanilla on run ${index + 1}`);
      }
    }

    const debug = instrumented.map((entry) => entry.debug);
    if (debug.some((entry) => entry === null)) throw new Error('instrumented run produced no debug metrics');
    const observed = debug as CharmDebugMetrics[];
    const semanticFrames = observed.reduce((total, entry) => total + entry.fullSnapshots, 0);
    const correlated = instrumented.reduce(
      (total, entry) => total + entry.latestSemanticRevision,
      0,
    );
    const allBytes = observed.flatMap((entry) => entry.bytes);
    const allNodes = observed.flatMap((entry) => entry.nodes);
    const allUnknown = observed.flatMap((entry) => entry.unknownNodes);
    const allSerialization = observed.flatMap((entry) => entry.serializationMicroseconds);
    const ratios = instrumented.map(
      (entry, index) => entry.durationMs / (vanilla[index] as ApplicationRun).durationMs,
    );

    const scenario: ScenarioReport = {
      id: 'charm-v2-immediate-e2e',
      framework: 'charm',
      renderingMode: 'immediate',
      description: 'real zero-config Bubble Tea v2 fixture, vanilla and instrumented builds, driven through PTYs',
      workload: {
        frames: semanticFrames,
        warmupFrames: 0,
        targetNodesPerFrame: Math.round(average(allNodes)),
      },
      metrics: {
        probeEventsPerFrame: unavailable(
          'events/frame',
          'Bubble Tea exposes accepted View calls but not the pre-render event burst coalesced by its renderer.',
        ),
        bytesPerFrame: measured(
          'bytes/frame',
          average(allBytes),
          'Actual canonical Go snapshot envelope bytes including the four-byte frame header.',
        ),
        fullSnapshots: measured(
          'count',
          observed.reduce((total, entry) => total + entry.fullSnapshots, 0),
          'Adapter debug counters across instrumented runs.',
        ),
        droppedEvents: measured(
          'count',
          observed.reduce((total, entry) => total + entry.droppedEvents, 0),
          'Failed Go client publications; every failure emits its cumulative debug counter immediately.',
        ),
        coalescedEvents: unavailable(
          'count',
          'Bubble Tea owns renderer coalescing before the probe hook and exposes no counter for discarded View requests.',
        ),
        semanticNodesPerFrame: measured('nodes/frame', average(allNodes), 'Actual probe snapshots.'),
        unknownFrameworkNodesPerFrame: measured(
          'nodes/frame',
          average(allUnknown),
          'Actual generic nodes in probe snapshots.',
        ),
        renderCorrelationRate: measured(
          'ratio',
          Math.min(1, correlated / Math.max(1, semanticFrames)),
          'Latest driver-paired semantic revision divided by publications, summed per fresh session.',
        ),
        probeSerializationTime: measured(
          'microseconds/frame',
          average(allSerialization),
          'Actual Go canonical snapshot plus wire-envelope encoding time.',
        ),
        parentNormalizationTime: unavailable(
          'microseconds/frame',
          'Charm publishes a normalized semantic snapshot directly; no parent semantic normalization stage runs.',
        ),
        parentProtocolValidationTime: unavailable(
          'microseconds/frame',
          'The live driver does not yet expose its decode/validation timer.',
        ),
        probeHotPathTime: unavailable(
          'microseconds/frame',
          'The E2E wall-time difference includes observation, IPC, PTY and driver work and cannot isolate the probe hot path.',
        ),
        applicationOverheadRatio: measured(
          'ratio',
          median(ratios),
          'Median instrumented/vanilla wall-time ratio; 1.0 means equal.',
        ),
      },
    };

    return {
      kind: 'termwright-performance-report',
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      environment: {
        runtime: `node ${process.version}; ${(await run('go', ['version'])).stdout.trim()}`,
        platform: process.platform,
        architecture: process.arch,
      },
      scenarios: [scenario],
      caveats: [
        'Wall-clock overhead includes the driver and PTY because that is the behaviour users experience in an instrumented test run.',
        'Compare applicationOverheadRatio only on the same machine and with the same iteration count.',
        'Unavailable values remain null with a reason; no zero is inferred from an unobservable framework counter.',
      ],
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
