import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';

const installRoot = resolve(process.argv[2] ?? process.cwd());
const entry = join(installRoot, 'node_modules', '@termwright', 'driver', 'dist', 'experimental.js');
// Ask the installed package for the platform's environment floor rather than
// passing a bare PATH: a Node child started on Windows without SystemRoot
// aborts inside CSPRNG initialization with exit code 134 before running any
// script, which reads here as a broken PTY boundary in the packed driver.
const { createNodePtyBackend, inheritedSpawnEnv } = await import(pathToFileURL(entry).href);
const proc = createNodePtyBackend().spawn({
  command: [process.execPath, '-e', "process.stdin.setRawMode?.(true);process.stdin.once('data',()=>{process.stdout.write('installed-driver-ok');process.exit(0)});process.stdin.resume()"],
  env: inheritedSpawnEnv(),
  columns: 40,
  rows: 4,
});
let output = '';
let writeFailure;
proc.onData((data) => { output += Buffer.from(data).toString('utf8'); });
proc.onWriteError?.((error) => { writeFailure = error; });
proc.write(Buffer.from('x'));
// Never hang: release the pty and terminate the child on every path, and give
// up loudly if the smoke stalls. This script gates a CI step.
const smokeTimeoutMs = 10_000;
let timeout;
let status;
try {
  status = await Promise.race([
    new Promise((resolveExit) => proc.onExit(resolveExit)),
    new Promise((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error(`installed driver PTY smoke timed out after ${smokeTimeoutMs}ms; output so far: ${JSON.stringify(output)}`)),
        smokeTimeoutMs,
      );
    }),
  ]);
} finally {
  clearTimeout(timeout);
  const pid = proc.pid;
  proc.dispose();
  if (typeof pid === 'number' && pid > 0) {
    try { process.kill(pid); } catch { /* already gone */ }
  }
}
if (writeFailure !== undefined) throw writeFailure;
if (status.code !== 0 || !output.includes('installed-driver-ok')) {
  throw new Error(`installed driver PTY boundary failed: ${JSON.stringify({ status, output })}`);
}
console.log(`installed @termwright/driver PTY boundary verified on ${process.platform}-${process.arch}`);
