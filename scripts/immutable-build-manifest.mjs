#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const IMMUTABLE_BUILD_MANIFEST_KIND = 'termwright-immutable-build-inputs';
export const IMMUTABLE_BUILD_MANIFEST_VERSION = 2;
export const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
export const defaultManifestPath = resolve(repositoryRoot, '.termwright', 'immutable-build-inputs.json');

const ROOT_BUILD_INPUTS = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  'tsconfig.json',
];

/** Writes the post-build fingerprint consumed read-only by test workers. */
export async function writeImmutableBuildManifest(options = {}) {
  const root = resolve(options.root ?? repositoryRoot);
  const manifestPath = resolve(options.manifestPath ?? defaultManifestPath);
  const sources = await buildInputFiles(root);
  const artifacts = await artifactFiles(root);
  if (artifacts.length === 0) {
    throw new Error('immutable build manifest needs at least one packages/*/dist artifact');
  }
  const manifest = {
    kind: IMMUTABLE_BUILD_MANIFEST_KIND,
    schemaVersion: IMMUTABLE_BUILD_MANIFEST_VERSION,
    sourceFingerprint: await fingerprint(root, sources),
    artifacts: Object.fromEntries(await Promise.all(artifacts.map(async (path) => [
      relativePath(root, path),
      await fileHash(path),
    ]))),
  };
  await mkdir(dirname(manifestPath), { recursive: true });
  const temporary = `${manifestPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await rename(temporary, manifestPath);
  return manifest;
}

/** Reads and structurally validates a build manifest without accepting partial state. */
export async function readImmutableBuildManifest(options = {}) {
  const manifestPath = resolve(options.manifestPath ?? defaultManifestPath);
  const value = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (value?.kind !== IMMUTABLE_BUILD_MANIFEST_KIND ||
      value.schemaVersion !== IMMUTABLE_BUILD_MANIFEST_VERSION ||
      typeof value.sourceFingerprint !== 'string' ||
      value.sourceFingerprint.length !== 64 ||
      !record(value.artifacts)) {
    throw new Error(`unsupported immutable build manifest ${manifestPath}`);
  }
  for (const [path, hash] of Object.entries(value.artifacts)) {
    if (path.length === 0 || typeof hash !== 'string' || hash.length !== 64) {
      throw new Error(`invalid immutable build artifact fingerprint ${JSON.stringify(path)}`);
    }
  }
  return value;
}

/** Verifies source freshness plus the exact immutable artifacts a consumer will execute. */
export async function verifyImmutableBuildInputs(entries, options = {}) {
  const root = resolve(options.root ?? repositoryRoot);
  const manifest = await readImmutableBuildManifest(options);
  const actualSourceFingerprint = await fingerprint(root, await buildInputFiles(root));
  const issues = [];
  if (actualSourceFingerprint !== manifest.sourceFingerprint) issues.push('workspace build sources changed');
  for (const entry of [...new Set(entries.map((path) => resolve(path)))]) {
    const name = relativePath(root, entry);
    const expected = manifest.artifacts[name];
    if (typeof expected !== 'string') {
      issues.push(`artifact is absent from the manifest: ${entry}`);
      continue;
    }
    let actual;
    try {
      actual = await fileHash(entry);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      issues.push(`artifact is missing: ${entry}`);
      continue;
    }
    if (actual !== expected) issues.push(`artifact changed after the build: ${entry}`);
  }
  return issues;
}

/** Pre-host barrier: proves no artifact in the completed workspace graph changed. */
export async function verifyImmutableWorkspaceBuild(options = {}) {
  const root = resolve(options.root ?? repositoryRoot);
  const manifest = await readImmutableBuildManifest(options);
  const currentArtifacts = await artifactFiles(root);
  return verifyImmutableBuildInputs(
    [
      ...Object.keys(manifest.artifacts).map((path) => resolve(root, path)),
      ...currentArtifacts,
    ],
    options,
  );
}

async function buildInputFiles(root) {
  const files = [];
  for (const name of ROOT_BUILD_INPUTS) {
    const path = resolve(root, name);
    try {
      await readFile(path);
      files.push(path);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  files.push(...await filesBelow(resolve(root, 'assets', 'brand'), () => true));
  const packagesRoot = resolve(root, 'packages');
  for (const entry of await readdir(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageRoot = resolve(packagesRoot, entry.name);
    const packageJsonPath = resolve(packageRoot, 'package.json');
    const packageJson = await optionalJson(packageJsonPath);
    if (packageJson !== undefined) files.push(packageJsonPath);
    files.push(...await packageBuildMetadata(packageRoot));
    if (packageJson !== undefined) files.push(...await reachableBuildScripts(packageRoot, packageJson));
    files.push(...await filesBelow(resolve(packageRoot, 'src'), isRuntimeBuildInput));
  }
  const rootPackageJson = await optionalJson(resolve(root, 'package.json'));
  if (rootPackageJson !== undefined) files.push(...await reachableBuildScripts(root, rootPackageJson));
  return [...new Set(files)].sort();
}

async function artifactFiles(root) {
  const files = [];
  const packagesRoot = resolve(root, 'packages');
  for (const entry of await readdir(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageRoot = resolve(packagesRoot, entry.name);
    files.push(...await filesBelow(resolve(packageRoot, 'dist'), () => true));
    const packageJson = await optionalJson(resolve(packageRoot, 'package.json'));
    if (packageJson !== undefined) files.push(...await declaredRuntimeArtifacts(packageRoot, packageJson));
  }
  return [...new Set(files)].sort();
}

async function packageBuildMetadata(packageRoot) {
  const entries = await readdir(packageRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && isPackageBuildMetadata(entry.name))
    .map((entry) => resolve(packageRoot, entry.name));
}

function isPackageBuildMetadata(name) {
  if (name.endsWith('.node')) return false;
  if (/^(?:README|LICENSE|NOTICE|CHANGELOG)(?:\.|$)/iu.test(name) || name.endsWith('.md')) return false;
  if (/^(?:vitest|playwright)(?:\.|-)/u.test(name)) return false;
  return true;
}

async function reachableBuildScripts(packageRoot, packageJson) {
  const scripts = record(packageJson.scripts) ? packageJson.scripts : {};
  const pending = ['build'];
  const visited = new Set();
  const files = [];
  while (pending.length > 0) {
    const name = pending.pop();
    if (name === undefined || visited.has(name)) continue;
    visited.add(name);
    const command = scripts[name];
    if (typeof command !== 'string') continue;
    for (const referenced of referencedPackageScripts(command)) pending.push(referenced);
    for (const referenced of referencedCommandFiles(command)) {
      const path = resolve(packageRoot, referenced);
      try {
        if ((await stat(path)).isFile()) files.push(path);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
  }
  return files;
}

function referencedPackageScripts(command) {
  const names = [];
  const pattern = /\b(?:pnpm|npm|yarn)\s+(?:run\s+)?([A-Za-z0-9:_-]+)/gu;
  for (const match of command.matchAll(pattern)) {
    if (match[1] !== undefined && match[1] !== 'exec') names.push(match[1]);
  }
  return names;
}

function referencedCommandFiles(command) {
  const files = [];
  const pattern = /"([^"]+)"|'([^']+)'|([^\s;&|]+)/gu;
  for (const match of command.matchAll(pattern)) {
    const token = match[1] ?? match[2] ?? match[3];
    if (token !== undefined && !token.startsWith('-')) files.push(token);
  }
  return files;
}

async function declaredRuntimeArtifacts(packageRoot, packageJson) {
  const realPackageRoot = await realpath(packageRoot);
  const declared = [];
  if (Array.isArray(packageJson.files)) {
    for (const value of packageJson.files) if (typeof value === 'string') declared.push(value);
  }
  collectExportTargets(packageJson.exports, declared);
  const optional = optionalRuntimeArtifacts(packageRoot, packageJson, declared);
  const artifacts = [];
  for (const name of [...new Set(declared)]) {
    if (hasPatternSyntax(name)) {
      throw new Error(`unsupported production artifact pattern ${JSON.stringify(name)} in ${packageRoot}`);
    }
    const path = resolve(packageRoot, name);
    relativePath(packageRoot, path);
    try {
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) {
        throw new Error(`symbolic production artifact is unsupported: ${path}`);
      }
      // Canonicalize both sides so macOS's /var -> /private/var alias does not
      // look like traversal. Symlinks remain forbidden: otherwise the target
      // could change without changing the declared package path.
      relativePath(realPackageRoot, await realpath(path));
      if (metadata.isDirectory()) artifacts.push(...await filesBelow(path, isRuntimeBuildInput));
      else if (metadata.isFile() && isRuntimeBuildInput(path)) artifacts.push(path);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      if (!optional.has(normalizeDeclaredPath(name))) {
        throw new Error(`declared production artifact is missing: ${path}`, { cause: error });
      }
    }
  }
  return artifacts;
}

function optionalRuntimeArtifacts(packageRoot, packageJson, declared) {
  const configured = packageJson.termwrightBuild?.optionalArtifacts;
  if (configured === undefined) return new Set();
  if (!Array.isArray(configured) || configured.length === 0) {
    throw new Error(`termwrightBuild.optionalArtifacts must be a non-empty array in ${packageRoot}`);
  }
  const platform = Array.isArray(packageJson.os) && packageJson.os.length === 1
    ? packageJson.os[0]
    : undefined;
  if (!['darwin', 'linux', 'win32'].includes(platform)) {
    throw new Error(`optional production artifacts require one supported native platform: ${packageRoot}`);
  }
  const build = packageJson.scripts?.build;
  if (typeof build !== 'string' || !build.includes('check-prebuild.mjs') || !build.includes('--allow-missing')) {
    throw new Error(`optional production artifacts require the certified --allow-missing prebuild guard: ${packageRoot}`);
  }
  const declaredNames = new Set(declared.map(normalizeDeclaredPath));
  const optional = new Set();
  for (const value of configured) {
    if (typeof value !== 'string' || !value.endsWith('.node') || hasPatternSyntax(value)) {
      throw new Error(`optional production artifact must be an exact .node path in ${packageRoot}`);
    }
    const normalized = normalizeDeclaredPath(value);
    relativePath(packageRoot, resolve(packageRoot, normalized));
    if (!declaredNames.has(normalized)) {
      throw new Error(`optional production artifact is not declared by files or exports: ${value}`);
    }
    optional.add(normalized);
  }
  return optional;
}

function normalizeDeclaredPath(path) {
  return path.replace(/^\.\//u, '');
}

function hasPatternSyntax(path) {
  return /[*?[\]{}!]/u.test(path);
}

function collectExportTargets(value, targets) {
  if (typeof value === 'string') {
    targets.push(value);
    return;
  }
  if (!record(value)) return;
  for (const child of Object.values(value)) collectExportTargets(child, targets);
}

async function optionalJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function filesBelow(root, include) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(path, include));
    else if (entry.isFile() && include(path)) files.push(path);
    else if (entry.isSymbolicLink()) throw new Error(`symbolic immutable build input is unsupported: ${path}`);
  }
  return files;
}

function isRuntimeBuildInput(path) {
  const normalized = path.split(sep).join('/');
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(normalized)) return false;
  if (normalized.includes('/__fixtures__/') || normalized.includes('/test-fixtures/')) return false;
  return !normalized.endsWith('.snap');
}

async function fingerprint(root, files) {
  const hash = createHash('sha256');
  for (const path of files) {
    hash.update(relativePath(root, path));
    hash.update('\0');
    hash.update(await fileHash(path));
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function fileHash(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

function relativePath(root, path) {
  const name = relative(root, path).split(sep).join('/');
  if (name === '..' || name.startsWith('../')) throw new Error(`${path} is outside immutable build root ${root}`);
  return name;
}

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3 || process.argv[2] !== '--write') {
    throw new Error('usage: immutable-build-manifest.mjs --write');
  }
  const manifest = await writeImmutableBuildManifest();
  process.stdout.write(`immutable build manifest: ${Object.keys(manifest.artifacts).length} artifacts\n`);
}
