#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { canonicalJson, compareVersions, parseVersion, trustedGoEnvironment } from './discover-framework-candidates.mjs';
import { safeExtractTarGz } from './safe-tar.mjs';

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TCELL_MODULE = 'github.com/gdamore/tcell/v2';
const TCELL_PATCH_ROOT = 'packages/probe-tview/upstream-patches/tcell';
const TCELL_TEMPLATE_ROOT = 'packages/probe-tview/upstream-patch-templates/tcell';

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

export async function classifyTcellConsoleProfile(sourceRoot) {
  let parsed;
  try {
    const { stdout } = await exec('go', ['run', join(root, 'scripts/classify-tcell-console-profile.go'), sourceRoot], {
      cwd: root,
      env: trustedGoEnvironment({ GOFLAGS: '', GOWORK: 'off', GOPROXY: 'off', GOSUMDB: 'off' }),
    });
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`tcell Windows console structural classification failed: ${error.stderr || error.message}`);
  }
  const matches = parsed?.matches;
  if (!Array.isArray(matches) || matches.some((entry) => typeof entry !== 'string')) {
    throw new Error('tcell Windows console structural classifier returned invalid evidence');
  }
  const unique = [...new Set(matches)];
  if (unique.length !== 1) {
    throw new Error(`tcell Windows console structural classification matched ${unique.length} audited profiles${unique.length === 0 ? '' : `: ${unique.join(', ')}`}`);
  }
  return unique[0];
}

function validateTcellTemplate(template, profileId) {
  if (
    template?.schemaVersion !== 1
    || template.kind !== 'termwright-tcell-patch-template'
    || template.profileId !== profileId
    || template.framework !== TCELL_MODULE
    || !Number.isSafeInteger(template.patchSetVersion)
    || template.patchSetVersion < 1
    || typeof template.note !== 'string'
    || template.note.length === 0
    || !Array.isArray(template.patched)
    || template.patched.length !== 0
    || !Array.isArray(template.added)
    || template.added.length === 0
  ) throw new Error(`invalid audited tcell template ${profileId}`);
  const targets = new Set();
  for (const [index, entry] of template.added.entries()) {
    const target = safeRelative(entry?.path, `tcell template ${profileId}.added[${index}].path`);
    safeRelative(entry?.source, `tcell template ${profileId}.added[${index}].source`);
    if (targets.has(target)) throw new Error(`tcell template ${profileId} adds ${target} more than once`);
    targets.add(target);
  }
  return template;
}

async function tcellTemplate(rootDir, candidate, streamRoot, sourceRoot) {
  const targetsTcell = streamRoot === TCELL_PATCH_ROOT;
  if (candidate.package === TCELL_MODULE && !targetsTcell) {
    throw new Error(`${candidate.id}: tcell candidate targets another patch stream`);
  }
  if (!targetsTcell) return null;
  const expectedPath = `${TCELL_PATCH_ROOT}/${candidate.version}/manifest.json`;
  if (
    candidate.package !== TCELL_MODULE
    || candidate.registry !== 'go'
    || candidate.frameworkId !== 'tview'
    || parseVersion(candidate.version)?.major !== 2
    || candidate.patch.path !== expectedPath
  ) throw new Error(`${candidate.id}: tcell patch request is not bound to the exact stream, package, and version`);
  const profileId = await classifyTcellConsoleProfile(sourceRoot);
  const directory = join(rootDir, TCELL_TEMPLATE_ROOT, safeRelative(profileId, 'tcell profileId'));
  const template = validateTcellTemplate(
    JSON.parse(await readFile(join(directory, 'template.json'), 'utf8')),
    profileId,
  );
  return {
    kind: 'structural-profile',
    directory,
    profileId,
    manifest: {
      framework: template.framework,
      frameworkVersion: candidate.version,
      patchSetVersion: template.patchSetVersion,
      note: template.note,
      patched: [],
      added: template.added.map((entry) => ({ ...entry, sha256: '' })),
    },
  };
}

async function materializeTemplate(template, destination) {
  if (template.kind !== 'structural-profile') {
    await cp(template.directory, destination, { recursive: true, errorOnExist: true });
    return;
  }
  await mkdir(destination, { recursive: false });
  for (const [index, entry] of template.manifest.added.entries()) {
    const source = safeRelative(entry.source, `added[${index}].source`);
    const output = join(destination, source);
    await mkdir(dirname(output), { recursive: true });
    await cp(join(template.directory, source), output, { errorOnExist: true, force: false });
  }
  await writeFile(join(destination, 'manifest.json'), canonicalJson(template.manifest));
}

