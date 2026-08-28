#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveHookInstrumentationProfile } from './certify-framework-candidate.mjs';
import { canonicalJson, downloadVerifiedNpmTarball } from './discover-framework-candidates.mjs';
import {
  materializeCandidateSource,
  preparePatchBundles,
  removeMaterializedCandidateSource,
} from './prepare-framework-candidate.mjs';
import { finishWithCleanups } from './cleanup-resources.mjs';
import { isDirectExecution } from './is-direct-execution.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

export const requiredPlatforms = (candidate) =>
  candidate.frameworkId === 'opentui'
    ? ['linux', 'macos']
    : candidate.frameworkId === 'tview'
      ? ['linux', 'windows']
      : ['linux'];

function validateVerdict(verdict, candidate, sourceRevision, platform) {
  if (
    verdict.schemaVersion !== 1 ||
    verdict.kind !== 'termwright-framework-candidate-verdict' ||
    verdict.candidateId !== candidate.id ||
    verdict.candidateDigest !== candidate.candidateDigest ||
    verdict.sourceRevision !== sourceRevision ||
    verdict.platform !== platform ||
    !['green', 'red'].includes(verdict.state) ||
    typeof verdict.detail !== 'string' ||
    verdict.detail.length === 0 ||
    verdict.detail.length > 12_000
  )
    throw new Error(`${candidate.id}: invalid or stale ${platform} verdict`);
}

export async function inventoryPlatformVerdicts({
  candidates,
  inputs,
  registryPath,
  sourceRevision,
}) {
  const expected = candidates.flatMap((candidate, slot) =>
    candidate === undefined
      ? []
      : requiredPlatforms(candidate).map((platform) => ({
          candidate,
          filename: `verdict-${slot}-${platform}.json`,
          platform,
          slot,
        })),
  );
  const entries = await readdir(inputs, { withFileTypes: true });
  const actualNames = entries.map(({ name }) => name).sort();
  const expectedNames = [
    ...expected.map(({ platform, slot }) => `framework-candidate-result-${slot}-${platform}`),
    ...(registryPath === undefined ? [] : ['framework-candidate-result-registry']),
  ].sort();
  if (
    entries.some((entry) => !entry.isDirectory()) ||
    actualNames.join('\0') !== expectedNames.join('\0')
  )
    throw new Error('platform certifier emitted an unexpected artifact shape');

  if (registryPath !== undefined) {
    const directory = join(inputs, 'framework-candidate-result-registry');
    const registryEntries = await readdir(directory, { withFileTypes: true });
    if (
      registryEntries.length !== 1 ||
      registryEntries[0].name !== 'candidate-registry.json' ||
      !registryEntries[0].isFile()
    )
      throw new Error('candidate registry artifact has an unexpected shape');
    const [trustedRegistry, sentinelRegistry] = await Promise.all([
      readFile(registryPath),
      readFile(join(directory, 'candidate-registry.json')),
    ]);
    if (!trustedRegistry.equals(sentinelRegistry))
      throw new Error('candidate registry artifacts disagree');
  }

  const bySlot = new Map();
  for (const { candidate, filename, platform, slot } of expected) {
    const directory = join(inputs, `framework-candidate-result-${slot}-${platform}`);
    const artifactEntries = await readdir(directory, { withFileTypes: true });
    if (
      artifactEntries.length !== 1 ||
      artifactEntries[0].name !== filename ||
      !artifactEntries[0].isFile()
    )
      throw new Error(`${candidate.id}: platform certifier emitted an unexpected artifact shape`);
    const verdictPath = join(directory, filename);
    const metadata = await stat(verdictPath);
    if (metadata.size > 64 * 1024)
      throw new Error(`${candidate.id}: platform verdict is oversized`);
    const bytes = await readFile(verdictPath);
    const verdict = JSON.parse(bytes.toString('utf8'));
    validateVerdict(verdict, candidate, sourceRevision, platform);
    const results = bySlot.get(slot) ?? [];
    results.push({ platform, verdict, verdictPath });
    bySlot.set(slot, results);
  }
  return bySlot;
}

export async function aggregateCandidate({
  candidate,
  slot,
  inputs,
  output,
  sourceRevision,
  platformResults,
}) {
  const results =
    platformResults ??
    (
      await inventoryPlatformVerdicts({
        candidates: Array.from({ length: slot + 1 }, (_, index) =>
          index === slot ? candidate : undefined,
        ),
        inputs,
        sourceRevision,
      })
    ).get(slot);

  const green = results.every(({ verdict }) => verdict.state === 'green');
  let executableResolution;
  if (green) {
    const resolutions = results.map(({ verdict }) => verdict.executableResolution);
    if (
      ['patch', 'capability'].includes(candidate.mode) &&
      resolutions.some((value) => value === null || typeof value !== 'object')
    ) {
      throw new Error(
        `${candidate.id}: green ${candidate.mode} verdict omitted executableResolution`,
      );
    }
    const present = resolutions.filter((value) => value !== undefined);
    if (present.length > 0) {
      const canonical = canonicalJson(present[0]);
      if (
        present.length !== resolutions.length ||
        present.some((value) => canonicalJson(value) !== canonical)
      ) {
        throw new Error(`${candidate.id}: platform executable resolutions disagree`);
      }
      executableResolution = present[0];
    }
  }
  const detail = results
    .map(({ platform, verdict }) => `[${platform}] ${verdict.state}: ${verdict.detail}`)
    .join('\n\n')
    .slice(0, 12_000);
  const aggregate = {
    schemaVersion: 1,
    kind: 'termwright-framework-candidate-verdict',
    candidateId: candidate.id,
    candidateDigest: candidate.candidateDigest,
    sourceRevision,
    state: green ? 'green' : 'red',
    detail,
    ...(executableResolution === undefined ? {} : { executableResolution }),
  };

  await mkdir(output, { recursive: true });
  await writeFile(join(output, `verdict-${slot}.json`), canonicalJson(aggregate));
  return aggregate;
}

