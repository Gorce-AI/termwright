#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const packagesRoot = join(root, 'packages');
const privatePackages = new Set();
const manifests = new Map();

for (const directory of readdirSync(packagesRoot).sort()) {
  const path = join(packagesRoot, directory, 'package.json');
  let manifest;
  try { manifest = JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) {
    if (error?.code === 'ENOENT') continue;
    throw error;
  }
  manifests.set(manifest.name, { directory, manifest });
  if (manifest.private === true) privatePackages.add(manifest.name);
}

const errors = [];
for (const [name, { manifest }] of manifests) {
  if (manifest.private === true) continue;
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const dependency of Object.keys(manifest[field] ?? {})) {
      if (privatePackages.has(dependency)) errors.push(`${name} has runtime ${field} on private ${dependency}`);
    }
  }
}

for (const directory of ['resource-broker', 'run-journal-transport']) {
  const dist = join(packagesRoot, directory, 'dist');
  for (const file of readdirSync(dist).filter((name) => name.endsWith('.js') || name.endsWith('.d.ts'))) {
    const source = readFileSync(join(dist, file), 'utf8');
    for (const privatePackage of privatePackages) {
      if (source.includes(`from \"${privatePackage}\"`) || source.includes(`from '${privatePackage}'`)) {
        errors.push(`packages/${directory}/dist/${file} imports private ${privatePackage}`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), 'termwright-private-boundaries-'));
try {
  const pnpmCli = process.env.npm_execpath;
  if (!pnpmCli) throw new Error('npm_execpath is missing; run this check through pnpm');
  const archives = Object.fromEntries(['protocol', 'resource-broker', 'run-journal-transport'].map((directory) => {
    const output = execFileSync(process.execPath, [pnpmCli, '--dir', `packages/${directory}`, 'pack', '--pack-destination', work], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    }).trim().split(/\r?\n/u).at(-1);
    if (!output) throw new Error(`pnpm pack produced no archive for ${directory}`);
    return [directory, output];
  }));
  const dependencies = Object.fromEntries(Object.entries(archives).map(([directory, archive]) => [
    `@termwright/${directory}`,
    `file:${archive}`,
  ]));
  writeFileSync(join(work, 'package.json'), `${JSON.stringify({
    private: true,
    type: 'module',
    dependencies,
    pnpm: { overrides: { '@termwright/protocol': dependencies['@termwright/protocol'] } },
  }, null, 2)}\n`);
  execFileSync(process.execPath, [pnpmCli, '--dir', work, 'install', '--ignore-scripts'], {
    cwd: root,
    stdio: 'inherit',
  });
  const consumer = join(work, 'consumer.mjs');
  writeFileSync(consumer, "await import('@termwright/resource-broker/transport');\nawait import('@termwright/run-journal-transport');\n");
  execFileSync(process.execPath, [consumer], { cwd: work, stdio: 'inherit' });
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log('private workspace runtime boundaries are bundled and packed consumers import cleanly');
