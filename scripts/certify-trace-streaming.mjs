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
  const rssSteadySlope = Math.max(...rss.slice(4)) - Math.min(...rss.slice(4));
  const heapSlope = Math.max(...heap) - Math.min(...heap);
  const finalizePeak = Math.max(beforeFinalize, afterFinalize) - beforeFinalize;
  const result = {
    status:
      rssSteadySlope <= 24 * 1024 * 1024 &&
      heapSlope <= 8 * 1024 * 1024 &&
      finalizePeak <= 16 * 1024 * 1024
        ? 'PASS'
        : 'FAIL',
    events: sequence,
    outputBytes: sequence * payload.byteLength,
    traceBytes,
    rssByPhase: rss,
    heapUsedByPhase: heap,
    rssSteadySlopeBytes: rssSteadySlope,
    heapSlopeBytes: heapSlope,
    finalizeGrowthBytes: finalizePeak,
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
