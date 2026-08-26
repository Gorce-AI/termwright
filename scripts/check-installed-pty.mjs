#!/usr/bin/env node
/**
 * Prove a consumer install resolves the prebuilt addon and runs it.
 *
 * Everything upstream of this checks a working tree: the binary is where the
 * build put it, the manifests say the right things, packing refuses an empty
 * archive. None of that is what a user gets. This installs the packed
 * tarballs into a clean directory and asks the installed copy to open a real
 * pseudoconsole — the first point where optional-dependency resolution, the
 * os/cpu filter, the loader's candidate list and the file actually being in
 * the archive are all exercised at once.
 *
 * The probe runs as a child process with its working directory inside the
 * install, because that is what makes a bare specifier resolve the way it
 * will for a consumer. Resolving it from here would ask this repository's
 * module graph a question about someone else's.
 *
 * Usage: check-installed-pty.mjs <install-dir>
 */

import { spawnSync } from 'node:child_process';
import { argv, execPath, exit, platform, arch } from 'node:process';

const installDirectory = argv[2];
if (installDirectory === undefined) {
  console.error('usage: check-installed-pty.mjs <install-dir>');
  exit(1);
}

const probe = `
const pty = await import('@termwright/pty');
if (!pty.ptyAvailable()) {
  console.error('resolved no addon: ' + (pty.ptyUnavailableReason?.() ?? 'no reason reported'));
  process.exit(2);
}
// Loading is not running. A binary that loads and then cannot open a
// pseudoconsole would still satisfy a resolution check, and the point of
// shipping a prebuild is that it works on arrival.
console.log('[pty-cert] lifecycle');
const handle = pty.spawnPty({
  command: [process.execPath, '-e', 'process.stdout.write("PREBUILD OK\\\\r\\\\n")'],
  env: { ...process.env, TERM: 'xterm-256color' },
  columns: 80,
  rows: 24,
});
const chunks = [];
handle.onData((data) => chunks.push(Buffer.from(data)));
const exited = new Promise((resolve) => handle.onExit(resolve));
const [status] = await Promise.all([exited, handle.outputEnded]);
const text = Buffer.concat(chunks).toString('utf8');
const sawEof = handle.sawRealEof;
const tree = handle.treeState();
if (!sawEof || status.code !== 0 || tree !== 'gone') {
  console.error('the session did not reach an owned EOF/exit/tree boundary: ' + JSON.stringify({ status, tree }));
  process.exit(3);
}
if (!text.includes('PREBUILD OK')) {
  console.error('the child produced no output; saw ' + JSON.stringify(text));
  process.exit(4);
}
let rejectedAfterEof = false;
try { handle.write(Buffer.from('late')); } catch { rejectedAfterEof = true; }
if (!rejectedAfterEof) {
  console.error('the installed addon admitted input after authoritative EOF');
  process.exit(5);
}
handle.dispose();

const environment = { ...process.env, TERM: 'xterm-256color' };
const command = (source) => [process.execPath, '-e', source];
const collect = (source) => {
  const session = pty.spawnPty({ command: command(source), env: environment, columns: 80, rows: 24 });
  const output = [];
  session.onData((data) => output.push(Buffer.from(data)));
  return { session, output, text: () => Buffer.concat(output).toString('utf8') };
};
const waitForText = ({ session, text }, marker) => {
  if (text().includes(marker)) return Promise.resolve();
  return new Promise((resolve) => {
    const release = session.onData(() => {
      if (!text().includes(marker)) return;
      release();
      resolve();
    });
  });
};

// Certify the bounded input queue in the packed consumer install, on this
// artifact's actual OS/architecture. The child deliberately never consumes
// stdin; rejection, not elapsed time, is the verdict.
console.log('[pty-cert] bounded-input');
const blocked = collect('require("node:net").createServer().listen(0); process.stdout.write("READY")');
await waitForText(blocked, 'READY');
let overflowRejected = false;
try {
  const block = Buffer.alloc(1024 * 1024, 0x61);
  for (let index = 0; index < 32; index += 1) blocked.session.write(block);
} catch (error) {
  overflowRejected = /input queue capacity exceeded/u.test(String(error));
}
blocked.session.dispose();
if (!overflowRejected) {
  console.error('the installed addon did not enforce its bounded input queue');
  process.exit(6);
}

// Drain must follow every admitted byte leaving the native queue, and the
// child must observe all of it. This exercises the platform writer rather than
// only proving that the addon can be loaded.
const inputBytes = 64 * 1024;
console.log('[pty-cert] drain');
const draining = collect([
  'process.stdin.setRawMode?.(true);',
  'process.stdin.resume();',
  'let received = 0;',
  'process.stdout.write("READY");',
  'process.stdin.on("data", chunk => {',
  '  received += chunk.length;',
  '  if (received >= ' + inputBytes + ') { process.stdout.write("INPUT_DRAINED"); process.exit(0); }',
  '});',
].join(''));
await waitForText(draining, 'READY');
const drained = new Promise((resolve) => {
  const release = draining.session.onDrain(() => { release(); resolve(); });
});
draining.session.write(Buffer.alloc(inputBytes, 0x62));
await Promise.all([drained, draining.session.outputEnded]);
if (!draining.text().includes('INPUT_DRAINED') || !draining.session.sawRealEof) {
  console.error('the installed addon did not drain admitted input before owned EOF');
  process.exit(7);
}
draining.session.dispose();

// Drive a burst several times larger than the bounded native-to-JavaScript
// queue's maximum represented byte volume and prove every framed application
// payload plus the final tail is delivered before EOF. Queue occupancy is an
// implementation detail; this certifies the observable lossless contract.
const pressureFrameCount = 4096;
const pressureFrameBytes = 4096;
console.log('[pty-cert] output-pressure');
const pressure = collect([
  'const fs = require("node:fs");',
  'const payload = Buffer.alloc(' + pressureFrameBytes + ', 0x71);',
  'for (let index = 0; index < ' + pressureFrameCount + '; index += 1) {',
  'fs.writeSync(1, Buffer.from("\\x1b]8486;TW_PRESSURE;" + index.toString(16).padStart(8, "0") + ";"));',
  'fs.writeSync(1, payload);',
  'fs.writeSync(1, Buffer.from("\\x07"));',
  '}',
  'fs.writeSync(1, Buffer.from("PRESSURE_SENTINEL"));',
].join(''));
await pressure.session.outputEnded;
const pressureOutput = Buffer.concat(pressure.output);
const pressurePrefix = Buffer.from('\x1b]8486;TW_PRESSURE;');
const pressureSentinel = Buffer.from('PRESSURE_SENTINEL');
let pressureCursor = 0;
let pressureValid = true;
for (let index = 0; index < pressureFrameCount; index += 1) {
  const start = pressureOutput.indexOf(pressurePrefix, pressureCursor);
  const end = start < 0 ? -1 : pressureOutput.indexOf(0x07, start + pressurePrefix.length);
  const body = end < 0 ? Buffer.alloc(0) : pressureOutput.subarray(start + pressurePrefix.length, end);
  const header = index.toString(16).padStart(8, '0') + ';';
  if (start < pressureCursor || end <= start || body.length !== 9 + pressureFrameBytes ||
      body.subarray(0, 9).toString('ascii') !== header ||
      !body.subarray(9).every((byte) => byte === 0x71)) {
    pressureValid = false;
    break;
  }
  pressureCursor = end + 1;
}
const sentinelIndex = pressureOutput.indexOf(pressureSentinel, pressureCursor);
pressureValid &&= pressureOutput.indexOf(pressurePrefix, pressureCursor) === -1 &&
  sentinelIndex >= pressureCursor && sentinelIndex === pressureOutput.lastIndexOf(pressureSentinel);
if (!pressureValid || !pressure.session.sawRealEof) {
  console.error('the installed addon lost its final output under channel pressure');
  process.exit(8);
}
pressure.session.dispose();

console.log('ran native PTY lifecycle and flow-control certification');
`;

const result = spawnSync(execPath, ['--input-type=module', '-e', probe], {
  cwd: installDirectory,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) {
  console.error(`the installed @termwright/pty failed on ${platform}-${arch} (exit ${result.status})`);
  exit(1);
}
console.log(`the installed @termwright/pty runs a real pseudoterminal on ${platform}-${arch}`);
