#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { canonicalJson, compareVersions, parseVersion } from './discover-framework-candidates.mjs';
import { safeExtractTarGz } from './safe-tar.mjs';

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function safeRelative(value, field) {
  if (typeof value !== 'string' || value.length === 0 || isAbsolute(value) || value.includes('\\') || value.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`${field} must be a normalized relative path`);
  }
  return value;
}

const hash = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

export function assertArtifactSha256(bytes, expected, label) {
  const actual = hash(bytes);
  const normalized = typeof expected === 'string' && expected.startsWith('sha256:') ? expected : `sha256:${String(expected)}`;
  if (actual !== normalized) throw new Error(`${label}: downloaded archive hashes ${actual}, expected ${normalized}`);
}

export async function digestTree(directory) {
  const files = [];
  const visit = async (current) => {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push({ path: relative(directory, path).split(sep).join('/'), sha256: hash(await readFile(path)) });
      else throw new Error('candidate patch bundles may contain only directories and regular files');
    }
  };
  await visit(directory);
  return hash(canonicalJson(files));
}

async function latestTemplate(rootDir, patchRoot, candidateVersion) {
  const base = join(rootDir, safeRelative(patchRoot, 'patchRoot'));
  const versions = [];
  for (const entry of await readdir(base, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === candidateVersion) continue;
    const manifestPath = join(base, entry.name, 'manifest.json');
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      versions.push({ version: manifest.frameworkVersion, directory: join(base, entry.name), manifest });
    } catch {}
  }
  const candidateMajor = parseVersion(candidateVersion)?.major;
  const sameLine = versions.filter((entry) => candidateMajor === undefined || parseVersion(entry.version)?.major === candidateMajor);
  sameLine.sort((a, b) => compareVersions(b.version, a.version));
  if (sameLine.length === 0) throw new Error(`no audited transform template exists for ${candidateVersion} below ${patchRoot}`);
  return sameLine[0];
}

