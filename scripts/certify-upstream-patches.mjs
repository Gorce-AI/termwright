#!/usr/bin/env node

/**
 * Build a deterministic, machine-readable candidate from the exact Go and
 * Rust patch sets already shipped by the probes.
 *
 * This is deliberately a bounded certifier, not the future AST generator. It
 * authenticates registry inputs, cross-checks the compatibility declaration,
 * applies each existing patch set twice through its owning applier, compares
 * complete output-tree digests and runs the repository's existing suites. A
 * successful report reaches `buildable`; it never claims stable or full
 * behavioral certification and never publishes anything.
 */

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { pnpmInvocation } from './package-manager-command.mjs';
import { safeExtractTarGz } from './safe-tar.mjs';

const exec = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = resolve(dirname(scriptPath), '..');
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const STATIC_FRAMEWORKS = new Set(['ratatui', 'charm']);
const PATCH_ROOTS = Object.freeze([
  { ecosystem: 'go', path: 'packages/probe-charm/upstream-patches' },
  { ecosystem: 'rust', path: 'clients/rust-probe/upstream-patches' },
]);

export class CertificationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CertificationError';
  }
}

export function canonicalJson(value) {
  return `${JSON.stringify(sortValue(value), null, 2)}\n`;
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortValue(child)]),
    );
  }
  return value;
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

async function sha256File(path) {
  return sha256(await readFile(path));
}

async function makeTreeOwnerWritable(path) {
  const info = await lstat(path).catch(() => null);
  if (info === null || info.isSymbolicLink()) return;
  await chmod(path, info.mode | (info.isDirectory() ? 0o700 : 0o600));
  if (info.isDirectory()) {
    for (const entry of await readdir(path)) await makeTreeOwnerWritable(join(path, entry));
  }
}

/** Content-address a tree without timestamps or machine-specific root paths. */
export async function digestTree(root) {
  const entries = [];
  const visit = async (directory) => {
    for (const entry of (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const full = join(directory, entry.name);
      const name = relative(root, full).split(sep).join('/');
      if (entry.isDirectory()) {
        entries.push({ path: `${name}/`, type: 'directory' });
        await visit(full);
      } else if (entry.isFile()) {
        entries.push({ path: name, type: 'file', digest: await sha256File(full) });
      } else if (entry.isSymbolicLink()) {
        entries.push({ path: name, type: 'symlink', target: await readlink(full) });
      } else {
        throw new CertificationError(`${name} has an unsupported filesystem type`);
      }
    }
  };
  await visit(root);
  return sha256(Buffer.from(canonicalJson(entries)));
}

function safeRelativePath(value, field) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || isAbsolute(value)
    || value.includes('\\')
    || value.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new CertificationError(`${field} must be a normalized relative path, found ${JSON.stringify(value)}`);
  }
  return value;
}

function requiredString(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new CertificationError(`${field} must be a non-empty string`);
  }
  return value;
}

function requiredDigest(value, field) {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new CertificationError(`${field} must be a sha256:<lowercase hex> digest`);
  }
  return value;
}

