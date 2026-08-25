#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalJson } from './discover-framework-candidates.mjs';

const requiredPlatforms = (candidate) => candidate.frameworkId === 'opentui'
  ? ['linux', 'macos']
  : ['linux'];

async function treeDigest(directory, omittedFile) {
  const files = [];
  const visit = async (current) => {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && path !== omittedFile) files.push({
        path: relative(directory, path).split('\\').join('/'),
        sha256: createHash('sha256').update(await readFile(path)).digest('hex'),
      });
      else if (!entry.isFile()) throw new Error(`platform result contains a non-regular entry: ${path}`);
    }
  };
  await visit(directory);
  return createHash('sha256').update(canonicalJson(files)).digest('hex');
}

function validateVerdict(verdict, candidate, sourceRevision, platform) {
  if (
    verdict.schemaVersion !== 1
    || verdict.kind !== 'termwright-framework-candidate-verdict'
    || verdict.candidateId !== candidate.id
    || verdict.candidateDigest !== candidate.candidateDigest
    || verdict.sourceRevision !== sourceRevision
    || !['green', 'red'].includes(verdict.state)
    || typeof verdict.detail !== 'string'
    || verdict.detail.length === 0
    || verdict.detail.length > 12_000
  ) throw new Error(`${candidate.id}: invalid or stale ${platform} verdict`);
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

  const green = results.every(({ verdict }) => verdict.state === 'green');
  let executableResolution;
  if (green) {
    const resolutions = results.map(({ verdict }) => verdict.executableResolution);
    if (candidate.mode === 'patch' && resolutions.some((value) => value === null || typeof value !== 'object')) {
      throw new Error(`${candidate.id}: green patch verdict omitted executableResolution`);
    }
    const present = resolutions.filter((value) => value !== undefined);
    if (present.length > 0) {
      const canonical = canonicalJson(present[0]);
      if (present.length !== resolutions.length || present.some((value) => canonicalJson(value) !== canonical)) {
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
      if (await treeDigest(result.directory, result.verdictPath) !== expected) {
        throw new Error(`${candidate.id}: green platform artifacts disagree`);
      }
    }
    await cp(canonical.directory, output, { recursive: true });
  }
  await writeFile(join(output, `verdict-${slot}.json`), canonicalJson(aggregate));
  return aggregate;
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
  for (const [slot, candidate] of registry.candidates.entries()) {
    await aggregateCandidate({ candidate, slot, inputs, output, sourceRevision });
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
