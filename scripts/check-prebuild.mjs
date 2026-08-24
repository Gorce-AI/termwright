#!/usr/bin/env node
/**
 * A prebuild package with no binary in it installs cleanly and does nothing.
 *
 * That is the failure mode worth guarding: npm accepts the empty package, the
 * loader finds no addon, the driver falls back, and every Windows session
 * quietly runs on the implementation the prebuild existed to replace. Nothing
 * in that chain is an error until someone reads a boundary that was supposed
 * to be authoritative.
 *
 * Usage:
 *   check-prebuild.mjs <arch> [--allow-missing]
 *   check-prebuild.mjs --all
 *
 * `--allow-missing` is for the build step of a working tree that has not
 * produced binaries: it reports and succeeds. Packing and publishing use the
 * strict form, where absence is an error.
 */

import { readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BINARY = 'termwright_conpty.node';
// A DLL-backed Node addon is never this small. The number is deliberately far
// below any real build: it catches a truncated download or an empty
// placeholder, not a binary that happens to be lean.
const MINIMUM_BYTES = 16 * 1024;

const argv = process.argv.slice(2);
const allowMissing = argv.includes('--allow-missing');
const all = argv.includes('--all');
const named = argv.filter((value) => !value.startsWith('--'));

async function prebuildDirectories() {
  const entries = await readdir(join(ROOT, 'packages'), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('conpty-win32-'))
    .map((entry) => entry.name.slice('conpty-win32-'.length))
    .sort();
}

const targets = all || named.length === 0 ? await prebuildDirectories() : named;
if (targets.length === 0) {
  console.error('no prebuild packages found under packages/');
  process.exit(1);
}

let missing = 0;
for (const arch of targets) {
  const path = join(ROOT, 'packages', `conpty-win32-${arch}`, BINARY);
  let size;
  try {
    size = (await stat(path)).size;
  } catch {
    missing += 1;
    console[allowMissing ? 'log' : 'error'](
      `packages/conpty-win32-${arch}/${BINARY} is absent` +
        (allowMissing ? ' (not built in this tree)' : '; publishing it would ship an empty prebuild'),
    );
    continue;
  }
  if (size < MINIMUM_BYTES) {
    console.error(
      `packages/conpty-win32-${arch}/${BINARY} is ${size} bytes, below the ${MINIMUM_BYTES} expected of a real addon`,
    );
    process.exit(1);
  }
  console.log(`packages/conpty-win32-${arch}/${BINARY}: ${size} bytes`);
}

if (missing > 0 && !allowMissing) process.exit(1);
