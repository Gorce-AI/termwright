import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { spawnPty } from '../../dist/index.js';

const marker = process.env.TERMWRIGHT_PROCSTAT_ESRCH_MARKER;
if (marker === undefined) throw new Error('the proc-stat interposer marker is missing');
const childEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key, value]) =>
      value !== undefined && key !== 'LD_PRELOAD' && !key.startsWith('TERMWRIGHT_PROCSTAT_ESRCH_'),
  ),
);
const foreign = spawn(process.execPath, ['-e', 'process.stdin.resume()'], {
  env: childEnv,
  stdio: ['pipe', 'ignore', 'ignore'],
});
const foreignExit = new Promise((resolve, reject) => {
  foreign.once('error', reject);
  foreign.once('exit', resolve);
});
let session;

try {
  if (foreign.pid === undefined) throw new Error('the foreign process did not receive a pid');
  session = spawnPty({
    command: [
      process.execPath,
      '-e',
      "process.stdin.once('data', () => process.exit(0)); process.stdin.resume()",
    ],
    env: childEnv,
    columns: 80,
    rows: 24,
  });
  const errors = [];
  session.onError((error) => errors.push(error));
  writeFileSync(marker, String(foreign.pid));
  const exit = new Promise((resolve) => session.onExit(resolve));
  // The slave starts in canonical input mode, so complete the input record.
  // Without the newline Node never receives a `data` event and the fixture
  // would wait forever before exercising the /proc scan below.
  session.write(Buffer.from('exit\n'));
  const [status] = await Promise.all([exit, session.outputEnded]);
  if (status.code !== 0 || status.signal !== null) {
    throw new Error(`unexpected PTY exit: ${JSON.stringify(status)}`);
  }
  if (errors.length > 0) throw new AggregateError(errors, 'the native lifecycle observer failed');
  if (existsSync(marker)) throw new Error('the proc-stat interposer did not inject ESRCH');
  if (session.treeState() !== 'gone') {
    throw new Error('the native backend did not prove its process group gone');
  }
} finally {
  try {
    session?.dispose();
  } finally {
    foreign.kill('SIGKILL');
    foreign.stdin.destroy();
    await foreignExit;
  }
}
