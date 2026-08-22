import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';

const installRoot = resolve(process.argv[2] ?? process.cwd());
const entry = join(installRoot, 'node_modules', '@termwright', 'driver', 'dist', 'index.js');
const { createNodePtyBackend } = await import(pathToFileURL(entry).href);
const proc = createNodePtyBackend().spawn({
  command: [process.execPath, '-e', "process.stdin.setRawMode?.(true);process.stdin.once('data',()=>{process.stdout.write('installed-driver-ok');process.exit(0)});process.stdin.resume()"],
  env: { PATH: process.env.PATH ?? '' },
  columns: 40,
  rows: 4,
});
let output = '';
let writeFailure;
proc.onData((data) => { output += Buffer.from(data).toString('utf8'); });
proc.onWriteError?.((error) => { writeFailure = error; });
proc.write(Buffer.from('x'));
let timeout;
const status = await Promise.race([
  new Promise((resolveExit) => proc.onExit(resolveExit)),
  new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error('installed driver PTY smoke timed out')), 5_000);
  }),
]).finally(() => clearTimeout(timeout));
proc.dispose();
if (writeFailure !== undefined) throw writeFailure;
if (status.code !== 0 || !output.includes('installed-driver-ok')) {
  throw new Error(`installed driver PTY boundary failed: ${JSON.stringify({ status, output })}`);
}
console.log(`installed @termwright/driver PTY boundary verified on ${process.platform}-${process.arch}`);
