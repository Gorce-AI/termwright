#!/usr/bin/env node

import assert from 'node:assert/strict';
import process from 'node:process';
import { ptyAvailable, ptyUnavailableReason, spawnPty } from '../packages/pty/dist/index.js';

const WAVES = 32;
const LANES = 4;
const WAVE_WATCHDOG_MS = 5_000;
const activeSessions = new Set();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    disposeActiveSessions();
    process.kill(process.pid, signal);
  });
}

if (process.platform !== 'darwin') {
  console.log(`Darwin fast-exit certification: not applicable on ${process.platform}`);
  process.exit(0);
}

if (!ptyAvailable()) {
  throw new Error(
    `Darwin fast-exit certification requires the native PTY: ${ptyUnavailableReason()}`,
  );
}

const environment = Object.fromEntries(
  Object.entries(process.env).filter((entry) => entry[1] !== undefined),
);

for (let wave = 0; wave < WAVES; wave += 1) {
  const sessions = [];
  try {
    for (let lane = 0; lane < LANES; lane += 1) {
      const session = collect(`FAST_EXIT:${wave}:${lane}`);
      sessions.push(session);
      activeSessions.add(session);
    }
    const statuses = await withWatchdog(
      Promise.all(sessions.map((session) => session.completed)),
      wave,
    );
    for (const [lane, session] of sessions.entries()) {
      assert.deepEqual(statuses[lane], { code: 0, signal: null });
      assert.equal(Buffer.concat(session.chunks).toString('utf8'), `FAST_EXIT:${wave}:${lane}`);
      assert.equal(session.handle.sawRealEof, true);
      assert.equal(session.handle.endReason, 0);
    }
  } finally {
    for (const session of sessions) {
      activeSessions.delete(session);
      session.dispose();
    }
  }
}

console.log(`Darwin fast-exit certification: ${WAVES} waves, ${WAVES * LANES} exact tails`);

function collect(expected) {
  const handle = spawnPty({
    command: [process.execPath, '-e', `process.stdout.write(${JSON.stringify(expected)})`],
    env: environment,
    columns: 80,
    rows: 24,
  });
  const chunks = [];
  const releases = [handle.onData((data) => chunks.push(Buffer.from(data)))];
  const exited = new Promise((resolve) => releases.push(handle.onExit(resolve)));
  const failed = new Promise((_, reject) => releases.push(handle.onError(reject)));
  return {
    handle,
    chunks,
    completed: Promise.race([
      Promise.all([exited, handle.outputEnded]).then(([status]) => status),
      failed,
    ]),
    dispose() {
      for (const release of releases.splice(0)) release();
      handle.dispose();
    },
  };
}

async function withWatchdog(operation, wave) {
  let timer;
  const watchdog = new Promise((_, reject) => {
    timer = setTimeout(() => {
      disposeActiveSessions();
      reject(
        new Error(
          `Darwin fast-exit certification wave ${wave} did not causally complete within ${WAVE_WATCHDOG_MS}ms`,
        ),
      );
    }, WAVE_WATCHDOG_MS);
    timer.unref();
  });
  try {
    return await Promise.race([operation, watchdog]);
  } finally {
    clearTimeout(timer);
  }
}

function disposeActiveSessions() {
  for (const session of activeSessions) session.dispose();
  activeSessions.clear();
}
