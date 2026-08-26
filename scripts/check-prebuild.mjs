#!/usr/bin/env node

import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BINARY = 'termwright_pty.node';
const MINIMUM_BYTES = 16 * 1024;
const TARGET = /^(darwin|linux|win32)-(arm64|x64)$/u;

const WINDOWS_MACHINE = Object.freeze({ x64: 0x8664, arm64: 0xaa64 });
const ELF_MACHINE = Object.freeze({ x64: 62, arm64: 183 });
const MACH_CPU = Object.freeze({ x64: 0x01000007, arm64: 0x0100000c });
const LC_BUILD_VERSION = 0x32;
const LC_VERSION_MIN_MACOSX = 0x24;
const REQUIRED_MACOS_MIN_VERSION = (13 << 16) | (5 << 8);
const LINUX_SYMBOL_FLOORS = Object.freeze({
  GLIBC: [2, 35],
  GLIBCXX: [3, 4, 29],
  CXXABI: [1, 3, 13],
});

function compareVersion(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function verifyLinuxSymbolFloor(view) {
  const strings = view.toString('latin1');
  for (const [family, maximum] of Object.entries(LINUX_SYMBOL_FLOORS)) {
    const pattern = new RegExp(`${family.replace('++', '\\+\\+')}_([0-9]+(?:\\.[0-9]+)+)`, 'gu');
    const versions = [...strings.matchAll(pattern)].map((match) =>
      match[1].split('.').map((part) => Number.parseInt(part, 10)));
    if (versions.length === 0) {
      throw new Error(`linux prebuild declares no ${family} symbol versions`);
    }
    const newest = versions.reduce((current, candidate) =>
      compareVersion(candidate, current) > 0 ? candidate : current);
    if (compareVersion(newest, maximum) > 0) {
      throw new Error(
        `linux prebuild requires ${family}_${newest.join('.')}, above Ubuntu 22.04 floor ${family}_${maximum.join('.')}`,
      );
    }
  }
}

function verifyMacOsMinimumVersion(view) {
  const commandCount = view.readUInt32LE(16);
  const commandsSize = view.readUInt32LE(20);
  let offset = 32;
  const end = offset + commandsSize;
  if (end > view.length) throw new Error('darwin prebuild has truncated Mach-O load commands');
  for (let index = 0; index < commandCount; index += 1) {
    if (offset > end - 8) throw new Error('darwin prebuild has a truncated Mach-O load command');
    const command = view.readUInt32LE(offset);
    const commandSize = view.readUInt32LE(offset + 4);
    if (commandSize < 16 || offset + commandSize > end) {
      throw new Error('darwin prebuild has an invalid Mach-O load command size');
    }
    if (command === LC_BUILD_VERSION || command === LC_VERSION_MIN_MACOSX) {
      const minimum = view.readUInt32LE(offset + 12 - (command === LC_VERSION_MIN_MACOSX ? 4 : 0));
      if (minimum !== REQUIRED_MACOS_MIN_VERSION) {
        const formatted = `${minimum >>> 16}.${(minimum >>> 8) & 0xff}.${minimum & 0xff}`;
        throw new Error(`darwin prebuild targets macOS ${formatted}, expected 13.5.0`);
      }
      return;
    }
    offset += commandSize;
  }
  throw new Error('darwin prebuild does not declare a minimum macOS version');
}

export function verifyBinaryArchitecture(bytes, platform, architecture) {
  const view = Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!Object.hasOwn(WINDOWS_MACHINE, architecture)) {
    throw new TypeError(`unsupported prebuild architecture: ${architecture}`);
  }
  if (platform === 'win32') {
    if (view.length < 0x40 || view[0] !== 0x4d || view[1] !== 0x5a) {
      throw new Error(`${platform}-${architecture} prebuild is not a PE image`);
    }
    const peOffset = view.readUInt32LE(0x3c);
    if (peOffset > view.length - 6 || view.toString('latin1', peOffset, peOffset + 4) !== 'PE\0\0' ||
        view.readUInt16LE(peOffset + 4) !== WINDOWS_MACHINE[architecture]) {
      throw new Error(`${platform}-${architecture} prebuild has the wrong PE architecture`);
    }
    return;
  }
  if (platform === 'linux') {
    if (view.length < 20 || view[0] !== 0x7f || view.toString('ascii', 1, 4) !== 'ELF' ||
        view[5] !== 1 || view.readUInt16LE(18) !== ELF_MACHINE[architecture]) {
      throw new Error(`${platform}-${architecture} prebuild has the wrong ELF architecture`);
    }
    verifyLinuxSymbolFloor(view);
    return;
  }
  if (platform === 'darwin') {
    if (view.length < 8 || view.readUInt32LE(0) !== 0xfeedfacf ||
        view.readUInt32LE(4) !== MACH_CPU[architecture]) {
      throw new Error(`${platform}-${architecture} prebuild has the wrong Mach-O architecture`);
    }
    verifyMacOsMinimumVersion(view);
    return;
  }
  throw new TypeError(`unsupported prebuild platform: ${platform}`);
}

async function discoveredTargets() {
  const entries = await readdir(join(ROOT, 'packages'), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('pty-'))
    .map((entry) => entry.name.slice('pty-'.length))
    .filter((target) => TARGET.test(target))
    .sort();
}

async function main(argv) {
  const allowMissing = argv.includes('--allow-missing');
  const named = argv.filter((value) => !value.startsWith('--'));
  const targets = argv.includes('--all') || named.length === 0
    ? await discoveredTargets()
    : [`${named[0]}-${named[1]}`];
  if (targets.length === 0) throw new Error('no PTY prebuild packages found');

  let missing = 0;
  for (const target of targets) {
    const match = TARGET.exec(target);
    if (match === null) throw new TypeError(`invalid PTY prebuild target: ${target}`);
    const [, platform, architecture] = match;
    const path = join(ROOT, 'packages', `pty-${target}`, BINARY);
    let size;
    try {
      size = (await stat(path)).size;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      missing += 1;
      console[allowMissing ? 'log' : 'error'](
        `packages/pty-${target}/${BINARY} is absent` +
          (allowMissing ? ' (not built in this tree)' : '; publishing it would be empty'),
      );
      continue;
    }
    if (size < MINIMUM_BYTES) {
      throw new Error(`packages/pty-${target}/${BINARY} is only ${size} bytes`);
    }
    verifyBinaryArchitecture(await readFile(path), platform, architecture);
    console.log(`packages/pty-${target}/${BINARY}: ${size} bytes`);
  }
  if (missing > 0 && !allowMissing) throw new Error(`${missing} required prebuild(s) are absent`);
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
