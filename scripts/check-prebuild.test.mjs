import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect } from 'vitest';
import { it as resourceAwareIt } from '../packages/test-provider-internal/src/index.ts';
import {
  assertSourceBuiltConptyLock,
  verifyBinaryArchitecture,
  verifyWindowsConptyBundle,
} from './check-prebuild.mjs';

const execute = promisify(execFile);
const it = resourceAwareIt.resources({ hostPressure: 'exclusive' });

function peFixture(machine) {
  const bytes = Buffer.alloc(0x80);
  bytes.write('MZ', 0, 'latin1');
  bytes.writeUInt32LE(0x40, 0x3c);
  bytes.write('PE\0\0', 0x40, 'latin1');
  bytes.writeUInt16LE(machine, 0x44);
  return bytes;
}

function elfFixture(machine) {
  const bytes = Buffer.alloc(128);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
  bytes.writeUInt16LE(machine, 18);
  bytes.write('GLIBC_2.35\0GLIBCXX_3.4.29\0CXXABI_1.3.13\0', 32, 'latin1');
  return bytes;
}

function machFixture(cpu, minimum = (13 << 16) | (5 << 8)) {
  const bytes = Buffer.alloc(56);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(cpu, 4);
  bytes.writeUInt32LE(1, 16);
  bytes.writeUInt32LE(24, 20);
  bytes.writeUInt32LE(0x32, 32);
  bytes.writeUInt32LE(24, 36);
  bytes.writeUInt32LE(1, 40);
  bytes.writeUInt32LE(minimum, 44);
  return bytes;
}

describe('native PTY prebuild architecture guard', () => {
  it('seals the complete x64 and ARM64 ConPTY runtime inventories', async () => {
    const packages = fileURLToPath(new URL('../packages/', import.meta.url));
    await expect(
      verifyWindowsConptyBundle(join(packages, 'pty-win32-x64'), 'x64'),
    ).resolves.toBeUndefined();
    await expect(
      verifyWindowsConptyBundle(join(packages, 'pty-win32-arm64'), 'arm64'),
    ).resolves.toBeUndefined();
  });

  it('rejects modified legal and SBOM metadata', async () => {
    const packages = fileURLToPath(new URL('../packages/', import.meta.url));
    const root = await mkdtemp(join(tmpdir(), 'tw-conpty-metadata-'));
    const candidate = join(root, 'pty-win32-x64');
    try {
      await cp(join(packages, 'pty-win32-x64'), candidate, { recursive: true });
      const sbom = join(candidate, 'vendor', 'SBOM.spdx.json');
      await writeFile(sbom, `${await readFile(sbom, 'utf8')}\n`);
      await expect(verifyWindowsConptyBundle(candidate, 'x64')).rejects.toThrow(
        /metadata SHA-256 mismatch/u,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects legacy lock and bundle manifest identities', async () => {
    expect(() =>
      assertSourceBuiltConptyLock({ schemaVersion: 2, url: 'https://example.invalid/legacy' }),
    ).toThrow(/legacy ConPTY lock key is forbidden: url/u);

    const packages = fileURLToPath(new URL('../packages/', import.meta.url));
    const root = await mkdtemp(join(tmpdir(), 'tw-conpty-legacy-manifest-'));
    const candidate = join(root, 'pty-win32-x64');
    try {
      await cp(join(packages, 'pty-win32-x64'), candidate, { recursive: true });
      const manifestPath = join(candidate, 'vendor', 'conpty-manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      await writeFile(
        manifestPath,
        `${JSON.stringify({ ...manifest, version: 'legacy' }, null, 2)}\n`,
      );
      await expect(verifyWindowsConptyBundle(candidate, 'x64')).rejects.toThrow(
        /legacy Windows ConPTY bundle manifest key is forbidden: version/u,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('accepts the exact AMD64 and ARM64 PE Machine values', () => {
    expect(() => verifyBinaryArchitecture(peFixture(0x8664), 'win32', 'x64')).not.toThrow();
    expect(() => verifyBinaryArchitecture(peFixture(0xaa64), 'win32', 'arm64')).not.toThrow();
  });

  it('accepts exact ELF and Mach-O architectures', () => {
    expect(() => verifyBinaryArchitecture(elfFixture(62), 'linux', 'x64')).not.toThrow();
    expect(() => verifyBinaryArchitecture(elfFixture(183), 'linux', 'arm64')).not.toThrow();
    expect(() => verifyBinaryArchitecture(machFixture(0x01000007), 'darwin', 'x64')).not.toThrow();
    expect(() =>
      verifyBinaryArchitecture(machFixture(0x0100000c), 'darwin', 'arm64'),
    ).not.toThrow();
  });

  it('rejects a binary packaged for another platform or architecture', () => {
    expect(() => verifyBinaryArchitecture(peFixture(0x8664), 'win32', 'arm64')).toThrow(
      /wrong PE/u,
    );
    expect(() => verifyBinaryArchitecture(elfFixture(62), 'linux', 'arm64')).toThrow(/wrong ELF/u);
    expect(() => verifyBinaryArchitecture(machFixture(0x0100000c), 'darwin', 'x64')).toThrow(
      /wrong Mach-O/u,
    );
  });

  it('rejects a Darwin binary whose deployment target drifted from 13.5', () => {
    expect(() =>
      verifyBinaryArchitecture(machFixture(0x0100000c, 15 << 16), 'darwin', 'arm64'),
    ).toThrow(/targets macOS 15\.0\.0, expected 13\.5\.0/u);
  });

  it('rejects Linux symbols above the documented Ubuntu 22.04 ABI floor', () => {
    const bytes = elfFixture(183);
    bytes.write('GLIBC_2.36\0', 96, 'latin1');
    expect(() => verifyBinaryArchitecture(bytes, 'linux', 'arm64')).toThrow(
      /requires GLIBC_2\.36, above Ubuntu 22\.04 floor/u,
    );
  });

  it('keeps an absent development prebuild optional only with --allow-missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'termwright-check-prebuild-'));
    const script = join(root, 'scripts', 'check-prebuild.mjs');
    try {
      await mkdir(join(root, 'scripts'), { recursive: true });
      await mkdir(join(root, 'packages', 'pty-darwin-arm64'), { recursive: true });
      await cp(fileURLToPath(new URL('./check-prebuild.mjs', import.meta.url)), script);
      await cp(
        fileURLToPath(new URL('./is-direct-execution.mjs', import.meta.url)),
        join(root, 'scripts', 'is-direct-execution.mjs'),
      );
      const executableScript = await realpath(script);
      await expect(
        execute(process.execPath, [executableScript, 'darwin', 'arm64', '--allow-missing']),
      ).resolves.toMatchObject({
        stdout: expect.stringContaining('is absent (not built in this tree)'),
      });
      await expect(
        execute(process.execPath, [executableScript, 'darwin', 'arm64']),
      ).rejects.toMatchObject({ code: 1 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
