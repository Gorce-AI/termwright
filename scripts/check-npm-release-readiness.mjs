#!/usr/bin/env node

import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDirectExecution } from './is-direct-execution.mjs';

const registry = 'https://registry.npmjs.org';

async function jsonResponse(fetchImpl, url, label) {
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${label}: registry returned HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new Error(`${label}: registry returned malformed JSON`);
  }
}

function validateRetiredPolicy(policy, active) {
  if (
    policy?.schemaVersion !== 1 ||
    typeof policy.scope !== 'string' ||
    !/^@[a-z0-9][a-z0-9-]*$/u.test(policy.scope) ||
    !Array.isArray(policy.packages)
  )
    throw new Error('retired npm package policy must use schemaVersion 1, a scope and packages');
  const seen = new Set();
  for (const entry of policy.packages) {
    if (
      typeof entry?.name !== 'string' ||
      !entry.name.startsWith(`${policy.scope}/`) ||
      typeof entry.replacement !== 'string' ||
      !active.has(entry.replacement) ||
      typeof entry.deprecationMessage !== 'string' ||
      entry.deprecationMessage.trim() !== entry.deprecationMessage ||
      entry.deprecationMessage.length === 0
    )
      throw new Error(`invalid retired npm package policy entry ${String(entry?.name)}`);
    if (active.has(entry.name))
      throw new Error(`retired npm package is still an active workspace package: ${entry.name}`);
    if (seen.has(entry.name)) throw new Error(`duplicate retired npm package: ${entry.name}`);
    seen.add(entry.name);
  }
  return new Map(policy.packages.map((entry) => [entry.name, entry]));
}

function validateBootstrapPolicy(policy, active) {
  if (
    policy?.schemaVersion !== 2 ||
    policy.version !== '0.0.0-bootstrap.0' ||
    policy.tag !== 'bootstrap' ||
    typeof policy.deprecationMessage !== 'string' ||
    policy.deprecationMessage.trim() !== policy.deprecationMessage ||
    policy.deprecationMessage.length === 0 ||
    !Array.isArray(policy.packages)
  )
    throw new Error('npm bootstrap policy must define the reviewed prerelease contract');
  if (new Set(policy.packages).size !== policy.packages.length)
    throw new Error('npm bootstrap policy contains duplicate package names');
  for (const name of policy.packages) {
    if (typeof name !== 'string' || !active.has(name))
      throw new Error(`invalid npm bootstrap package: ${String(name)}`);
  }
  return policy;
}

function parseStableVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  return match?.slice(1).map(Number);
}

function compareStableVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function validatePublishedBootstrap(name, workspaceVersion, packument, policy, errors) {
  const manifest = packument?.versions?.[policy.version];
  if (manifest === undefined) {
    errors.push(`${name} is missing the reviewed registry bootstrap ${policy.version}`);
    return;
  }
  if (manifest.deprecated !== policy.deprecationMessage)
    errors.push(
      `${name}@${policy.version} must be deprecated with the exact message: ${policy.deprecationMessage}`,
    );
  if (packument?.['dist-tags']?.[policy.tag] !== policy.version)
    errors.push(`${name} must keep dist-tag ${policy.tag} on ${policy.version}`);
  const parsedWorkspace = parseStableVersion(workspaceVersion);
  const firstFunctional = [0, 3, 0];
  for (const publishedVersion of Object.keys(packument?.versions ?? {})) {
    if (publishedVersion === policy.version) continue;
    const parsedPublished = parseStableVersion(publishedVersion);
    if (
      parsedPublished === undefined ||
      parsedWorkspace === undefined ||
      compareStableVersions(parsedPublished, firstFunctional) < 0 ||
      compareStableVersions(parsedPublished, parsedWorkspace) > 0
    )
      errors.push(
        `${name}@${publishedVersion} is not a reviewed functional release at or below workspace version ${workspaceVersion}`,
      );
  }
  const latest = packument?.['dist-tags']?.latest;
  const functionalVersions = Object.keys(packument?.versions ?? {}).filter(
    (publishedVersion) => publishedVersion !== policy.version,
  );
  if (latest === undefined) {
    errors.push(
      `${name} must keep a latest tag: npm assigns the first published version to latest until the first functional release replaces it`,
    );
  } else if (latest === policy.version) {
    if (functionalVersions.length > 0)
      errors.push(
        `${name} latest must move from the deprecated bootstrap placeholder to the reviewed functional release`,
      );
  } else {
    const latestManifest = packument?.versions?.[latest];
    const parsedLatest = parseStableVersion(latest);
    if (
      latestManifest === undefined ||
      parsedLatest === undefined ||
      parsedWorkspace === undefined ||
      compareStableVersions(parsedLatest, firstFunctional) < 0 ||
      compareStableVersions(parsedLatest, parsedWorkspace) > 0 ||
      (typeof latestManifest.deprecated === 'string' && latestManifest.deprecated.length > 0)
    )
      errors.push(
        `${name} latest tag ${String(latest)} is not a reviewed functional release at or below workspace version ${workspaceVersion}`,
      );
  }
  if (
    manifest.dependencies !== undefined ||
    manifest.optionalDependencies !== undefined ||
    manifest.peerDependencies !== undefined ||
    manifest.scripts !== undefined ||
    manifest.bin !== undefined
  )
    errors.push(`${name}@${policy.version} is not a dependency-free administrative placeholder`);
}

