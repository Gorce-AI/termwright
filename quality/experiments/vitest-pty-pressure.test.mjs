import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { threadId } from 'node:worker_threads';
import nodePty from '@lydell/node-pty';
import { expect, test } from 'vitest';

const cases = Number(process.env.TERMWRIGHT_MATRIX_CASES ?? 8);
const telemetryDirectory = process.env.TERMWRIGHT_MATRIX_TELEMETRY;
const source = basename(fileURLToPath(import.meta.url));
const telemetry = telemetryDirectory === undefined ? undefined : join(telemetryDirectory, `${source}.jsonl`);
if (telemetryDirectory !== undefined) mkdirSync(telemetryDirectory, { recursive: true });
let activePtys = 0;

if (telemetryDirectory !== undefined && process.env.TERMWRIGHT_MATRIX_FILE_PARALLELISM === 'true') {
  await workerRendezvous(telemetryDirectory, Number(process.env.TERMWRIGHT_MATRIX_WORKERS));
}

test.concurrent.each(Array.from({ length: cases }, (_, index) => index))('PTY pressure %i', async (index) => {
  const started = performance.now();
  activePtys += 1;
  record({ phase: 'start', index, activePtys, pid: process.pid, ppid: process.ppid, memory: process.memoryUsage() });
  const pty = nodePty.spawn(process.execPath, ['-e', `process.stdout.write(${JSON.stringify(`pty-${index}`)});process.exit(0)`], {
    encoding: null,
    cols: 40,
    rows: 4,
    env: process.env,
  });
  let timer;
  try {
    const status = await Promise.race([
      new Promise((resolve) => pty.onExit(resolve)),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`PTY ${index} exit timed out`)), 15_000);
      }),
    ]);
    expect(status.exitCode).toBe(0);
  } finally {
    clearTimeout(timer);
    try { pty.kill(); } catch { /* process already reaped */ }
    activePtys -= 1;
    record({ phase: 'finish', index, activePtys, pid: process.pid, ppid: process.ppid, durationMs: performance.now() - started, memory: process.memoryUsage() });
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
