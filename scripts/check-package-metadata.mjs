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

const entries = await readdir(PACKAGES, { withFileTypes: true });
const errors = [];
let publicPackages = 0;

for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
  if (!entry.isDirectory()) continue;

  const manifestPath = join(PACKAGES, entry.name, 'package.json');
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') continue;
    errors.push(`${relative(ROOT, manifestPath)}: ${error instanceof Error ? error.message : String(error)}`);
    continue;
  }

  if (manifest.private === true) continue;
  publicPackages += 1;

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
    errors.push(
      `${relative(ROOT, manifestPath)}: repository must be ${JSON.stringify(expected)}`,
    );
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`package repository metadata is in sync for ${publicPackages} public packages`);
}