export async function preparePatchBundle({ rootDir = root, candidate, sourceRoot, outputDirectory, sourceRevision }) {
  if (candidate.mode !== 'patch' || candidate.patch?.status !== 'needs-patch') throw new Error(`${candidate.id}: candidate does not need a generated patch`);
  if (typeof sourceRevision !== 'string' || sourceRevision.length < 7) throw new Error('sourceRevision is required');
  const streamRoot = safeRelative(candidate.patch.path, 'candidate.patch.path').split('/').slice(0, -2).join('/');
  const template = await tcellTemplate(rootDir, candidate, streamRoot, sourceRoot)
    ?? await latestTemplate(rootDir, streamRoot, candidate.version);
  const destination = join(outputDirectory, 'patch');
  await mkdir(outputDirectory, { recursive: true });
  await materializeTemplate(template, destination);
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
    template: template.kind === 'structural-profile'
      ? { profileId: template.profileId, selection: 'go-ast-capability', patchSetVersion: template.manifest.patchSetVersion }
      : { frameworkVersion: oldVersion, patchSetVersion: template.manifest.patchSetVersion },
    patchTreeDigest,
  };
  await writeFile(join(outputDirectory, 'bundle.json'), canonicalJson(metadata));
  return { metadata, manifest, destination };
}

export async function prepareSyntheticPatchBundle(options) {
  const directory = await mkdtemp(join(tmpdir(), 'termwright-candidate-'));
  return preparePatchBundle({ ...options, outputDirectory: options.outputDirectory ?? directory });
}

export async function assertGoDownloadBinding(result, candidate) {
  if (
    typeof result?.Dir !== 'string'
    || typeof result?.Zip !== 'string'
    || result.Sum !== candidate.source?.sum
    || result.GoModSum !== candidate.source?.goModSum
  ) throw new Error(`${candidate.id}: downloaded Go module identity does not match discovery`);
  const zipSha256 = createHash('sha256').update(await readFile(result.Zip)).digest('hex');
  if (zipSha256 !== candidate.source?.zipSha256) {
    throw new Error(`${candidate.id}: downloaded Go module archive does not match discovery`);
  }
}

export async function materializeCandidateSource(candidate) {
  const directory = await mkdtemp(join(tmpdir(), 'termwright-upstream-'));
  const sourceRoot = join(directory, 'source');
  await mkdir(sourceRoot);
  if (candidate.registry === 'go') {
    const result = JSON.parse((await exec('go', ['mod', 'download', '-json', `${candidate.package}@${candidate.version}`], { env: trustedGoEnvironment({ GOFLAGS: '', GOWORK: 'off', GOPROXY: 'https://proxy.golang.org', GOSUMDB: 'sum.golang.org' }) })).stdout);
    await assertGoDownloadBinding(result, candidate);
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
  if (manifest.framework !== candidate.package || manifest.frameworkVersion !== candidate.version) {
    throw new Error(`${candidate.id}: patch manifest targets another exact framework artifact`);
  }
  const patchSets = framework.instrumentation?.patchSets;
  if (!Array.isArray(patchSets)) throw new Error(`${candidate.id}: certified patch-set declarations are missing`);
  const existing = patchSets.find((entry) => entry.name === candidate.package && entry.version === candidate.version);
  if (existing === undefined) patchSets.push({ name: candidate.package, version: candidate.version, patchSetVersion: manifest.patchSetVersion });
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
  const modules = resolution.modules.map((module) => ({ name: module.name, version: module.version, ...(module.optional === true ? { optional: true } : {}) }));
  if (new Set(modules.map((module) => module.name)).size !== modules.length) throw new Error(`${candidate.id}: executable variant resolves one module more than once`);
  if (!modules.some((module) => module.name === candidate.package && module.version === candidate.version)) throw new Error(`${candidate.id}: executable variant does not contain the exact candidate`);
  for (const module of modules) {
    if (!framework.instrumentation.patchSets.some((patch) => patch.name === module.name && patch.version === module.version)) {
      throw new Error(`${candidate.id}: executable variant uses uncertified patch ${module.name}@${module.version}`);
    }
  }
  modules.sort((a, b) => a.name.localeCompare(b.name) || compareVersions(a.version, b.version));
  // Only an already-certified variant may establish which module owns the
  // framework version. The candidate variant must not be able to authorize
  // itself as primary merely by sharing the same version string.
  const primaryModules = new Set(framework.instrumentation.variants.flatMap((variant) =>
    variant.modules
      .filter((module) => module.optional !== true && module.version === variant.frameworkVersion)
      .map((module) => module.name)));
  const signature = canonicalJson({ frameworkVersion: resolution.frameworkVersion, modules });
  const id = `${candidate.frameworkId}-${resolution.frameworkVersion}-${createHash('sha256').update(signature).digest('hex').slice(0, 12)}`.replace(/[^A-Za-z0-9._-]/gu, '-');
  const variants = framework.instrumentation.variants;
  const existing = variants.find((variant) => canonicalJson({ frameworkVersion: variant.frameworkVersion, modules: variant.modules }) === signature);
  if (existing === undefined) variants.push({ id, frameworkVersion: resolution.frameworkVersion, modules });
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
  framework.certification.ids = framework.versions.verified.map(
    (version) => `${framework.id}@${version}/${framework.probe.packageVersion}`,
  );
  return next;
}
