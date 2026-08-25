import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createNodePtyBackend, inheritedSpawnEnv } from '../packages/driver/dist/experimental.js';

const requireFromDriver = createRequire(new URL('../packages/driver/src/pty.ts', import.meta.url));
const platformName = `@lydell/node-pty-${process.platform}-${process.arch}`;
const requireFromWrapper = createRequire(requireFromDriver.resolve('@lydell/node-pty'));
const entry = requireFromWrapper.resolve(platformName);
const root = dirname(dirname(entry));
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (manifest.version !== '1.2.0-beta.15') {
  throw new Error(`${platformName}: expected exact 1.2.0-beta.15, found ${String(manifest.version)}`);
}

const implementation = await readFile(
  join(root, 'lib', process.platform === 'win32' ? 'windowsTerminal.js' : 'unixTerminal.js'),
  'utf8',
);
if (process.platform === 'win32') {
  if (!implementation.includes('_this._agent = new windowsPtyAgent_1.WindowsPtyAgent') ||
      !implementation.includes('this._agent.inSocket.write(data)') ||
      !implementation.includes("_this._socket.on('close', function ()") ||
      !implementation.includes("_this.emit('exit', _this._agent.exitCode)")) {
    throw new Error(`${platformName}: certified ConPTY agent/input/output-EOF boundary changed`);
  }
  // Termwright deliberately does NOT use WindowsTerminal's deferral. Both its
  // writes and its kill wait for `_isReady`, which is only set after the first
  // `data` event, so a child that prints nothing until written to can neither
  // be written to nor killed. Pin the shape of that gate so the day upstream
  // fixes it is a visible event rather than a silent divergence.
  if (!implementation.includes('WindowsTerminal.prototype._defer = function') ||
      !implementation.includes('if (this._isReady)')) {
    throw new Error(`${platformName}: certified ConPTY deferral gate changed; re-check the write/kill barrier`);
  }
  const agentImplementation = await readFile(join(root, 'lib', 'windowsPtyAgent.js'), 'utf8');
  if (!agentImplementation.includes('WindowsPtyAgent.prototype._getConsoleProcessList = function') ||
      !agentImplementation.includes('consoleProcessList.forEach(function (pid)') ||
      !agentImplementation.includes('this._closeTimeout = setTimeout(function ()') ||
      !agentImplementation.includes('this._outSocket.destroy()')) {
    throw new Error(`${platformName}: certified ConPTY process-tree/timer-degraded output boundary changed`);
  }
  // The barriers Termwright owns instead: an immediate agent-level kill, and
  // the output pipe's connect signal as the point writes become deliverable.
  if (!agentImplementation.includes('WindowsPtyAgent.prototype.kill = function') ||
      !agentImplementation.includes("_this._outSocket.emit('ready_datapipe')")) {
    throw new Error(`${platformName}: certified ConPTY readiness/kill boundary changed`);
  }
} else if (!implementation.includes('_this._fd = term.fd') ||
           !implementation.includes('Object.defineProperty(UnixTerminal.prototype, "fd"') ||
           !implementation.includes("_this.once('close', function ()") ||
           !implementation.includes("~err.code.indexOf('EIO')")) {
  throw new Error(`${platformName}: certified Unix fd/EIO boundary changed`);
}

const lock = await readFile('pnpm-lock.yaml', 'utf8');
for (const target of ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64']) {
  const key = `'@lydell/node-pty-${target}@1.2.0-beta.15':`;
  if (!lock.includes(key)) throw new Error(`pnpm lock omits certified target ${target}`);
}
if (lock.includes('@lydell/node-pty-darwin-arm64@1.2.0-beta.15(patch_hash=')) {
  throw new Error('node-pty certification must not depend on root-only package-manager patches');
}

