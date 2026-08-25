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
 * Usage: check-installed-conpty.mjs <install-dir>
 */

import { spawnSync } from 'node:child_process';
import { argv, execPath, exit, platform, arch } from 'node:process';

const installDirectory = argv[2];
if (installDirectory === undefined) {
  console.error('usage: check-installed-conpty.mjs <install-dir>');
  exit(1);
}

if (platform !== 'win32') {
  // Not a skip that hides anything: there is no addon to resolve here, and
  // saying so is more useful than a pass that means nothing.
  console.log(`no ConPTY addon exists for ${platform}; nothing to resolve`);
  exit(0);
}

const probe = `
const conpty = await import('@termwright/conpty');
if (!conpty.conPtyAvailable()) {
  console.error('resolved no addon: ' + (conpty.conPtyUnavailableReason?.() ?? 'no reason reported'));
  process.exit(2);
}
// Loading is not running. A binary that loads and then cannot open a
// pseudoconsole would still satisfy a resolution check, and the point of
// shipping a prebuild is that it works on arrival.
const handle = conpty.spawnConPty({
  command: [process.execPath, '-e', 'process.stdout.write("PREBUILD OK\\\\r\\\\n")'],
  env: { ...process.env, TERM: 'xterm-256color' },
  columns: 80,
  rows: 24,
});
const chunks = [];
handle.onData((data) => chunks.push(Buffer.from(data)));
await handle.outputEnded;
const text = Buffer.concat(chunks).toString('utf8');
const sawEof = handle.sawRealEof;
handle.dispose();
if (!sawEof) { console.error('the stream ended without a real end of output'); process.exit(3); }
if (!text.includes('PREBUILD OK')) {
  console.error('the child produced no output; saw ' + JSON.stringify(text));
  process.exit(4);
}
console.log('ran a real pseudoconsole');
`;

const result = spawnSync(execPath, ['--input-type=module', '-e', probe], {
  cwd: installDirectory,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) {
  console.error(`the installed @termwright/conpty failed on win32-${arch} (exit ${result.status})`);
  exit(1);
}
console.log(`the installed @termwright/conpty runs a real pseudoconsole on win32-${arch}`);
