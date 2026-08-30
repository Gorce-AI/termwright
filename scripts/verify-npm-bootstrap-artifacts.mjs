#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { isDirectExecution } from './is-direct-execution.mjs';
import {
  bootstrapArtifactKind,
  bootstrapDeprecationMessage,
  bootstrapTag,
  bootstrapVersion,
  validatePackedArchive,
  validatePackageSelection,
} from './pack-npm-artifacts.mjs';

export function verifyNpmBootstrapArtifacts(directoryArgument, { expectedSourceCommit } = {}) {
  const directory = resolve(directoryArgument);
  const plan = JSON.parse(
    readFileSync(resolve(import.meta.dirname, 'npm-bootstrap-packages.json'), 'utf8'),
  );
  if (
    plan.schemaVersion !== 2 ||
    plan.version !== bootstrapVersion ||
    plan.tag !== bootstrapTag ||
    plan.deprecationMessage !== bootstrapDeprecationMessage ||
    !Array.isArray(plan.packages)
  )
    throw new Error('npm bootstrap plan does not match the reviewed placeholder policy');
  const manifest = JSON.parse(readFileSync(join(directory, 'bootstrap-manifest.json'), 'utf8'));
  if (
    manifest.schemaVersion !== 2 ||
    manifest.artifactKind !== bootstrapArtifactKind ||
    manifest.publicationTag !== bootstrapTag ||
    manifest.bootstrapVersion !== bootstrapVersion ||
    manifest.deprecationMessage !== bootstrapDeprecationMessage ||
    !/^[0-9a-f]{40}$/u.test(manifest.sourceCommit)
  )
    throw new Error('bootstrap manifest has an invalid schema or source commit');
  if (expectedSourceCommit !== undefined && manifest.sourceCommit !== expectedSourceCommit)
    throw new Error(
      `bootstrap manifest source commit ${manifest.sourceCommit} does not match reviewed commit ${expectedSourceCommit}`,
    );
  if (manifest.packageCount !== plan.packages.length || !Array.isArray(manifest.publicationOrder))
    throw new Error('bootstrap manifest has an invalid package count or publication order');

  const declaredNames = manifest.publicationOrder.map((entry) => entry.name);
  const selected = new Map(plan.packages.map((name) => [name, { manifest: { name } }]));
  validatePackageSelection(declaredNames, selected, { bootstrap: true });
  if (JSON.stringify(declaredNames) !== JSON.stringify(plan.packages))
    throw new Error('bootstrap manifest does not match the reviewed publication order');

  const npmDirectory = join(directory, 'npm');
  const actualEntries = readdirSync(npmDirectory, { withFileTypes: true });
  if (actualEntries.some((entry) => !entry.isFile()))
    throw new Error('bootstrap artifact npm inventory must contain regular files only');
  const actualArchives = actualEntries.map((entry) => entry.name).sort();
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
    const packedManifest = validatePackedArchive(archive, entry.name, { bootstrap: true });
    if (packedManifest.version !== entry.version)
      throw new Error(`${entry.file} version does not match its manifest`);
    if (entry.version !== bootstrapVersion)
      throw new Error(`${entry.file} does not use the reviewed registry bootstrap version`);
  }

  return `verified ${manifest.packageCount} npm bootstrap archives from ${manifest.sourceCommit} in publication order`;
}

if (isDirectExecution(import.meta.url)) {
  if (
    process.argv.length !== 5 ||
    process.argv[3] !== '--expected-sha' ||
    !/^[0-9a-f]{40}$/u.test(process.argv[4] ?? '')
  )
    throw new Error(
      'usage: verify-npm-bootstrap-artifacts.mjs <directory> --expected-sha <reviewed-40-char-sha>',
    );
  console.log(
    verifyNpmBootstrapArtifacts(process.argv[2], { expectedSourceCommit: process.argv[4] }),
  );
}
