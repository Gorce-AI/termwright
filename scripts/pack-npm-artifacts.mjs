#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { isDirectExecution } from './is-direct-execution.mjs';
import { inspectSafeTarGz } from './safe-tar.mjs';

const repositoryUrl = 'git+https://github.com/Gorce-AI/termwright.git';
export const bootstrapVersion = '0.0.0-bootstrap.0';
export const bootstrapTag = 'bootstrap';
export const bootstrapArtifactKind = 'registry-bootstrap-placeholders-v1';
export const bootstrapDeprecationMessage =
  'Registry bootstrap placeholder; install version 0.3.0 or newer.';
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
  'package/vendor/NOTICE.microsoft-terminal.md',
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

function bootstrapDiagnostic(name) {
  return `${name}@${bootstrapVersion} is a registry bootstrap placeholder; install ${name}@^0.3.0.`;
}

function bootstrapManifest(name) {
  return {
    name,
    version: bootstrapVersion,
    description: `Registry bootstrap placeholder for ${name}; install ^0.3.0.`,
    license: 'MIT',
    type: 'module',
    exports: { '.': { types: './index.d.ts', import: './index.js' } },
    files: ['index.js', 'index.d.ts', 'README.md', 'LICENSE'],
    repository: { type: 'git', url: repositoryUrl },
    publishConfig: { access: 'public', tag: bootstrapTag },
  };
}

function bootstrapReadme(name) {
  return `# ${name}\n\nThis prerelease exists only to establish the npm package name before Termwright 0.3.0 trusted publishing. Install ${name}@^0.3.0 for the functional package.\n`;
}

function bootstrapFiles(name, root) {
  return new Map([
    ['package/LICENSE', readFileSync(join(root, 'LICENSE'))],
    ['package/README.md', Buffer.from(bootstrapReadme(name))],
    ['package/index.d.ts', Buffer.from('export {};\n')],
    [
      'package/index.js',
      Buffer.from(`throw new Error(${JSON.stringify(bootstrapDiagnostic(name))});\n`),
    ],
    ['package/package.json', Buffer.from(`${JSON.stringify(bootstrapManifest(name), null, 2)}\n`)],
  ]);
}

