#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { access, cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalJson, compareVersions, validateCandidateAssessments } from './discover-framework-candidates.mjs';
import { renderSemanticCompletenessReport } from './generate-semantic-completeness.mjs';
import { digestTree } from './prepare-framework-candidate.mjs';
import { proposeCompatibilityUpdate, recordExecutableVariant } from './prepare-framework-candidate.mjs';
import { renderGeometryPage } from '../website/scripts/check-geometry-matrix.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function verdictFiles(directory) {
  const found = [];
  const visit = async (path) => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const target = join(path, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.name.endsWith('.json') && entry.name.startsWith('verdict-')) found.push(target);
    }
  };
  await visit(directory);
  return found.sort();
}

export async function generatedUpdateDirectories(directory) {
  const found = new Map();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const target = join(directory, entry.name);
    if (
      await access(join(target, 'bundle.json')).then(
        () => true,
        () => false,
      )
    )
      found.set(entry.name, target);
  }
  return found;
}

export function generatedUpdateName(candidate) {
  const suffix = candidate.candidateDigest.slice('sha256:'.length, 'sha256:'.length + 16);
  if (candidate.frameworkId === 'textual') return null;
  if (candidate.mode === 'hook' && candidate.hookStrategy === 'runtime') return `candidate-update-runtime-${suffix}`;
  if (candidate.mode === 'hook' && candidate.hookStrategy === 'exact-source') return `candidate-update-hook-${suffix}`;
  if (candidate.mode === 'patch' && candidate.patch.status === 'needs-patch') return `candidate-update-${suffix}`;
  return null;
}