export async function checkNpmReleaseReadiness({
  packagesRoot,
  retiredPolicy,
  bootstrapPolicy,
  expectedMissing,
  fetchImpl = fetch,
}) {
  const activeVersions = new Map();
  const directories = await readdir(packagesRoot, { withFileTypes: true });
  for (const entry of directories.filter((candidate) => candidate.isDirectory())) {
    let manifest;
    try {
      manifest = JSON.parse(
        await readFile(resolve(packagesRoot, entry.name, 'package.json'), 'utf8'),
      );
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    if (manifest.private !== true) {
      if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string')
        throw new Error(`public workspace package ${entry.name} has no name or version`);
      activeVersions.set(manifest.name, manifest.version);
    }
  }
  const active = new Set(activeVersions.keys());
  const retired = validateRetiredPolicy(retiredPolicy, active);
  const bootstrap =
    bootstrapPolicy === undefined ? undefined : validateBootstrapPolicy(bootstrapPolicy, active);
  const bootstrapNames = new Set(bootstrap?.packages ?? []);
  const missing = [];
  const errors = [];
  const bootstrapPackuments = new Map();

  await Promise.all(
    [...active].map(async (name) => {
      const response = await fetchImpl(`${registry}/${encodeURIComponent(name)}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 404) missing.push(name);
      else if (!response.ok) errors.push(`${name}: registry returned HTTP ${response.status}`);
      else if (bootstrapNames.has(name)) {
        try {
          bootstrapPackuments.set(name, await response.json());
        } catch {
          errors.push(`${name}: registry returned malformed JSON`);
        }
      }
    }),
  );

  if (bootstrap !== undefined) {
    for (const name of bootstrap.packages) {
      const packument = bootstrapPackuments.get(name);
      if (packument !== undefined)
        validatePublishedBootstrap(name, activeVersions.get(name), packument, bootstrap, errors);
    }
  }

  const expected = expectedMissing === undefined ? undefined : [...expectedMissing].sort();
  const actualMissing = [...missing].sort();
  if (expected !== undefined && JSON.stringify(actualMissing) !== JSON.stringify(expected)) {
    errors.push(
      `npm bootstrap scope changed: expected ${expected.join(', ') || '(none)'}, found ${actualMissing.join(', ') || '(none)'}`,
    );
  } else if (expected === undefined && actualMissing.length > 0) {
    errors.push(
      `npm package names missing a registry bootstrap: ${actualMissing.join(', ')}`,
      'Publish a reviewed bootstrap version interactively, configure release.yml / npm-publish as its trusted publisher, then start a new first-attempt certification run.',
    );
  }

  const scopeInventory = await jsonResponse(
    fetchImpl,
    `${registry}/-/org/${retiredPolicy.scope.slice(1)}/package?format=cli`,
    `${retiredPolicy.scope} namespace inventory`,
  );
  if (
    typeof scopeInventory !== 'object' ||
    scopeInventory === null ||
    Array.isArray(scopeInventory) ||
    Object.values(scopeInventory).some((access) => typeof access !== 'string')
  )
    throw new Error(`${retiredPolicy.scope} namespace inventory has an invalid shape`);

  const expectedRegistry = new Set(
    [...active].filter(
      (name) => name.startsWith(`${retiredPolicy.scope}/`) && !actualMissing.includes(name),
    ),
  );
  for (const name of retired.keys()) expectedRegistry.add(name);
  const actualRegistry = new Set(Object.keys(scopeInventory));
  const unexpected = [...actualRegistry].filter((name) => !expectedRegistry.has(name)).sort();
  const absent = [...expectedRegistry].filter((name) => !actualRegistry.has(name)).sort();
  if (unexpected.length > 0)
    errors.push(
      `unreviewed npm packages exist in ${retiredPolicy.scope}: ${unexpected.join(', ')}`,
    );
  if (absent.length > 0)
    errors.push(`reviewed npm namespace inventory is missing: ${absent.join(', ')}`);

  await Promise.all(
    [...retired.values()].map(async (entry) => {
      const packument = await jsonResponse(
        fetchImpl,
        `${registry}/${encodeURIComponent(entry.name)}`,
        entry.name,
      );
      const versions = Object.entries(packument?.versions ?? {});
      if (versions.length === 0) {
        errors.push(`retired npm package has no published versions: ${entry.name}`);
        return;
      }
      for (const [version, manifest] of versions) {
        if (manifest?.deprecated !== entry.deprecationMessage) {
          errors.push(
            `${entry.name}@${version} must be deprecated with the exact message: ${entry.deprecationMessage}`,
          );
        }
      }
    }),
  );

  if (errors.length > 0) throw new Error(errors.join('\n'));
  return expected === undefined
    ? `every public workspace package exists on npm${bootstrap === undefined ? '' : ', the bootstrap placeholder policy is exact,'} and the namespace retirement policy is exact`
    : `npm registry is missing exactly the reviewed ${expected.length}-package bootstrap scope and the namespace retirement policy is exact`;
}

async function main() {
  const packageListArgument = process.argv.indexOf('--expect-missing');
  let expectedMissing;
  if (packageListArgument !== -1) {
    const path = process.argv[packageListArgument + 1];
    if (!path || process.argv.length !== packageListArgument + 2)
      throw new Error('--expect-missing requires exactly one package-list path');
    const plan = JSON.parse(await readFile(resolve(path), 'utf8'));
    if (plan.schemaVersion !== 2 || !Array.isArray(plan.packages))
      throw new Error(
        'expected-missing package list must use schemaVersion 2 and a packages array',
      );
    expectedMissing = plan.packages;
  }
  const retiredPolicy = JSON.parse(
    await readFile(resolve(import.meta.dirname, 'npm-retired-packages.json'), 'utf8'),
  );
  const bootstrapPolicy = JSON.parse(
    await readFile(resolve(import.meta.dirname, 'npm-bootstrap-packages.json'), 'utf8'),
  );
  console.log(
    await checkNpmReleaseReadiness({
      packagesRoot: resolve(import.meta.dirname, '../packages'),
      retiredPolicy,
      bootstrapPolicy,
      expectedMissing,
    }),
  );
}

if (isDirectExecution(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
