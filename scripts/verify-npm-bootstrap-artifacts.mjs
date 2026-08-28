#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { validatePackedArchive, validatePackageSelection } from './pack-npm-artifacts.mjs';

const directory = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('usage: verify-npm-bootstrap-artifacts.mjs <directory>');
const plan = JSON.parse(
  readFileSync(resolve(import.meta.dirname, 'npm-bootstrap-packages.json'), 'utf8'),
);
const manifest = JSON.parse(readFileSync(join(directory, 'bootstrap-manifest.json'), 'utf8'));
if (manifest.schemaVersion !== 1 || !/^[0-9a-f]{40}$/u.test(manifest.sourceCommit))
  throw new Error('bootstrap manifest has an invalid schema or source commit');
if (manifest.packageCount !== plan.packages.length || !Array.isArray(manifest.publicationOrder))
  throw new Error('bootstrap manifest has an invalid package count or publication order');

const declaredNames = manifest.publicationOrder.map((entry) => entry.name);
const selected = new Map(plan.packages.map((name) => [name, { manifest: { name } }]));
validatePackageSelection(declaredNames, selected, { bootstrap: true });
if (JSON.stringify(declaredNames) !== JSON.stringify(plan.packages))
  throw new Error('bootstrap manifest does not match the reviewed publication order');

const npmDirectory = join(directory, 'npm');
const actualArchives = readdirSync(npmDirectory)
  .filter((file) => file.endsWith('.tgz'))
  .sort();
const declaredArchives = manifest.publicationOrder.map((entry) => basename(entry.file)).sort();
if (JSON.stringify(actualArchives) !== JSON.stringify(declaredArchives))
  throw new Error('bootstrap artifact archive inventory does not match its manifest');

for (const [index, entry] of manifest.publicationOrder.entries()) {
  if (entry.order !== index + 1 || entry.file !== `npm/${basename(entry.file)}`)
    throw new Error(`invalid publication order entry for ${String(entry.name)}`);
  const archive = join(directory, entry.file);
  const digest = createHash('sha256').update(readFileSync(archive)).digest('hex');
  if (digest !== entry.sha256 || statSync(archive).size !== entry.bytes)
    throw new Error(`${entry.file} does not match its sealed digest and size`);
  const packedManifest = validatePackedArchive(archive, entry.name);
  if (packedManifest.version !== entry.version)
    throw new Error(`${entry.file} version does not match its manifest`);
}

console.log(
  `verified ${manifest.packageCount} npm bootstrap archives from ${manifest.sourceCommit} in publication order`,
);
