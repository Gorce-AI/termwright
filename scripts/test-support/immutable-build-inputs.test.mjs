import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyImmutableWorkspaceBuild, writeImmutableBuildManifest } from '../immutable-build-manifest.mjs';
import { requireImmutableBuildInputs } from './immutable-build-inputs.mjs';

describe('immutable workspace build inputs', () => {
  const temporaryDirectories = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })));
  });

  async function workspace(options = {}) {
    const root = await mkdtemp(join(tmpdir(), 'termwright-built-input-'));
    temporaryDirectories.push(root);
    const packageRoot = join(root, 'packages', 'fixture');
    const entry = join(packageRoot, 'dist', 'index.js');
    const source = join(packageRoot, 'src', 'index.ts');
    const rootBuildScript = join(root, 'scripts', 'build-runtime.mjs');
    const bindingConfig = join(packageRoot, 'binding.gyp');
    const applicationConfig = join(packageRoot, 'tsconfig.app.json');
    const nativeArtifact = join(packageRoot, 'fixture.node');
    const runtimeDirectoryFile = join(packageRoot, 'runner', 'runner-entry.mjs');
    const exportedRuntimeFile = join(packageRoot, 'runtime-entry.mjs');
    const manifestPath = join(root, '.termwright', 'immutable-build-inputs.json');
    await mkdir(join(packageRoot, 'dist'), { recursive: true });
    await mkdir(join(packageRoot, 'src'), { recursive: true });
    await mkdir(join(root, 'scripts'), { recursive: true });
    await mkdir(join(packageRoot, 'runner'), { recursive: true });
    await writeFile(join(root, 'package.json'), '{"private":true,"scripts":{"build":"node scripts/build-runtime.mjs"}}\n');
    await writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
      name: 'fixture',
      files: ['dist', 'fixture.node', 'runner', ...(options.files ?? [])],
      exports: {
        './native': './fixture.node',
        './runtime': './runtime-entry.mjs',
      },
      ...(options.optionalNative === true ? {
        os: [options.optionalPlatform ?? 'win32'],
        cpu: ['x64'],
        termwrightBuild: { optionalArtifacts: ['fixture.node'] },
        scripts: { build: `node ../../scripts/check-prebuild.mjs ${options.optionalPlatform ?? 'win32'} x64 --allow-missing` },
      } : {}),
    }));
    await writeFile(rootBuildScript, 'export const buildVersion = 1;\n');
    await writeFile(bindingConfig, '{"targets":[]}\n');
    await writeFile(applicationConfig, '{"compilerOptions":{"target":"ES2023"}}\n');
    await writeFile(source, 'export const version = 1;\n');
    await writeFile(entry, 'export const version = 1;\n');
    if (options.optionalNative !== true) await writeFile(nativeArtifact, 'native-v1');
    await writeFile(runtimeDirectoryFile, 'export const runnerVersion = 1;\n');
    await writeFile(exportedRuntimeFile, 'export const runtimeVersion = 1;\n');
    await writeImmutableBuildManifest({ root, manifestPath });
    return {
      root,
      entry,
      source,
      rootBuildScript,
      bindingConfig,
      applicationConfig,
      nativeArtifact,
      runtimeDirectoryFile,
      exportedRuntimeFile,
      manifestPath,
    };
  }

  it('accepts a fresh artifact without mutating it', async () => {
    const built = await workspace();

    await expect(requireImmutableBuildInputs([built.entry, built.entry], {
      label: 'fixture package',
      root: built.root,
      manifestPath: built.manifestPath,
    })).resolves.toBeUndefined();
    await expect(readFile(built.entry, 'utf8')).resolves.toBe('export const version = 1;\n');
  });

  it('rejects a stale source even when the expected artifact still exists', async () => {
    const built = await workspace();
    await writeFile(built.source, 'export const version = 2;\n');

    await expect(requireImmutableBuildInputs([built.entry], {
      label: 'fixture package',
      root: built.root,
      manifestPath: built.manifestPath,
      buildCommand: 'pnpm build',
    })).rejects.toThrow(/fixture package.*workspace build sources changed.*pnpm build/u);
  });

  it('rejects an artifact changed after the manifest was recorded', async () => {
    const built = await workspace();
    await writeFile(built.entry, 'export const version = 99;\n');

    await expect(requireImmutableBuildInputs([built.entry], {
      label: 'fixture package',
      root: built.root,
      manifestPath: built.manifestPath,
    })).rejects.toThrow(/artifact changed after the build/u);
  });

  it('rejects a root script reached from the workspace build declaration after it changes', async () => {
    const built = await workspace();
    await writeFile(built.rootBuildScript, 'export const buildVersion = 2;\n');

    await expect(requireImmutableBuildInputs([built.entry], {
      label: 'fixture package',
      root: built.root,
      manifestPath: built.manifestPath,
    })).rejects.toThrow(/workspace build sources changed/u);
  });

  it.each([
    ['native binding config', 'bindingConfig'],
    ['secondary TypeScript config', 'applicationConfig'],
  ])('rejects a changed %s', async (_label, key) => {
    const built = await workspace();
    await writeFile(built[key], '{"changed":true}\n');

    await expect(requireImmutableBuildInputs([built.entry], {
      label: 'fixture package',
      root: built.root,
      manifestPath: built.manifestPath,
    })).rejects.toThrow(/workspace build sources changed/u);
  });

  it('rejects a changed package-root native artifact during the pre-host workspace barrier', async () => {
    const built = await workspace();
    await writeFile(built.nativeArtifact, 'native-v2');

    await expect(verifyImmutableWorkspaceBuild({
      root: built.root,
      manifestPath: built.manifestPath,
    })).resolves.toEqual([
      expect.stringContaining(`artifact changed after the build: ${built.nativeArtifact}`),
    ]);
  });

  it.each([
    ['declared runtime directory member', 'runtimeDirectoryFile'],
    ['declared runtime export', 'exportedRuntimeFile'],
  ])('rejects a changed %s during the pre-host workspace barrier', async (_label, key) => {
    const built = await workspace();
    await writeFile(built[key], 'export const changedAfterBuild = true;\n');

    const issues = await verifyImmutableWorkspaceBuild({
      root: built.root,
      manifestPath: built.manifestPath,
    });
    expect(issues).toContain(`artifact changed after the build: ${built[key]}`);
  });

  it.each([
    ['declared runtime directory', 'runtimeDirectoryFile', true],
    ['declared runtime export', 'exportedRuntimeFile', false],
  ])('fails manifest creation when a %s is missing', async (_label, key, directory) => {
    const built = await workspace();
    await rm(directory ? join(built.root, 'packages', 'fixture', 'runner') : built[key], {
      recursive: directory,
      force: true,
    });

    await expect(writeImmutableBuildManifest({
      root: built.root,
      manifestPath: built.manifestPath,
    })).rejects.toThrow(/declared production artifact is missing/u);
  });

  it.each(['darwin', 'linux', 'win32'])('permits a declaratively optional %s .node artifact to be absent', async (optionalPlatform) => {
    const built = await workspace({ optionalNative: true, optionalPlatform });
    const manifest = await writeImmutableBuildManifest({
      root: built.root,
      manifestPath: built.manifestPath,
    });

    expect(manifest.artifacts).not.toHaveProperty('packages/fixture/fixture.node');
    expect(Object.keys(manifest.artifacts)).toContain('packages/fixture/runner/runner-entry.mjs');
  });

  it('rejects a missing .node unless its package declares the certified allow-missing guard', async () => {
    const built = await workspace();
    await rm(built.nativeArtifact);
    await expect(writeImmutableBuildManifest({
      root: built.root,
      manifestPath: built.manifestPath,
    })).rejects.toThrow(/declared production artifact is missing/u);

    const packagePath = join(built.root, 'packages', 'fixture', 'package.json');
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
    packageJson.os = ['win32'];
    packageJson.termwrightBuild = { optionalArtifacts: ['fixture.node'] };
    packageJson.scripts = { build: 'node build-native.mjs --allow-missing' };
    await writeFile(packagePath, JSON.stringify(packageJson));
    await expect(writeImmutableBuildManifest({
      root: built.root,
      manifestPath: built.manifestPath,
    })).rejects.toThrow(/certified --allow-missing prebuild guard/u);
  });

  it('records the real repository package-root runtime graph', async () => {
    const manifestDirectory = await mkdtemp(join(tmpdir(), 'termwright-real-manifest-'));
    temporaryDirectories.push(manifestDirectory);
    const root = fileURLToPath(new URL('../..', import.meta.url));
    const manifest = await writeImmutableBuildManifest({
      root,
      manifestPath: join(manifestDirectory, 'manifest.json'),
    });

    expect(Object.keys(manifest.artifacts)).toEqual(expect.arrayContaining([
      'packages/ink/runner/runner-entry.mjs',
      'packages/probe-charm/upstream-patches/bubbletea/v1.3.10/manifest.json',
      'packages/probe-tview/upstream-patches/tview/v0.42.0/manifest.json',
    ]));
  });

  it('rejects a declared production path that traverses outside its package', async () => {
    await expect(workspace({ files: ['../outside-runtime'] }))
      .rejects.toThrow(/outside immutable build root/u);
  });

  it('names missing and unrecorded inputs without invoking a builder', async () => {
    const built = await workspace();
    const first = join(built.root, 'packages', 'fixture', 'dist', 'missing.js');
    const second = join(built.root, 'packages', 'fixture', 'dist', 'preload.js');

    await expect(requireImmutableBuildInputs([first, second], {
      label: 'fixture package',
      root: built.root,
      manifestPath: built.manifestPath,
      buildCommand: 'pnpm --filter fixture build',
    })).rejects.toThrow(
      new RegExp(`fixture package.*${escapeRegExp(first)}.*${escapeRegExp(second)}.*pnpm --filter fixture build.*must not build or clean`, 'u'),
    );
  });
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
