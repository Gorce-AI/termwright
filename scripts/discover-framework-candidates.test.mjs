import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { canonicalJson, compareVersions, npmCatalog, parseGoDownloadResult, pypiCatalog, recoverGoDownloadFailure, resolveNpmDependencyClosure, selectCandidates, trustedGoEnvironment } from './discover-framework-candidates.mjs';

const source = (digit) => ({ checksum: digit.repeat(64), registry: 'https://crates.io' });
const config = {
  maxCandidatesPerRun: 2,
  streams: [{ id: 'example-v2', frameworkId: 'example', ecosystem: 'rust', registry: 'crates.io', package: 'example', minimumVersion: '2.0.0', major: 2, patchRoot: 'patches/example' }],
};

describe('framework candidate discovery', () => {
  it('enumerates a patch published after a newer minor instead of checking only latest', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tw-discovery-'));
    const result = await selectCandidates({
      rootDir: directory,
      config,
      ledger: { streams: { 'example-v2': [{ version: '2.1.0' }, { version: '2.2.0' }] } },
      catalogs: { 'example-v2': [
        { version: '2.1.0', publishedAt: '2026-01-01T00:00:00Z', source: source('1') },
        { version: '2.2.0', publishedAt: '2026-01-02T00:00:00Z', source: source('2') },
        { version: '2.1.1', publishedAt: '2026-01-03T00:00:00Z', source: source('3') },
      ] },
    });
    expect(result.candidates.map((entry) => entry.version)).toEqual(['2.1.1']);
  });

  it('is bounded, oldest-publication-first, stable-only, and reports the backlog', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tw-discovery-'));
    const result = await selectCandidates({
      rootDir: directory,
      config,
      ledger: { streams: {} },
      catalogs: { 'example-v2': [
        { version: '2.3.0-beta.1', publishedAt: '2025-12-01T00:00:00Z', source: source('4') },
        { version: '2.2.0', publishedAt: '2026-01-03T00:00:00Z', source: source('2') },
        { version: '2.0.1', publishedAt: '2026-01-01T00:00:00Z', source: source('1') },
        { version: '2.1.0', publishedAt: '2026-01-02T00:00:00Z', source: source('3') },
      ] },
    });
    expect(result.candidates.map((entry) => entry.version)).toEqual(['2.0.1', '2.1.0']);
    expect(result.totalPending).toBe(3);
    expect(result.backlog).toBe(1);
  });

  it('marks an exact prepared patch and content-addresses its manifest', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tw-discovery-'));
    await mkdir(join(directory, 'patches/example/2.0.1'), { recursive: true });
    await writeFile(join(directory, 'patches/example/2.0.1/manifest.json'), '{"framework":"example"}\n');
    const result = await selectCandidates({ rootDir: directory, config, ledger: { streams: {} }, catalogs: { 'example-v2': [{ version: '2.0.1', publishedAt: '2026-01-01T00:00:00Z', source: source('1') }] } });
    expect(result.candidates[0].patch.status).toBe('ready');
    expect(result.candidates[0].patch.manifestDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(result.candidates[0].candidateDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it('compares prefixed semantic versions numerically', () => {
    expect(compareVersions('v2.10.0', 'v2.9.9')).toBeGreaterThan(0);
  });

  it('turns an unsupported Go floor into typed candidate evidence', () => {
    expect(parseGoDownloadResult('example.invalid/framework@v2.0.9', JSON.stringify({
      Error: 'requires go >= 1.25.0 (running go 1.24.13; GOTOOLCHAIN=local)',
      Sum: 'h1:source',
      GoModSum: 'h1:module',
      Zip: '/cache/framework.zip',
    }))).toMatchObject({ RequiredGoVersion: '1.25.0' });
  });

  it('still fails discovery for non-toolchain Go download errors', () => {
    expect(() => parseGoDownloadResult('example.invalid/framework@v2.0.9', JSON.stringify({
      Error: 'checksum mismatch',
    }))).toThrow('example.invalid/framework@v2.0.9: checksum mismatch');
  });

  it('never accepts a successful-looking payload from a failed Go process', () => {
    const failure = Object.assign(new Error('go exited nonzero'), {
      stdout: JSON.stringify({ Sum: 'h1:source', GoModSum: 'h1:module', Zip: '/cache/framework.zip' }),
    });
    expect(() => recoverGoDownloadFailure('example.invalid/framework@v2.0.9', failure)).toThrow(failure);
  });

  it('forces local toolchain selection over inherited or caller-provided auto mode', () => {
    expect(trustedGoEnvironment({ GOTOOLCHAIN: 'auto', GOWORK: 'off' }, { GOTOOLCHAIN: 'auto' }))
      .toMatchObject({ GOTOOLCHAIN: 'local', GOWORK: 'off' });
  });

  it('discovers hook integrations without inventing a patch requirement', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tw-discovery-'));
    const hookConfig = {
      maxCandidatesPerRun: 2,
      streams: [{ id: 'ink', frameworkId: 'ink', ecosystem: 'npm', registry: 'npm', package: 'ink', minimumVersion: '7.1.1', major: 7, mode: 'hook', hookStrategy: 'exact-source' }],
    };
    const npmSource = { integrity: `sha512-${Buffer.alloc(64).toString('base64')}`, shasum: 'a'.repeat(40), tarballSha256: 'b'.repeat(64), dependencyClosure: [] };
    const result = await selectCandidates({ rootDir: directory, config: hookConfig, ledger: { streams: {} }, catalogs: { ink: [{ version: '7.1.2', publishedAt: '2026-03-01T00:00:00Z', source: npmSource }] } });
    expect(result.candidates[0]).toMatchObject({ mode: 'hook', hookStrategy: 'exact-source', patch: { status: 'not-applicable', path: null, manifestDigest: null } });
  });

  it('refuses a hook stream whose certification mechanism is implicit', async () => {
    await expect(selectCandidates({
      config: { maxCandidatesPerRun: 1, streams: [{ id: 'implicit', mode: 'hook', minimumVersion: '1.0.0' }] },
      ledger: { streams: {} },
      catalogs: { implicit: [] },
    })).rejects.toThrow(/explicit exact-source or runtime strategy/u);
  });

  it('keeps the repository hook strategies explicit and framework-specific', async () => {
    const config = JSON.parse(await readFile(new URL('../compatibility/upstream-patches.json', import.meta.url), 'utf8'));
    const strategies = Object.fromEntries(config.streams.filter((stream) => stream.mode === 'hook').map((stream) => [stream.frameworkId, stream.hookStrategy]));
    expect(strategies).toEqual({ ink: 'exact-source', opentui: 'runtime', textual: 'runtime' });
  });

  it('uses npm release time and preserves registry integrity plus dependency metadata', async () => {
    const response = { ok: true, json: async () => ({ time: { '7.1.2': '2026-03-01T00:00:00Z' }, versions: { '7.1.2': { dist: { tarball: 'https://registry.invalid/ink.tgz', integrity: 'sha512-evidence', shasum: 'a'.repeat(40) }, dependencies: { react: '^19.0.0' } } } }) };
    const entries = await npmCatalog({ id: 'ink', package: 'ink' }, async () => response);
    expect(entries).toEqual([{ version: '7.1.2', publishedAt: '2026-03-01T00:00:00Z', source: { registry: 'https://registry.npmjs.org', tarball: 'https://registry.invalid/ink.tgz', integrity: 'sha512-evidence', shasum: 'a'.repeat(40), dependencies: { react: '^19.0.0' }, optionalDependencies: {}, peerDependencies: {}, peerDependenciesMeta: {}, bundledDependencies: [], os: [], cpu: [], libc: [] } }]);
  });

  it('resolves ranged, nested, optional, peer, and platform packages into one checksum-bound graph', async () => {
    const tarballs = new Map();
    const manifest = (name, version, extra = {}) => {
      const bytes = Buffer.from(`${name}@${version}`);
      const tarball = `https://tarballs.invalid/${encodeURIComponent(name)}-${version}.tgz`;
      tarballs.set(tarball, bytes);
      return { name, version, ...extra, dist: { tarball, integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`, shasum: createHash('sha1').update(bytes).digest('hex') } };
    };
    const packuments = {
      a: { versions: { '2.0.0': manifest('a', '2.0.0'), '1.9.0': manifest('a', '1.9.0', { dependencies: { nested: '~3.1.0' }, optionalDependencies: { native: '^1.0.0' }, peerDependencies: { peer: '>=4 <5' } }) } },
      nested: { versions: { '3.1.9': manifest('nested', '3.1.9'), '3.1.2': manifest('nested', '3.1.2') } },
      native: { versions: { '1.2.0': manifest('native', '1.2.0', { os: ['darwin'], cpu: ['arm64'], libc: ['glibc'] }) } },
      peer: { versions: { '4.8.0': manifest('peer', '4.8.0') } },
    };
    const fetchImpl = async (url) => {
      if (tarballs.has(url)) return { ok: true, arrayBuffer: async () => tarballs.get(url) };
      const name = decodeURIComponent(url.slice('https://registry.npmjs.org/'.length));
      return { ok: packuments[name] !== undefined, status: packuments[name] === undefined ? 404 : 200, json: async () => packuments[name] };
    };
    const first = await resolveNpmDependencyClosure({ dependencies: { a: '^1.0.0' } }, { fetchImpl });
    const second = await resolveNpmDependencyClosure({ dependencies: { a: '^1.0.0' } }, { fetchImpl });
    expect(first.dependencyClosure.map(({ name, version }) => `${name}@${version}`)).toEqual(['a@1.9.0', 'native@1.2.0', 'nested@3.1.9', 'peer@4.8.0']);
    expect(first.dependencyClosure.find((entry) => entry.name === 'native')?.platform).toEqual({ os: ['darwin'], cpu: ['arm64'], libc: ['glibc'] });
    expect(first.dependencyClosure.every((entry) => entry.integrity.startsWith('sha512-') && /^[0-9a-f]{64}$/u.test(entry.tarballSha256))).toBe(true);
    expect(first.closureDigest).toBe(second.closureDigest);
  });

  it('produces the same closure digest when registry versions and dependency declarations arrive out of order', async () => {
    const bytes = Buffer.from('same tarball');
    const dist = { tarball: 'https://tarballs.invalid/same.tgz', integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` };
    const makeFetch = (versions) => async (url) => url.startsWith('https://tarballs.invalid/')
      ? { ok: true, arrayBuffer: async () => bytes }
      : { ok: true, json: async () => ({ versions }) };
    const forward = await resolveNpmDependencyClosure({ dependencies: { pkg: '^1.0.0' } }, { fetchImpl: makeFetch({ '1.0.0': { name: 'pkg', version: '1.0.0', dist }, '1.2.0': { name: 'pkg', version: '1.2.0', dist } }) });
    const reverse = await resolveNpmDependencyClosure({ dependencies: { pkg: '^1.0.0' } }, { fetchImpl: makeFetch({ '1.2.0': { name: 'pkg', version: '1.2.0', dist }, '1.0.0': { name: 'pkg', version: '1.0.0', dist } }) });
    expect(reverse).toEqual(forward);
  });

  it('fails closed instead of omitting an unsupported production dependency', async () => {
    await expect(resolveNpmDependencyClosure({ dependencies: { unsafe: 'git+https://example.invalid/unsafe.git' } }, {
      fetchImpl: async () => ({ ok: true, json: async () => ({ versions: { '1.0.0': {} } }) }),
    })).rejects.toThrow(/unsupported npm dependency selector/u);
    await expect(resolveNpmDependencyClosure({ name: 'bundled-root', dependencies: { hidden: '1.0.0' }, bundledDependencies: ['hidden'] }, {
      fetchImpl: async () => ({ ok: true, json: async () => ({ versions: {} }) }),
    })).rejects.toThrow(/bundled production dependencies/u);
  });

  it('reselects the same npm root version when its transitive closure digest changes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tw-discovery-'));
    const npmConfig = { maxCandidatesPerRun: 2, streams: [{ id: 'native', frameworkId: 'native', ecosystem: 'npm', registry: 'npm', package: 'native', minimumVersion: '1.0.0', mode: 'hook', hookStrategy: 'runtime', monitorDependencyClosure: true }] };
    const complete = (version) => {
      const dependencyRoots = [{ name: 'platform', packageName: 'platform', requested: '^1', type: 'optional', optionalPeer: false, version }];
      const dependencyClosure = [{ name: 'platform', version, integrity: `sha512-${Buffer.alloc(64).toString('base64')}`, tarball: `https://registry.invalid/platform-${version}.tgz`, tarballSha256: 'e'.repeat(64), platform: { os: [], cpu: [], libc: [] }, dependencies: [] }];
      const closureDigest = `sha256:${createHash('sha256').update(canonicalJson({ dependencyRoots, dependencyClosure })).digest('hex')}`;
      return { integrity: `sha512-${Buffer.alloc(64).toString('base64')}`, shasum: 'a'.repeat(40), tarballSha256: 'b'.repeat(64), dependencyRoots, dependencyClosure, closureComplete: true, closureDigest };
    };
    const result = await selectCandidates({ rootDir: directory, config: npmConfig, ledger: { streams: { native: [{ version: '1.0.0', source: complete('1.0.0') }] } }, catalogs: { native: [{ version: '1.0.0', publishedAt: '2026-03-01T00:00:00Z', source: complete('1.0.1') }] } });
    expect(result.candidates.map((entry) => entry.id)).toEqual(['native@1.0.0']);
  });

  it('reselects the same npm root version when its own immutable artifact evidence drifts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tw-discovery-'));
    const npmConfig = { maxCandidatesPerRun: 2, streams: [{ id: 'native', frameworkId: 'native', ecosystem: 'npm', registry: 'npm', package: 'native', minimumVersion: '1.0.0', mode: 'hook', hookStrategy: 'runtime', monitorDependencyClosure: true }] };
    const dependencyRoots = [];
    const dependencyClosure = [];
    const closureDigest = `sha256:${createHash('sha256').update(canonicalJson({ dependencyRoots, dependencyClosure })).digest('hex')}`;
    const complete = (rootDigest) => ({ integrity: `sha512-${Buffer.alloc(64).toString('base64')}`, shasum: 'a'.repeat(40), tarball: 'https://registry.invalid/native.tgz', tarballSha256: rootDigest.repeat(64), dependencyRoots, dependencyClosure, closureComplete: true, closureDigest });
    const result = await selectCandidates({ rootDir: directory, config: npmConfig, ledger: { streams: { native: [{ version: '1.0.0', source: complete('b') }] } }, catalogs: { native: [{ version: '1.0.0', publishedAt: '2026-03-01T00:00:00Z', source: complete('c') }] } });
    expect(result.candidates.map((entry) => entry.id)).toEqual(['native@1.0.0']);
  });

  it('records every non-yanked PyPI file hash and deterministically prefers the sdist', async () => {
    const response = { ok: true, json: async () => ({ releases: { '8.3.0': [
      { filename: 'textual.whl', packagetype: 'bdist_wheel', url: 'https://pypi.invalid/wheel', upload_time_iso_8601: '2026-03-02T00:00:01Z', yanked: false, digests: { sha256: 'a'.repeat(64) } },
      { filename: 'textual.tar.gz', packagetype: 'sdist', url: 'https://pypi.invalid/sdist', upload_time_iso_8601: '2026-03-02T00:00:00Z', yanked: false, digests: { sha256: 'b'.repeat(64) } },
    ] } }) };
    const entries = await pypiCatalog({ id: 'textual', package: 'textual' }, async () => response);
    expect(entries[0].source).toMatchObject({ filename: 'textual.tar.gz', sha256: 'b'.repeat(64) });
    expect(entries[0].source.files).toHaveLength(2);
  });
});
