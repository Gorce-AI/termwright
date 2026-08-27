#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { canonicalJson, compareVersions, parseVersion, trustedGoEnvironment } from './discover-framework-candidates.mjs';
import { safeExtractTarGz } from './safe-tar.mjs';
import { finishWithCleanups } from './cleanup-resources.mjs';

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const materializedSourceDirectories = new WeakMap();
const disposedMaterializedSourceLeases = new WeakSet();

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
      else if (entry.isFile())
        files.push({
          path: relative(directory, path).split(sep).join('/'),
          sha256: hash(await readFile(path)),
        });
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
      versions.push({
        version: manifest.frameworkVersion,
        directory: join(base, entry.name),
        manifest,
      });
    } catch {}
  }
  const candidateMajor = parseVersion(candidateVersion)?.major;
  const sameLine = versions.filter((entry) => candidateMajor === undefined || parseVersion(entry.version)?.major === candidateMajor);
  sameLine.sort((a, b) => compareVersions(b.version, a.version));
  if (sameLine.length === 0) throw new Error(`no audited transform template exists for ${candidateVersion} below ${patchRoot}`);
  return sameLine[0];
}

async function materializeTemplate(template, destination) {
  await cp(template.directory, destination, {
    recursive: true,
    errorOnExist: true,
  });
}

