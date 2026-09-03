#!/usr/bin/env node

/**
 * Keep every publishable workspace manifest bound to this repository.
 *
 * npm trusted publishing validates `repository.url` against the GitHub
 * repository that minted the OIDC token. In a monorepo the `directory` is
 * equally important metadata for people and registry tooling, so neither is
 * allowed to drift independently between packages.
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PACKAGES = join(ROOT, 'packages');
const REPOSITORY_URL = 'git+https://github.com/Gorce-AI/termwright.git';
const SURFACE_PATH = join(ROOT, 'quality/public-api-surface.json');
const SURFACE_CATEGORIES = [
  'public-stable-ish',
  'advanced-intentional',
  'internal-accidentally-exported',
  'obsolete',
  'duplicate',
];
const surface = JSON.parse(await readFile(SURFACE_PATH, 'utf8'));
const classifiedExports = new Map();

if (surface.version !== 1) throw new Error('public API surface registry must use version 1');

for (const category of SURFACE_CATEGORIES) {
  for (const [packageName, subpaths] of Object.entries(surface[category] ?? {})) {
    for (const subpath of subpaths) {
      const identity = `${packageName}:${subpath}`;
      const previous = classifiedExports.get(identity);
      if (previous !== undefined) {
        throw new Error(`${identity} is classified as both ${previous} and ${category}`);
      }
      classifiedExports.set(identity, category);
      if (['internal-accidentally-exported', 'obsolete', 'duplicate'].includes(category)) {
        throw new Error(`${identity} is classified ${category} and must be removed before release`);
      }
    }
  }
}

const entries = await readdir(PACKAGES, { withFileTypes: true });
const errors = [];
const observedExports = new Set();
let publicPackages = 0;

for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
  if (!entry.isDirectory()) continue;

  const manifestPath = join(PACKAGES, entry.name, 'package.json');
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') continue;
    errors.push(
      `${relative(ROOT, manifestPath)}: ${error instanceof Error ? error.message : String(error)}`,
    );
    continue;
  }

  if (manifest.private === true) continue;
  publicPackages += 1;

  for (const subpath of Object.keys(manifest.exports ?? {})) {
    const identity = `${manifest.name}:${subpath}`;
    observedExports.add(identity);
    if (!classifiedExports.has(identity)) {
      errors.push(`${relative(ROOT, manifestPath)}: public export ${subpath} is not classified`);
    }
    if (/(^|\/)internal(?:\/|$)/u.test(subpath)) {
      errors.push(
        `${relative(ROOT, manifestPath)}: public export ${subpath} exposes an internal namespace`,
      );
    }
  }

  const expected = {
    type: 'git',
    url: REPOSITORY_URL,
    directory: `packages/${entry.name}`,
  };
  const actual = manifest.repository;
  if (
    actual?.type !== expected.type ||
    actual?.url !== expected.url ||
    actual?.directory !== expected.directory
  ) {
    errors.push(`${relative(ROOT, manifestPath)}: repository must be ${JSON.stringify(expected)}`);
  }
}

for (const [identity, category] of classifiedExports) {
  if (!observedExports.has(identity)) {
    errors.push(`${relative(ROOT, SURFACE_PATH)}: ${category} entry ${identity} is not exported`);
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`package repository metadata is in sync for ${publicPackages} public packages`);
}
