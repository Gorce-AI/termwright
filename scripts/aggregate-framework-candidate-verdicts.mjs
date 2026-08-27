#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deriveHookInstrumentationProfile } from './certify-framework-candidate.mjs';
import { canonicalJson, downloadVerifiedNpmTarball } from './discover-framework-candidates.mjs';
import {
  materializeCandidateSource,
  preparePatchBundles,
  removeMaterializedCandidateSource,
} from './prepare-framework-candidate.mjs';
import { finishWithCleanups } from './cleanup-resources.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

export const requiredPlatforms = (candidate) =>
  candidate.frameworkId === 'opentui'
    ? ['linux', 'macos']
    : candidate.frameworkId === 'tview'
      ? ['linux', 'windows']
      : ['linux'];

async function treeDigest(directory, omittedFile) {
  const files = [];
  const visit = async (current) => {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && path !== omittedFile) {
        const relativePath = relative(directory, path).split('\\').join('/');
        files.push({
          path: relativePath,
          sha256: createHash('sha256')
            .update(await readFile(path))
            .digest('hex'),
        });
      } else if (!entry.isFile())
        throw new Error(`platform result contains a non-regular entry: ${path}`);
    }
  };
  await visit(directory);
  return createHash('sha256').update(canonicalJson(files)).digest('hex');
}

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

async function validatePlatformArtifactShape(result, slot) {
  const entries = await readdir(result.directory, { withFileTypes: true });
  const expected = [`verdict-${slot}.json`];
  if (
    entries
      .map((entry) => entry.name)
      .sort()
      .join('\0') !== expected.join('\0')
  ) {
    throw new Error(
      `${result.verdict.candidateId}: platform certifier emitted an unexpected artifact shape`,
    );
  }
  for (const entry of entries) {
    if (entry.name === `verdict-${slot}.json` ? !entry.isFile() : !entry.isDirectory()) {
      throw new Error(
        `${result.verdict.candidateId}: platform certifier artifact has an unexpected type`,
      );
    }
  }
}

export async function aggregateCandidate({ candidate, slot, inputs, output, sourceRevision }) {
  const results = [];
  for (const platform of requiredPlatforms(candidate)) {
    const directory = join(inputs, `framework-candidate-result-${slot}-${platform}`);
    const verdictPath = join(directory, `verdict-${slot}.json`);
    const verdict = JSON.parse(await readFile(verdictPath, 'utf8'));
    validateVerdict(verdict, candidate, sourceRevision, platform);
    results.push({ directory, platform, verdict, verdictPath });
  }
  await Promise.all(results.map((result) => validatePlatformArtifactShape(result, slot)));

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
  if (green) {
    const [canonical, ...others] = results;
    const expected = await treeDigest(canonical.directory, canonical.verdictPath);
    for (const result of others) {
      if ((await treeDigest(result.directory, result.verdictPath)) !== expected) {
        throw new Error(`${candidate.id}: green platform artifacts disagree`);
      }
    }
  }
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
  const trustedUpdates = [];
  for (const [slot, candidate] of registry.candidates.entries()) {
    const aggregate = await aggregateCandidate({
      candidate,
      slot,
      inputs,
      output,
      sourceRevision,
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

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