async function freshUpdateDirectory(output, name) {
  const directory = join(output, name);
  if (
    await access(directory).then(
      () => true,
      () => false,
    )
  )
    throw new Error(`trusted update namespace already exists: ${name}`);
  return directory;
}

export async function writeTrustedRuntimeUpdate({ candidate, output, sourceRevision }) {
  const suffix = candidate.candidateDigest.slice('sha256:'.length, 'sha256:'.length + 16);
  const directory = await freshUpdateDirectory(output, `candidate-update-runtime-${suffix}`);
  await mkdir(directory);
  const profile = { version: candidate.version };
  await writeFile(
    join(directory, 'bundle.json'),
    canonicalJson({
      schemaVersion: 1,
      kind: 'termwright-generated-runtime-profile',
      candidateId: candidate.id,
      candidateDigest: candidate.candidateDigest,
      sourceRevision,
      framework: candidate.frameworkId,
      profile,
      profileDigest: `sha256:${createHash('sha256').update(canonicalJson(profile)).digest('hex')}`,
    }),
  );
}

export async function writeTrustedHookUpdate({ candidate, output, sourceRevision }) {
  const archiveBytes = await downloadVerifiedNpmTarball(candidate.source);
  const derived = await deriveHookInstrumentationProfile(candidate, archiveBytes, sourceRevision);
  const profile = {
    version: derived.version,
    rendererSha256: derived.rendererSha256,
    coreSha256: derived.coreSha256,
  };
  const suffix = candidate.candidateDigest.slice('sha256:'.length, 'sha256:'.length + 16);
  const directory = await freshUpdateDirectory(output, `candidate-update-hook-${suffix}`);
  await mkdir(directory);
  await writeFile(
    join(directory, 'bundle.json'),
    canonicalJson({
      schemaVersion: 1,
      kind: 'termwright-generated-hook-profile',
      candidateId: candidate.id,
      candidateDigest: candidate.candidateDigest,
      sourceRevision,
      framework: candidate.frameworkId,
      profile,
      profileDigest: `sha256:${createHash('sha256').update(canonicalJson(profile)).digest('hex')}`,
    }),
  );
}

export async function writeTrustedPatchUpdates(
  { candidates, output, sourceRevision },
  {
    materialize = materializeCandidateSource,
    prepare = preparePatchBundles,
    freshOutput = freshUpdateDirectory,
    cleanup = removeMaterializedCandidateSource,
  } = {},
) {
  if (candidates.length === 0) return;
  const requests = [];
  const sourceRoots = [];
  let hasPrimary = false;
  let primaryError;
  try {
    for (const candidate of candidates) {
      const suffix = candidate.candidateDigest.slice('sha256:'.length, 'sha256:'.length + 16);
      const sourceLease = await materialize(candidate);
      sourceRoots.push(sourceLease);
      requests.push({
        rootDir: root,
        candidate,
        sourceRoot: sourceLease.sourceRoot,
        outputDirectory: await freshOutput(output, `candidate-update-${suffix}`),
        sourceRevision,
      });
    }
    await prepare(requests);
  } catch (error) {
    hasPrimary = true;
    primaryError = error;
  }
  await finishWithCleanups({
    hasPrimary,
    primaryError,
    cleanups: sourceRoots.map((sourceLease) => async () => cleanup(sourceLease)),
    message: 'trusted patch preparation and source cleanup failed',
  });
}

export async function writeTrustedPatchUpdate({ candidate, output, sourceRevision }) {
  await writeTrustedPatchUpdates({
    candidates: [candidate],
    output,
    sourceRevision,
  });
}

async function main(argv) {
  let registryPath;
  let inputs;
  let output;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--registry') registryPath = resolve(argv[++index]);
    else if (argv[index] === '--inputs') inputs = resolve(argv[++index]);
    else if (argv[index] === '--output') output = resolve(argv[++index]);
    else throw new Error(`unknown argument ${argv[index]}`);
  }
  if (registryPath === undefined || inputs === undefined || output === undefined) {
    throw new Error('--registry, --inputs and --output are required');
  }
  const registry = JSON.parse(await readFile(registryPath, 'utf8'));
  const sourceRevision = process.env.GITHUB_SHA ?? 'local-unpinned';
  const platformVerdicts = await inventoryPlatformVerdicts({
    candidates: registry.candidates,
    inputs,
    registryPath,
    sourceRevision,
  });
  const trustedUpdates = [];
  for (const [slot, candidate] of registry.candidates.entries()) {
    const aggregate = await aggregateCandidate({
      candidate,
      slot,
      output,
      sourceRevision,
      platformResults: platformVerdicts.get(slot),
    });
    if (aggregate.state === 'green') trustedUpdates.push(candidate);
  }
  await writeTrustedPatchUpdates({
    candidates: trustedUpdates.filter(
      (candidate) => candidate.mode === 'patch' && candidate.patch.status === 'needs-patch',
    ),
    output,
    sourceRevision,
  });
  for (const candidate of trustedUpdates) {
    if (candidate.frameworkId === 'textual') continue;
    if (candidate.mode === 'hook' && candidate.hookStrategy === 'runtime')
      await writeTrustedRuntimeUpdate({ candidate, output, sourceRevision });
    else if (candidate.mode === 'hook' && candidate.hookStrategy === 'exact-source')
      await writeTrustedHookUpdate({ candidate, output, sourceRevision });
  }
}

if (isDirectExecution(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
