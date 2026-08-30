import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bootstrapArtifactKind,
  bootstrapDeprecationMessage,
  bootstrapPackageOrder,
  bootstrapTag,
  bootstrapVersion,
  packNpmArtifacts,
  parseArguments,
  validatePackageSelection,
  validatePackedArchive,
} from './pack-npm-artifacts.mjs';
import { verifyNpmBootstrapArtifacts } from './verify-npm-bootstrap-artifacts.mjs';

const temporary = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { force: true, recursive: true });
});

function archive({ name, windows = false, unsafe = false, addon = true, hosts }) {
  const root = mkdtempSync(join(tmpdir(), 'termwright-pack-check-'));
  temporary.push(root);
  const entries = [
    tarEntry(
      'package/package.json',
      JSON.stringify({
        name,
        version: '0.2.0',
        repository: { url: 'git+https://github.com/Gorce-AI/termwright.git' },
      }),
    ),
  ];
  if (addon) entries.push(tarEntry('package/termwright_pty.node', 'addon'));
  if (windows) {
    for (const member of [
      'conpty.dll',
      'conpty-manifest.json',
      'LICENSE.microsoft-terminal.txt',
      'THIRD_PARTY_NOTICES.md',
      'SBOM.spdx.json',
    ])
      entries.push(tarEntry(`package/vendor/${member}`, member));
    const hostArchitectures =
      hosts ?? (name === '@termwright/pty-win32-x64' ? ['arm64', 'x64'] : ['arm64']);
    for (const architecture of hostArchitectures)
      entries.push(tarEntry(`package/vendor/${architecture}/OpenConsole.exe`, architecture));
  }
  if (unsafe) entries.push(tarEntry('package/vendor/OpenConsole.exe', 'unsafe'));
  const result = join(root, 'package.tgz');
  writeFileSync(result, gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)])));
  return result;
}

function placeholderArchive(name, override = {}, { diagnostic, extraEntry } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'termwright-bootstrap-check-'));
  temporary.push(root);
  const manifest = {
    name,
    version: bootstrapVersion,
    description: `Registry bootstrap placeholder for ${name}; install ^0.3.0.`,
    license: 'MIT',
    type: 'module',
    exports: { '.': { types: './index.d.ts', import: './index.js' } },
    files: ['index.js', 'index.d.ts', 'README.md', 'LICENSE'],
    repository: {
      type: 'git',
      url: 'git+https://github.com/Gorce-AI/termwright.git',
    },
    publishConfig: { access: 'public', tag: bootstrapTag },
    ...override,
  };
  const expectedDiagnostic = `${name}@${bootstrapVersion} is a registry bootstrap placeholder; install ${name}@^0.3.0.`;
  const entries = [
    tarEntry('package/package.json', `${JSON.stringify(manifest, null, 2)}\n`),
    tarEntry('package/LICENSE', readFileSync(resolve(import.meta.dirname, '../LICENSE'))),
    tarEntry(
      'package/README.md',
      `# ${name}\n\nThis prerelease exists only to establish the npm package name before Termwright 0.3.0 trusted publishing. Install ${name}@^0.3.0 for the functional package.\n`,
    ),
    tarEntry('package/index.d.ts', 'export {};\n'),
    tarEntry(
      'package/index.js',
      `throw new Error(${JSON.stringify(diagnostic ?? expectedDiagnostic)});\n`,
    ),
  ];
  if (extraEntry !== undefined) entries.push(tarEntry(extraEntry, 'unexpected'));
  const result = join(root, 'package.tgz');
  writeFileSync(result, gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)])));
  return result;
}