// This smoke spawns the backend directly, below the environment allowlist a
// launch would apply, so it asks the driver for the same platform floor. A
// Node child started on Windows without SystemRoot aborts inside CSPRNG
// initialization with exit code 134 before running a line of script, which
// reads here as a broken PTY write boundary rather than a bare environment.
// The child prints nothing until it is written to, which is the exact shape
// that deadlocks when writes are gated on output. Keep the limit short: it
// exists to report a stuck write barrier quickly, and a longer one only hides
// the bug for longer.
//
// Releasing the pty is not always enough to end this process — the ConPTY path
// keeps a conout worker thread alive and its console-process-list kill is
// asynchronous — so a watchdog reports how far the smoke got and leaves. A
// certification script must fail, never hang. The stage markers make "where
// did it stop" answerable from the CI log instead of by guessing.
const smokeTimeoutMs = 10_000;
let output = '';
const stages = [];
const stage = (name) => {
  stages.push(`${name}@${Math.round(performance.now())}ms`);
  process.stderr.write(`node-pty certification: ${name}\n`);
};
let spawned;
const watchdog = setTimeout(() => {
  process.stderr.write(
    `node-pty certification watchdog fired; stages=${stages.join(',')} output=${JSON.stringify(output)}\n`,
  );
  // Release the pty AND terminate the child before leaving. process.exit()
  // skips finally blocks, and closing the pseudoconsole does not reliably take
  // the child with it, so an orphan keeps the console handles this CI step
  // waits on and the job hangs anyway — the exact failure this watchdog exists
  // to prevent. The smoke's child never exits on its own: it blocks on stdin.
  const pid = spawned?.pid;
  try { spawned?.dispose(); } catch { /* already gone */ }
  if (typeof pid === 'number' && pid > 0) {
    try { process.kill(pid); } catch { /* already gone */ }
  }
  process.exit(1);
}, smokeTimeoutMs * 3);

stage('spawning');
const backend = createNodePtyBackend();
const proc = backend.spawn({
  command: [process.execPath, '-e', "process.stdin.setRawMode?.(true);process.stdin.once('data',()=>{process.stdout.write('tw-write-ok');process.exit(0)});process.stdin.resume()"],
  env: inheritedSpawnEnv(),
  columns: 40,
  rows: 4,
});
spawned = proc;
let writeFailure;
let sawOutput = false;
proc.onData((data) => {
  output += Buffer.from(data).toString('utf8');
  if (!sawOutput) { sawOutput = true; stage('first-output'); }
});
proc.onWriteError?.((error) => { writeFailure = error; });
stage('spawned');
proc.write(Buffer.from('x'));
stage('write-queued');
let timeout;
let status;
try {
  status = await Promise.race([
    new Promise((resolve) => proc.onExit(resolve)),
    new Promise((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error(`certified PTY smoke timed out after ${smokeTimeoutMs}ms; output so far: ${JSON.stringify(output)}`)),
        smokeTimeoutMs,
      );
    }),
  ]);
} finally {
  stage('settled');
  // Release the pty on every path. A timeout that skipped this left the pty
  // open, so the script kept the event loop alive and the job hung until the
  // CI runner's own limit instead of failing in ten seconds with a reason.
  clearTimeout(timeout);
  clearTimeout(watchdog);
  proc.dispose();
}
if (writeFailure !== undefined) throw writeFailure;
if (status.code !== 0 || !output.includes('tw-write-ok')) {
  throw new Error(`Termwright-owned PTY write boundary failed: ${JSON.stringify({ status, output })}`);
}
// node-pty cannot certify a complete output tail on either implementation:
// ConPTY closes on a timer, while Unix maps POLLHUP/EIO to stream completion
// even when libuv has not delivered every byte queued on the PTY master.
const expectedDrain = 'bounded-fallback';
if (proc.lifecycle?.outputDrain !== expectedDrain) {
  throw new Error(`Termwright-owned PTY output boundary mismatch: expected ${expectedDrain}, found ${String(proc.lifecycle?.outputDrain)}`);
}

console.log(`node-pty certification: ${platformName}@${manifest.version}, Termwright-owned write queue/output boundary verified (${expectedDrain})`);
