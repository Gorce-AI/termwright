import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';

const installRoot = resolve(process.argv[2] ?? process.cwd());
const entry = join(installRoot, 'node_modules', '@termwright', 'driver', 'dist', 'experimental.js');
// Ask the installed package for the platform's environment floor rather than
// passing a bare PATH: a Node child started on Windows without SystemRoot
// aborts inside CSPRNG initialization with exit code 134 before running any
// script, which reads here as a broken PTY boundary in the packed driver.
const { createNativePtyBackend, inheritedSpawnEnv } = await import(pathToFileURL(entry).href);
const proc = createNativePtyBackend().spawn({
  command: [
    process.execPath,
    '-e',
    "process.stdin.setRawMode?.(true);process.stdin.once('data',()=>{process.stdout.write('installed-driver-ok');process.exit(0)});process.stdin.resume()",
  ],
  env: inheritedSpawnEnv(),
  columns: 40,
  rows: 4,
});
let output = '';
let writeFailure;
proc.onData((data) => {
  output += Buffer.from(data).toString('utf8');
});
proc.onWriteError?.((error) => {
  writeFailure = error;
});
const exited = new Promise((resolveExit) => proc.onExit(resolveExit));
proc.write(Buffer.from('x'));
let status;
let sawEof;
let tree;
try {
  [status] = await Promise.all([exited, proc.outputEnded]);
  sawEof = proc.sawOutputEnd?.();
  tree = proc.treeState?.();
} finally {
  proc.dispose();
}
if (writeFailure !== undefined) throw writeFailure;
if (
  status.code !== 0 ||
  sawEof !== true ||
  tree !== 'gone' ||
  !output.includes('installed-driver-ok')
) {
  throw new Error(
    `installed driver PTY boundary failed: ${JSON.stringify({ status, sawEof, tree, output })}`,
  );
}
console.log(
  `installed @termwright/driver PTY boundary verified on ${process.platform}-${process.arch}`,
);
