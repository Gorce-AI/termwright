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

import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BINARY = 'termwright_conpty.node';
// A DLL-backed Node addon is never this small. The number is deliberately far
// below any real build: it catches a truncated download or an empty
// placeholder, not a binary that happens to be lean.
const MINIMUM_BYTES = 16 * 1024;
const PE_MACHINE = Object.freeze({
  x64: 0x8664,
  arm64: 0xaa64,
});

/**
 * Verifies that a native addon is a PE image for the package architecture.
 * Cross-compiled ARM64 binaries cannot be executed on the x64 builder, so the
 * COFF Machine field is the authoritative evidence available in that lane.
 */
export function verifyPeMachine(bytes, arch) {
  const expected = Object.hasOwn(PE_MACHINE, arch) ? PE_MACHINE[arch] : undefined;
  if (expected === undefined) throw new TypeError(`unsupported Windows prebuild architecture: ${arch}`);
  if (bytes.length < 0x40 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
    throw new Error(`${arch} prebuild is not a PE image (missing DOS header)`);
  }

  const view = Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const peOffset = view.readUInt32LE(0x3c);
  if (peOffset > view.length - 6 || view.toString('latin1', peOffset, peOffset + 4) !== 'PE\0\0') {
    throw new Error(`${arch} prebuild is not a PE image (missing PE signature)`);
  }

  const actual = view.readUInt16LE(peOffset + 4);
  if (actual !== expected) {
    const hexadecimal = (value) => `0x${value.toString(16).padStart(4, '0')}`;
    throw new Error(
      `${arch} prebuild has PE Machine ${hexadecimal(actual)}, expected ${hexadecimal(expected)}`,
    );
  }
}

async function main(argv) {
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
  if (targets.length === 0) throw new Error('no prebuild packages found under packages/');

  let missing = 0;
  for (const arch of targets) {
    const path = join(ROOT, 'packages', `conpty-win32-${arch}`, BINARY);
    let size;
    try {
      size = (await stat(path)).size;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      missing += 1;
      console[allowMissing ? 'log' : 'error'](
        `packages/conpty-win32-${arch}/${BINARY} is absent` +
          (allowMissing ? ' (not built in this tree)' : '; publishing it would ship an empty prebuild'),
      );
      continue;
    }
    if (size < MINIMUM_BYTES) {
      throw new Error(
        `packages/conpty-win32-${arch}/${BINARY} is ${size} bytes, below the ${MINIMUM_BYTES} expected of a real addon`,
      );
    }
    verifyPeMachine(await readFile(path), arch);
    console.log(`packages/conpty-win32-${arch}/${BINARY}: ${size} bytes, PE Machine ${arch}`);
  }

  if (missing > 0 && !allowMissing) throw new Error(`${missing} required prebuild(s) are absent`);
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