export function validateManifestShape(manifest, label = 'manifest') {
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new CertificationError(`${label} must be an object`);
  }
  requiredString(manifest.framework, `${label}.framework`);
  requiredString(manifest.frameworkVersion, `${label}.frameworkVersion`);
  if (!Number.isSafeInteger(manifest.patchSetVersion) || manifest.patchSetVersion <= 0) {
    throw new CertificationError(`${label}.patchSetVersion must be a positive integer`);
  }
  if (!Array.isArray(manifest.patched) || !Array.isArray(manifest.added)) {
    throw new CertificationError(`${label} must contain patched and added arrays`);
  }

  const targets = new Set();
  for (const [index, file] of manifest.patched.entries()) {
    const prefix = `${label}.patched[${index}]`;
    const target = safeRelativePath(file?.path, `${prefix}.path`);
    safeRelativePath(file?.patch, `${prefix}.patch`);
    requiredDigest(file?.sha256Before, `${prefix}.sha256Before`);
    requiredDigest(file?.sha256After, `${prefix}.sha256After`);
    if (targets.has(target)) throw new CertificationError(`${label} declares ${target} more than once`);
    targets.add(target);
  }
  for (const [index, file] of manifest.added.entries()) {
    const prefix = `${label}.added[${index}]`;
    const target = safeRelativePath(file?.path, `${prefix}.path`);
    safeRelativePath(file?.source, `${prefix}.source`);
    requiredDigest(file?.sha256, `${prefix}.sha256`);
    if (targets.has(target)) throw new CertificationError(`${label} declares ${target} more than once`);
    targets.add(target);
  }
  if (targets.size === 0) throw new CertificationError(`${label} changes no files`);
  return manifest;
}

async function manifestsBelow(root, ecosystem, relativeRoot) {
  const base = join(root, relativeRoot);
  const found = [];
  const visit = async (directory) => {
    for (const entry of (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.name === 'manifest.json') {
        const patchSetDir = dirname(full);
        const manifest = validateManifestShape(JSON.parse(await readFile(full, 'utf8')), relative(root, full));
        found.push({ ecosystem, patchSetDir, manifest });
      }
    }
  };
  await visit(base);
  return found;
}

export async function discoverPatchSets(root = defaultRoot, ecosystems = new Set(['go', 'rust'])) {
  const groups = await Promise.all(
    PATCH_ROOTS
      .filter(({ ecosystem }) => ecosystems.has(ecosystem))
      .map(({ ecosystem, path }) => manifestsBelow(root, ecosystem, path)),
  );
  return groups.flat().sort((left, right) => candidateKey(left.manifest).localeCompare(candidateKey(right.manifest)));
}

function candidateKey(candidate) {
  const manifest = candidate.manifest ?? candidate;
  return `${manifest.framework}@${manifest.frameworkVersion}#${manifest.patchSetVersion}`;
}

export async function loadDeclarations(root = defaultRoot, ecosystems = new Set(['go', 'rust'])) {
  const registryPath = join(root, 'compatibility/registry.json');
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  if (registry?.schemaVersion !== 6 || !Array.isArray(registry.frameworks)) {
    throw new CertificationError('compatibility/registry.json is not schemaVersion 6');
  }
  const declarations = new Map();
  for (const framework of registry.frameworks) {
    if (!STATIC_FRAMEWORKS.has(framework.id)) continue;
    if (
      !['stable', 'frame-local', 'correlated'].includes(framework.probe?.identityKind)
      || !Array.isArray(framework.probe?.capabilities)
      || !Array.isArray(framework.probe?.adapterCapabilities)
      || framework.probe.capabilities.some((capability) => typeof capability !== 'string')
      || framework.probe.adapterCapabilities.some((capability) => typeof capability !== 'string')
    ) {
      throw new CertificationError(`${framework.id} has an invalid capability declaration`);
    }
    const ecosystem = framework.id === 'ratatui' ? 'rust' : 'go';
    if (!ecosystems.has(ecosystem)) continue;
    for (const module of framework.instrumentation?.patchSets ?? []) {
      if (
        typeof module.name !== 'string'
        || typeof module.version !== 'string'
        || !Number.isSafeInteger(module.patchSetVersion)
        || module.patchSetVersion <= 0
      ) {
        throw new CertificationError(`${framework.id} has an invalid patch-set declaration`);
      }
      const key = `${module.name}@${module.version}`;
      if (declarations.has(key)) throw new CertificationError(`duplicate compatibility declaration ${key}`);
      const executableVariants = (framework.instrumentation?.variants ?? [])
        .filter((variant) => variant.modules?.some((entry) => entry.name === module.name && entry.version === module.version))
        .map((variant) => variant.id)
        .sort();
      declarations.set(key, {
        ecosystem,
        frameworkId: framework.id,
        executableVariants,
        module: module.name,
        version: module.version,
        patchSetVersion: module.patchSetVersion,
        identityKind: framework.probe.identityKind,
        probeCapabilities: framework.probe.capabilities,
        adapterCapabilities: framework.probe.adapterCapabilities,
      });
    }
  }
  return { declarations, registryDigest: await sha256File(registryPath) };
}

