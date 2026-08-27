import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  canonicalJson,
  compareVersions,
  npmCatalog,
  parseGoDownloadResult,
  pypiCatalog,
  recoverGoDownloadFailure,
  resolveNpmDependencyClosure,
  selectCandidates,
  trustedGoEnvironment,
} from './discover-framework-candidates.mjs';

const exec = promisify(execFile);

const source = (digit) => ({
  checksum: digit.repeat(64),
  registry: 'https://crates.io',
});
const config = {
  maxCandidatesPerRun: 2,
  streams: [
    {
      id: 'example-v2',
      frameworkId: 'example',
      ecosystem: 'rust',
      registry: 'crates.io',
      package: 'example',
      certificationRevision: 1,
      minimumVersion: '2.0.0',
      major: 2,
      patchRoot: 'patches/example',
    },
  ],
};

describe('framework candidate discovery', () => {
  it('enumerates a patch published after a newer minor instead of checking only latest', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tw-discovery-'));
    const result = await selectCandidates({
      rootDir: directory,
      config,
      ledger: {
        streams: { 'example-v2': [{ version: '2.1.0' }, { version: '2.2.0' }] },
      },
      catalogs: {
        'example-v2': [
          {
            version: '2.1.0',
            publishedAt: '2026-01-01T00:00:00Z',
            source: source('1'),
          },
          {
            version: '2.2.0',
            publishedAt: '2026-01-02T00:00:00Z',
            source: source('2'),
          },
          {
            version: '2.1.1',
            publishedAt: '2026-01-03T00:00:00Z',
            source: source('3'),
          },
        ],
      },
    });
    expect(result.candidates.map((entry) => entry.version)).toEqual(['2.1.1']);
  });

  it('is bounded, oldest-publication-first, stable-only, and reports the backlog', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tw-discovery-'));
    const result = await selectCandidates({
      rootDir: directory,
      config,
      ledger: { streams: {} },
      catalogs: {
        'example-v2': [
          {
            version: '2.3.0-beta.1',
            publishedAt: '2025-12-01T00:00:00Z',
            source: source('4'),
          },
          {
            version: '2.2.0',
            publishedAt: '2026-01-03T00:00:00Z',
            source: source('2'),
          },
          {
            version: '2.0.1',
            publishedAt: '2026-01-01T00:00:00Z',
            source: source('1'),
          },
          {
            version: '2.1.0',
            publishedAt: '2026-01-02T00:00:00Z',
            source: source('3'),
          },
        ],
      },
    });
    expect(result.candidates.map((entry) => entry.version)).toEqual(['2.0.1', '2.1.0']);
    expect(result.totalPending).toBe(3);
    expect(result.backlog).toBe(1);
  });

  it('gives every pending stream one oldest candidate before another stream gets a second slot', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tw-discovery-'));
    const fairConfig = {
      maxCandidatesPerRun: 3,
      streams: [
        { ...config.streams[0], id: 'older-backlog', frameworkId: 'older' },
        { ...config.streams[0], id: 'newer-stream', frameworkId: 'newer' },
      ],
    };
    const result = await selectCandidates({
      rootDir: directory,
      config: fairConfig,
      maximum: 3,
      ledger: { streams: {} },
      catalogs: {
        'older-backlog': [
          {
            version: '2.0.1',
            publishedAt: '2026-01-01T00:00:00Z',
            source: source('1'),
          },
          {
            version: '2.0.2',
            publishedAt: '2026-01-02T00:00:00Z',
            source: source('2'),
          },
          {
            version: '2.0.3',
            publishedAt: '2026-01-03T00:00:00Z',
            source: source('3'),
          },
        ],
        'newer-stream': [
          {
            version: '2.1.0',
            publishedAt: '2026-02-01T00:00:00Z',
            source: source('4'),
          },
        ],
      },
    });
    expect(result.candidates.map((entry) => entry.id)).toEqual([
      'older-backlog@2.0.1',
      'newer-stream@2.1.0',
      'older-backlog@2.0.2',
    ]);
    expect(result.totalPending).toBe(4);
    expect(result.backlog).toBe(1);

    const permuted = await selectCandidates({
      rootDir: directory,
      config: { ...fairConfig, streams: [...fairConfig.streams].reverse() },
      maximum: 3,
      ledger: { streams: {} },
      catalogs: {
        'newer-stream': [
          ...result.candidates
            .filter((entry) => entry.streamId === 'newer-stream')
            .map((entry) => ({
              version: entry.version,
              publishedAt: entry.publishedAt,
              source: entry.source,
            })),
        ],
        'older-backlog': [
          {
            version: '2.0.3',
            publishedAt: '2026-01-03T00:00:00Z',
            source: source('3'),
          },
          {
            version: '2.0.1',
            publishedAt: '2026-01-01T00:00:00Z',
            source: source('1'),
          },
          {
            version: '2.0.2',
            publishedAt: '2026-01-02T00:00:00Z',
            source: source('2'),
          },
        ],
      },
    });
    expect(permuted.candidates.map((entry) => entry.id)).toEqual(
      result.candidates.map((entry) => entry.id),
    );
  });

  it('applies an exact stream filter and an independent bounded dispatch cap', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tw-stream-discovery-'));
    const streamConfig = {
      maxCandidatesPerRun: 16,
      streams: [
        { ...config.streams[0], id: 'another-v2', frameworkId: 'another' },
        {
          ...config.streams[0],
          id: 'tcell-v2',
          frameworkId: 'tview',
          package: 'github.com/gdamore/tcell/v2',
        },
      ],
    };
    const tcell = Array.from({ length: 20 }, (_, index) => ({
      version: `2.0.${index + 1}`,
      publishedAt: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
      source: source(String((index % 9) + 1)),
    }));
    const result = await selectCandidates({
      rootDir: directory,
      config: streamConfig,
      streamId: 'tcell-v2',
      maximum: 17,
      ledger: { streams: {} },
      catalogs: {
        'another-v2': [
          {
            version: '2.0.1',
            publishedAt: '2025-01-01T00:00:00Z',
            source: source('9'),
          },
        ],
        'tcell-v2': tcell,
      },
    });

    expect(result.candidates).toHaveLength(17);
    expect(result.candidates.every((entry) => entry.streamId === 'tcell-v2')).toBe(true);
    expect(result).toMatchObject({ limit: 17, totalPending: 20, backlog: 3 });
    await expect(
      selectCandidates({
        rootDir: directory,
        config: streamConfig,
        streamId: 'missing',
        maximum: 17,
        ledger: { streams: {} },
        catalogs: {},
      }),
    ).rejects.toThrow(/unknown candidate stream/u);
  });

  it('does not turn an add-only candidate into a working-tree patch profile', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tw-unseeded-discovery-'));
    const ledger = join(directory, 'ledger.json');
    const assessments = join(directory, 'assessments.json');
    const catalog = join(directory, 'catalog.json');
    const output = join(directory, 'registry.json');
    await writeFile(ledger, JSON.stringify({ schemaVersion: 1, streams: {} }));
    await writeFile(assessments, JSON.stringify({ schemaVersion: 1, streams: {} }));
    await writeFile(
      catalog,
      JSON.stringify({
        streams: {
          'tcell-v2': [
            {
              version: 'v2.8.1',
              publishedAt: '2026-01-01T00:00:00Z',
              source: {
                sum: 'h1:source',
                goModSum: 'h1:gomod',
                zipSha256: 'a'.repeat(64),
                toolchainSupported: true,
              },
            },
          ],
        },
      }),
    );

    await exec(process.execPath, [
      fileURLToPath(new URL('./discover-framework-candidates.mjs', import.meta.url)),
      '--ledger',
      ledger,
      '--assessments',
      assessments,
      '--catalog',
      catalog,
      '--stream',
      'tcell-v2',
      '--max',
      '1',
      '--output',
      output,
    ]);
    const registry = JSON.parse(await readFile(output, 'utf8'));
    expect(registry.candidates).toHaveLength(1);
    expect(registry.candidates[0]).toMatchObject({
      id: 'tcell-v2@v2.8.1',
      mode: 'capability',
      capability: 'tcell-same-writer-marker',
      capabilityStrategy: 'compile-conformance',
      patch: { status: 'not-applicable', path: null, manifestDigest: null },
    });
  });

  it('discovers add-only capability candidates without inventing an exact patch manifest', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tw-capability-discovery-'));
    const capabilityConfig = {
      maxCandidatesPerRun: 1,
      streams: [
        {
          id: 'bubbles-v2',
          frameworkId: 'charm',
          ecosystem: 'go',
          registry: 'go',
          package: 'charm.land/bubbles/v2',
          certificationRevision: 1,
          minimumVersion: 'v2.1.1',
          major: 2,
          mode: 'capability',
          capability: 'bubbles-private-state',
          capabilityStrategy: 'compile-conformance',
        },
      ],
    };
    const goSource = {
      sum: 'h1:module',
      goModSum: 'h1:go-mod',
      zipSha256: 'a'.repeat(64),
      toolchainSupported: true,
    };
    const result = await selectCandidates({
      rootDir: directory,
      config: capabilityConfig,
      ledger: { streams: {} },
      catalogs: {
        'bubbles-v2': [
          {
            version: 'v2.2.0',
            publishedAt: '2026-01-01T00:00:00Z',
            source: goSource,
          },
        ],
      },
    });

    expect(result.candidates[0]).toMatchObject({
      mode: 'capability',
      capability: 'bubbles-private-state',
      capabilityStrategy: 'compile-conformance',
      patch: { status: 'not-applicable', path: null, manifestDigest: null },
    });
  });

  it('keeps the scheduled default large enough to visit every configured stream', async () => {
    const repositoryConfig = JSON.parse(
      await readFile(new URL('../compatibility/upstream-patches.json', import.meta.url), 'utf8'),
    );
    const workflow = await readFile(
      new URL('../.github/workflows/upstream-candidates.yml', import.meta.url),
      'utf8',
    );
    expect(repositoryConfig.maxCandidatesPerRun).toBeGreaterThanOrEqual(
      repositoryConfig.streams.length,
    );
    expect(workflow).toContain(`default: ${repositoryConfig.maxCandidatesPerRun}`);
    expect(workflow).toContain(`inputs.maximum || '${repositoryConfig.maxCandidatesPerRun}'`);
    expect(workflow).toContain("STREAM: ${{ inputs.stream || '' }}");
    expect(workflow).toContain('discovery_args+=(--stream "$STREAM")');
  });

  it('does not retry an exact red assessment until its artifact or certifier revision changes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tw-discovery-'));
    const catalogs = {
      'example-v2': [
        {
          version: '2.0.1',
          publishedAt: '2026-01-01T00:00:00Z',
          source: source('1'),
        },
      ],
    };
    const first = await selectCandidates({
      rootDir: directory,
      config,
      ledger: { streams: {} },
      catalogs,
    });
    const candidate = first.candidates[0];
    const assessments = {
      schemaVersion: 1,
      streams: {
        'example-v2': [
          {
            state: 'red',
            version: candidate.version,
            certificationRevision: candidate.certificationRevision,
            candidateDigest: candidate.candidateDigest,
            source: candidate.source,
          },
        ],
      },
    };
    const unchanged = await selectCandidates({
      rootDir: directory,
      config,
      ledger: { streams: {} },
      assessments,
      catalogs,
    });
    expect(unchanged).toMatchObject({
      totalPending: 0,
      backlog: 0,
      candidates: [],
    });

    const revised = await selectCandidates({
      rootDir: directory,
      config: {
        ...config,
        streams: [{ ...config.streams[0], certificationRevision: 2 }],
      },
      ledger: { streams: {} },
      assessments,
      catalogs,
    });
    expect(revised.candidates).toHaveLength(1);
    expect(revised.candidates[0]).toMatchObject({
      version: '2.0.1',
      certificationRevision: 2,
    });
    expect(revised.candidates[0].candidateDigest).not.toBe(candidate.candidateDigest);

    const changedSource = await selectCandidates({
      rootDir: directory,
      config,
      ledger: { streams: {} },
      assessments,
      catalogs: {
        'example-v2': [{ ...catalogs['example-v2'][0], source: source('2') }],
      },
    });
    expect(changedSource.candidates).toHaveLength(1);
    expect(changedSource.candidates[0].candidateDigest).not.toBe(candidate.candidateDigest);

    await mkdir(join(directory, 'patches/example/2.0.1'), { recursive: true });
    await writeFile(
      join(directory, 'patches/example/2.0.1/manifest.json'),
      '{"framework":"example"}\n',
    );
    const preparedPatch = await selectCandidates({
      rootDir: directory,
      config,
      ledger: { streams: {} },
      assessments,
      catalogs,
    });
    expect(preparedPatch.candidates).toHaveLength(1);
    expect(preparedPatch.candidates[0]).toMatchObject({
      patch: { status: 'ready' },
    });
    expect(preparedPatch.candidates[0].candidateDigest).not.toBe(candidate.candidateDigest);
  });

  it('does not resolve an unbounded history of unchanged red assessments before scheduling', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tw-discovery-'));
    const entries = Array.from({ length: 20 }, (_, index) => ({
      version: `2.0.${index + 1}`,
      publishedAt: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
      source: source(String((index % 9) + 1)),
    }));
    const assessments = {
      schemaVersion: 1,
      streams: {
        'example-v2': entries.map((entry) => ({
          state: 'red',
          version: entry.version,
          certificationRevision: 1,
          candidateDigest: 'sha256:'.concat('a'.repeat(64)),
          source: entry.source,
        })),
      },
    };
    let resolutions = 0;
    const result = await selectCandidates({
      rootDir: directory,
      config,
      maximum: 1,
      ledger: { streams: {} },
      assessments,
      catalogs: { 'example-v2': entries },
      sourceResolver: async (_stream, _version, candidateSource) => {
        resolutions += 1;
        return candidateSource;
      },
    });
    expect(result.candidates).toHaveLength(1);
    expect(resolutions).toBe(0);
  });

  it('resolves the current npm closure when a certifier revision requalifies a red root', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tw-discovery-'));
    const closure = { dependencyRoots: [], dependencyClosure: [] };
    const npmSource = {
      registry: 'https://registry.npmjs.org',
      tarball: 'https://registry.invalid/runtime.tgz',
      integrity: 'sha512-evidence',
      shasum: 'a'.repeat(40),
      tarballSha256: 'b'.repeat(64),
      dependencies: { dep: '^1.0.0' },
      optionalDependencies: {},
      peerDependencies: {},
      peerDependenciesMeta: {},
      bundledDependencies: [],
      os: [],
      cpu: [],
      libc: [],
      ...closure,
      closureDigest: `sha256:${createHash('sha256').update(canonicalJson(closure)).digest('hex')}`,
      closureComplete: true,
    };
    const stream = {
      id: 'runtime-npm',
      frameworkId: 'runtime-npm',
      ecosystem: 'npm',
      registry: 'npm',
      package: 'runtime-npm',
      certificationRevision: 1,
      minimumVersion: '2.0.0',
      major: 2,
      mode: 'hook',
      hookStrategy: 'runtime',
      monitorDependencyClosure: true,
    };
    const catalogEntry = {
      version: '2.0.1',
      publishedAt: '2026-01-01T00:00:00Z',
      source: npmSource,
    };
    const first = await selectCandidates({
      rootDir: directory,
      config: { maxCandidatesPerRun: 1, streams: [stream] },
      ledger: { streams: {} },
      catalogs: { 'runtime-npm': [catalogEntry] },
    });
    const assessment = {
      schemaVersion: 1,
      streams: {
        'runtime-npm': [
          {
            state: 'red',
            version: '2.0.1',
            certificationRevision: 1,
            candidateDigest: first.candidates[0].candidateDigest,
            source: npmSource,
          },
        ],
      },
    };
    const lightweightSource = Object.fromEntries(
      Object.entries(npmSource).filter(
        ([key]) =>
          ![
            'tarballSha256',
            'dependencyRoots',
            'dependencyClosure',
            'closureDigest',
            'closureComplete',
          ].includes(key),
      ),
    );
    const changedClosure = {
      dependencyRoots: [
        {
          name: 'dep',
          requested: '^1.0.0',
          type: 'dependency',
          packageName: 'dep',
          version: '1.1.0',
        },
      ],
      dependencyClosure: [
        {
          name: 'dep',
          version: '1.1.0',
          integrity: 'sha512-dep',
          tarball: 'https://registry.invalid/dep.tgz',
          tarballSha256: 'd'.repeat(64),
          platform: { os: [], cpu: [], libc: [] },
          dependencies: [],
        },
      ],
    };
    let resolutions = 0;
    const revised = await selectCandidates({
      rootDir: directory,
      config: {
        maxCandidatesPerRun: 1,
        streams: [{ ...stream, certificationRevision: 2 }],
      },
      ledger: { streams: {} },
      assessments: assessment,
      catalogs: {
        'runtime-npm': [{ ...catalogEntry, source: lightweightSource }],
      },
      sourceResolver: async (_stream, _version, _source, recordedSource) => {
        resolutions += 1;
        return {
          ...recordedSource,
          ...changedClosure,
          closureDigest: `sha256:${createHash('sha256').update(canonicalJson(changedClosure)).digest('hex')}`,
        };
      },
    });
    expect(resolutions).toBe(1);
    expect(revised.candidates).toHaveLength(1);
    expect(revised.candidates[0]).toMatchObject({
      certificationRevision: 2,
      source: { dependencyClosure: [{ version: '1.1.0' }] },
    });
  });

  it('fails closed on malformed, duplicate, or unknown-stream assessments', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tw-discovery-'));
    const catalogs = { 'example-v2': [] };
    const valid = {
      state: 'red',
      version: '2.0.1',
      certificationRevision: 1,
      candidateDigest: `sha256:${'a'.repeat(64)}`,
      source: source('1'),
    };
    await expect(
      selectCandidates({
        rootDir: directory,
        config,
        ledger: { streams: {} },
        catalogs,
        assessments: { schemaVersion: 1, streams: { unknown: [valid] } },
      }),
    ).rejects.toThrow(/unknown stream/u);
    await expect(
      selectCandidates({
        rootDir: directory,
        config,
        ledger: { streams: {} },
        catalogs,
        assessments: {
          schemaVersion: 1,
          streams: { 'example-v2': [valid, valid] },
        },
      }),
    ).rejects.toThrow(/duplicate/u);
    await expect(
      selectCandidates({
        rootDir: directory,
        config,
        ledger: { streams: {} },
        catalogs,
        assessments: {
          schemaVersion: 1,
          streams: {
            'example-v2': [{ ...valid, candidateDigest: 'not-a-digest' }],
          },
        },
      }),
    ).rejects.toThrow(/malformed/u);
  });

  it('marks an exact prepared patch and content-addresses its manifest', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tw-discovery-'));
    await mkdir(join(directory, 'patches/example/2.0.1'), { recursive: true });
    await writeFile(
      join(directory, 'patches/example/2.0.1/manifest.json'),
      '{"framework":"example"}\n',
    );
    const result = await selectCandidates({
      rootDir: directory,
      config,
      ledger: { streams: {} },
      catalogs: {
        'example-v2': [
          {
            version: '2.0.1',
            publishedAt: '2026-01-01T00:00:00Z',
            source: source('1'),
          },
        ],
      },
    });
    expect(result.candidates[0].patch.status).toBe('ready');
    expect(result.candidates[0].patch.manifestDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(result.candidates[0].candidateDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it('compares prefixed semantic versions numerically', () => {
    expect(compareVersions('v2.10.0', 'v2.9.9')).toBeGreaterThan(0);
  });

  it('turns an unsupported Go floor into typed candidate evidence', () => {
    expect(
      parseGoDownloadResult(
        'example.invalid/framework@v2.0.9',
        JSON.stringify({
          Error: 'requires go >= 1.25.0 (running go 1.24.13; GOTOOLCHAIN=local)',
          Sum: 'h1:source',
          GoModSum: 'h1:module',
          Zip: '/cache/framework.zip',
        }),
      ),
    ).toMatchObject({ RequiredGoVersion: '1.25.0' });
  });

  it('still fails discovery for non-toolchain Go download errors', () => {
    expect(() =>
      parseGoDownloadResult(
        'example.invalid/framework@v2.0.9',
        JSON.stringify({
          Error: 'checksum mismatch',
        }),
      ),
    ).toThrow('example.invalid/framework@v2.0.9: checksum mismatch');
  });

  it('never accepts a successful-looking payload from a failed Go process', () => {
    const failure = Object.assign(new Error('go exited nonzero'), {
      stdout: JSON.stringify({
        Sum: 'h1:source',
        GoModSum: 'h1:module',
        Zip: '/cache/framework.zip',
      }),
    });
    expect(() => recoverGoDownloadFailure('example.invalid/framework@v2.0.9', failure)).toThrow(
      failure,
    );
  });

  it('forces local toolchain selection over inherited or caller-provided auto mode', () => {
    expect(
      trustedGoEnvironment({ GOTOOLCHAIN: 'auto', GOWORK: 'off' }, { GOTOOLCHAIN: 'auto' }),
    ).toMatchObject({ GOTOOLCHAIN: 'local', GOWORK: 'off' });
  });

  it('discovers hook integrations without inventing a patch requirement', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tw-discovery-'));
    const hookConfig = {
      maxCandidatesPerRun: 2,
      streams: [
        {
          id: 'ink',
          frameworkId: 'ink',
          ecosystem: 'npm',
          registry: 'npm',
          package: 'ink',
          certificationRevision: 1,
          minimumVersion: '7.1.1',
          major: 7,
          mode: 'hook',
          hookStrategy: 'exact-source',
        },
      ],
    };
    const npmSource = {
      integrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
      shasum: 'a'.repeat(40),
      tarballSha256: 'b'.repeat(64),
      dependencyClosure: [],
    };
    const result = await selectCandidates({
      rootDir: directory,
      config: hookConfig,
      ledger: { streams: {} },
      catalogs: {
        ink: [
          {
            version: '7.1.2',
            publishedAt: '2026-03-01T00:00:00Z',
            source: npmSource,
          },
        ],
      },
    });
    expect(result.candidates[0]).toMatchObject({
      mode: 'hook',
      hookStrategy: 'exact-source',
      patch: { status: 'not-applicable', path: null, manifestDigest: null },
    });
  });

  it('refuses a hook stream whose certification mechanism is implicit', async () => {
    await expect(
      selectCandidates({
        config: {
          maxCandidatesPerRun: 1,
          streams: [
            {
              id: 'implicit',
              mode: 'hook',
              certificationRevision: 1,
              minimumVersion: '1.0.0',
            },
          ],
        },
        ledger: { streams: {} },
        catalogs: { implicit: [] },
      }),
    ).rejects.toThrow(/explicit exact-source or runtime strategy/u);
  });

  it('keeps the repository hook strategies explicit and framework-specific', async () => {
    const config = JSON.parse(
      await readFile(new URL('../compatibility/upstream-patches.json', import.meta.url), 'utf8'),
    );
    const strategies = Object.fromEntries(
      config.streams
        .filter((stream) => stream.mode === 'hook')
        .map((stream) => [stream.frameworkId, stream.hookStrategy]),
    );
    expect(strategies).toEqual({
      ink: 'exact-source',
      opentui: 'runtime',
      textual: 'runtime',
    });
  });

  it('uses npm release time and preserves registry integrity plus dependency metadata', async () => {
    const response = {
      ok: true,
      json: async () => ({
        time: { '7.1.2': '2026-03-01T00:00:00Z' },
        versions: {
          '7.1.2': {
            dist: {
              tarball: 'https://registry.invalid/ink.tgz',
              integrity: 'sha512-evidence',
              shasum: 'a'.repeat(40),
            },
            dependencies: { react: '^19.0.0' },
          },
        },
      }),
    };
    const entries = await npmCatalog({ id: 'ink', package: 'ink' }, async () => response);
    expect(entries).toEqual([
      {
        version: '7.1.2',
        publishedAt: '2026-03-01T00:00:00Z',
        source: {
          registry: 'https://registry.npmjs.org',
          tarball: 'https://registry.invalid/ink.tgz',
          integrity: 'sha512-evidence',
          shasum: 'a'.repeat(40),
          dependencies: { react: '^19.0.0' },
          optionalDependencies: {},
          peerDependencies: {},
          peerDependenciesMeta: {},
          bundledDependencies: [],
          os: [],
          cpu: [],
          libc: [],
        },
      },
    ]);
  });

  it('resolves ranged, nested, optional, peer, and platform packages into one checksum-bound graph', async () => {
    const tarballs = new Map();
    const manifest = (name, version, extra = {}) => {
      const bytes = Buffer.from(`${name}@${version}`);
      const tarball = `https://tarballs.invalid/${encodeURIComponent(name)}-${version}.tgz`;
      tarballs.set(tarball, bytes);
      return {
        name,
        version,
        ...extra,
        dist: {
          tarball,
          integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
          shasum: createHash('sha1').update(bytes).digest('hex'),
        },
      };
    };
    const packuments = {
      a: {
        versions: {
          '2.0.0': manifest('a', '2.0.0'),
          '1.9.0': manifest('a', '1.9.0', {
            dependencies: { nested: '~3.1.0' },
            optionalDependencies: { native: '^1.0.0' },
            peerDependencies: { peer: '>=4 <5' },
          }),
        },
      },
      nested: {
        versions: {
          '3.1.9': manifest('nested', '3.1.9'),
          '3.1.2': manifest('nested', '3.1.2'),
        },
      },
      native: {
        versions: {
          '1.2.0': manifest('native', '1.2.0', {
            os: ['darwin'],
            cpu: ['arm64'],
            libc: ['glibc'],
          }),
        },
      },
      peer: { versions: { '4.8.0': manifest('peer', '4.8.0') } },
    };
    const fetchImpl = async (url) => {
      if (tarballs.has(url)) return { ok: true, arrayBuffer: async () => tarballs.get(url) };
      const name = decodeURIComponent(url.slice('https://registry.npmjs.org/'.length));
      return {
        ok: packuments[name] !== undefined,
        status: packuments[name] === undefined ? 404 : 200,
        json: async () => packuments[name],
      };
    };
    const first = await resolveNpmDependencyClosure(
      { dependencies: { a: '^1.0.0' } },
      { fetchImpl },
    );
    const second = await resolveNpmDependencyClosure(
      { dependencies: { a: '^1.0.0' } },
      { fetchImpl },
    );
    expect(first.dependencyClosure.map(({ name, version }) => `${name}@${version}`)).toEqual([
      'a@1.9.0',
      'native@1.2.0',
      'nested@3.1.9',
      'peer@4.8.0',
    ]);
    expect(first.dependencyClosure.find((entry) => entry.name === 'native')?.platform).toEqual({
      os: ['darwin'],
      cpu: ['arm64'],
      libc: ['glibc'],
    });
    expect(
      first.dependencyClosure.every(
        (entry) =>
          entry.integrity.startsWith('sha512-') && /^[0-9a-f]{64}$/u.test(entry.tarballSha256),
      ),
    ).toBe(true);
    expect(first.closureDigest).toBe(second.closureDigest);
  });

  it('produces the same closure digest when registry versions and dependency declarations arrive out of order', async () => {
    const bytes = Buffer.from('same tarball');
    const dist = {
      tarball: 'https://tarballs.invalid/same.tgz',
      integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    };
    const makeFetch = (versions) => async (url) =>
      url.startsWith('https://tarballs.invalid/')
        ? { ok: true, arrayBuffer: async () => bytes }
        : { ok: true, json: async () => ({ versions }) };
    const forward = await resolveNpmDependencyClosure(
      { dependencies: { pkg: '^1.0.0' } },
      {
        fetchImpl: makeFetch({
          '1.0.0': { name: 'pkg', version: '1.0.0', dist },
          '1.2.0': { name: 'pkg', version: '1.2.0', dist },
        }),
      },
    );
    const reverse = await resolveNpmDependencyClosure(
      { dependencies: { pkg: '^1.0.0' } },
      {
        fetchImpl: makeFetch({
          '1.2.0': { name: 'pkg', version: '1.2.0', dist },
          '1.0.0': { name: 'pkg', version: '1.0.0', dist },
        }),
      },
    );
    expect(reverse).toEqual(forward);
  });

  it('fails closed instead of omitting an unsupported production dependency', async () => {
    await expect(
      resolveNpmDependencyClosure(
        { dependencies: { unsafe: 'git+https://example.invalid/unsafe.git' } },
        {
          fetchImpl: async () => ({
            ok: true,
            json: async () => ({ versions: { '1.0.0': {} } }),
          }),
        },
      ),
    ).rejects.toThrow(/unsupported npm dependency selector/u);
    await expect(
      resolveNpmDependencyClosure(
        {
          name: 'bundled-root',
          dependencies: { hidden: '1.0.0' },
          bundledDependencies: ['hidden'],
        },
        {
          fetchImpl: async () => ({
            ok: true,
            json: async () => ({ versions: {} }),
          }),
        },
      ),
    ).rejects.toThrow(/bundled production dependencies/u);
  });

  it('reselects the same npm root version when its transitive closure digest changes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tw-discovery-'));
    const npmConfig = {
      maxCandidatesPerRun: 2,
      streams: [
        {
          id: 'native',
          frameworkId: 'native',
          ecosystem: 'npm',
          registry: 'npm',
          package: 'native',
          certificationRevision: 1,
          minimumVersion: '1.0.0',
          mode: 'hook',
          hookStrategy: 'runtime',
          monitorDependencyClosure: true,
        },
      ],
    };
    const complete = (version) => {
      const dependencyRoots = [
        {
          name: 'platform',
          packageName: 'platform',
          requested: '^1',
          type: 'optional',
          optionalPeer: false,
          version,
        },
      ];
      const dependencyClosure = [
        {
          name: 'platform',
          version,
          integrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
          tarball: `https://registry.invalid/platform-${version}.tgz`,
          tarballSha256: 'e'.repeat(64),
          platform: { os: [], cpu: [], libc: [] },
          dependencies: [],
        },
      ];
      const closureDigest = `sha256:${createHash('sha256').update(canonicalJson({ dependencyRoots, dependencyClosure })).digest('hex')}`;
      return {
        integrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
        shasum: 'a'.repeat(40),
        tarballSha256: 'b'.repeat(64),
        dependencyRoots,
        dependencyClosure,
        closureComplete: true,
        closureDigest,
      };
    };
    const result = await selectCandidates({
      rootDir: directory,
      config: npmConfig,
      ledger: {
        streams: { native: [{ version: '1.0.0', source: complete('1.0.0') }] },
      },
      catalogs: {
        native: [
          {
            version: '1.0.0',
            publishedAt: '2026-03-01T00:00:00Z',
            source: complete('1.0.1'),
          },
        ],
      },
    });
    expect(result.candidates.map((entry) => entry.id)).toEqual(['native@1.0.0']);
  });

  it('reselects the same npm root version when its own immutable artifact evidence drifts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tw-discovery-'));
    const npmConfig = {
      maxCandidatesPerRun: 2,
      streams: [
        {
          id: 'native',
          frameworkId: 'native',
          ecosystem: 'npm',
          registry: 'npm',
          package: 'native',
          certificationRevision: 1,
          minimumVersion: '1.0.0',
          mode: 'hook',
          hookStrategy: 'runtime',
          monitorDependencyClosure: true,
        },
      ],
    };
    const dependencyRoots = [];
    const dependencyClosure = [];
    const closureDigest = `sha256:${createHash('sha256').update(canonicalJson({ dependencyRoots, dependencyClosure })).digest('hex')}`;
    const complete = (rootDigest) => ({
      integrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
      shasum: 'a'.repeat(40),
      tarball: 'https://registry.invalid/native.tgz',
      tarballSha256: rootDigest.repeat(64),
      dependencyRoots,
      dependencyClosure,
      closureComplete: true,
      closureDigest,
    });
    const result = await selectCandidates({
      rootDir: directory,
      config: npmConfig,
      ledger: {
        streams: { native: [{ version: '1.0.0', source: complete('b') }] },
      },
      catalogs: {
        native: [
          {
            version: '1.0.0',
            publishedAt: '2026-03-01T00:00:00Z',
            source: complete('c'),
          },
        ],
      },
    });
    expect(result.candidates.map((entry) => entry.id)).toEqual(['native@1.0.0']);
  });

  it('records every non-yanked PyPI file hash and deterministically prefers the sdist', async () => {
    const response = {
      ok: true,
      json: async () => ({
        releases: {
          '8.3.0': [
            {
              filename: 'textual.whl',
              packagetype: 'bdist_wheel',
              url: 'https://pypi.invalid/wheel',
              upload_time_iso_8601: '2026-03-02T00:00:01Z',
              yanked: false,
              digests: { sha256: 'a'.repeat(64) },
            },
            {
              filename: 'textual.tar.gz',
              packagetype: 'sdist',
              url: 'https://pypi.invalid/sdist',
              upload_time_iso_8601: '2026-03-02T00:00:00Z',
              yanked: false,
              digests: { sha256: 'b'.repeat(64) },
            },
          ],
        },
      }),
    };
    const entries = await pypiCatalog({ id: 'textual', package: 'textual' }, async () => response);
    expect(entries[0].source).toMatchObject({
      filename: 'textual.tar.gz',
      sha256: 'b'.repeat(64),
    });
    expect(entries[0].source.files).toHaveLength(2);
  });
});
