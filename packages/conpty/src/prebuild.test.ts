import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { candidatePaths } from './index.js';

const packageRoot = new URL('../', import.meta.url);

async function manifest(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(fileURLToPath(new URL(path, packageRoot)), 'utf8')) as Record<
    string,
    unknown
  >;
}

/**
 * The published shape, checked where it is written rather than where it breaks.
 *
 * A prebuild that is not declared, or declared under a name the loader never
 * asks for, produces no error anywhere: the install succeeds, the addon is
 * absent, and the driver falls back to the backend the prebuild existed to
 * replace. These read the manifests directly because that silence is the
 * whole hazard.
 */
describe('the prebuild contract', () => {
  it('looks for the local build before any published prebuild', () => {
    const [first, second] = candidatePaths('x64');
    // A working tree must test the addon it just compiled. Preferring an
    // installed prebuild would have CI certify the previous release while the
    // change under review sits unbuilt beside it.
    expect(first).toBe('../build/Release/termwright_conpty.node');
    expect(second).toBe('@termwright/conpty-win32-x64/termwright_conpty.node');
  });

  it('asks for the running architecture, not a fixed one', () => {
    expect(candidatePaths('arm64')[1]).toBe(
      '@termwright/conpty-win32-arm64/termwright_conpty.node',
    );
  });

  it('declares every architecture it knows how to ask for', async () => {
    const parent = await manifest('package.json');
    const optional = (parent['optionalDependencies'] ?? {}) as Record<string, string>;
    for (const architecture of ['x64', 'arm64']) {
      const name = `@termwright/conpty-win32-${architecture}`;
      expect(candidatePaths(architecture)[1]?.startsWith(name)).toBe(true);
      // Optional, so a platform without a prebuild installs rather than
      // failing; declared, so the one with a prebuild actually receives it.
      expect(optional[name]).toBeDefined();
    }
  });

  it('restricts each prebuild to the one platform and architecture it is for', async () => {
    for (const architecture of ['x64', 'arm64']) {
      const child = await manifest(`../conpty-win32-${architecture}/package.json`);
      expect(child['os']).toEqual(['win32']);
      expect(child['cpu']).toEqual([architecture]);
      // Without this the package publishes empty and installs cleanly, which
      // is the failure this whole file exists to prevent.
      expect(child['files']).toEqual(['termwright_conpty.node']);
      expect(child['exports']).toMatchObject({
        './termwright_conpty.node': './termwright_conpty.node',
      });
    }
  });

  it('publishes no build recipe, because npm would run it', async () => {
    const parent = await manifest('package.json');
    const files = parent['files'] as readonly string[];
    // npm compiles any installed package that has a binding.gyp at its root,
    // with no script asked for and no toolchain guaranteed. Shipping one made
    // every install of this package invoke node-gyp and fail on a machine
    // without Visual Studio — the exact requirement prebuilds remove.
    expect(files).not.toContain('binding.gyp');
    for (const hook of ['install', 'preinstall', 'postinstall']) {
      expect(parent['scripts']).not.toHaveProperty(hook);
    }
    // The addon headers are needed to compile and never to run. Leaving them
    // a runtime dependency makes every consumer fetch a build-time package.
    expect(parent['dependencies'] ?? {}).not.toHaveProperty('node-addon-api');
  });

  it('keeps the prebuilds at the version of the package that loads them', async () => {
    const parent = await manifest('package.json');
    for (const architecture of ['x64', 'arm64']) {
      const child = await manifest(`../conpty-win32-${architecture}/package.json`);
      // A prebuild from another release is an addon compiled against another
      // source. Same version, or the pairing means nothing.
      expect(child['version']).toBe(parent['version']);
    }
  });
});
