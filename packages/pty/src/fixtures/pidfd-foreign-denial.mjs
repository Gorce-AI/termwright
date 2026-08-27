import { spawnPty } from '../../dist/index.js';

const blockedPid = Number.parseInt(process.env.TERMWRIGHT_BLOCKED_PID ?? '', 10);
if (!Number.isSafeInteger(blockedPid) || blockedPid <= 0) {
  throw new Error('the seccomp launcher did not identify its foreign process');
}

const session = spawnPty({
  command: [process.execPath, '-e', 'process.exit(0)'],
  env: Object.fromEntries(Object.entries(process.env).filter((entry) => entry[1] !== undefined)),
  columns: 80,
  rows: 24,
});

try {
  const exit = new Promise((resolve) => session.onExit(resolve));
  const [status] = await Promise.all([exit, session.outputEnded]);
  if (status.code !== 0 || status.signal !== null) {
    throw new Error(`unexpected PTY exit: ${JSON.stringify(status)}`);
  }
  if (session.treeState() !== 'gone') {
    throw new Error('the native backend did not prove its process group gone');
  }
} finally {
  session.dispose();
  try {
    process.kill(blockedPid, 'SIGKILL');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}
