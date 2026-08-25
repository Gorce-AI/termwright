import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { threadId } from 'node:worker_threads';
import { expect, test } from 'vitest';
import { createNodePtyBackend } from '../driver-backend.mjs';
import { createPtyLeasePool } from './pty-lease.mjs';

const cases = Number(process.env.TERMWRIGHT_MATRIX_CASES ?? 8);
const telemetryDirectory = process.env.TERMWRIGHT_MATRIX_TELEMETRY;
const source = basename(fileURLToPath(import.meta.url));
const telemetry = telemetryDirectory === undefined ? undefined : join(telemetryDirectory, `${source}.jsonl`);
if (telemetryDirectory !== undefined) mkdirSync(telemetryDirectory, { recursive: true });
const ptyLeases = createPtyLeasePool(Number(process.env.TERMWRIGHT_MATRIX_CELL_PTYS));
let activePtys = 0;

if (telemetryDirectory !== undefined && process.env.TERMWRIGHT_MATRIX_FILE_PARALLELISM === 'true') {
  await workerRendezvous(telemetryDirectory, Number(process.env.TERMWRIGHT_MATRIX_WORKERS));
}

test.concurrent.for(Array.from({ length: cases }, (_, index) => index))('PTY pressure %i', async (index, context) => {
  const leaseRequest = ptyLeases.request();
  let cleanup;
  const abort = () => {
    leaseRequest.cancel();
    if (cleanup !== undefined) void cleanup();
  };
  context.signal.addEventListener('abort', abort, { once: true });
  context.onTestFinished(async () => {
    abort();
    if (cleanup !== undefined) await cleanup();
    context.signal.removeEventListener('abort', abort);
  });
  const releaseLease = (await leaseRequest.promise).claim();
  if (context.signal.aborted) {
    releaseLease();
    throw context.signal.reason;
  }
  const started = performance.now();
  const readyOutput = `pty-ready-${index}`;
  const doneOutput = `pty-done-${index}`;
  // The matrix exercises Termwright's production PTY boundary, not node-pty's
  // public write() shortcut. On ConPTY that boundary owns readiness,
  // backpressure and asynchronous write failures. A one-shot READY -> input ->
  // DONE exchange therefore certifies delivery without a sleep or retry.
  const child = [
    `const ready = ${JSON.stringify(readyOutput)};`,
    'process.stdin.setRawMode?.(true);',
    "process.stdin.once('data', () => {",
    '  process.stdin.pause();',
    `  process.stdout.write(${JSON.stringify(doneOutput)}, () => process.exit(0));`,
    '});',
    'process.stdin.resume();',
    'process.stdout.write(ready);',
  ].join('\n');
  let pty;
  try {
    pty = createNodePtyBackend().spawn({
      command: [process.execPath, '-e', child],
      columns: 40,
      rows: 4,
      env: process.env,
    });
  } catch (error) {
    releaseLease();
    throw error;
  }
  let output = '';
  let dataSubscription;
  let exitSubscription;
  let exited = false;
  let releaseSent = false;
  let rejectOutput;
  let writeFailure;
  const outputReady = new Promise((resolve, reject) => {
    rejectOutput = reject;
    dataSubscription = pty.onData((chunk) => {
      output += Buffer.from(chunk).toString('utf8');
      if (!releaseSent && output.includes(readyOutput)) {
        releaseSent = true;
        pty.write(Buffer.from('release'));
      }
      if (output.includes(doneOutput)) resolve();
    });
  });
  const writeErrorSubscription = pty.onWriteError?.((error) => {
    writeFailure = error;
    rejectOutput(error);
  });
  const exitReady = new Promise((resolve) => {
    exitSubscription = pty.onExit((status) => {
      exited = true;
      if (!output.includes(doneOutput)) {
        rejectOutput(new Error(`PTY ${index} exited before DONE (${String(status.code)}): ${JSON.stringify(output.slice(-512))}`));
      }
      resolve(status);
    });
  });
  let startedRecorded = false;
  let cleanupPromise;
  cleanup = () => {
    if (cleanupPromise !== undefined) return cleanupPromise;
    if (!exited) {
      pty.dispose();
    }
    cleanupPromise = (async () => {
      try {
        await exitReady;
        pty.dispose();
        dataSubscription?.();
        exitSubscription?.();
        writeErrorSubscription?.();
        if (startedRecorded) {
          activePtys -= 1;
          record({
            phase: 'finish', index, activePtys, pid: process.pid, ppid: process.ppid,
            durationMs: performance.now() - started, memory: process.memoryUsage(),
            readyObserved: output.includes(readyOutput), releaseSent,
            doneObserved: output.includes(doneOutput), exited,
          });
        }
      } finally {
        releaseLease();
      }
    })();
    return cleanupPromise;
  };
  try {
    activePtys += 1;
    startedRecorded = true;
    record({ phase: 'start', index, activePtys, pid: process.pid, ppid: process.ppid, memory: process.memoryUsage() });
    const [status] = await Promise.all([exitReady, outputReady]);
    expect(writeFailure).toBeUndefined();
    expect(status.code).toBe(0);
    expect(releaseSent).toBe(true);
    expect(output).toContain(doneOutput);
  } finally {
    await cleanup();
  }
});

function record(value) {
  if (telemetry === undefined) return;
  appendFileSync(telemetry, `${JSON.stringify({ ...value, source, pid: process.pid, threadId, timeMs: performance.timeOrigin + performance.now(), node: process.version, platform: process.platform, arch: process.arch })}\n`, 'utf8');
}

async function workerRendezvous(directory, workers) {
  if (!Number.isSafeInteger(workers) || workers < 1) throw new Error('invalid worker rendezvous width');
  await new Promise((resolve, reject) => {
    let settled = false;
    // The rendezvous is state-based. Directory watch events are only hints on
    // Windows and may be coalesced, so correctness must not depend on an edge.
    const observation = setInterval(check, 25);
    const deadline = setTimeout(() => finish(new Error(`worker rendezvous reached fewer than ${workers} files`)), 15_000);
    const ready = `${source}.ready`;
    try {
      writeFileSync(join(directory, ready), `${process.pid}:${threadId}\n`, { encoding: 'utf8', flag: 'wx' });
      check();
    } catch (error) {
      finish(error);
    }

    function check() {
      try {
        const identities = new Set(readdirSync(directory)
          .filter((name) => name.endsWith('.ready'))
          .map((name) => {
            const identity = readFileSync(join(directory, name), 'utf8');
            if (!/^[1-9]\d*:\d+\n$/u.test(identity)) {
              throw new Error(`invalid worker identity in ${name}`);
            }
            return identity.trim();
          }));
        if (identities.size >= workers) finish();
      } catch (error) {
        finish(error);
      }
    }

    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearInterval(observation);
      if (error === undefined) resolve();
      else reject(error);
    }
  });
}
