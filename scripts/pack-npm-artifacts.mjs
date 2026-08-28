#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repositoryUrl = 'git+https://github.com/Gorce-AI/termwright.git';
const nativePackages = [
  '@termwright/pty-darwin-arm64',
  '@termwright/pty-darwin-x64',
  '@termwright/pty-linux-arm64',
  '@termwright/pty-linux-x64',
  '@termwright/pty-win32-arm64',
  '@termwright/pty-win32-x64',
];
export const bootstrapPackageOrder = [
  ...nativePackages,
  '@termwright/evidence-provider',
  '@termwright/resource-broker',
  '@termwright/run-history',
  '@termwright/run-journal-transport',
  '@termwright/pty',
];
const windowsMembers = [
  'package/vendor/conpty.dll',
  'package/vendor/conpty-manifest.json',
  'package/vendor/LICENSE.microsoft-terminal.txt',
  'package/vendor/THIRD_PARTY_NOTICES.md',
  'package/vendor/SBOM.spdx.json',
];
const windowsHostMembers = {
  '@termwright/pty-win32-arm64': ['package/vendor/arm64/OpenConsole.exe'],
  '@termwright/pty-win32-x64': [
    'package/vendor/arm64/OpenConsole.exe',
    'package/vendor/x64/OpenConsole.exe',
  ],
};

function fail(message) {
  throw new Error(message);
}

export function validatePackageSelection(names, manifests, { bootstrap = false } = {}) {
  if (!Array.isArray(names) || names.length === 0) fail('package selection must be non-empty');
  if (new Set(names).size !== names.length) fail('package selection contains duplicate names');
  for (const name of names) {
    const entry = manifests.get(name);
    if (!entry) fail(`selected package ${name} is not a public workspace package`);
    if (entry.manifest.private === true) fail(`selected package ${name} is private`);
  }
  if (!bootstrap) return;
  if (JSON.stringify(names) !== JSON.stringify(bootstrapPackageOrder))
    fail(
      `bootstrap selection must exactly match the reviewed publication order: ${bootstrapPackageOrder.join(', ')}`,
    );
}

export function validatePackedArchive(archive, expectedName) {
  const members = execFileSync('tar', ['-tf', archive], { encoding: 'utf8' })
    .trim()
    .split(/\r?\n/u);
  if (new Set(members).size !== members.length) fail(`${archive} contains duplicate members`);
  if (members.some((member) => member.startsWith('/') || member.split('/').includes('..')))
    fail(`${archive} contains an unsafe member path`);
  if (!members.includes('package/package.json')) fail(`${archive} carries no package manifest`);

  const manifest = JSON.parse(
    execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8' }),
  );
  if (manifest.name !== expectedName)
    fail(`${archive} contains ${String(manifest.name)} instead of ${expectedName}`);
  if (typeof manifest.version !== 'string' || manifest.version.length === 0)
    fail(`${archive} has no package version`);
  if (JSON.stringify(manifest).includes('workspace:'))
    fail(`${archive} contains an unexpanded workspace dependency`);
  if (manifest.repository?.url !== repositoryUrl)
    fail(`${archive} does not identify the repository required for npm provenance`);

  if (nativePackages.includes(expectedName)) {
    if (!members.includes('package/termwright_pty.node'))
      fail(`${archive} carries no addon; a prebuild package without its binary is incomplete`);
    if (expectedName.startsWith('@termwright/pty-win32-')) {
      for (const member of windowsMembers) {
        if (!members.includes(member)) fail(`${archive} carries no ${member}`);
      }
      const expectedHosts = windowsHostMembers[expectedName];
      const actualHosts = members.filter((member) => member.endsWith('/OpenConsole.exe')).sort();
      if (JSON.stringify(actualHosts) !== JSON.stringify(expectedHosts))
        fail(
          `${archive} has invalid OpenConsole inventory: expected ${expectedHosts.join(', ')}, found ${actualHosts.join(', ') || '(none)'}`,
        );
    }
  }
  return manifest;
}

