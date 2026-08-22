import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createNodePtyBackend, inheritedSpawnEnv } from '../packages/driver/dist/index.js';

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
  throw new Error(`${platformName}: certified Unix fd/output-EOF boundary changed`);
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
const backend = createNodePtyBackend();
const proc = backend.spawn({
  command: [process.execPath, '-e', "process.stdin.setRawMode?.(true);process.stdin.once('data',()=>{process.stdout.write('tw-write-ok');process.exit(0)});process.stdin.resume()"],
  env: inheritedSpawnEnv(),
  columns: 40,
  rows: 4,
});
let output = '';
let writeFailure;
proc.onData((data) => { output += Buffer.from(data).toString('utf8'); });
proc.onWriteError?.((error) => { writeFailure = error; });
proc.write(Buffer.from('x'));
// The child here prints nothing until it is written to, which is the exact
// shape that used to deadlock on ConPTY. Keep the limit short on every
// platform: it exists to report a stuck write barrier quickly, and a longer
// one would only have hidden that bug for longer.
const smokeTimeoutMs = 10_000;
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
  // Release the pty on every path. A timeout that skipped this left the pty
  // open, so the script kept the event loop alive and the job hung until the
  // CI runner's own limit instead of failing in five seconds with a reason.
  clearTimeout(timeout);
  proc.dispose();
}
if (writeFailure !== undefined) throw writeFailure;
if (status.code !== 0 || !output.includes('tw-write-ok')) {
  throw new Error(`Termwright-owned PTY write boundary failed: ${JSON.stringify({ status, output })}`);
}
const expectedDrain = process.platform === 'win32' ? 'bounded-fallback' : 'eof';
if (proc.lifecycle?.outputDrain !== expectedDrain) {
  throw new Error(`Termwright-owned PTY output boundary mismatch: expected ${expectedDrain}, found ${String(proc.lifecycle?.outputDrain)}`);
}

console.log(`node-pty certification: ${platformName}@${manifest.version}, Termwright-owned write queue/output boundary verified (${expectedDrain})`);
