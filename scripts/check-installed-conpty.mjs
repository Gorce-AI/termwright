#!/usr/bin/env node
/**
 * Prove a consumer install resolves the prebuilt addon.
 *
 * Everything upstream of this checks a working tree: the binary is where the
 * build put it, the manifests say the right things, the packing refuses an
 * empty archive. None of that is what a user gets. This installs the packed
 * tarballs into a clean directory and asks the installed copy to load its
 * addon, which is the first point where the whole chain — optional dependency
 * resolution, the os/cpu filter, the loader's candidate list, the file
 * actually being in the archive — is exercised at once.
 *
 * Usage: check-installed-conpty.mjs <install-dir>
 */

import { createRequire } from 'node:module';
import { argv, exit, platform, arch } from 'node:process';

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

const require = createRequire(`${installDirectory}/`);
let conpty;
try {
  conpty = await import(require.resolve('@termwright/conpty'));
} catch (error) {
  console.error(`the installed @termwright/conpty could not be imported: ${error?.message ?? error}`);
  exit(1);
}

if (!conpty.conPtyAvailable()) {
  console.error(
    `the installed @termwright/conpty resolved no addon for win32-${arch}: ` +
      `${conpty.conPtyUnavailableReason?.() ?? 'no reason reported'}`,
  );
  exit(1);
}

// Loading is not running. A binary that loads and then cannot open a
// pseudoconsole would still pass a require check, and the point of shipping a
// prebuild is that the thing works on arrival.
const handle = conpty.spawnConPty({
  command: [process.execPath, '-e', 'process.stdout.write("PREBUILD OK\\r\\n")'],
  env: { ...process.env, TERM: 'xterm-256color' },
  columns: 80,
  rows: 24,
});
const chunks = [];
handle.onData((data) => chunks.push(Buffer.from(data)));
await handle.outputEnded;
const text = Buffer.concat(chunks).toString('utf8');
handle.dispose();

if (!handle.sawRealEof) {
  console.error('the installed addon ended its stream without a real end of output');
  exit(1);
}
if (!text.includes('PREBUILD OK')) {
  console.error(`the installed addon produced no output from its child; saw ${JSON.stringify(text)}`);
  exit(1);
}
console.log(`the installed @termwright/conpty runs a real pseudoconsole on win32-${arch}`);
