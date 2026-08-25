#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const hex = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');

export function verifyNpmMetadata(metadata, expected) {
  if (metadata?.name !== expected.name || metadata?.version !== expected.version || metadata?.dist?.integrity !== expected.integrity) {
    throw new Error(`${expected.name}@${expected.version} exists on npm with different immutable content`);
  }
}

export function verifyPypiMetadata(metadata, expectedFiles, version) {
  if (metadata?.info?.version !== version) throw new Error(`termwright ${version} exists on PyPI with unexpected metadata`);
  const published = new Map((metadata.urls ?? []).map((file) => [file.filename, file.digests?.sha256]));
  if ([...published].some(([name, digest]) => expectedFiles.get(name) !== digest)) {
    throw new Error(`termwright ${version} exists on PyPI with a different immutable file set`);
  }
  return published.size === expectedFiles.size ? 'exact' : 'partial';
}

export function verifyCrateMetadata(metadata, expected) {
  if (metadata?.version?.num !== expected.version || metadata?.version?.checksum !== expected.checksum) {
    throw new Error(`${expected.name}@${expected.version} exists on crates.io with different immutable content`);
  }
}

async function registryJson(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'termwright-release (github.com/Gorce-AI/termwright)' } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`registry metadata request failed with HTTP ${response.status}: ${url}`);
  return response.json();
}

async function verifyNpm(archive) {
  const bytes = await readFile(archive);
  const manifest = JSON.parse((await exec('tar', ['-xOf', archive, 'package/package.json'])).stdout);
  const expected = { name: manifest.name, version: manifest.version, integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` };
  const metadata = await registryJson(`https://registry.npmjs.org/${encodeURIComponent(expected.name)}/${encodeURIComponent(expected.version)}`);
  if (metadata === null) return 'missing';
  verifyNpmMetadata(metadata, expected);
  return 'exact';
}

async function verifyPypi(directory, version) {
  const expected = new Map();
  for (const name of (await readdir(directory)).sort()) expected.set(name, hex('sha256', await readFile(resolve(directory, name))));
  if (expected.size === 0) throw new Error('no local PyPI artifacts to verify');
  const metadata = await registryJson(`https://pypi.org/pypi/termwright/${encodeURIComponent(version)}/json`);
  if (metadata === null) return 'missing';
  return verifyPypiMetadata(metadata, expected, version);
}

async function verifyCrate(archive, name, version) {
  if (basename(archive) !== `${name}-${version}.crate`) throw new Error('crate archive filename is not bound to the requested package and version');
  const expected = { name, version, checksum: hex('sha256', await readFile(archive)) };
  const metadata = await registryJson(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}/${encodeURIComponent(version)}`);
  if (metadata === null) return 'missing';
  verifyCrateMetadata(metadata, expected);
  return 'exact';
}

async function main(argv) {
  const [registry, ...args] = argv;
  const result = registry === 'npm' && args.length === 1
    ? await verifyNpm(resolve(args[0]))
    : registry === 'pypi' && args.length === 2
      ? await verifyPypi(resolve(args[0]), args[1])
      : registry === 'crate' && args.length === 3
        ? await verifyCrate(resolve(args[0]), args[1], args[2])
        : null;
  if (result === null) throw new Error('usage: verify-published-artifact.mjs npm <tgz> | pypi <directory> <version> | crate <crate> <name> <version>');
  process.stdout.write(`${result}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main(process.argv.slice(2));
