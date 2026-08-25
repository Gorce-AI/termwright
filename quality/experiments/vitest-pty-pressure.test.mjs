import { appendFileSync } from 'node:fs';
import nodePty from '@lydell/node-pty';
import { expect, test } from 'vitest';

const cases = Number(process.env.TERMWRIGHT_MATRIX_CASES ?? 8);
const telemetry = process.env.TERMWRIGHT_MATRIX_TELEMETRY;
let activePtys = 0;

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
  appendFileSync(telemetry, `${JSON.stringify({ ...value, node: process.version, platform: process.platform, arch: process.arch })}\n`, 'utf8');
}
