import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { assertCandidateSemanticSession, candidateToolchainBlock, deriveHookInstrumentationProfile, installedDependencyFrom, verifyCandidateEvidence, verifyInstalledNpmClosure } from './certify-framework-candidate.mjs';

const exec = promisify(execFile);

function tarEntry(name, contents) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100, 8, 'ascii');
  header.write('0000000\0', 108, 8, 'ascii');
  header.write('0000000\0', 116, 8, 'ascii');
  header.write(`${contents.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  header.write('00000000000\0', 136, 12, 'ascii');
  header.fill(0x20, 148, 156);
  header[156] = '0'.charCodeAt(0);
  header.write('ustar\0', 257, 6, 'ascii');
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return Buffer.concat([header, contents, Buffer.alloc((512 - contents.length % 512) % 512)]);
}

function packageTar(files) {
  return gzipSync(Buffer.concat([
    ...Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([path, contents]) => tarEntry(`package/${path}`, Buffer.from(contents))),
    Buffer.alloc(1024),
  ]));
}

function npmSource(url, bytes) {
  return {
    tarball: url,
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    shasum: createHash('sha1').update(bytes).digest('hex'),
    tarballSha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

async function npmClosureFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'tw-installed-closure-'));
  const probe = join(directory, 'probe');
  const rootPackage = join(probe, 'node_modules', '@example', 'root');
  const dependency = join(probe, 'node_modules', 'dependency');
  await Promise.all([
    mkdir(rootPackage, { recursive: true }),
    mkdir(dependency, { recursive: true }),
  ]);
  await writeFile(join(probe, 'package.json'), JSON.stringify({ name: 'probe' }));
  const rootManifest = JSON.stringify({ name: '@example/root', version: '1.2.3', main: 'index.js', dependencies: { dependency: '^4.0.0' } });
  const dependencyManifest = JSON.stringify({ name: 'dependency', version: '4.1.0', main: 'index.js', bin: { dependency: 'cli.js' } });
  await writeFile(join(rootPackage, 'package.json'), rootManifest);
  await writeFile(join(rootPackage, 'index.js'), 'export {};\n');
  await mkdir(join(rootPackage, 'node_modules', '.bin'), { recursive: true });
  await writeFile(join(rootPackage, 'node_modules', '.bin', 'dependency'), '#!/bin/sh\n');
  await writeFile(join(dependency, 'package.json'), dependencyManifest);
  await writeFile(join(dependency, 'index.js'), 'export {};\n');
  await writeFile(join(dependency, 'cli.js'), '#!/usr/bin/env node\n');
  const rootTar = packageTar({ 'index.js': 'export {};\n', 'package.json': rootManifest });
  const dependencyTar = packageTar({ 'cli.js': '#!/usr/bin/env node\n', 'index.js': 'export {};\n', 'package.json': dependencyManifest });
  const tarballs = new Map([['https://registry.invalid/root.tgz', rootTar], ['https://registry.invalid/dependency.tgz', dependencyTar]]);
  const fetchImpl = async (url) => ({ ok: tarballs.has(url), status: tarballs.has(url) ? 200 : 404, arrayBuffer: async () => tarballs.get(url) });
  const dependencyNode = {
    name: 'dependency', version: '4.1.0', ...npmSource('https://registry.invalid/dependency.tgz', dependencyTar), dependencies: [],
  };
  const candidate = {
    id: 'root@1.2.3', package: '@example/root', version: '1.2.3',
    source: {
      ...npmSource('https://registry.invalid/root.tgz', rootTar),
      closureComplete: true,
      dependencyRoots: [{ name: 'dependency', requested: '^4.0.0', type: 'dependency', optionalPeer: false, packageName: 'dependency', version: '4.1.0' }],
      dependencyClosure: [dependencyNode],
    },
  };
  return { candidate, dependency, directory, fetchImpl, probe, rootPackage };
}

describe('framework candidate evidence binding', () => {
  it('walks the real pnpm package location when dependency versions diverge', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tw-pnpm-closure-'));
    const packageDirectory = (key, name) => join(directory, '.pnpm', key, 'node_modules', name);
    const rootPackage = packageDirectory('root@1.0.0', 'root');
    const stringWidth = packageDirectory('string-width@7.2.0', 'string-width');
    const stripAnsi71 = packageDirectory('strip-ansi@7.1.2', 'strip-ansi');
    const stripAnsi72 = packageDirectory('strip-ansi@7.2.0', 'strip-ansi');
    try {
      await Promise.all([rootPackage, stringWidth, stripAnsi71, stripAnsi72].map((path) => mkdir(path, { recursive: true })));
      await Promise.all([
        writeFile(join(rootPackage, 'package.json'), JSON.stringify({ name: 'root', version: '1.0.0' })),
        writeFile(join(stringWidth, 'package.json'), JSON.stringify({ name: 'string-width', version: '7.2.0' })),
        writeFile(join(stripAnsi71, 'package.json'), JSON.stringify({ name: 'strip-ansi', version: '7.1.2' })),
        writeFile(join(stripAnsi72, 'package.json'), JSON.stringify({ name: 'strip-ansi', version: '7.2.0' })),
      ]);
      await mkdir(join(rootPackage, 'node_modules'), { recursive: true });
      await symlink(stringWidth, join(rootPackage, 'node_modules', 'string-width'), 'dir');
      await symlink(stripAnsi71, join(rootPackage, 'node_modules', 'strip-ansi'), 'dir');
      await symlink(stripAnsi72, join(dirname(stringWidth), 'strip-ansi'), 'dir');

      const child = await installedDependencyFrom(rootPackage, 'string-width');
      expect(child.directory).toBe(await realpath(stringWidth));
      await expect(installedDependencyFrom(child.directory, 'strip-ansi')).resolves.toMatchObject({
        directory: await realpath(stripAnsi72),
        manifest: { version: '7.2.0' },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('never derives source instrumentation for an OpenTUI runtime-hook candidate', async () => {
    await expect(deriveHookInstrumentationProfile({
      id: 'opentui@0.5.4',
      frameworkId: 'opentui',
      hookStrategy: 'runtime',
    }, Buffer.from('not an archive'), 'a'.repeat(40))).rejects.toThrow(/no deterministic exact-source/u);
  });

  it('cryptographically binds the exact installed npm graph to every discovered tarball', async () => {
    const { candidate, directory, fetchImpl, probe } = await npmClosureFixture();
    try {
      await expect(verifyInstalledNpmClosure(candidate, probe, { fetchImpl })).resolves.toMatchObject({ version: '1.2.3', resolvedNodes: 1 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects altered installed bytes even when package names, versions and declarations match', async () => {
    const { candidate, dependency, directory, fetchImpl, probe } = await npmClosureFixture();
    try {
      await writeFile(join(dependency, 'index.js'), 'export const altered = true;\n');
      await expect(verifyInstalledNpmClosure(candidate, probe, { fetchImpl })).rejects.toThrow(/content does not match/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects undeclared installed content below the package node_modules boundary', async () => {
    const { candidate, directory, fetchImpl, probe, rootPackage } = await npmClosureFixture();
    try {
      await mkdir(join(rootPackage, 'node_modules'), { recursive: true });
      await writeFile(join(rootPackage, 'node_modules', 'hidden.js'), 'export const hidden = true;\n');
      await expect(verifyInstalledNpmClosure(candidate, probe, { fetchImpl })).rejects.toThrow(/root content does not match/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('ignores only package-manager launchers materialized below node_modules/.bin', async () => {
    const { candidate, directory, fetchImpl, probe, rootPackage } = await npmClosureFixture();
    try {
      await mkdir(join(rootPackage, 'node_modules', '.bin'), { recursive: true });
      await writeFile(join(rootPackage, 'node_modules', '.bin', 'dependency'), '#!/bin/sh\n');
      await expect(verifyInstalledNpmClosure(candidate, probe, { fetchImpl })).resolves.toMatchObject({ version: '1.2.3', resolvedNodes: 1 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects undeclared package-manager launchers below node_modules/.bin', async () => {
    const { candidate, directory, fetchImpl, probe, rootPackage } = await npmClosureFixture();
    try {
      await mkdir(join(rootPackage, 'node_modules', '.bin'), { recursive: true });
      await writeFile(join(rootPackage, 'node_modules', '.bin', 'unbound'), '#!/bin/sh\n');
      await expect(verifyInstalledNpmClosure(candidate, probe, { fetchImpl })).rejects.toThrow(/bin entry is undeclared/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects changed executable mode even when file bytes are unchanged', async () => {
    const { candidate, dependency, directory, fetchImpl, probe } = await npmClosureFixture();
    try {
      await chmod(join(dependency, 'index.js'), 0o755);
      await expect(verifyInstalledNpmClosure(candidate, probe, { fetchImpl })).rejects.toThrow(/content does not match/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects expected closure nodes that are unreachable from the installed root', async () => {
    const { candidate, directory, fetchImpl, probe } = await npmClosureFixture();
    try {
      candidate.source.dependencyClosure.push({ ...candidate.source.dependencyClosure[0], name: 'orphan', version: '9.0.0' });
      await expect(verifyInstalledNpmClosure(candidate, probe, { fetchImpl })).rejects.toThrow(/unreachable nodes: orphan@9\.0\.0/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('uses the frozen contract instead of the removed provisional capabilities API', async () => {
    const session = {
      settled: async () => ({ capabilities: { 'semantic-tree': { status: 'supported' } } }),
      semanticTree: () => ({ v: 2 }),
    };
    await expect(assertCandidateSemanticSession(session, 'bubbletea-v2@v2.0.9')).resolves.toBeUndefined();
  });

  it('rejects a session whose frozen contract lacks semantic support', async () => {
    const session = {
      settled: async () => ({ capabilities: { 'semantic-tree': { status: 'unsupported' } } }),
      semanticTree: () => ({ v: 2 }),
    };
    await expect(assertCandidateSemanticSession(session, 'bubbletea-v2@v2.0.9')).rejects.toThrow(/no supported semantic tree/u);
  });

  it('classifies a newer upstream Go floor as a typed red candidate outcome', () => {
    expect(candidateToolchainBlock({
      id: 'bubbletea-v2@v2.1.0',
      source: { requiredGoVersion: '1.26.0', toolchainSupported: false },
    }, '1.25')).toBe('bubbletea-v2@v2.1.0: requires Go >= 1.26.0; trusted certification is pinned to Go 1.25');
  });

  it('returns a failing process status after retaining a typed red verdict', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tw-red-candidate-'));
    const registry = join(directory, 'registry.json');
    const verdict = join(directory, 'verdict.json');
    await writeFile(registry, JSON.stringify({ candidates: [{
      id: 'bubbletea-v2@v2.1.0',
      candidateDigest: `sha256:${'a'.repeat(64)}`,
      source: { requiredGoVersion: '1.26.0', toolchainSupported: false },
    }] }));
    try {
      await expect(exec(process.execPath, [
        fileURLToPath(new URL('./certify-framework-candidate.mjs', import.meta.url)),
        '--registry', registry,
        '--candidate', 'bubbletea-v2@v2.1.0',
        '--output', verdict,
      ], {
        env: { ...process.env, GITHUB_SHA: 'candidate-sha', TERMWRIGHT_UPSTREAM_GO_VERSION: '1.25' },
      })).rejects.toMatchObject({ code: 1 });
      expect(JSON.parse(await readFile(verdict, 'utf8'))).toMatchObject({
        candidateId: 'bubbletea-v2@v2.1.0',
        state: 'red',
        detail: 'bubbletea-v2@v2.1.0: requires Go >= 1.26.0; trusted certification is pinned to Go 1.25',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('accepts an exact Go source binding', () => {
    expect(() => verifyCandidateEvidence({
      id: 'tview@v0.42.0',
      package: 'github.com/rivo/tview',
      version: 'v0.42.0',
      registry: 'go',
      source: { sum: 'h1:module', goModSum: 'h1:gomod', zipSha256: 'a'.repeat(64) },
    }, { behaviorallyCertified: true, stablePublishEligible: true, candidates: [{
      module: 'github.com/rivo/tview',
      upstreamVersion: 'v0.42.0',
      material: { sum: 'h1:module', goModSum: 'h1:gomod', zipDigest: `sha256:${'a'.repeat(64)}` },
    }] }, { passed: true })).not.toThrow();
  });

  it('rejects evidence for another source archive', () => {
    expect(() => verifyCandidateEvidence({
      id: 'ratatui-core@0.1.2',
      package: 'ratatui-core',
      version: '0.1.2',
      registry: 'crates.io',
      source: { checksum: 'b'.repeat(64) },
    }, { behaviorallyCertified: true, stablePublishEligible: true, candidates: [{
      module: 'ratatui-core',
      upstreamVersion: '0.1.2',
      material: { checksum: `sha256:${'c'.repeat(64)}`, archiveDigest: `sha256:${'c'.repeat(64)}` },
    }] }, { passed: true })).toThrow(/does not match/u);
  });

  it('rejects deterministic patch application that lacks candidate-specific behavioral certification', () => {
    expect(() => verifyCandidateEvidence({
      id: 'tview@v0.43.0',
      package: 'github.com/rivo/tview',
      version: 'v0.43.0',
      registry: 'go',
      source: { sum: 'h1:module', goModSum: 'h1:gomod', zipSha256: 'a'.repeat(64) },
    }, {
      behaviorallyCertified: false,
      stablePublishEligible: false,
      candidates: [],
    }, { passed: false })).toThrow(/not behaviorally certified/u);
  });
});
