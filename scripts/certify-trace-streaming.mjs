import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { createTraceWriter } from '../packages/trace/dist/index.js';

const root = await mkdtemp(join(tmpdir(), 'termwright-trace-streaming-'));
const dir = join(root, 'long-run.twtrace');
const listeners = new Set();
let sequence = 0;
let clock = 0;
const source = {
  sessionId: 'trace-streaming-certification',
  events: {
    on: () => () => undefined,
    checkpoint: () => sequence,
    subscribe: (_options, callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  },
};

const writer = createTraceWriter(source, {
  dir,
  now: () => clock,
  maxOutputBytes: 128 * 1024 * 1024,
  maxPendingRecords: 4_096,
  maxPendingBytes: 4 * 1024 * 1024,
});
const payload = new TextEncoder().encode(`${'x'.repeat(4_094)}\r\n`);
const rss = [];
const heap = [];

try {
  for (let phase = 0; phase < 8; phase += 1) {
    for (let index = 0; index < 2_500; index += 1) {
      clock += 1;
      const record = {
        sequence: ++sequence,
        type: 'output',
        payload: { data: payload, timeMs: clock },
      };
      for (const listener of listeners) listener(record);
      await yieldTurn();
    }
    await yieldTurn();
    globalThis.gc?.();
    const memory = process.memoryUsage();
    rss.push(memory.rss);
    heap.push(memory.heapUsed);
  }
  const beforeFinalize = process.memoryUsage().rss;
  const archive = await writer.finalize();
  globalThis.gc?.();
  const afterFinalize = process.memoryUsage().rss;
  const traceBytes = await directoryBytes(dir);
  const steadyRss = rss.slice(4);
  const steadyHeap = heap.slice(4);
  const rssSteadyRange = Math.max(...steadyRss) - Math.min(...steadyRss);
  const heapSteadyRange = Math.max(...steadyHeap) - Math.min(...steadyHeap);
  // A range catches one-off spikes but is not a slope. The median of all
  // pairwise slopes (Theil-Sen) gives the long-run gate a robust trend that is
  // not dominated by one GC/RSS sampling outlier.
  const rssSteadyTrendPerPhase = medianPairwiseSlope(steadyRss);
  const heapSteadyTrendPerPhase = medianPairwiseSlope(steadyHeap);
  const finalizePeak = Math.max(beforeFinalize, afterFinalize) - beforeFinalize;
  const peakSampledRss = Math.max(...rss, beforeFinalize, afterFinalize);
  const tempDiskOverFinal = Math.max(0, archive.resources.tempDiskPeakBytes - traceBytes);
  const result = {
    status:
      rssSteadyRange <= 24 * 1024 * 1024 &&
      heapSteadyRange <= 8 * 1024 * 1024 &&
      rssSteadyTrendPerPhase <= 2 * 1024 * 1024 &&
      heapSteadyTrendPerPhase <= 512 * 1024 &&
      finalizePeak <= 16 * 1024 * 1024 &&
      tempDiskOverFinal <= 4 * 1024
        ? 'PASS'
        : 'FAIL',
    events: sequence,
    outputBytes: sequence * payload.byteLength,
    traceBytes,
    rssByPhase: rss,
    heapUsedByPhase: heap,
    peakSampledRssBytes: peakSampledRss,
    rssSteadyRangeBytes: rssSteadyRange,
    heapSteadyRangeBytes: heapSteadyRange,
    rssSteadyTrendBytesPerPhase: rssSteadyTrendPerPhase,
    rssSteadyTrendBytesPerEvent: rssSteadyTrendPerPhase / 2_500,
    heapSteadyTrendBytesPerPhase: heapSteadyTrendPerPhase,
    heapSteadyTrendBytesPerEvent: heapSteadyTrendPerPhase / 2_500,
    finalizeGrowthBytes: finalizePeak,
    tempDiskPeakBytes: archive.resources.tempDiskPeakBytes,
    tempDiskOverFinalBytes: tempDiskOverFinal,
    durationMs: archive.durationMs,
  };
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== 'PASS') process.exitCode = 1;
} finally {
  await rm(root, { recursive: true, force: true });
}

async function directoryBytes(path) {
  const members = [
    'meta.json',
    'session.cast',
    'events.jsonl',
    'semantics.jsonl',
    'logs.jsonl',
    'timeline.jsonl',
    'COMMITTED',
  ];
  let total = 0;
  for (const member of members)
    total += (await stat(join(path, member)).catch(() => ({ size: 0 }))).size;
  return total;
}

function medianPairwiseSlope(values) {
  const slopes = [];
  for (let left = 0; left < values.length; left += 1) {
    for (let right = left + 1; right < values.length; right += 1) {
      slopes.push((values[right] - values[left]) / (right - left));
    }
  }
  slopes.sort((a, b) => a - b);
  const middle = Math.floor(slopes.length / 2);
  return slopes.length % 2 === 0 ? (slopes[middle - 1] + slopes[middle]) / 2 : slopes[middle];
}
