#!/usr/bin/env node

import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const packagesRoot = resolve(import.meta.dirname, '../packages');
const packageListArgument = process.argv.indexOf('--expect-missing');
let expectedMissing;
if (packageListArgument !== -1) {
  const path = process.argv[packageListArgument + 1];
  if (!path || process.argv.length !== packageListArgument + 2)
    throw new Error('--expect-missing requires exactly one package-list path');
  const plan = JSON.parse(await readFile(resolve(path), 'utf8'));
  if (plan.schemaVersion !== 1 || !Array.isArray(plan.packages))
    throw new Error('expected-missing package list must use schemaVersion 1 and a packages array');
  expectedMissing = [...plan.packages].sort();
}
const missing = [];
const errors = [];

const directories = await readdir(packagesRoot, { withFileTypes: true });
await Promise.all(
  directories
    .filter((entry) => entry.isDirectory())
    .map(async (entry) => {
      let manifest;
      try {
        manifest = JSON.parse(
          await readFile(resolve(packagesRoot, entry.name, 'package.json'), 'utf8'),
        );
      } catch (error) {
        if (error?.code === 'ENOENT') return;
        throw error;
      }
      if (manifest.private === true) return;
      const name = manifest.name;
      const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 404) {
        missing.push(name);
        return;
      }
      if (!response.ok) errors.push(`${name}: registry returned HTTP ${response.status}`);
    }),
);

if (expectedMissing !== undefined) {
  const actual = [...missing].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expectedMissing)) {
    errors.push(
      `npm bootstrap scope changed: expected ${expectedMissing.join(', ') || '(none)'}, found ${actual.join(', ') || '(none)'}`,
    );
  }
} else if (missing.length > 0) {
  errors.push(
    `npm package names missing a registry bootstrap: ${missing.sort().join(', ')}`,
    'Publish a reviewed bootstrap version interactively, configure release.yml / npm-publish as its trusted publisher, then start a new first-attempt certification run.',
  );
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(
  expectedMissing === undefined
    ? 'every public workspace package already exists on npm'
    : `npm registry is missing exactly the reviewed ${expectedMissing.length}-package bootstrap scope`,
);