export function validatePackedArchive(archive, expectedName, { bootstrap = false } = {}) {
  const resolvedArchive = resolve(archive);
  const entries = inspectSafeTarGz(readFileSync(resolvedArchive));
  const members = entries.map((entry) => entry.path);
  if (!members.includes('package/package.json')) fail(`${archive} carries no package manifest`);

  const manifestEntry = entries.find(
    (entry) => entry.type === '0' && entry.path === 'package/package.json',
  );
  if (manifestEntry === undefined) fail(`${archive} carries no regular package manifest`);
  const manifest = JSON.parse(manifestEntry.payload.toString('utf8'));
  if (manifest.name !== expectedName)
    fail(`${archive} contains ${String(manifest.name)} instead of ${expectedName}`);
  if (typeof manifest.version !== 'string' || manifest.version.length === 0)
    fail(`${archive} has no package version`);
  if (JSON.stringify(manifest).includes('workspace:'))
    fail(`${archive} contains an unexpanded workspace dependency`);
  if (manifest.repository?.url !== repositoryUrl)
    fail(`${archive} does not identify the repository required for npm provenance`);

  if (bootstrap) {
    const expectedMembers = [
      'package/LICENSE',
      'package/README.md',
      'package/index.d.ts',
      'package/index.js',
      'package/package.json',
    ];
    if (JSON.stringify([...members].sort()) !== JSON.stringify(expectedMembers))
      fail(`${archive} has invalid registry bootstrap placeholder inventory`);
    if (
      manifest.dependencies !== undefined ||
      manifest.optionalDependencies !== undefined ||
      manifest.peerDependencies !== undefined ||
      manifest.scripts !== undefined ||
      manifest.bin !== undefined
    )
      fail(
        `${archive} registry bootstrap placeholder must not declare dependencies or executables`,
      );
    if (JSON.stringify(manifest) !== JSON.stringify(bootstrapManifest(expectedName)))
      fail(`${archive} has an invalid registry bootstrap placeholder manifest`);
    const expectedFiles = bootstrapFiles(expectedName, resolve(import.meta.dirname, '..'));
    for (const entry of entries) {
      const expected = expectedFiles.get(entry.path);
      if (entry.type !== '0' || expected === undefined || !entry.payload.equals(expected))
        fail(`${archive} has invalid registry bootstrap placeholder contents`);
    }
    return manifest;
  }

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

function tarEntry(path, contents) {
  const payload = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
  const header = Buffer.alloc(512);
  header.write(path, 0, 100, 'utf8');
  header.write('0000644\0', 100, 8, 'ascii');
  header.write('0000000\0', 108, 8, 'ascii');
  header.write('0000000\0', 116, 8, 'ascii');
  header.write(`${payload.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  header.write('00000000000\0', 136, 12, 'ascii');
  header.fill(0x20, 148, 156);
  header[156] = '0'.charCodeAt(0);
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return Buffer.concat([header, payload, Buffer.alloc((512 - (payload.length % 512)) % 512)]);
}

function packBootstrapPlaceholder({ name, output, root }) {
  const files = bootstrapFiles(name, root);
  const tar = Buffer.concat([
    ...[...files].map(([path, contents]) => tarEntry(path, contents)),
    Buffer.alloc(1024),
  ]);
  const filename = `${name.slice(1).replace('/', '-')}-${bootstrapVersion}.tgz`;
  writeFileSync(join(output, filename), gzipSync(tar, { level: 9 }));
}

export function parseArguments(arguments_) {
  if (arguments_[0] === '--') arguments_ = arguments_.slice(1);
  const options = {
    output: undefined,
    packageList: undefined,
    manifest: undefined,
    sourceSha: undefined,
    artifactMode: 'standard',
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
      case '--artifact-mode':
        options.artifactMode = value;
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
  if (options.artifactMode !== 'standard' && options.artifactMode !== 'bootstrap-placeholders')
    fail('--artifact-mode must be standard or bootstrap-placeholders');
  if (options.artifactMode === 'bootstrap-placeholders' && options.packageList === undefined)
    fail('bootstrap-placeholders artifact mode requires --package-list');
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

const unorderedManifestRecords = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
];

function sortedRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, value[key]]),
  );
}

export function canonicalizePublishedManifest(manifest) {
  for (const field of unorderedManifestRecords) {
    if (manifest[field] !== undefined) manifest[field] = sortedRecord(manifest[field]);
  }
  return manifest;
}

function tarField(buffer, start, length) {
  const terminator = buffer.indexOf(0, start);
  const end = terminator >= start && terminator < start + length ? terminator : start + length;
  return buffer.subarray(start, end).toString('utf8').trim();
}

function tarSize(header) {
  const encoded = tarField(header, 124, 12);
  if (!/^[0-7]+$/u.test(encoded)) fail('packed archive has an invalid tar entry size');
  const size = Number.parseInt(encoded, 8);
  if (!Number.isSafeInteger(size) || size < 0) fail('packed archive has an invalid tar entry size');
  return size;
}

export function canonicalizePackedArchive(archive) {
  const original = readFileSync(archive);
  const inspected = inspectSafeTarGz(original);
  const manifestEntry = inspected.find(
    (entry) => entry.type === '0' && entry.path === 'package/package.json',
  );
  if (manifestEntry === undefined) fail(`${archive} carries no regular package manifest`);
  const manifestText = manifestEntry.payload.toString('utf8');
  const trailingNewline = manifestText.endsWith('\n') ? '\n' : '';
  const canonicalManifest = Buffer.from(
    `${JSON.stringify(
      canonicalizePublishedManifest(JSON.parse(manifestText)),
      null,
      2,
    )}${trailingNewline}`,
  );
  if (canonicalManifest.length !== manifestEntry.payload.length)
    fail(`${archive} manifest canonicalization changed its byte length`);

  const tar = gunzipSync(original);
  let offset = 0;
  let replacements = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = tarSize(header);
    const name = [tarField(header, 345, 155), tarField(header, 0, 100)].filter(Boolean).join('/');
    const payloadOffset = offset + 512;
    if (name === 'package/package.json' && String.fromCharCode(header[156] || 0x30) === '0') {
      if (size !== canonicalManifest.length)
        fail(`${archive} manifest size does not match its tar header`);
      canonicalManifest.copy(tar, payloadOffset);
      replacements += 1;
    }
    offset = payloadOffset + Math.ceil(size / 512) * 512;
  }
  if (replacements !== 1) fail(`${archive} has an ambiguous package manifest inventory`);
  writeFileSync(archive, gzipSync(tar, { level: 9 }));
  inspectSafeTarGz(readFileSync(archive));
}

export function packNpmArtifacts(options) {
  const root = resolve(import.meta.dirname, '..');
  const output = resolve(root, options.output);
  mkdirSync(output, { recursive: true });
  const existing = readdirSync(output);
  if (existing.length > 0) fail(`output directory must be empty: ${output}`);

  const manifests = workspaceManifests(root);
  let names = [...manifests.keys()].sort();
  const bootstrap = options.artifactMode === 'bootstrap-placeholders';
  if (options.packageList) {
    const plan = JSON.parse(readFileSync(resolve(root, options.packageList), 'utf8'));
    if (
      !Array.isArray(plan.packages) ||
      (bootstrap
        ? plan.schemaVersion !== 2 ||
          plan.version !== bootstrapVersion ||
          plan.tag !== bootstrapTag ||
          plan.deprecationMessage !== bootstrapDeprecationMessage
        : plan.schemaVersion !== 1)
    )
      fail('bootstrap package list does not match the reviewed placeholder policy');
    names = plan.packages;
  }
  validatePackageSelection(names, manifests, { bootstrap });

  const pnpmCli = process.env.npm_execpath;
  if (!bootstrap && !pnpmCli) fail('npm_execpath is missing; invoke this script through pnpm');
  const artifacts = [];
  for (const [order, name] of names.entries()) {
    const before = new Set(readdirSync(output));
    if (bootstrap) {
      packBootstrapPlaceholder({ name, output, root });
    } else {
      const { directory } = manifests.get(name);
      execFileSync(
        process.execPath,
        [pnpmCli, '--dir', `packages/${directory}`, 'pack', '--pack-destination', output],
        { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] },
      );
    }
    const created = readdirSync(output).filter((file) => !before.has(file));
    if (created.length !== 1 || !created[0].endsWith('.tgz'))
      fail(`packing ${name} created an unexpected inventory: ${created.join(', ')}`);
    const archive = join(output, created[0]);
    if (!bootstrap) canonicalizePackedArchive(archive);
    const manifest = validatePackedArchive(archive, name, {
      bootstrap,
    });
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
          schemaVersion: bootstrap ? 2 : 1,
          sourceCommit: options.sourceSha,
          ...(bootstrap
            ? {
                artifactKind: bootstrapArtifactKind,
                publicationTag: bootstrapTag,
                bootstrapVersion,
                deprecationMessage: bootstrapDeprecationMessage,
              }
            : {}),
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

if (isDirectExecution(import.meta.url)) {
  packNpmArtifacts(parseArguments(process.argv.slice(2)));
}