export function crossCheckDeclarations(patchSets, declarations) {
  const matched = new Map();
  for (const patchSet of patchSets) {
    const { manifest } = patchSet;
    const key = `${manifest.framework}@${manifest.frameworkVersion}`;
    const declaration = declarations.get(key);
    if (declaration === undefined) {
      throw new CertificationError(`${candidateKey(manifest)} has no compatibility declaration`);
    }
    if (declaration.ecosystem !== patchSet.ecosystem) {
      throw new CertificationError(`${key} is declared as ${declaration.ecosystem}, found under ${patchSet.ecosystem}`);
    }
    if (declaration.patchSetVersion !== manifest.patchSetVersion) {
      throw new CertificationError(
        `${key} declares patch-set ${declaration.patchSetVersion}, manifest has ${manifest.patchSetVersion}`,
      );
    }
    matched.set(key, { ...patchSet, declaration });
  }
  for (const key of declarations.keys()) {
    if (!matched.has(key)) throw new CertificationError(`${key} is declared but has no patch-set manifest`);
  }
  return [...matched.values()].sort((left, right) => candidateKey(left.manifest).localeCompare(candidateKey(right.manifest)));
}

export async function validatePatchSetFiles(candidate) {
  const { manifest, patchSetDir } = candidate;
  const artifacts = [];
  for (const file of manifest.patched) {
    const patchPath = join(patchSetDir, file.patch);
    const info = await stat(patchPath).catch(() => null);
    if (info === null || !info.isFile() || info.size === 0) {
      throw new CertificationError(`${candidateKey(manifest)}: ${file.patch} is missing or empty`);
    }
    artifacts.push({ path: file.patch, digest: await sha256File(patchPath) });
  }
  for (const file of manifest.added) {
    const sourcePath = join(patchSetDir, file.source);
    const actual = await sha256File(sourcePath).catch(() => null);
    if (actual !== file.sha256) {
      throw new CertificationError(
        `${candidateKey(manifest)}: ${file.source} hashes ${actual ?? 'missing'}, expected ${file.sha256}`,
      );
    }
    artifacts.push({ path: file.source, digest: actual });
  }
  return {
    artifacts: artifacts.sort((left, right) => left.path.localeCompare(right.path)),
    patchSetDigest: await digestTree(patchSetDir),
  };
}

export function assertDeterministicRuns(label, first, second) {
  const left = canonicalJson(first);
  const right = canonicalJson(second);
  if (left !== right) throw new CertificationError(`${label} produced different results in two clean runs`);
}

async function run(command, args, options = {}) {
  try {
    const result = await exec(command, args, {
      cwd: options.cwd ?? defaultRoot,
      env: options.env ?? process.env,
      maxBuffer: 64 * 1024 * 1024,
      encoding: 'utf8',
    });
    return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  } catch (error) {
    const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
    const stdout = typeof error?.stdout === 'string' ? error.stdout.trim() : '';
    const detail = [stderr, stdout, error instanceof Error ? error.message : String(error)]
      .filter(Boolean)
      .join('\n')
      .slice(-12_000);
    throw new CertificationError(`${command} ${args.join(' ')} failed:\n${detail}`);
  }
}

async function runPnpm(args, options = {}) {
  const invocation = pnpmInvocation(args, { env: options.env ?? process.env });
  return run(invocation.command, invocation.args, options);
}