function tarEntry(name, contents) {
  const payload = Buffer.from(contents);
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100, 8, 'ascii');
  header.write('0000000\0', 108, 8, 'ascii');
  header.write('0000000\0', 116, 8, 'ascii');
  header.write(`${payload.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  header.write('00000000000\0', 136, 12, 'ascii');
  header.fill(0x20, 148, 156);
  header[156] = '0'.charCodeAt(0);
  header.write('ustar\0', 257, 6, 'ascii');
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return Buffer.concat([header, payload, Buffer.alloc((512 - (payload.length % 512)) % 512)]);
}

describe('npm artifact packing contract', () => {
  it('accepts pnpm script argument forwarding without weakening option parsing', () => {
    expect(
      parseArguments([
        '--',
        '--artifact-mode',
        'bootstrap-placeholders',
        '--output',
        'bootstrap/npm',
        '--package-list',
        'scripts/npm-bootstrap-packages.json',
        '--manifest',
        'bootstrap/bootstrap-manifest.json',
        '--source-sha',
        'a'.repeat(40),
      ]),
    ).toEqual({
      output: 'bootstrap/npm',
      packageList: 'scripts/npm-bootstrap-packages.json',
      manifest: 'bootstrap/bootstrap-manifest.json',
      sourceSha: 'a'.repeat(40),
      artifactMode: 'bootstrap-placeholders',
    });
    expect(() => parseArguments(['--', '--output', 'out', '--publish', 'true'])).toThrow(
      'unknown argument: --publish',
    );
    expect(
      parseArguments([
        '--output',
        'preview/npm',
        '--manifest',
        'preview/manifest.json',
        '--source-sha',
        'b'.repeat(40),
      ]),
    ).toMatchObject({
      artifactMode: 'standard',
      packageList: undefined,
      manifest: 'preview/manifest.json',
    });
    expect(() => parseArguments(['--output', 'out', '--package-list', 'packages.json'])).toThrow(
      '--package-list requires --manifest',
    );
    expect(() => parseArguments(['--output', 'out', '--manifest', 'manifest.json'])).toThrow(
      '--manifest requires --source-sha',
    );
    expect(() => parseArguments(['--output', 'out', '--source-sha', 'c'.repeat(40)])).toThrow(
      '--source-sha requires --manifest',
    );
    expect(() =>
      parseArguments(['--output', 'out', '--artifact-mode', 'bootstrap-placeholders']),
    ).toThrow('requires --package-list');
  });

  it('requires all native packages before the wrapper in the bootstrap plan', () => {
    const names = [...bootstrapPackageOrder];
    const manifests = new Map(names.map((name) => [name, { manifest: { name } }]));
    expect(() => validatePackageSelection(names, manifests, { bootstrap: true })).not.toThrow();
    const reordered = [...names];
    reordered.splice(0, 1);
    reordered.splice(10, 0, '@termwright/pty-darwin-arm64');
    expect(() => validatePackageSelection(reordered, manifests, { bootstrap: true })).toThrow(
      'must exactly match the reviewed publication order',
    );
  });

  it('defines dependency-free prerelease placeholders that request only the bootstrap tag', () => {
    expect(bootstrapArtifactKind).toBe('registry-bootstrap-placeholders-v1');
    expect(bootstrapVersion).toBe('0.0.0-bootstrap.0');
    expect(bootstrapTag).toBe('bootstrap');
    const name = '@termwright/run-history';
    expect(
      validatePackedArchive(placeholderArchive(name), name, { bootstrap: true }),
    ).toMatchObject({
      name,
      version: bootstrapVersion,
      publishConfig: { access: 'public', tag: bootstrapTag },
    });
    expect(() =>
      validatePackedArchive(
        placeholderArchive(name, { dependencies: { '@termwright/protocol': '0.2.0' } }),
        name,
        { bootstrap: true },
      ),
    ).toThrow('must not declare dependencies');
    expect(() =>
      validatePackedArchive(
        placeholderArchive(name, { scripts: { postinstall: 'node exploit.js' } }),
        name,
        { bootstrap: true },
      ),
    ).toThrow('must not declare dependencies or executables');
    expect(() =>
      validatePackedArchive(
        placeholderArchive(name, { publishConfig: { access: 'public', tag: 'latest' } }),
        name,
        { bootstrap: true },
      ),
    ).toThrow('invalid registry bootstrap placeholder manifest');
    expect(() =>
      validatePackedArchive(placeholderArchive(name, { version: '0.2.0' }), name, {
        bootstrap: true,
      }),
    ).toThrow('invalid registry bootstrap placeholder manifest');
    expect(() =>
      validatePackedArchive(
        placeholderArchive(name, {}, { diagnostic: 'wrong diagnostic' }),
        name,
        { bootstrap: true },
      ),
    ).toThrow('invalid registry bootstrap placeholder contents');
    expect(() =>
      validatePackedArchive(
        placeholderArchive(name, {}, { extraEntry: 'package/termwright_pty.node' }),
        name,
        { bootstrap: true },
      ),
    ).toThrow('invalid registry bootstrap placeholder inventory');
  });

  it('generates and independently verifies the complete sealed bootstrap set', () => {
    const root = mkdtempSync(join(tmpdir(), 'termwright-bootstrap-integration-'));
    temporary.push(root);
    const manifestPath = join(root, 'bootstrap-manifest.json');
    const artifacts = packNpmArtifacts({
      output: join(root, 'npm'),
      packageList: 'scripts/npm-bootstrap-packages.json',
      manifest: manifestPath,
      sourceSha: 'd'.repeat(40),
      artifactMode: 'bootstrap-placeholders',
    });
    expect(artifacts).toHaveLength(11);
    expect(artifacts.map((entry) => entry.name)).toEqual(bootstrapPackageOrder);
    expect(new Set(artifacts.map((entry) => entry.version))).toEqual(new Set([bootstrapVersion]));
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(manifest).toMatchObject({
      schemaVersion: 2,
      artifactKind: bootstrapArtifactKind,
      publicationTag: bootstrapTag,
      bootstrapVersion,
      deprecationMessage: bootstrapDeprecationMessage,
      packageCount: 11,
    });
    expect(verifyNpmBootstrapArtifacts(root, { expectedSourceCommit: 'd'.repeat(40) })).toContain(
      'verified 11 npm bootstrap archives',
    );
    const secondRoot = mkdtempSync(join(tmpdir(), 'termwright-bootstrap-reproduction-'));
    temporary.push(secondRoot);
    const secondManifestPath = join(secondRoot, 'bootstrap-manifest.json');
    const reproduced = packNpmArtifacts({
      output: join(secondRoot, 'npm'),
      packageList: 'scripts/npm-bootstrap-packages.json',
      manifest: secondManifestPath,
      sourceSha: 'd'.repeat(40),
      artifactMode: 'bootstrap-placeholders',
    });
    expect(reproduced.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 }))).toEqual(
      artifacts.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })),
    );
    expect(readFileSync(secondManifestPath, 'utf8')).toBe(readFileSync(manifestPath, 'utf8'));
    expect(() =>
      verifyNpmBootstrapArtifacts(root, { expectedSourceCommit: 'e'.repeat(40) }),
    ).toThrow('does not match reviewed commit');
    writeFileSync(join(root, 'npm', 'unexpected.txt'), 'not an archive');
    expect(() =>
      verifyNpmBootstrapArtifacts(root, { expectedSourceCommit: 'd'.repeat(40) }),
    ).toThrow('archive inventory');
  });

  it('accepts a complete Windows native archive and rejects an incomplete or unsafe one', () => {
    const name = '@termwright/pty-win32-x64';
    expect(validatePackedArchive(archive({ name, windows: true }), name).name).toBe(name);
    expect(() =>
      validatePackedArchive(archive({ name, windows: true, addon: false }), name),
    ).toThrow('carries no addon');
    expect(() => validatePackedArchive(archive({ name, windows: true, hosts: [] }), name)).toThrow(
      'invalid OpenConsole inventory',
    );
    expect(() =>
      validatePackedArchive(archive({ name, windows: true, unsafe: true }), name),
    ).toThrow('invalid OpenConsole inventory');
  });
});