async function preparePatchBundleInner({ rootDir = root, candidate, sourceRoot, outputDirectory, sourceRevision }) {
  if (candidate.mode !== 'patch' || candidate.patch?.status !== 'needs-patch') throw new Error(`${candidate.id}: candidate does not need a generated patch`);
  if (typeof sourceRevision !== 'string' || sourceRevision.length < 7) throw new Error('sourceRevision is required');
  const streamRoot = safeRelative(candidate.patch.path, 'candidate.patch.path').split('/').slice(0, -2).join('/');
  const selectedTemplate = await latestTemplate(rootDir, streamRoot, candidate.version);
  const destination = join(outputDirectory, 'patch');
  await mkdir(outputDirectory, { recursive: true });
  await materializeTemplate(selectedTemplate, destination);
  const manifestPath = join(destination, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const oldVersion = manifest.frameworkVersion;
  manifest.frameworkVersion = candidate.version;
  for (const [index, entry] of manifest.patched.entries()) {
    const target = safeRelative(entry.path, `patched[${index}].path`);
    const patch = safeRelative(entry.patch, `patched[${index}].patch`);
    const targetPath = join(sourceRoot, target);
    entry.sha256Before = hash(await readFile(targetPath));
    // `git apply`, not `patch`. Which `patch.exe` a machine has is whatever
    // happens to be first in PATH — a Windows runner with Strawberry Perl
    // installed supplies GNU patch 2.5.9, which aborts on an internal
    // assertion here. An audited transform that applies or does not apply
    // depending on the host's PATH is not audited, and git is already a
    // requirement of every path that reaches this script.
    try {
      await exec('git', ['apply', '--unsafe-paths', '-p1', `--directory=.`, join(destination, patch)], {
        cwd: sourceRoot,
      });
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
    template: {
      frameworkVersion: oldVersion,
      patchSetVersion: selectedTemplate.manifest.patchSetVersion,
    },
    patchTreeDigest,
  };
  await writeFile(join(outputDirectory, 'bundle.json'), canonicalJson(metadata));
  return { metadata, manifest, destination };
}

export async function preparePatchBundles(requests) {
  if (!Array.isArray(requests) || requests.length === 0) throw new TypeError('at least one patch bundle request is required');
  for (const request of requests) {
    if (request.candidate?.mode !== 'patch' || request.candidate.patch?.status !== 'needs-patch') {
      throw new Error(`${request.candidate?.id}: candidate does not need a generated patch`);
    }
    if (typeof request.sourceRevision !== 'string' || request.sourceRevision.length < 7) throw new Error('sourceRevision is required');
  }
  return Promise.all(requests.map((request) => preparePatchBundleInner(request)));
}

export async function preparePatchBundle(request) {
  const [prepared] = await preparePatchBundles([request]);
  return prepared;
}

export async function prepareSyntheticPatchBundle(options) {
  const directory = await mkdtemp(join(tmpdir(), 'termwright-candidate-'));
  return preparePatchBundle({
    ...options,
    outputDirectory: options.outputDirectory ?? directory,
  });
}

export async function assertGoDownloadBinding(result, candidate) {
  if (typeof result?.Dir !== 'string' || typeof result?.Zip !== 'string' || result.Sum !== candidate.source?.sum || result.GoModSum !== candidate.source?.goModSum)
    throw new Error(`${candidate.id}: downloaded Go module identity does not match discovery`);
  const zipSha256 = createHash('sha256')
    .update(await readFile(result.Zip))
    .digest('hex');
  if (zipSha256 !== candidate.source?.zipSha256) {
    throw new Error(`${candidate.id}: downloaded Go module archive does not match discovery`);
  }
}

export async function materializeCandidateSource(candidate) {
  const lease = await createMaterializedCandidateSourceLease();
  const { sourceRoot } = lease;
  try {
    await mkdir(sourceRoot);
    if (candidate.registry === 'go') {
      const result = JSON.parse(
        (
          await exec('go', ['mod', 'download', '-json', `${candidate.package}@${candidate.version}`], {
            env: trustedGoEnvironment({
              GOFLAGS: '',
              GOWORK: 'off',
              GOPROXY: 'https://proxy.golang.org',
              GOSUMDB: 'sum.golang.org',
            }),
          })
        ).stdout,
      );
      await assertGoDownloadBinding(result, candidate);
      await cp(result.Dir, sourceRoot, { recursive: true });
    } else if (candidate.registry === 'crates.io') {
      const response = await fetch(`https://crates.io/api/v1/crates/${encodeURIComponent(candidate.package)}/${encodeURIComponent(candidate.version)}/download`, {
        headers: { 'user-agent': 'termwright-compatibility-workflow/1' },
      });
      if (!response.ok) throw new Error(`${candidate.id}: crates.io source download failed with ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      assertArtifactSha256(bytes, candidate.source?.checksum, candidate.id);
      await safeExtractTarGz(bytes, sourceRoot, { stripComponents: 1 });
    } else throw new Error(`${candidate.id}: patch preparation does not support ${candidate.registry}`);
    // Go's module cache is intentionally read-only. A private materialization
    // is a working tree, not a cache mirror: transforms must be able to edit it
    // and the owning process must be able to remove every directory afterwards.
    await makeOwnedTreeWritable(sourceRoot);
    return lease;
  } catch (error) {
    await finishWithCleanups({
      hasPrimary: true,
      primaryError: error,
      cleanups: [async () => removeMaterializedCandidateSource(lease)],
      message: `${candidate.id}: source materialization and cleanup failed`,
    });
  }
}

/** Creates a private source lease. Exported only for ownership tests. */
export async function createMaterializedCandidateSourceLease() {
  const directory = resolve(await mkdtemp(join(tmpdir(), 'termwright-upstream-')));
  const lease = Object.freeze({ sourceRoot: join(directory, 'source') });
  materializedSourceDirectories.set(lease, directory);
  return lease;
}

async function makeOwnedTreeWritable(path) {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink()) return;
  await chmod(path, metadata.mode | (metadata.isDirectory() ? 0o700 : 0o600));
  if (!metadata.isDirectory()) return;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    await makeOwnedTreeWritable(join(path, entry.name));
  }
}

/** Removes only the exact opaque lease created by {@link materializeCandidateSource}. */
export async function removeMaterializedCandidateSource(lease) {
  if (typeof lease === 'object' && lease !== null && disposedMaterializedSourceLeases.has(lease)) return;
  const directory = typeof lease === 'object' && lease !== null ? materializedSourceDirectories.get(lease) : undefined;
  if (directory === undefined) throw new Error('refusing to remove a source tree not owned by Termwright');
  await makeOwnedTreeWritable(directory);
  await rm(directory, { recursive: true, force: true });
  materializedSourceDirectories.delete(lease);
  disposedMaterializedSourceLeases.add(lease);
}

export function proposeCompatibilityUpdate(registry, candidate, manifest) {
  const next = structuredClone(registry);
  const framework = next.frameworks?.find((entry) => entry.id === candidate.frameworkId);
  if (framework === undefined) throw new Error(`${candidate.id}: compatibility framework row is missing`);
  if (manifest.framework !== candidate.package || manifest.frameworkVersion !== candidate.version) {
    throw new Error(`${candidate.id}: patch manifest targets another exact framework artifact`);
  }
  const patchSets = framework.instrumentation?.patchSets;
  if (!Array.isArray(patchSets)) throw new Error(`${candidate.id}: certified patch-set declarations are missing`);
  const existing = patchSets.find((entry) => entry.name === candidate.package && entry.version === candidate.version);
  if (existing === undefined)
    patchSets.push({
      name: candidate.package,
      version: candidate.version,
      patchSetVersion: manifest.patchSetVersion,
    });
  else if (existing.patchSetVersion !== manifest.patchSetVersion) throw new Error(`${candidate.id}: patch-set declaration conflicts with the generated manifest`);
  patchSets.sort((a, b) => a.name.localeCompare(b.name) || compareVersions(a.version, b.version));
  const checksumSources = framework.certification?.checksumSources;
  if (!Array.isArray(checksumSources) || typeof candidate.patch?.path !== 'string') {
    throw new Error(`${candidate.id}: exact patch certification metadata is incomplete`);
  }
  if (!checksumSources.includes(candidate.patch.path)) checksumSources.push(candidate.patch.path);
  checksumSources.sort();
  return next;
}

export function recordExecutableVariant(registry, candidate, resolution) {
  const next = structuredClone(registry);
  const framework = next.frameworks?.find((entry) => entry.id === candidate.frameworkId);
  if (framework === undefined) throw new Error(`${candidate.id}: compatibility framework row is missing`);
  if (typeof resolution?.frameworkVersion !== 'string' || resolution.frameworkVersion.length === 0 || !Array.isArray(resolution.modules) || resolution.modules.length === 0) {
    throw new Error(`${candidate.id}: behavioral certification produced no executable module resolution`);
  }
  const modules = resolution.modules.map((module) => ({
    name: module.name,
    version: module.version,
    ...(module.optional === true ? { optional: true } : {}),
  }));
  if (new Set(modules.map((module) => module.name)).size !== modules.length) throw new Error(`${candidate.id}: executable variant resolves one module more than once`);
  if (!modules.some((module) => module.name === candidate.package && module.version === candidate.version)) throw new Error(`${candidate.id}: executable variant does not contain the exact candidate`);
  const previouslyCertifiedModules = new Set(framework.instrumentation.variants.flatMap((variant) => variant.modules.map((module) => `${module.name}@${module.version}`)));
  for (const module of modules) {
    const candidateCapabilityModule =
      candidate.mode === 'capability' && module.name === candidate.package && module.version === candidate.version && candidate.capabilityStrategy === 'compile-conformance';
    const exactPatchModule = framework.instrumentation.patchSets.some((patch) => patch.name === module.name && patch.version === module.version);
    const certifiedCapabilityCompanion = framework.versions.policy === 'capability' && previouslyCertifiedModules.has(`${module.name}@${module.version}`);
    if (!candidateCapabilityModule && !exactPatchModule && !certifiedCapabilityCompanion) {
      throw new Error(`${candidate.id}: executable variant uses uncertified module ${module.name}@${module.version}`);
    }
  }
  modules.sort((a, b) => a.name.localeCompare(b.name) || compareVersions(a.version, b.version));
  // Only an already-certified variant may establish which module owns the
  // framework version. The candidate variant must not be able to authorize
  // itself as primary merely by sharing the same version string.
  const primaryModules = new Set(
    framework.instrumentation.variants.flatMap((variant) => variant.modules.filter((module) => module.optional !== true && module.version === variant.frameworkVersion).map((module) => module.name)),
  );
  const signature = canonicalJson({
    frameworkVersion: resolution.frameworkVersion,
    modules,
  });
  const id = `${candidate.frameworkId}-${resolution.frameworkVersion}-${createHash('sha256').update(signature).digest('hex').slice(0, 12)}`.replace(/[^A-Za-z0-9._-]/gu, '-');
  const variants = framework.instrumentation.variants;
  const existing = variants.find(
    (variant) =>
      canonicalJson({
        frameworkVersion: variant.frameworkVersion,
        modules: variant.modules,
      }) === signature,
  );
  if (existing === undefined)
    variants.push({
      id,
      frameworkVersion: resolution.frameworkVersion,
      modules,
    });
  variants.sort((a, b) => a.id.localeCompare(b.id));
  const isPrimaryFrameworkCandidate = framework.frameworkPackage === candidate.package || primaryModules.has(candidate.package);
  if (isPrimaryFrameworkCandidate && resolution.frameworkVersion === candidate.version && !framework.versions.verified.includes(candidate.version)) {
    framework.versions.verified.push(candidate.version);
    framework.versions.verified.sort(compareVersions);
    if (framework.versions.policy === 'exact') framework.versions.declared = framework.versions.verified.join(' or ');
  }
  if (!Array.isArray(framework.certification?.ids) || typeof framework.probe?.packageVersion !== 'string') {
    throw new Error(`${candidate.id}: framework certification identity metadata is incomplete`);
  }
  if (framework.versions.policy === 'exact') {
    framework.certification.ids = framework.versions.verified.map((version) => `${framework.id}@${version}/${framework.probe.packageVersion}`);
  }
  return next;
}