async function collectToolchains(root, ecosystems) {
  const toolchains = {
    node: { version: process.version },
    pnpm: { version: (await runPnpm(['--version'], { cwd: root })).stdout },
  };
  if (ecosystems.has('go')) {
    toolchains.go = {
      version: (await run('go', ['version'], { cwd: root })).stdout,
      selection: (await run('go', ['env', 'GOTOOLCHAIN'], { cwd: root })).stdout,
    };
  }
  if (ecosystems.has('rust')) {
    toolchains.rustc = { version: (await run('rustc', ['--version', '--verbose'], { cwd: root })).stdout };
    toolchains.cargo = { version: (await run('cargo', ['--version', '--verbose'], { cwd: root })).stdout };
  }
  return toolchains;
}

async function goModule(root, candidate) {
  const { manifest, patchSetDir } = candidate;
  const scratch = await mkdtemp(join(tmpdir(), 'tw-upstream-go-'));
  try {
    // Never certify a mutable global module-cache directory. A clean cache
    // makes `go mod download` fetch and verify the archive against the Go
    // checksum database before the freshly extracted tree becomes our input.
    const goEnvironment = {
      ...process.env,
      GOFLAGS: '',
      GOMODCACHE: join(scratch, 'gomodcache'),
      GONOSUMDB: '',
      GOPRIVATE: '',
      GOSUMDB: 'sum.golang.org',
      GOTOOLCHAIN: 'local',
      GOWORK: 'off',
    };
    const downloaded = await run(
      'go',
      ['mod', 'download', '-json', `${manifest.framework}@${manifest.frameworkVersion}`],
      {
        cwd: root,
        env: goEnvironment,
      },
    );
    let module;
    try {
      module = JSON.parse(downloaded.stdout);
    } catch {
      throw new CertificationError(`${candidateKey(manifest)}: go mod download returned invalid JSON`);
    }
    if (
      module.Path !== manifest.framework
      || module.Version !== manifest.frameworkVersion
      || typeof module.Dir !== 'string'
      || typeof module.Sum !== 'string'
      || !module.Sum.startsWith('h1:')
      || typeof module.GoModSum !== 'string'
      || !module.GoModSum.startsWith('h1:')
      || typeof module.Zip !== 'string'
    ) {
      throw new CertificationError(`${candidateKey(manifest)}: Go registry identity is incomplete or mismatched`);
    }

    for (const file of manifest.added) {
      try {
        await lstat(join(module.Dir, file.path));
        throw new CertificationError(`${candidateKey(manifest)}: added target ${file.path} already exists upstream`);
      } catch (error) {
        if (error instanceof CertificationError) throw error;
        if (error?.code !== 'ENOENT') throw error;
      }
    }

    const probeGo = await import(pathToFileURL(join(root, 'packages/probe-go/dist/index.js')).href)
      .catch(() => {
        throw new CertificationError('packages/probe-go/dist is missing; run pnpm --filter @termwright/probe-go build');
      });
    const execute = async (name) => {
      const copyDir = join(scratch, name);
      await probeGo.materializeUpstream(module.Dir, copyDir);
      await probeGo.applyPatchSet(copyDir, patchSetDir);
      return {
        outputTreeDigest: await digestTree(copyDir),
        pinnedFiles: [
          ...manifest.patched.map((file) => ({ path: file.path, digest: file.sha256After })),
          ...manifest.added.map((file) => ({ path: file.path, digest: file.sha256 })),
        ].sort((left, right) => left.path.localeCompare(right.path)),
      };
    };
    const first = await execute('run-1');
    const second = await execute('run-2');
    assertDeterministicRuns(candidateKey(manifest), first, second);
    return {
      material: {
        source: 'go-module',
        module: module.Path,
        version: module.Version,
        sum: module.Sum,
        goModSum: module.GoModSum,
        zipDigest: await sha256File(module.Zip),
        upstreamTreeDigest: await digestTree(module.Dir),
        sourceBinding: 'isolated-go-checksum-database-download',
        checksumDatabase: 'sum.golang.org',
        effectiveGoToolchain: (await run('go', ['version'], { cwd: module.Dir, env: goEnvironment })).stdout,
      },
      result: first,
    };
  } finally {
    // Go's module cache is deliberately read-only. Cleanup must not turn a
    // successful certification into a failure merely because of those modes.
    await makeTreeOwnerWritable(scratch).catch(() => {});
    await rm(scratch, { recursive: true, force: true }).catch(() => {});
  }
}