export async function preparePatchBundle({ rootDir = root, candidate, sourceRoot, outputDirectory, sourceRevision }) {
  if (candidate.mode !== 'patch' || candidate.patch?.status !== 'needs-patch') throw new Error(`${candidate.id}: candidate does not need a generated patch`);
  if (typeof sourceRevision !== 'string' || sourceRevision.length < 7) throw new Error('sourceRevision is required');
  const streamRoot = safeRelative(candidate.patch.path, 'candidate.patch.path').split('/').slice(0, -2).join('/');
  const template = await latestTemplate(rootDir, streamRoot, candidate.version);
  const destination = join(outputDirectory, 'patch');
  await mkdir(outputDirectory, { recursive: true });
  await cp(template.directory, destination, { recursive: true, errorOnExist: true });
  const manifestPath = join(destination, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const oldVersion = manifest.frameworkVersion;
  manifest.frameworkVersion = candidate.version;
  for (const [index, entry] of manifest.patched.entries()) {
    const target = safeRelative(entry.path, `patched[${index}].path`);
    const patch = safeRelative(entry.patch, `patched[${index}].patch`);
    const targetPath = join(sourceRoot, target);
    entry.sha256Before = hash(await readFile(targetPath));
    try {
      await exec('patch', ['--batch', '--fuzz=0', '-p1', '-i', join(destination, patch)], { cwd: sourceRoot });
    } catch (error) {
      throw new Error(`${candidate.id}: audited transform no longer applies to ${target}: ${error.stderr || error.message}`);
    }
    entry.sha256After = hash(await readFile(targetPath));
  }
  for (const [index, entry] of manifest.added.entries()) {
    const source = safeRelative(entry.source, `added[${index}].source`);
    const path = join(destination, source);
    const contents = (await readFile(path, 'utf8')).replaceAll(oldVersion, candidate.version);
    await writeFile(path, contents);
    entry.sha256 = hash(contents);
  }
  await writeFile(manifestPath, canonicalJson(manifest));
  const patchTreeDigest = await digestTree(destination);
  const metadata = {
    schemaVersion: 1,
    kind: 'termwright-generated-patch-bundle',
    candidateId: candidate.id,
    candidateDigest: candidate.candidateDigest,
    sourceRevision,
    targetPath: candidate.patch.path.split('/').slice(0, -1).join('/'),
    template: { frameworkVersion: oldVersion, patchSetVersion: template.manifest.patchSetVersion },
    patchTreeDigest,
  };
  await writeFile(join(outputDirectory, 'bundle.json'), canonicalJson(metadata));
  return { metadata, manifest, destination };
}

export async function prepareSyntheticPatchBundle(options) {
  const directory = await mkdtemp(join(tmpdir(), 'termwright-candidate-'));
  return preparePatchBundle({ ...options, outputDirectory: options.outputDirectory ?? directory });
}

export async function materializeCandidateSource(candidate) {
  const directory = await mkdtemp(join(tmpdir(), 'termwright-upstream-'));
  const sourceRoot = join(directory, 'source');
  await mkdir(sourceRoot);
  if (candidate.registry === 'go') {
    const result = JSON.parse((await exec('go', ['mod', 'download', '-json', `${candidate.package}@${candidate.version}`], { env: { ...process.env, GOFLAGS: '', GOWORK: 'off', GOPROXY: 'https://proxy.golang.org', GOSUMDB: 'sum.golang.org' } })).stdout);
    await cp(result.Dir, sourceRoot, { recursive: true });
  } else if (candidate.registry === 'crates.io') {
    const response = await fetch(`https://crates.io/api/v1/crates/${encodeURIComponent(candidate.package)}/${encodeURIComponent(candidate.version)}/download`, { headers: { 'user-agent': 'termwright-compatibility-workflow/1' } });
    if (!response.ok) throw new Error(`${candidate.id}: crates.io source download failed with ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assertArtifactSha256(bytes, candidate.source?.checksum, candidate.id);
    await safeExtractTarGz(bytes, sourceRoot, { stripComponents: 1 });
  } else throw new Error(`${candidate.id}: patch preparation does not support ${candidate.registry}`);
  return sourceRoot;
}

export function proposeCompatibilityUpdate(registry, candidate, manifest) {
  const next = structuredClone(registry);
  const framework = next.frameworks?.find((entry) => entry.id === candidate.frameworkId);
  if (framework === undefined) throw new Error(`${candidate.id}: compatibility framework row is missing`);
  const patchSets = framework.instrumentation?.patchSets;
  if (!Array.isArray(patchSets)) throw new Error(`${candidate.id}: certified patch-set declarations are missing`);
  const existing = patchSets.find((entry) => entry.name === candidate.package && entry.version === candidate.version);
  if (existing === undefined) patchSets.push({ name: candidate.package, version: candidate.version, patchSetVersion: manifest.patchSetVersion });
  else if (existing.patchSetVersion !== manifest.patchSetVersion) throw new Error(`${candidate.id}: patch-set declaration conflicts with the generated manifest`);
  patchSets.sort((a, b) => a.name.localeCompare(b.name) || compareVersions(a.version, b.version));
  return next;
}

export function recordExecutableVariant(registry, candidate, resolution) {
  const next = structuredClone(registry);
  const framework = next.frameworks?.find((entry) => entry.id === candidate.frameworkId);
  if (framework === undefined) throw new Error(`${candidate.id}: compatibility framework row is missing`);
  if (typeof resolution?.frameworkVersion !== 'string' || resolution.frameworkVersion.length === 0 || !Array.isArray(resolution.modules) || resolution.modules.length === 0) {
    throw new Error(`${candidate.id}: behavioral certification produced no executable module resolution`);
  }
  const modules = resolution.modules.map((module) => ({ name: module.name, version: module.version, ...(module.optional === true ? { optional: true } : {}) }));
  if (new Set(modules.map((module) => module.name)).size !== modules.length) throw new Error(`${candidate.id}: executable variant resolves one module more than once`);
  if (!modules.some((module) => module.name === candidate.package && module.version === candidate.version)) throw new Error(`${candidate.id}: executable variant does not contain the exact candidate`);
  for (const module of modules) {
    if (!framework.instrumentation.patchSets.some((patch) => patch.name === module.name && patch.version === module.version)) {
      throw new Error(`${candidate.id}: executable variant uses uncertified patch ${module.name}@${module.version}`);
    }
  }
  modules.sort((a, b) => a.name.localeCompare(b.name) || compareVersions(a.version, b.version));
  const signature = canonicalJson({ frameworkVersion: resolution.frameworkVersion, modules });
  const id = `${candidate.frameworkId}-${resolution.frameworkVersion}-${createHash('sha256').update(signature).digest('hex').slice(0, 12)}`.replace(/[^A-Za-z0-9._-]/gu, '-');
  const variants = framework.instrumentation.variants;
  const existing = variants.find((variant) => canonicalJson({ frameworkVersion: variant.frameworkVersion, modules: variant.modules }) === signature);
  if (existing === undefined) variants.push({ id, frameworkVersion: resolution.frameworkVersion, modules });
  variants.sort((a, b) => a.id.localeCompare(b.id));
  if (framework.frameworkPackage === candidate.package && !framework.versions.verified.includes(candidate.version)) {
    framework.versions.verified.push(candidate.version);
    framework.versions.verified.sort(compareVersions);
    if (framework.versions.policy === 'exact') framework.versions.declared = framework.versions.verified.join(' or ');
  }
  return next;
}
