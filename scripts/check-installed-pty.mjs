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
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { argv, execPath, exit, platform, arch } from 'node:process';
import { fileURLToPath } from 'node:url';

const installDirectory = argv[2];
const verdictFlag = argv.indexOf('--verdict');
const verdictPath = verdictFlag < 0 ? undefined : argv[verdictFlag + 1];
const causalFixturePath = fileURLToPath(new URL('./fixtures/conpty-causal-order.ps1', import.meta.url));
if (installDirectory === undefined) {
  console.error('usage: check-installed-pty.mjs <install-dir> [--verdict <path>]');
  exit(1);
}
if (verdictFlag >= 0 && verdictPath === undefined) {
  console.error('--verdict requires an output path');
  exit(1);
}

const probe = `
	const { createServer } = await import('node:net');
	const { spawnSync } = await import('node:child_process');
	const pty = await import('@termwright/pty');
if (!pty.ptyAvailable()) {
  console.error('resolved no addon: ' + (pty.ptyUnavailableReason?.() ?? 'no reason reported'));
  process.exit(2);
}
if (process.platform === 'win32') {
  const runtime = pty.conPtyRuntimeInfo();
  const nativeArchitecture = process.env.PROCESSOR_ARCHITEW6432?.toLowerCase() === 'arm64' ||
    process.env.PROCESSOR_ARCHITECTURE?.toLowerCase() === 'arm64' ? 'arm64' : 'x64';
  if (runtime.provider !== 'vendored' || runtime.package !== 'Microsoft.Windows.Console.ConPTY' ||
      runtime.version !== '1.24.260710001' || runtime.mode !== 'ordered-vt-passthrough' ||
      runtime.policy !== 'strict' || runtime.assetsValidated !== true ||
      runtime.coreExports !== true || runtime.failureCode !== '' || runtime.failureWin32 !== 0 ||
      runtime.selectedHostArchitecture !== nativeArchitecture) {
    console.error('the installed addon did not load the certified vendored ConPTY runtime: ' + JSON.stringify(runtime));
    process.exit(9);
  }
  console.log('[pty-cert] vendored-conpty ' + JSON.stringify(runtime));
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
const command = (source, executable = process.execPath) => [executable, '-e', source];
const collect = (source, executable = process.execPath) => {
  const session = pty.spawnPty({ command: command(source, executable), env: environment, columns: 80, rows: 24 });
  const output = [];
  session.onData((data) => output.push(Buffer.from(data)));
  return { session, output, text: () => Buffer.concat(output).toString('utf8') };
};

if (process.platform === 'win32') {
  const causalCycles = 256;
  const causalSource = [
    'const { writeSync } = require("node:fs");',
    'for (let index = 0; index < ' + causalCycles + '; index += 1) {',
    '  const id = index.toString(16).padStart(4, "0");',
    '  writeSync(1, Buffer.from("A" + id + "\\x1b]8486;TW_CAUSAL;A;" + id + "\\x07"));',
    '  writeSync(1, Buffer.from("B" + id + "\\x1b]8486;TW_CAUSAL;B;" + id + "\\x07"));',
    '  writeSync(1, Buffer.from("A" + id + "\\x1b]8486;TW_CAUSAL;C;" + id + "\\x07"));',
    '}',
    'writeSync(1, Buffer.from("\\x1b[?1049hALT\\x1b]8486;TW_CAUSAL;ALT\\x07\\x1b[?1049lPRIMARY\\x1b]8486;TW_CAUSAL;FINAL\\x07"));',
  ].join('');
  const certifyVtOrder = async (name, executable) => {
    const causal = collect(causalSource, executable);
    await causal.session.outputEnded;
    const bytes = causal.text();
    let cursor = bytes.indexOf('A0000\x1b]8486;TW_CAUSAL;A;0000\x07');
    let valid = cursor >= 0 && !/[AB][0-9a-f]{4}/u.test(bytes.slice(0, cursor));
    for (let index = 0; index < causalCycles && valid; index += 1) {
      const id = index.toString(16).padStart(4, '0');
      for (const [text, phase] of [['A', 'A'], ['B', 'B'], ['A', 'C']]) {
        const expected = text + id + '\x1b]8486;TW_CAUSAL;' + phase + ';' + id + '\x07';
        if (bytes.indexOf(expected, cursor) !== cursor) { valid = false; break; }
        cursor += expected.length;
      }
    }
    const tail = '\x1b[?1049hALT\x1b]8486;TW_CAUSAL;ALT\x07\x1b[?1049lPRIMARY\x1b]8486;TW_CAUSAL;FINAL\x07';
    valid &&= bytes.indexOf(tail, cursor) === cursor && causal.session.sawRealEof;
    causal.session.dispose();
    if (!valid) throw new Error(name + ' application writes lost causal VT/alternate-screen order');
  };

  console.log('[pty-cert] causal-vt-node');
  await certifyVtOrder('Node', process.execPath);
  if (process.env.TERMWRIGHT_REQUIRE_BUN === '1') {
    if (spawnSync('bun', ['--version'], { stdio: 'ignore' }).status !== 0) {
      throw new Error('Bun is required for Windows PTY certification');
    }
    console.log('[pty-cert] causal-vt-bun');
    await certifyVtOrder('Bun', 'bun');
  }

  console.log('[pty-cert] causal-legacy');
  const legacySession = pty.spawnPty({
    command: ['powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', process.env.TERMWRIGHT_CONPTY_CAUSAL_FIXTURE],
    env: environment,
    columns: 100,
    rows: 30,
  });
  const legacyOutput = [];
  legacySession.onData((data) => legacyOutput.push(Buffer.from(data)));
  const legacy = { session: legacySession, text: () => Buffer.concat(legacyOutput).toString('utf8') };
  await legacy.session.outputEnded;
  const legacyBytes = legacy.text();
  let legacyCursor = legacyBytes.indexOf('A0000\x1b]8486;TW_LEGACY;A;0000\x07');
  let legacyValid = legacyCursor >= 0;
  for (let index = 0; index < 256 && legacyValid; index += 1) {
    const id = index.toString(16).padStart(4, '0');
    const first = 'A' + id + '\x1b]8486;TW_LEGACY;A;' + id + '\x07';
    legacyValid &&= legacyBytes.indexOf(first, legacyCursor) === legacyCursor;
    legacyCursor += first.length;
    const textIndex = legacyBytes.indexOf('B' + id, legacyCursor);
    const markerText = '\x1b]8486;TW_LEGACY;B;' + id + '\x07';
    const markerIndex = legacyBytes.indexOf(markerText, legacyCursor);
    legacyValid &&= textIndex >= legacyCursor && markerIndex > textIndex;
    legacyCursor = markerIndex + markerText.length;
    const final = 'A' + id + '\x1b]8486;TW_LEGACY;C;' + id + '\x07';
    legacyValid &&= legacyBytes.indexOf(final, legacyCursor) === legacyCursor;
    legacyCursor += final.length;
  }
  legacyValid &&= legacy.session.sawRealEof;
  legacy.session.dispose();
  if (!legacyValid) throw new Error('legacy Console API output was overtaken by its following VT marker');
}
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

// Keep the child alive until both native drain and exact child receipt are
// observed. This avoids racing the writer's drain publication against input
// pipe teardown while exercising the installed platform writer.
const inputBytes = 64 * 1024;
console.log('[pty-cert] drain');
const controlServer = createServer();
const controlConnected = new Promise((resolve) => controlServer.once('connection', resolve));
await new Promise((resolve, reject) => {
  controlServer.once('error', reject);
  controlServer.listen(0, '127.0.0.1', resolve);
});
const controlAddress = controlServer.address();
if (controlAddress === null || typeof controlAddress === 'string') {
  console.error('the drain control server has no TCP port');
  process.exit(7);
}
const draining = collect([
  'const net = require("node:net");',
  'process.stdin.setRawMode?.(true);',
  'process.stdin.resume();',
  'let received = 0;',
  'const control = net.connect(' + controlAddress.port + ', "127.0.0.1", () => process.stdout.write("READY"));',
  'control.once("data", () => control.end("BYE"));',
  'control.once("close", () => process.exit(0));',
  'process.stdin.on("data", chunk => {',
  '  received += chunk.length;',
  '  if (received === ' + inputBytes + ') process.stdout.write("INPUT_DRAINED");',
  '});',
].join(''));
await waitForText(draining, 'READY');
const control = await controlConnected;
const drained = new Promise((resolve) => {
  const release = draining.session.onDrain(() => { release(); resolve(); });
});
draining.session.write(Buffer.alloc(inputBytes, 0x62));
await Promise.all([drained, waitForText(draining, 'INPUT_DRAINED')]);
const controlClosed = new Promise((resolve, reject) => {
  const reply = [];
  control.on('data', (data) => reply.push(data));
  control.once('error', reject);
  control.once('end', () => control.end());
  control.once('close', (hadError) => {
    if (hadError) return;
    const message = Buffer.concat(reply).toString();
    if (message === 'BYE') resolve();
    else reject(new Error('unexpected drain-control farewell: ' + JSON.stringify(message)));
  });
});
control.write('X');
await Promise.all([controlClosed, draining.session.outputEnded]);
if (!draining.text().includes('INPUT_DRAINED') || !draining.session.sawRealEof) {
  console.error('the installed addon did not drain admitted input before owned EOF');
  process.exit(7);
}
draining.session.dispose();
control.destroy();
await new Promise((resolve, reject) => controlServer.close((error) => error === undefined ? resolve() : reject(error)));

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
let pressureCursor = pressureOutput.indexOf(pressurePrefix);
let pressureValid = true;
for (let index = 0; index < pressureFrameCount; index += 1) {
  const start = pressureOutput.indexOf(pressurePrefix, pressureCursor);
  const end = start < 0 ? -1 : pressureOutput.indexOf(0x07, start + pressurePrefix.length);
  const body = end < 0 ? Buffer.alloc(0) : pressureOutput.subarray(start + pressurePrefix.length, end);
  const header = index.toString(16).padStart(8, '0') + ';';
  const startIsValid = start === pressureCursor;
  if (!startIsValid || end <= start || body.length !== 9 + pressureFrameBytes ||
      body.subarray(0, 9).toString('ascii') !== header ||
      !body.subarray(9).every((byte) => byte === 0x71)) {
    pressureValid = false;
    break;
  }
  pressureCursor = end + 1;
}
const sentinelIndex = pressureOutput.indexOf(pressureSentinel, pressureCursor);
const sentinelIsValid = sentinelIndex === pressureCursor;
pressureValid &&= pressureOutput.indexOf(pressurePrefix, pressureCursor) === -1 &&
  sentinelIsValid && sentinelIndex === pressureOutput.lastIndexOf(pressureSentinel);
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
  env: { ...process.env, TERMWRIGHT_CONPTY_CAUSAL_FIXTURE: causalFixturePath },
  stdio: ['ignore', 'pipe', 'pipe'],
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) {
  console.error(`the installed @termwright/pty failed on ${platform}-${arch} (exit ${result.status})`);
  exit(1);
}
if (verdictPath !== undefined) {
  if (platform !== 'win32') {
    console.error('--verdict is only supported for a Windows ConPTY bundle');
    exit(1);
  }
  const installedRequire = createRequire(join(installDirectory, 'termwright-pty-certifier.cjs'));
  const addonPath = installedRequire.resolve(`@termwright/pty-win32-${arch}/termwright_pty.node`);
  const manifestPath = join(dirname(addonPath), 'vendor', 'conpty-manifest.json');
  const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
  const runtime = installedRequire(addonPath).conPtyRuntimeInfo();
  writeFileSync(verdictPath, `${JSON.stringify({
    schemaVersion: 1,
    platform,
    architecture: arch,
    addonSha256: sha256(addonPath),
    conptyManifestSha256: sha256(manifestPath),
    runtime,
    causal: { node: true, bun: process.env.TERMWRIGHT_REQUIRE_BUN === '1', legacy: true, alternateScreen: true },
  }, null, 2)}\n`);
}
console.log(`the installed @termwright/pty runs a real pseudoterminal on ${platform}-${arch}`);