async function rustCrate(root, candidate) {
  const { manifest, patchSetDir } = candidate;
  const scratch = await mkdtemp(join(tmpdir(), 'tw-upstream-rust-'));
  try {
    const metadataResponse = await fetch(`https://crates.io/api/v1/crates/${encodeURIComponent(manifest.framework)}/${encodeURIComponent(manifest.frameworkVersion)}`, { headers: { 'user-agent': 'termwright-compatibility-workflow/1' } });
    if (!metadataResponse.ok) throw new CertificationError(`${candidateKey(manifest)}: crates.io metadata failed with ${metadataResponse.status}`);
    const metadata = await metadataResponse.json();
    const published = metadata.version?.num === manifest.frameworkVersion ? metadata.version : undefined;
    if (!/^[0-9a-f]{64}$/u.test(published?.checksum ?? '')) throw new CertificationError(`${candidateKey(manifest)}: crates.io returned no exact checksum`);
    const archiveResponse = await fetch(`https://crates.io/api/v1/crates/${encodeURIComponent(manifest.framework)}/${encodeURIComponent(manifest.frameworkVersion)}/download`, { headers: { 'user-agent': 'termwright-compatibility-workflow/1' } });
    if (!archiveResponse.ok) throw new CertificationError(`${candidateKey(manifest)}: crates.io archive failed with ${archiveResponse.status}`);
    const archive = Buffer.from(await archiveResponse.arrayBuffer());
    const archiveDigest = sha256(archive);
    const checksum = `sha256:${published.checksum}`;
    if (archiveDigest !== checksum) {
      throw new CertificationError(
        `${candidateKey(manifest)}: crates.io archive hashes ${archiveDigest}, expected ${checksum}`,
      );
    }
    const registrySource = join(scratch, 'registry-source');
    await mkdir(registrySource);
    await safeExtractTarGz(archive, registrySource);
    const extracted = await readdir(registrySource, { withFileTypes: true });
    const expectedDirectory = `${manifest.framework}-${manifest.frameworkVersion}`;
    if (
      extracted.length !== 1
      || extracted[0].name !== expectedDirectory
      || !extracted[0].isDirectory()
    ) {
      throw new CertificationError(`${candidateKey(manifest)}: crates.io archive has an unexpected root layout`);
    }
    const sourceDir = join(registrySource, expectedDirectory);
    const upstreamTreeDigest = await digestTree(sourceDir);
    const execute = async (name) => {
      const copyDir = join(scratch, name);
      const helper = await run('cargo', [
        'run', '--quiet', '--locked',
        '--manifest-path', join(root, 'clients/rust-probe/Cargo.toml'),
        '--example', 'upstream_certify', '--',
        patchSetDir,
        sourceDir,
        copyDir,
        '__TERMWRIGHT_PROBE_PATH__',
      ], { cwd: root });
      return {
        helper: JSON.parse(helper.stdout),
        outputTreeDigest: await digestTree(copyDir),
      };
    };
    const first = await execute('run-1');
    const second = await execute('run-2');
    assertDeterministicRuns(candidateKey(manifest), first, second);
    return {
      material: {
        source: 'crates.io',
        crate: manifest.framework,
        version: manifest.frameworkVersion,
        checksum,
        archiveDigest,
        upstreamTreeDigest,
        sourceBinding: 'lockfile-checksum-matched-crate-archive',
      },
      result: first,
    };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function runExistingTests(root, ecosystems) {
  // The registry is only evidence when its capabilities still match the
  // handshakes/detectors in source. This gate catches a manifest that applies
  // perfectly while the declared contract silently drifted.
  await runPnpm(['run', 'test:compatibility'], { cwd: root });
  const gates = [{ id: 'compatibility-registry-runtime-drift', status: 'pass' }];
  if (ecosystems.has('go')) {
    for (const packageName of ['@termwright/probe-go', '@termwright/probe-tview', '@termwright/probe-charm']) {
      await runPnpm(['--filter', packageName, 'run', 'test'], { cwd: root });
      gates.push({ id: `existing-tests:${packageName}`, status: 'pass' });
    }
  }
  if (ecosystems.has('rust')) {
    await run('cargo', ['test', '--locked', '--manifest-path', join(root, 'clients/rust-probe/Cargo.toml')], {
      cwd: root,
      env: { ...process.env, TERMWRIGHT_REQUIRE_RATATUI: '1' },
    });
    gates.push({ id: 'existing-tests:termwright-probe-ratatui', status: 'pass' });
  }
  return gates;
}

function candidateRecord(root, candidate, local, execution) {
  const { manifest, declaration, patchSetDir, ecosystem } = candidate;
  return {
    id: candidateKey(manifest),
    ecosystem,
    frameworkId: declaration.frameworkId,
    executableVariants: declaration.executableVariants,
    module: manifest.framework,
    upstreamVersion: manifest.frameworkVersion,
    patchSetVersion: manifest.patchSetVersion,
    identityKind: declaration.identityKind,
    capabilities: {
      probe: declaration.probeCapabilities,
      adapter: declaration.adapterCapabilities,
    },
    patchSetPath: relative(root, patchSetDir).split(sep).join('/'),
    patchSetDigest: local.patchSetDigest,
    artifacts: local.artifacts,
    material: execution.material,
    output: execution.result,
  };
}

export function provenance(report, sourceRevision, registryDigest, certifierDigest) {
  const verificationSuites = report.gates
    .filter((gate) => gate.id === 'compatibility-registry-runtime-drift' || gate.id.startsWith('existing-tests:'))
    .map((gate) => gate.id);
  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: report.candidates.map((candidate) => ({
      name: candidate.id,
      digest: { sha256: candidate.output.outputTreeDigest.slice('sha256:'.length) },
    })),
    predicateType: 'https://termwright.dev/attestations/upstream-candidate/v1',
    predicate: {
      buildDefinition: {
        buildType: 'https://termwright.dev/build-types/upstream-patch-candidate/v1',
        externalParameters: {
          ecosystems: report.ecosystems,
          sourceRevision,
        },
        internalParameters: {
          runsPerPatchSet: 2,
          verificationSuites,
          toolchains: report.toolchains,
        },
        resolvedDependencies: [
          { uri: 'git+https://github.com/gorce-ai/termwright', digest: { gitCommit: sourceRevision } },
          { uri: 'file:compatibility/registry.json', digest: { sha256: registryDigest.slice('sha256:'.length) } },
          { uri: 'file:scripts/certify-upstream-patches.mjs', digest: { sha256: certifierDigest.slice('sha256:'.length) } },
          ...report.candidates.map((candidate) => ({
            uri: `file:${candidate.patchSetPath}`,
            digest: { sha256: candidate.patchSetDigest.slice('sha256:'.length) },
          })),
          ...report.candidates.map((candidate) => ({
            uri: `${candidate.material.source}:${candidate.module}@${candidate.upstreamVersion}`,
            digest: {
              sha256: (candidate.material.archiveDigest ?? candidate.material.zipDigest).slice('sha256:'.length),
            },
          })),
          ...report.candidates.map((candidate) => ({
            uri: `${candidate.material.source}:${candidate.module}@${candidate.upstreamVersion}#source-tree`,
            digest: { sha256: candidate.material.upstreamTreeDigest.slice('sha256:'.length) },
          })),
        ],
      },
      runDetails: {
        builder: { id: 'https://github.com/gorce-ai/termwright/scripts/certify-upstream-patches.mjs' },
        metadata: { invocationId: sourceRevision },
        byproducts: [{ name: 'candidate-report.json', digest: sha256(Buffer.from(canonicalJson(report))) }],
      },
      signed: false,
    },
  };
}

export function sanitizeFailureMessage(error, root = defaultRoot, outputDir) {
  let message = error instanceof Error ? error.message : String(error);
  const knownRoots = [outputDir, root, tmpdir()]
    .filter((value) => typeof value === 'string' && value.length > 1)
    .map((value) => resolve(value))
    .sort((left, right) => right.length - left.length);
  for (const path of knownRoots) message = message.split(path).join('<redacted-path>');

  // Toolchains may mention caches outside the repository or OS temp root.
  // Keep the diagnostic useful while making failure evidence portable and
  // safe to upload from a developer machine.
  message = message
    // A Windows file URL is `file://C:\path`, with two slashes — requiring
    // three left the drive-qualified path in the message, and the bare
    // drive-letter rule below could not catch it either because the character
    // before `C:` is a slash rather than whitespace.
    .replace(/file:\/\/\/?[^\s"'<>]*/gmu, 'file://<absolute-path>')
    .replace(/(^|[\s"'=(])\/(?!\/)[^\s"'<>]*/gmu, '$1<absolute-path>')
    .replace(/(^|[\s"'=(])[A-Za-z]:[\\/][^\s"'<>]*/gmu, '$1<absolute-path>');
  return message.slice(-12_000);
}

function failureReport({ ecosystems, sourceRevision, phase, message }) {
  return {
    schemaVersion: 1,
    kind: 'termwright-upstream-patch-candidate',
    state: 'failed',
    certificationProfile: 'local-v1',
    targetCertificationState: 'not-assessed',
    behaviorallyCertified: false,
    stablePublishEligible: false,
    sourceRevision,
    ecosystems: [...ecosystems].sort(),
    failure: {
      phase,
      message,
    },
  };
}

export async function initializeFailureReport(options = {}) {
  const root = resolve(options.root ?? defaultRoot);
  const outputDir = resolve(options.outputDir ?? join(root, 'upstream-candidate'));
  const ecosystems = options.ecosystems ?? new Set(['go', 'rust']);
  const sourceRevision = options.sourceRevision ?? process.env['GITHUB_SHA'] ?? 'local-unpinned';
  await mkdir(outputDir, { recursive: true });
  await rm(join(outputDir, 'candidate-provenance.json'), { force: true });
  const report = failureReport({
    ecosystems,
    sourceRevision,
    phase: options.phase ?? 'workflow-bootstrap',
    message: options.message ?? 'Certification did not complete; inspect the workflow logs.',
  });
  await writeJson(join(outputDir, 'candidate-report.json'), report);
  return report;
}

export async function certify(options = {}) {
  const root = resolve(options.root ?? defaultRoot);
  const outputDir = resolve(options.outputDir ?? join(root, 'upstream-candidate'));
  const ecosystems = options.ecosystems ?? new Set(['go', 'rust']);
  const sourceRevision = options.sourceRevision ?? process.env['GITHUB_SHA'] ?? 'local-unpinned';
  await initializeFailureReport({
    root,
    outputDir,
    ecosystems,
    sourceRevision,
    phase: 'certifier',
    message: 'Certification started but did not complete.',
  });

  try {
    const patchSets = await discoverPatchSets(root, ecosystems);
    const { declarations, registryDigest } = await loadDeclarations(root, ecosystems);
    const candidates = crossCheckDeclarations(patchSets, declarations);
    const toolchains = await collectToolchains(root, ecosystems);
    const records = [];
    for (const candidate of candidates) {
      const local = await validatePatchSetFiles(candidate);
      const execution = candidate.ecosystem === 'go'
        ? await goModule(root, candidate)
        : await rustCrate(root, candidate);
      records.push(candidateRecord(root, candidate, local, execution));
    }

    const gates = [
      { id: 'manifest-and-declaration', status: 'pass' },
      { id: 'pinned-input-output', status: 'pass' },
      { id: 'two-clean-run-determinism', status: 'pass' },
    ];
    if (options.skipExistingTests !== true) gates.push(...await runExistingTests(root, ecosystems));
    const report = {
      schemaVersion: 1,
      kind: 'termwright-upstream-patch-candidate',
      state: 'candidate',
      candidateStage: options.skipExistingTests === true ? 'generated' : 'buildable',
      certificationProfile: 'local-v1',
      targetCertificationState: 'not-assessed',
      behaviorallyCertified: false,
      stablePublishEligible: false,
      sourceRevision,
      ecosystems: [...ecosystems].sort(),
      toolchains,
      gates,
      candidates: records.sort((left, right) => left.id.localeCompare(right.id)),
      limitations: [
        'This bounded pipeline applies committed unified diffs; it does not generate AST recipes.',
        'Existing behavioral suites run, but the full behavioral-certification gate and signed provenance are not implemented.',
        'The report is an unsigned candidate artifact and cannot authorize stable publication.',
        'Recorded toolchain versions describe this runner; this profile is not a hermetic or reproducible-build claim.',
      ],
    };
    const attestation = provenance(report, sourceRevision, registryDigest, await sha256File(scriptPath));
    await writeJson(join(outputDir, 'candidate-report.json'), report);
    await writeJson(join(outputDir, 'candidate-provenance.json'), attestation);
    return { report, provenance: attestation };
  } catch (error) {
    const failure = failureReport({
      ecosystems,
      sourceRevision,
      phase: 'certifier',
      message: sanitizeFailureMessage(error, root, outputDir),
    });
    await writeJson(join(outputDir, 'candidate-report.json'), failure);
    throw error;
  }
}

async function writeJson(path, value) {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, canonicalJson(value));
  await rename(temporary, path);
}

function parseArguments(argv) {
  let outputDir = join(defaultRoot, 'upstream-candidate');
  let sourceRevision;
  let ecosystems = new Set(['go', 'rust']);
  let skipExistingTests = false;
  let initializeOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--output') outputDir = argv[++index];
    else if (argument === '--source-revision') {
      sourceRevision = argv[++index];
      if (sourceRevision === undefined) throw new CertificationError('--source-revision needs a value');
    }
    else if (argument === '--ecosystem') {
      const value = argv[++index];
      if (value !== 'go' && value !== 'rust' && value !== 'all') {
        throw new CertificationError(`--ecosystem must be go, rust or all; found ${value}`);
      }
      ecosystems = value === 'all' ? new Set(['go', 'rust']) : new Set([value]);
    } else if (argument === '--skip-existing-tests') skipExistingTests = true;
    else if (argument === '--initialize-only') initializeOnly = true;
    else throw new CertificationError(`unknown argument ${argument}`);
  }
  if (typeof outputDir !== 'string' || outputDir.length === 0) throw new CertificationError('--output needs a directory');
  if (sourceRevision !== undefined && (typeof sourceRevision !== 'string' || sourceRevision.length === 0)) {
    throw new CertificationError('--source-revision needs a value');
  }
  if (initializeOnly && skipExistingTests) {
    throw new CertificationError('--initialize-only cannot be combined with --skip-existing-tests');
  }
  return { outputDir, sourceRevision, ecosystems, skipExistingTests, initializeOnly };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.initializeOnly) {
      await initializeFailureReport(options);
      process.stdout.write('failed/workflow-bootstrap: initialized non-certification report\n');
    } else {
      const result = await certify(options);
      process.stdout.write(
        `${result.report.state}/${result.report.candidateStage}: `
        + `${result.report.candidates.length} upstream patch-set candidates\n`,
      );
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