export function parseArguments(arguments_) {
  if (arguments_[0] === '--') arguments_ = arguments_.slice(1);
  const options = {
    output: undefined,
    packageList: undefined,
    manifest: undefined,
    sourceSha: undefined,
  };
  for (let index = 0; index < arguments_.length; index += 2) {
    const value = arguments_[index + 1];
    if (value === undefined) fail(`${arguments_[index]} requires a value`);
    switch (arguments_[index]) {
      case '--output':
        options.output = value;
        break;
      case '--package-list':
        options.packageList = value;
        break;
      case '--manifest':
        options.manifest = value;
        break;
      case '--source-sha':
        options.sourceSha = value;
        break;
      default:
        fail(`unknown argument: ${arguments_[index]}`);
    }
  }
  if (!options.output) fail('--output is required');
  if (options.packageList !== undefined && options.manifest === undefined)
    fail('--package-list requires --manifest');
  if (options.manifest !== undefined && options.sourceSha === undefined)
    fail('--manifest requires --source-sha');
  if (options.sourceSha !== undefined && options.manifest === undefined)
    fail('--source-sha requires --manifest');
  if (options.sourceSha !== undefined && !/^[0-9a-f]{40}$/u.test(options.sourceSha))
    fail('--source-sha must be a lowercase 40-character Git SHA');
  return options;
}

function workspaceManifests(root) {
  const result = new Map();
  for (const directory of readdirSync(join(root, 'packages')).sort()) {
    let manifest;
    try {
      manifest = JSON.parse(
        readFileSync(join(root, 'packages', directory, 'package.json'), 'utf8'),
      );
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    if (manifest.private !== true) {
      if (result.has(manifest.name))
        fail(`duplicate public workspace package name: ${manifest.name}`);
      result.set(manifest.name, { directory, manifest });
    }
  }
  return result;
}

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function packNpmArtifacts(options) {
  const root = resolve(import.meta.dirname, '..');
  const output = resolve(root, options.output);
  mkdirSync(output, { recursive: true });
  const existing = readdirSync(output);
  if (existing.length > 0) fail(`output directory must be empty: ${output}`);

  const manifests = workspaceManifests(root);
  let names = [...manifests.keys()].sort();
  if (options.packageList) {
    const plan = JSON.parse(readFileSync(resolve(root, options.packageList), 'utf8'));
    if (plan.schemaVersion !== 1 || !Array.isArray(plan.packages))
      fail('bootstrap package list must use schemaVersion 1 and a packages array');
    names = plan.packages;
  }
  validatePackageSelection(names, manifests, { bootstrap: options.packageList !== undefined });

  const pnpmCli = process.env.npm_execpath;
  if (!pnpmCli) fail('npm_execpath is missing; invoke this script through pnpm');
  const artifacts = [];
  for (const [order, name] of names.entries()) {
    const { directory } = manifests.get(name);
    const before = new Set(readdirSync(output));
    execFileSync(
      process.execPath,
      [pnpmCli, '--dir', `packages/${directory}`, 'pack', '--pack-destination', output],
      { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] },
    );
    const created = readdirSync(output).filter((file) => !before.has(file));
    if (created.length !== 1 || !created[0].endsWith('.tgz'))
      fail(`packing ${name} created an unexpected inventory: ${created.join(', ')}`);
    const archive = join(output, created[0]);
    const manifest = validatePackedArchive(archive, name);
    artifacts.push({
      order: order + 1,
      name,
      version: manifest.version,
      file: `npm/${basename(archive)}`,
      bytes: statSync(archive).size,
      sha256: digest(archive),
    });
  }

  if (options.manifest) {
    writeFileSync(
      resolve(root, options.manifest),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          sourceCommit: options.sourceSha,
          packageCount: artifacts.length,
          publicationOrder: artifacts,
        },
        null,
        2,
      )}\n`,
    );
  }
  return artifacts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  packNpmArtifacts(parseArguments(process.argv.slice(2)));
}