export function reconcile(registry, ledger, verdicts, context = {}) {
  const assessments = validateCandidateAssessments(context.assessments ?? { schemaVersion: 1, streams: {} });
  const candidates = new Map(registry.candidates.map((entry) => [entry.id, entry]));
  const byCandidate = new Map();
  for (const verdict of verdicts) {
    const candidate = candidates.get(verdict.candidateId);
    if (candidate === undefined || candidate.candidateDigest !== verdict.candidateDigest) throw new Error(`untrusted or stale verdict for ${verdict.candidateId}`);
    if (byCandidate.has(verdict.candidateId)) throw new Error(`duplicate verdict for ${verdict.candidateId}`);
    if (!['green', 'red'].includes(verdict.state)) throw new Error(`invalid verdict state for ${verdict.candidateId}`);
    if (
      context.strictArtifacts === true &&
      (verdict.schemaVersion !== 1 ||
        verdict.kind !== 'termwright-framework-candidate-verdict' ||
        typeof context.sourceRevision !== 'string' ||
        !/^[0-9a-f]{40}$/u.test(context.sourceRevision) ||
        verdict.sourceRevision !== context.sourceRevision ||
        typeof verdict.detail !== 'string' ||
        verdict.detail.length === 0 ||
        verdict.detail.length > 12_000)
    )
      throw new Error(`invalid or stale typed verdict for ${verdict.candidateId}`);
    byCandidate.set(verdict.candidateId, verdict);
  }
  if (context.strictArtifacts === true && byCandidate.size !== candidates.size) {
    const missing = [...candidates.keys()].filter((id) => !byCandidate.has(id));
    throw new Error(`candidate verdict artifact set is incomplete: ${missing.join(', ')}`);
  }
  const next = structuredClone(ledger);
  next.streams ??= {};
  const nextAssessments = structuredClone(assessments);
  nextAssessments.streams ??= {};
  const issues = [];
  for (const candidate of registry.candidates) {
    const verdict = byCandidate.get(candidate.id);
    if (verdict?.state === 'green') {
      const entries = next.streams[candidate.streamId] ?? [];
      const record = {
        version: candidate.version,
        publishedAt: candidate.publishedAt,
        source: candidate.source,
        patchManifestDigest: candidate.patch.manifestDigest,
        candidateDigest: candidate.candidateDigest,
      };
      const existing = entries.findIndex((entry) => entry.version === candidate.version);
      if (existing === -1) entries.push(record);
      else if (entries[existing].candidateDigest !== candidate.candidateDigest) entries[existing] = record;
      entries.sort((a, b) => compareVersions(a.version, b.version));
      next.streams[candidate.streamId] = entries;
      const assessed = nextAssessments.streams[candidate.streamId] ?? [];
      const remaining = assessed.filter((entry) => entry.version !== candidate.version);
      if (remaining.length === 0) delete nextAssessments.streams[candidate.streamId];
      else nextAssessments.streams[candidate.streamId] = remaining;
    } else {
      if (typeof context.runUrl !== 'string' || !/^https:\/\//u.test(context.runUrl)) throw new Error(`${candidate.id}: failure issue requires an authenticated source run URL`);
      if (typeof context.owner !== 'string' || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(context.owner)) throw new Error(`${candidate.id}: failure issue requires a repository owner`);
      issues.push({
        key: candidate.id,
        owner: context.owner,
        title: `[compatibility] ${candidate.id}`,
        body: [
          `Upstream published \`${candidate.package}@${candidate.version}\`.`,
          '',
          `Candidate digest: \`${candidate.candidateDigest}\``,
          `Certification revision: \`${candidate.certificationRevision}\``,
          `Published: ${candidate.publishedAt}`,
          `Integration mode: \`${candidate.mode}\``,
          ...(candidate.mode === 'hook' ? [`Hook strategy: \`${candidate.hookStrategy}\``] : []),
          ...(candidate.mode === 'capability' ? [`Capability: \`${candidate.capability}\``, `Capability strategy: \`${candidate.capabilityStrategy}\``] : []),
          ...(candidate.mode === 'patch' ? [`Patch status: \`${candidate.patch.status}\``, `Expected manifest: \`${candidate.patch.path}\``] : []),
          '',
          `Certification result: ${verdict?.detail ?? 'No verdict artifact was produced.'}`,
          '',
          `Certification run: ${context.runUrl}`,
          '',
          candidate.source?.toolchainSupported === false
            ? `The compatibility registry is unchanged. Review and explicitly repin the trusted Go toolchain to >= ${candidate.source.requiredGoVersion}; automatic toolchain downloads remain disabled.`
            : candidate.mode === 'capability'
              ? 'The compatibility registry is unchanged. The owned add-only compilation unit must compile and pass candidate-specific behavioral conformance; do not create an exact-version patch profile or weaken the capability when it fails.'
              : candidate.mode === 'hook'
                ? `The compatibility registry is unchanged. Review the failed capability and behavioral evidence; ${candidate.hookStrategy === 'exact-source' ? 'do not add fuzzy support or bypass exact instrumentation where the framework still requires it' : 'do not allowlist the version until the public/runtime contract reaches full semantic parity'}. Rerun only after the adapter or certifier genuinely supports this artifact. A PR is created only after every gate passes without a missing conformance area.`
                : candidate.patch.status === 'needs-patch'
                  ? 'The compatibility registry is unchanged. Prepare an exact checksummed structural patch, then rerun the workflow. A PR is created only after every gate passes without a missing conformance area.'
                  : 'The compatibility registry is unchanged. Review the existing exact patch and behavioral failure, then rerun only after the incompatibility is fixed. A PR is created only after every gate passes without a missing conformance area.',
          '',
          `This exact red candidate is recorded and will not be retried unchanged. If the adapter or certifier changes without changing the upstream source or patch digest, increment \`certificationRevision\` for stream \`${candidate.streamId}\` before starting a new first-attempt workflow run.`,
        ].join('\n'),
      });
      if (verdict?.state === 'red') {
        if (!Number.isSafeInteger(candidate.certificationRevision) || candidate.certificationRevision < 1) {
          throw new Error(`${candidate.id}: red verdict lacks a certification revision`);
        }
        const entries = nextAssessments.streams[candidate.streamId] ?? [];
        const record = {
          state: 'red',
          version: candidate.version,
          certificationRevision: candidate.certificationRevision,
          candidateDigest: candidate.candidateDigest,
          source: candidate.source,
        };
        const existing = entries.findIndex((entry) => entry.version === candidate.version);
        if (existing === -1) entries.push(record);
        else entries[existing] = record;
        entries.sort((a, b) => compareVersions(a.version, b.version));
        nextAssessments.streams[candidate.streamId] = entries;
      }
    }
  }
  return {
    ledger: next,
    assessments: nextAssessments,
    plan: {
      schemaVersion: 1,
      green: registry.candidates.filter((entry) => byCandidate.get(entry.id)?.state === 'green').map((entry) => entry.id),
      issues,
    },
  };
}

export async function verifyGeneratedUpdate({ candidate, verdict, updateDirectory, expectedRevision }) {
  const metadata = JSON.parse(await readFile(join(updateDirectory, 'bundle.json'), 'utf8'));
  if (verdict.state !== 'green' || metadata.candidateId !== candidate.id || metadata.candidateDigest !== candidate.candidateDigest)
    throw new Error(`${candidate.id}: generated update is not bound to the green candidate`);
  if (verdict.sourceRevision !== expectedRevision || metadata.sourceRevision !== expectedRevision) throw new Error(`${candidate.id}: stale source revision in generated update`);
  const target = metadata.targetPath;
  if (typeof target !== 'string' || isAbsolute(target) || target.includes('\\') || target.split('/').some((part) => part === '' || part === '.' || part === '..'))
    throw new Error(`${candidate.id}: unsafe generated update target path`);
  if ((await digestTree(join(updateDirectory, 'patch'))) !== metadata.patchTreeDigest) throw new Error(`${candidate.id}: generated patch digest mismatch`);
  return metadata;
}

export async function verifyGeneratedHookProfile({ candidate, verdict, updateDirectory, expectedRevision }) {
  const metadata = JSON.parse(await readFile(join(updateDirectory, 'bundle.json'), 'utf8'));
  if (
    metadata.schemaVersion !== 1 ||
    metadata.kind !== 'termwright-generated-hook-profile' ||
    verdict.state !== 'green' ||
    metadata.candidateId !== candidate.id ||
    metadata.candidateDigest !== candidate.candidateDigest ||
    verdict.sourceRevision !== expectedRevision ||
    metadata.sourceRevision !== expectedRevision ||
    metadata.framework !== candidate.frameworkId ||
    metadata.profile?.version !== candidate.version
  )
    throw new Error(`${candidate.id}: generated hook profile is not bound to the green candidate`);
  const digest = `sha256:${createHash('sha256').update(canonicalJson(metadata.profile)).digest('hex')}`;
  if (metadata.profileDigest !== digest) throw new Error(`${candidate.id}: generated hook profile digest mismatch`);
  return metadata.profile;
}

export async function verifyGeneratedRuntimeProfile({ candidate, verdict, updateDirectory, expectedRevision }) {
  const metadata = JSON.parse(await readFile(join(updateDirectory, 'bundle.json'), 'utf8'));
  if (
    metadata.schemaVersion !== 1 ||
    metadata.kind !== 'termwright-generated-runtime-profile' ||
    candidate.hookStrategy !== 'runtime' ||
    verdict.state !== 'green' ||
    metadata.candidateId !== candidate.id ||
    metadata.candidateDigest !== candidate.candidateDigest ||
    verdict.sourceRevision !== expectedRevision ||
    metadata.sourceRevision !== expectedRevision ||
    metadata.framework !== candidate.frameworkId ||
    metadata.profile?.version !== candidate.version ||
    Object.keys(metadata.profile).sort().join(',') !== 'version'
  )
    throw new Error(`${candidate.id}: generated runtime profile is not bound to the green candidate`);
  const digest = `sha256:${createHash('sha256').update(canonicalJson(metadata.profile)).digest('hex')}`;
  if (metadata.profileDigest !== digest) throw new Error(`${candidate.id}: generated runtime profile digest mismatch`);
  return metadata.profile;
}

export function sameHookProfile(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

export function addCertifiedRuntimeProfile(document, candidate, profile) {
  if (candidate.frameworkId !== 'opentui' || candidate.hookStrategy !== 'runtime' || profile.version !== candidate.version) {
    throw new Error(`${candidate.id}: runtime profile targets another framework or version`);
  }
  const existing = document.profiles.find((entry) => entry.version === candidate.version);
  if (existing === undefined) document.profiles.push(profile);
  else if (canonicalJson(existing) !== canonicalJson(profile)) throw new Error(`${candidate.id}: certified runtime profile is immutable`);
  document.profiles.sort((left, right) => compareVersions(left.version, right.version));
  return document;
}

export function recordVerifiedFrameworkVersion(registry, candidate) {
  const framework = registry.frameworks?.find((entry) => entry.id === candidate.frameworkId);
  if (framework === undefined) throw new Error(`${candidate.id}: compatibility framework row is missing`);
  if (typeof framework.certification?.adapterVersion !== 'string' || framework.certification.adapterVersion.length === 0) {
    throw new Error(`${candidate.id}: compatibility framework certification adapter version is missing`);
  }
  if (typeof framework.frameworkPackage !== 'string' || candidate.package !== framework.frameworkPackage) {
    throw new Error(`${candidate.id}: candidate package does not match the compatibility framework package`);
  }
  const next = structuredClone(framework);
  if (!next.versions.verified.includes(candidate.version)) next.versions.verified.push(candidate.version);
  next.versions.verified.sort(compareVersions);
  if (next.versions.policy === 'exact') next.versions.declared = next.versions.verified.join(' or ');
  next.certification.ids = next.versions.verified.map((version) => `${next.id}@${version}/${next.certification.adapterVersion}`);
  if (next.certification.strategy !== 'native-hook') {
    const variants = next.instrumentation?.variants;
    if (!Array.isArray(variants)) throw new Error(`${candidate.id}: exact framework variants are missing`);
    for (const version of next.versions.verified) {
      const expected = {
        id: `${next.id}-${version}`,
        frameworkVersion: version,
        modules: [{ name: next.frameworkPackage, version }],
      };
      const existing = variants.find((variant) => variant.frameworkVersion === version);
      if (existing === undefined) variants.push(expected);
      else if (canonicalJson(existing) !== canonicalJson(expected)) {
        throw new Error(`${candidate.id}: existing exact framework variant has another identity`);
      }
    }
    variants.sort((left, right) => compareVersions(left.frameworkVersion, right.frameworkVersion));
  }
  Object.assign(framework, next);
}

export function renderExactPeerRange(versions) {
  if (!Array.isArray(versions) || versions.length === 0 || versions.some((version) => typeof version !== 'string' || version.length === 0)) {
    throw new Error('exact peer range requires at least one version');
  }
  return [...new Set(versions)].sort(compareVersions).join(' || ');
}

async function updateCertifiedHookPeerRanges(frameworkId, versions) {
  if (frameworkId !== 'ink') return;
  const range = renderExactPeerRange(versions);
  for (const relativePath of ['packages/ink/package.json', 'packages/probe-ink/package.json']) {
    const path = join(root, relativePath);
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    if (manifest.peerDependencies?.ink === undefined) throw new Error(`${relativePath}: missing Ink peer dependency`);
    manifest.peerDependencies.ink = range;
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
  }
}

async function main(argv) {
  let registryPath;
  let verdictDirectory;
  let ledgerPath = join(root, 'compatibility/certified-upstreams.json');
  let assessmentsPath = join(root, 'compatibility/candidate-assessments.json');
  let planPath = join(root, 'upstream-publish-plan.json');
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--registry') registryPath = resolve(argv[++i]);
    else if (argv[i] === '--verdicts') verdictDirectory = resolve(argv[++i]);
    else if (argv[i] === '--ledger') ledgerPath = resolve(argv[++i]);
    else if (argv[i] === '--assessments') assessmentsPath = resolve(argv[++i]);
    else if (argv[i] === '--plan') planPath = resolve(argv[++i]);
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (registryPath === undefined || verdictDirectory === undefined) throw new Error('--registry and --verdicts are required');
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  const ledger = JSON.parse(await readFile(ledgerPath, 'utf8'));
  const assessments = JSON.parse(await readFile(assessmentsPath, 'utf8'));
  const config = JSON.parse(await readFile(join(root, 'compatibility/upstream-patches.json'), 'utf8'));
  validateCandidateAssessments(
    assessments,
    config.streams.map((stream) => stream.id),
  );
  const verdicts = await Promise.all((await verdictFiles(verdictDirectory)).map(async (path) => JSON.parse(await readFile(path, 'utf8'))));
  const expectedRevision = process.env.GITHUB_SHA ?? 'local-unpinned';
  const result = reconcile(registry, ledger, verdicts, {
    runUrl: process.env.SOURCE_RUN_URL,
    owner: process.env.ISSUE_OWNER,
    sourceRevision: expectedRevision,
    strictArtifacts: true,
    assessments,
  });
  let compatibility = JSON.parse(await readFile(join(root, 'compatibility/registry.json'), 'utf8'));
  const updates = await generatedUpdateDirectories(verdictDirectory);
  const expectedUpdateNames = registry.candidates
    .filter((candidate) => verdicts.find((entry) => entry.candidateId === candidate.id)?.state === 'green')
    .map(generatedUpdateName)
    .filter((name) => name !== null)
    .sort();
  if ([...updates.keys()].sort().join('\0') !== expectedUpdateNames.join('\0')) {
    throw new Error('generated candidate update artifact set does not match the exact green candidates');
  }
  for (const candidate of registry.candidates) {
    const verdict = verdicts.find((entry) => entry.candidateId === candidate.id);
    if (verdict?.state !== 'green') continue;
    if (candidate.mode === 'capability') {
      if (candidate.capabilityStrategy !== 'compile-conformance' || verdict.executableResolution === null || typeof verdict.executableResolution !== 'object') {
        throw new Error(`${candidate.id}: green capability verdict has no compile-conformance executable resolution`);
      }
      compatibility = recordExecutableVariant(compatibility, candidate, verdict.executableResolution);
      continue;
    }
    if (candidate.mode === 'hook') {
      if (candidate.frameworkId === 'textual') {
        if (candidate.registry !== 'pypi' || candidate.hookStrategy !== 'runtime') throw new Error(`${candidate.id}: green Textual verdict does not describe runtime capability certification`);
        continue;
      }
      if (candidate.hookStrategy === 'runtime') {
        const matched = updates.get(generatedUpdateName(candidate));
        if (matched === undefined) throw new Error(`${candidate.id}: green runtime-hook verdict has no generated capability profile`);
        const profile = await verifyGeneratedRuntimeProfile({
          candidate,
          verdict,
          updateDirectory: matched,
          expectedRevision,
        });
        const profilePath = candidate.frameworkId === 'opentui' ? join(root, 'packages/probe-opentui/src/certified-runtime.json') : undefined;
        if (profilePath === undefined) throw new Error(`${candidate.id}: unsupported runtime-hook profile framework`);
        const document = JSON.parse(await readFile(profilePath, 'utf8'));
        addCertifiedRuntimeProfile(document, candidate, profile);
        await writeFile(profilePath, canonicalJson(document));
        recordVerifiedFrameworkVersion(compatibility, candidate);
        continue;
      }
      if (candidate.hookStrategy !== 'exact-source' || candidate.frameworkId !== 'ink') {
        throw new Error(`${candidate.id}: unsupported exact-source hook profile framework`);
      }
      const matched = updates.get(generatedUpdateName(candidate));
      if (matched === undefined) throw new Error(`${candidate.id}: green hook verdict has no generated instrumentation profile`);
      const profile = await verifyGeneratedHookProfile({
        candidate,
        verdict,
        updateDirectory: matched,
        expectedRevision,
      });
      const profilePath = join(root, 'packages/probe-ink/src/certified-instrumentation.json');
      const document = JSON.parse(await readFile(profilePath, 'utf8'));
      const existing = document.profiles.find((entry) => entry.version === candidate.version);
      if (existing === undefined) document.profiles.push(profile);
      else if (!sameHookProfile(existing, profile)) throw new Error(`${candidate.id}: certified hook profile is immutable`);
      document.profiles.sort((left, right) => compareVersions(left.version, right.version));
      await writeFile(profilePath, canonicalJson(document));
      await updateCertifiedHookPeerRanges(
        candidate.frameworkId,
        document.profiles.map((entry) => entry.version),
      );
      recordVerifiedFrameworkVersion(compatibility, candidate);
      continue;
    }
    let manifest;
    if (candidate.patch.status === 'needs-patch') {
      const matched = updates.get(generatedUpdateName(candidate));
      if (matched === undefined) throw new Error(`${candidate.id}: green verdict has no generated update bundle`);
      const metadata = await verifyGeneratedUpdate({
        candidate,
        verdict,
        updateDirectory: matched,
        expectedRevision,
      });
      const expectedTarget = candidate.patch.path.split('/').slice(0, -1).join('/');
      if (metadata.targetPath !== expectedTarget) throw new Error(`${candidate.id}: generated update targets a different patch directory`);
      const target = join(root, metadata.targetPath);
      if (
        await access(target).then(
          () => true,
          () => false,
        )
      )
        throw new Error(`${candidate.id}: refusing to overwrite an existing patch directory`);
      await mkdir(dirname(target), { recursive: true });
      await cp(join(matched, 'patch'), target, {
        recursive: true,
        errorOnExist: true,
      });
      manifest = JSON.parse(await readFile(join(target, 'manifest.json'), 'utf8'));
    } else if (candidate.patch.status === 'ready') {
      manifest = JSON.parse(await readFile(join(root, candidate.patch.path), 'utf8'));
    } else throw new Error(`${candidate.id}: green verdict has unsupported patch state ${candidate.patch.status}`);
    compatibility = proposeCompatibilityUpdate(compatibility, candidate, manifest);
    compatibility = recordExecutableVariant(compatibility, candidate, verdict.executableResolution);
  }
  const geometryPagePath = join(root, 'website/src/content/docs/reference/geometry-visibility.md');
  const geometryPage = renderGeometryPage(await readFile(geometryPagePath, 'utf8'), compatibility, JSON.parse(await readFile(join(root, 'clients/test-vectors/capability-graph.json'), 'utf8')));
  await writeFile(join(root, 'compatibility/registry.json'), canonicalJson(compatibility));
  await writeFile(join(root, 'compatibility/framework-semantic-completeness.json'), renderSemanticCompletenessReport(compatibility));
  await writeFile(geometryPagePath, geometryPage);
  if (result.plan.green.length > 0) {
    const packages = new Set();
    for (const candidate of registry.candidates.filter((entry) => result.plan.green.includes(entry.id))) {
      if (candidate.frameworkId !== 'textual') {
        packages.add(candidate.frameworkId === 'ratatui' ? 'termwright' : `@termwright/probe-${candidate.frameworkId}`);
      }
      if (candidate.frameworkId === 'ink') packages.add('@termwright/ink');
    }
    const frontmatter = [...packages]
      .sort()
      .map((name) => `"${name}": patch`)
      .join('\n');
    if (packages.size > 0)
      await writeFile(join(root, '.changeset/framework-compatibility-auto.md'), `---\n${frontmatter}\n---\n\nCertify upstream framework releases: ${result.plan.green.join(', ')}.\n`);
  }
  await writeFile(ledgerPath, canonicalJson(result.ledger));
  await writeFile(assessmentsPath, canonicalJson(result.assessments));
  await writeFile(planPath, canonicalJson(result.plan));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
