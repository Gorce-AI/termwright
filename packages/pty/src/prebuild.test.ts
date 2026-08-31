import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { candidatePaths } from './index.js';

const packageRoot = new URL('../', import.meta.url);
const targets = [
  ['darwin', 'arm64'],
  ['darwin', 'x64'],
  ['linux', 'arm64'],
  ['linux', 'x64'],
  ['win32', 'arm64'],
  ['win32', 'x64'],
] as const;

const windowsVendorFiles = {
  arm64: [
    'vendor/conpty.dll',
    'vendor/arm64/OpenConsole.exe',
    'vendor/conpty-manifest.json',
    'vendor/LICENSE.microsoft-terminal.txt',
    'vendor/NOTICE.microsoft-terminal.md',
    'vendor/THIRD_PARTY_NOTICES.md',
    'vendor/SBOM.spdx.json',
  ],
  x64: [
    'vendor/conpty.dll',
    'vendor/x64/OpenConsole.exe',
    'vendor/arm64/OpenConsole.exe',
    'vendor/conpty-manifest.json',
    'vendor/LICENSE.microsoft-terminal.txt',
    'vendor/NOTICE.microsoft-terminal.md',
    'vendor/THIRD_PARTY_NOTICES.md',
    'vendor/SBOM.spdx.json',
  ],
} as const;

async function manifest(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(fileURLToPath(new URL(path, packageRoot)), 'utf8')) as Record<
    string,
    unknown
  >;
}

describe('the universal PTY prebuild contract', () => {
  it('loads a working-tree addon before the exact platform package', () => {
    expect(candidatePaths('darwin', 'arm64')).toEqual([
      '../build/Release/termwright_pty.node',
      '@termwright/pty-darwin-arm64/termwright_pty.node',
    ]);
  });

  it('declares and validates all six supported platform packages', async () => {
    const parent = await manifest('package.json');
    const optional = parent.optionalDependencies as Record<string, string>;
    for (const [platform, architecture] of targets) {
      const name = `@termwright/pty-${platform}-${architecture}`;
      expect(candidatePaths(platform, architecture)[1]).toBe(`${name}/termwright_pty.node`);
      expect(optional[name]).toBeDefined();
      const child = await manifest(`../pty-${platform}-${architecture}/package.json`);
      expect(child.os).toEqual([platform]);
      expect(child.cpu).toEqual([architecture]);
      expect(child.libc).toEqual(platform === 'linux' ? ['glibc'] : undefined);
      const expectedFiles =
        platform === 'win32'
          ? ['termwright_pty.node', ...windowsVendorFiles[architecture]]
          : ['termwright_pty.node'];
      expect(child.files).toEqual(expectedFiles);
      expect((child.termwrightBuild as { optionalArtifacts: string[] }).optionalArtifacts).toEqual([
        'termwright_pty.node',
      ]);
      expect(child.exports).toEqual({ './termwright_pty.node': './termwright_pty.node' });
      expect(child.version).toBe(parent.version);
    }
  });

  it('ships no install hook or native build recipe to consumers', async () => {
    const parent = await manifest('package.json');
    expect(parent.files).not.toContain('binding.gyp');
    for (const hook of ['install', 'preinstall', 'postinstall']) {
      expect(parent.scripts).not.toHaveProperty(hook);
    }
    expect(parent.dependencies ?? {}).not.toHaveProperty('node-addon-api');
  });
});
