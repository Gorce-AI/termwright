import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { describe, expect } from 'vitest';
import { it as resourceAwareIt } from '../packages/resource-broker/src/vitest.ts';
import {
  assertCandidateSemanticSession,
  assertRustTestDiscovered,
  bindLocalTermwrightGoClient,
  candidateExecutableName,
  candidateToolchainBlock,
  certificationPlatform,
  deriveHookInstrumentationProfile,
  installedDependencyFrom,
  isSupportedCompileCapabilityCandidate,
  packageContentDigestForEntries,
  selectCharmCandidateComposition,
  verifyCandidateEvidence,
  verifyDerivedInkTransforms,
  verifyInstalledNpmClosure,
  verifyPreparedUpdateInvariant,
} from './certify-framework-candidate.mjs';
import { digestTree } from './prepare-framework-candidate.mjs';
import {
  instrumentInkCore,
  instrumentInkRenderer,
} from '../packages/probe-ink/src/instrumentation.ts';

const exec = promisify(execFile);
const requireInk = createRequire(new URL('../packages/probe-ink/package.json', import.meta.url));
const it = resourceAwareIt.resources({ hostPressure: 'exclusive' });

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
  return Buffer.concat([header, contents, Buffer.alloc((512 - (contents.length % 512)) % 512)]);
}

function packageTar(files) {
  return gzipSync(
    Buffer.concat([
      ...Object.entries(files)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([path, contents]) => tarEntry(`package/${path}`, Buffer.from(contents))),
      Buffer.alloc(1024),
    ]),
  );
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
  const rootManifest = JSON.stringify({
    name: '@example/root',
    version: '1.2.3',
    main: 'index.js',
    dependencies: { dependency: '^4.0.0' },
  });
  const dependencyManifest = JSON.stringify({
    name: 'dependency',
    version: '4.1.0',
    main: 'index.js',
    bin: { dependency: 'cli.js' },
  });
  await writeFile(join(rootPackage, 'package.json'), rootManifest);
  await writeFile(join(rootPackage, 'index.js'), 'export {};\n');
  await mkdir(join(rootPackage, 'node_modules', '.bin'), { recursive: true });
  await writeFile(join(rootPackage, 'node_modules', '.bin', 'dependency'), '#!/bin/sh\n');
  await writeFile(join(dependency, 'package.json'), dependencyManifest);
  await writeFile(join(dependency, 'index.js'), 'export {};\n');
  await writeFile(join(dependency, 'cli.js'), '#!/usr/bin/env node\n');
  const rootTar = packageTar({
    'index.js': 'export {};\n',
    'package.json': rootManifest,
  });
  const dependencyTar = packageTar({
    'cli.js': '#!/usr/bin/env node\n',
    'index.js': 'export {};\n',
    'package.json': dependencyManifest,
  });
  const tarballs = new Map([
    ['https://registry.invalid/root.tgz', rootTar],
    ['https://registry.invalid/dependency.tgz', dependencyTar],
  ]);
  const fetchImpl = async (url) => ({
    ok: tarballs.has(url),
    status: tarballs.has(url) ? 200 : 404,
    arrayBuffer: async () => tarballs.get(url),
  });
  const dependencyNode = {
    name: 'dependency',
    version: '4.1.0',
    ...npmSource('https://registry.invalid/dependency.tgz', dependencyTar),
    dependencies: [],
  };
  const candidate = {
    id: 'root@1.2.3',
    package: '@example/root',
    version: '1.2.3',
    source: {
      ...npmSource('https://registry.invalid/root.tgz', rootTar),
      closureComplete: true,
      dependencyRoots: [
        {
          name: 'dependency',
          requested: '^4.0.0',
          type: 'dependency',
          optionalPeer: false,
          packageName: 'dependency',
          version: '4.1.0',
        },
      ],
      dependencyClosure: [dependencyNode],
    },
  };
  return { candidate, dependency, directory, fetchImpl, probe, rootPackage };
}

describe('framework candidate evidence binding', () => {
  it('binds and verifies the repository-owned Go client in one toolchain transaction', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tw-go-client-replace-'));
    const client = join(directory, 'client');
    const app = join(directory, 'app');
    await Promise.all([mkdir(client), mkdir(app)]);
    const canonicalClient = await realpath(client);
    const env = { PATH: '/toolchain' };
    const calls = [];
    try {
      await expect(
        bindLocalTermwrightGoClient(app, env, client, async (...arguments_) => {
          calls.push(arguments_);
          return {
            stdout: JSON.stringify({
              Replace: [
                {
                  Old: { Path: 'github.com/gorce-ai/termwright/clients/go' },
                  New: { Path: canonicalClient },
                },
              ],
            }),
            stderr: '',
          };
        }),
      ).resolves.toBe(canonicalClient);
      expect(calls).toEqual([
        [
          'go',
          ['mod', 'edit', `-replace=github.com/gorce-ai/termwright/clients/go=${canonicalClient}`],
          env,
          app,
        ],
        ['go', ['mod', 'edit', '-json'], env, app],
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ['malformed JSON', '{'],
    ['a mismatched replacement', JSON.stringify({ Replace: [] })],
  ])('fails closed when go mod edit returns %s', async (_label, stdout) => {
    const client = await mkdtemp(join(tmpdir(), 'tw-go-client-invalid-'));
    try {
      await expect(
        bindLocalTermwrightGoClient('/candidate', {}, client, async () => ({ stdout, stderr: '' })),
      ).rejects.toThrow(
        /malformed JSON|did not report the exact Termwright Go client replacement/u,
      );
    } finally {
      await rm(client, { recursive: true, force: true });
    }
  });

  it('refuses a zero-test Rust certification filter', () => {
    expect(() =>
      assertRustTestDiscovered(
        'running 0 tests\n\ntest result: ok. 0 passed; 0 failed\n',
        'required_contract_test',
        'ratatui-core@0.1.2',
      ),
    ).toThrow(/was not discovered/u);
    expect(() =>
      assertRustTestDiscovered(
        'required_contract_test: test\n',
        'required_contract_test',
        'ratatui-core@0.1.2',
      ),
    ).not.toThrow();
  });

  it('binds verdict provenance to the actual supported host platform', () => {
    expect(certificationPlatform('linux')).toBe('linux');
    expect(certificationPlatform('darwin')).toBe('macos');
    expect(certificationPlatform('win32')).toBe('windows');
    expect(() => certificationPlatform('freebsd')).toThrow(
      /unsupported certification host platform/u,
    );
    expect(candidateExecutableName('windows')).toBe('candidate-app.exe');
    expect(candidateExecutableName('linux')).toBe('candidate-app');
  });

  it('rejects a generated patch bundle changed by candidate code after trusted preparation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tw-prepared-update-'));
    await mkdir(join(directory, 'patch'));
    await writeFile(join(directory, 'patch', 'manifest.json'), '{"version":1}\n');
    await writeFile(join(directory, 'bundle.json'), '{"trusted":true}\n');
    const invariant = {
      directory,
      bundle: await readFile(join(directory, 'bundle.json')),
      patchTreeDigest: await digestTree(join(directory, 'patch')),
    };
    await expect(verifyPreparedUpdateInvariant(invariant)).resolves.toBeUndefined();
    await writeFile(join(directory, 'patch', 'manifest.json'), '{"version":2}\n');
    await expect(verifyPreparedUpdateInvariant(invariant)).rejects.toThrow(/patch tree changed/u);
    await writeFile(join(directory, 'patch', 'manifest.json'), '{"version":1}\n');
    await writeFile(join(directory, 'bundle.json'), '{"trusted":false}\n');
    await expect(verifyPreparedUpdateInvariant(invariant)).rejects.toThrow(/bundle changed/u);
  });
  it('executes Bubble Tea and Bubbles candidates with an exact certified companion', () => {
    const tea = 'charm.land/bubbletea/v2';
    const bubbles = 'charm.land/bubbles/v2';
    const patchSets = [
      { name: tea, version: 'v2.0.8' },
      { name: tea, version: 'v2.0.9' },
      { name: bubbles, version: 'v2.1.1' },
    ];
    expect(
      selectCharmCandidateComposition(
        { id: 'bubbletea-v2@v2.0.9', package: tea, version: 'v2.0.9' },
        patchSets,
        tea,
        bubbles,
      ),
    ).toEqual({ teaVersion: 'v2.0.9', bubblesVersion: 'v2.1.1' });
    expect(
      selectCharmCandidateComposition(
        {
          id: 'bubbles-v2@v2.2.0',
          package: bubbles,
          version: 'v2.2.0',
          mode: 'capability',
          capability: 'bubbles-private-state',
          capabilityStrategy: 'compile-conformance',
        },
        patchSets,
        tea,
        bubbles,
      ),
    ).toEqual({ teaVersion: 'v2.0.9', bubblesVersion: 'v2.2.0' });
  });

  it('admits only the declared add-only Go capability streams', () => {
    for (const candidate of [
      { frameworkId: 'tview', package: 'github.com/rivo/tview', capability: 'tview-private-state' },
      {
        frameworkId: 'tview',
        package: 'github.com/gdamore/tcell/v2',
        capability: 'tcell-same-writer-marker',
      },
      {
        frameworkId: 'charm',
        package: 'github.com/charmbracelet/bubbles',
        capability: 'bubbles-private-state',
      },
      {
        frameworkId: 'charm',
        package: 'charm.land/bubbles/v2',
        capability: 'bubbles-private-state',
      },
    ]) {
      expect(
        isSupportedCompileCapabilityCandidate({
          ...candidate,
          mode: 'capability',
          capabilityStrategy: 'compile-conformance',
        }),
      ).toBe(true);
    }
    expect(
      isSupportedCompileCapabilityCandidate({
        frameworkId: 'tview',
        package: 'github.com/rivo/tview',
        capability: 'wrong-capability',
        mode: 'capability',
        capabilityStrategy: 'compile-conformance',
      }),
    ).toBe(false);
    expect(
      isSupportedCompileCapabilityCandidate({
        frameworkId: 'tview',
        package: 'github.com/rivo/tview',
        capability: 'tview-private-state',
        mode: 'patch',
        capabilityStrategy: 'compile-conformance',
      }),
    ).toBe(false);
  });

  it('fails closed when a Charm candidate has no exact companion profile', () => {
    expect(() =>
      selectCharmCandidateComposition(
        { id: 'bubbletea-v2@v2.0.9', package: 'tea', version: 'v2.0.9' },
        [{ name: 'tea', version: 'v2.0.9' }],
        'tea',
        'bubbles',
      ),
    ).toThrow(/no exact certified Charm companion/u);
  });

  it('rejects a Bubbles compile-capability candidate without an exact-certified Bubble Tea companion', () => {
    expect(() =>
      selectCharmCandidateComposition(
        {
          id: 'bubbles-v2@v2.2.0',
          package: 'bubbles',
          version: 'v2.2.0',
          mode: 'capability',
          capability: 'bubbles-private-state',
          capabilityStrategy: 'compile-conformance',
        },
        [{ name: 'bubbles', version: 'v2.1.1' }],
        'tea',
        'bubbles',
      ),
    ).toThrow(/no exact certified Charm companion/u);
  });

  it('fails closed when the exact candidate patch declaration is missing', () => {
    expect(() =>
      selectCharmCandidateComposition(
        { id: 'bubbletea-v2@v2.0.9', package: 'tea', version: 'v2.0.9' },
        [
          { name: 'tea', version: 'v2.0.8' },
          { name: 'bubbles', version: 'v2.1.1' },
        ],
        'tea',
        'bubbles',
      ),
    ).toThrow(/exact candidate patch declaration is missing/u);
  });

  it('does not let a patch candidate bypass exact admission by resembling Bubbles', () => {
    expect(() =>
      selectCharmCandidateComposition(
        {
          id: 'bubbles-v2@v2.2.0',
          package: 'bubbles',
          version: 'v2.2.0',
          mode: 'patch',
        },
        [
          { name: 'tea', version: 'v2.0.9' },
          { name: 'bubbles', version: 'v2.1.1' },
        ],
        'tea',
        'bubbles',
      ),
    ).toThrow(/exact candidate patch declaration is missing/u);
  });
  it('walks the real pnpm package location when dependency versions diverge', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tw-pnpm-closure-'));
    const packageDirectory = (key, name) => join(directory, '.pnpm', key, 'node_modules', name);
    const rootPackage = packageDirectory('root@1.0.0', 'root');
    const stringWidth = packageDirectory('string-width@7.2.0', 'string-width');
    const stripAnsi71 = join(rootPackage, 'node_modules', 'strip-ansi');
    const stripAnsi72 = join(dirname(stringWidth), 'strip-ansi');
    try {
      await Promise.all(
        [rootPackage, stringWidth, stripAnsi71, stripAnsi72].map((path) =>
          mkdir(path, { recursive: true }),
        ),
      );
      await Promise.all([
        writeFile(
          join(rootPackage, 'package.json'),
          JSON.stringify({ name: 'root', version: '1.0.0' }),
        ),
        writeFile(
          join(stringWidth, 'package.json'),
          JSON.stringify({ name: 'string-width', version: '7.2.0' }),
        ),
        writeFile(
          join(stripAnsi71, 'package.json'),
          JSON.stringify({ name: 'strip-ansi', version: '7.1.2' }),
        ),
        writeFile(
          join(stripAnsi72, 'package.json'),
          JSON.stringify({ name: 'strip-ansi', version: '7.2.0' }),
        ),
      ]);
      await mkdir(join(rootPackage, 'node_modules'), { recursive: true });
      await symlink(
        stringWidth,
        join(rootPackage, 'node_modules', 'string-width'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );

      await expect(installedDependencyFrom(rootPackage, 'strip-ansi')).resolves.toMatchObject({
        manifest: { version: '7.1.2' },
      });
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
    await expect(
      deriveHookInstrumentationProfile(
        {
          id: 'opentui@0.5.4',
          frameworkId: 'opentui',
          hookStrategy: 'runtime',
        },
        Buffer.from('not an archive'),
        'a'.repeat(40),
      ),
    ).rejects.toThrow(/no deterministic exact-source/u);
  });

  it('checks derived Ink transforms with canonical package paths', async () => {
    const inkBuild = dirname(requireInk.resolve('ink'));
    const profile = {
      sources: {
        renderer: await readFile(join(inkBuild, 'renderer.js'), 'utf8'),
        core: await readFile(join(inkBuild, 'ink.js'), 'utf8'),
      },
    };
    expect(() =>
      verifyDerivedInkTransforms(
        'ink@7.1.1',
        { instrumentInkCore, instrumentInkRenderer },
        profile,
      ),
    ).not.toThrow();
  });

  it('cryptographically binds the exact installed npm graph to every discovered tarball', async () => {
    const { candidate, directory, fetchImpl, probe } = await npmClosureFixture();
    try {
      await expect(
        verifyInstalledNpmClosure(candidate, probe, { fetchImpl }),
      ).resolves.toMatchObject({ version: '1.2.3', resolvedNodes: 1 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects altered installed bytes even when package names, versions and declarations match', async () => {
    const { candidate, dependency, directory, fetchImpl, probe } = await npmClosureFixture();
    try {
      await writeFile(join(dependency, 'index.js'), 'export const altered = true;\n');
      await expect(verifyInstalledNpmClosure(candidate, probe, { fetchImpl })).rejects.toThrow(
        /content does not match/u,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects undeclared installed content below the package node_modules boundary', async () => {
    const { candidate, directory, fetchImpl, probe, rootPackage } = await npmClosureFixture();
    try {
      await mkdir(join(rootPackage, 'node_modules'), { recursive: true });
      await writeFile(
        join(rootPackage, 'node_modules', 'hidden.js'),
        'export const hidden = true;\n',
      );
      await expect(verifyInstalledNpmClosure(candidate, probe, { fetchImpl })).rejects.toThrow(
        /root content does not match/u,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('ignores only package-manager launchers materialized below node_modules/.bin', async () => {
    const { candidate, directory, fetchImpl, probe, rootPackage } = await npmClosureFixture();
    try {
      await mkdir(join(rootPackage, 'node_modules', '.bin'), {
        recursive: true,
      });
      await writeFile(join(rootPackage, 'node_modules', '.bin', 'dependency'), '#!/bin/sh\n');
      await expect(
        verifyInstalledNpmClosure(candidate, probe, { fetchImpl }),
      ).resolves.toMatchObject({ version: '1.2.3', resolvedNodes: 1 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects undeclared package-manager launchers below node_modules/.bin', async () => {
    const { candidate, directory, fetchImpl, probe, rootPackage } = await npmClosureFixture();
    try {
      await mkdir(join(rootPackage, 'node_modules', '.bin'), {
        recursive: true,
      });
      await writeFile(join(rootPackage, 'node_modules', '.bin', 'unbound'), '#!/bin/sh\n');
      await expect(verifyInstalledNpmClosure(candidate, probe, { fetchImpl })).rejects.toThrow(
        /bin entry is undeclared/u,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('binds executable mode even when file bytes are unchanged', () => {
    const regular = [
      {
        path: 'index.js',
        executableMode: 0,
        sha256: `sha256:${'a'.repeat(64)}`,
      },
    ];
    const executable = [{ ...regular[0], executableMode: 0o111 }];

    expect(packageContentDigestForEntries(executable)).not.toBe(
      packageContentDigestForEntries(regular),
    );
  });

  it('rejects expected closure nodes that are unreachable from the installed root', async () => {
    const { candidate, directory, fetchImpl, probe } = await npmClosureFixture();
    try {
      candidate.source.dependencyClosure.push({
        ...candidate.source.dependencyClosure[0],
        name: 'orphan',
        version: '9.0.0',
      });
      await expect(verifyInstalledNpmClosure(candidate, probe, { fetchImpl })).rejects.toThrow(
        /unreachable nodes: orphan@9\.0\.0/u,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('uses the frozen contract instead of the removed provisional capabilities API', async () => {
    const session = {
      settled: async () => ({
        capabilities: { 'semantic-tree': { status: 'supported' } },
      }),
      semanticTree: () => ({ v: 2 }),
    };
    await expect(
      assertCandidateSemanticSession(session, 'bubbletea-v2@v2.0.9'),
    ).resolves.toBeUndefined();
  });

  it('rejects a session whose frozen contract lacks semantic support', async () => {
    const session = {
      settled: async () => ({
        capabilities: { 'semantic-tree': { status: 'unsupported' } },
      }),
      semanticTree: () => ({ v: 2 }),
    };
    await expect(assertCandidateSemanticSession(session, 'bubbletea-v2@v2.0.9')).rejects.toThrow(
      /no supported semantic tree/u,
    );
  });

  it('classifies a newer upstream Go floor as a typed red candidate outcome', () => {
    expect(
      candidateToolchainBlock(
        {
          id: 'bubbletea-v2@v2.1.0',
          source: { requiredGoVersion: '1.26.0', toolchainSupported: false },
        },
        '1.25',
      ),
    ).toBe(
      'bubbletea-v2@v2.1.0: requires Go >= 1.26.0; trusted certification is pinned to Go 1.25',
    );
  });

  it('returns a failing process status after retaining a typed red verdict', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tw-red-candidate-'));
    const registry = join(directory, 'registry.json');
    const verdict = join(directory, 'verdict.json');
    await writeFile(
      registry,
      JSON.stringify({
        candidates: [
          {
            id: 'bubbletea-v2@v2.1.0',
            candidateDigest: `sha256:${'a'.repeat(64)}`,
            source: { requiredGoVersion: '1.26.0', toolchainSupported: false },
          },
        ],
      }),
    );
    try {
      await expect(
        exec(
          process.execPath,
          [
            fileURLToPath(new URL('./certify-framework-candidate.mjs', import.meta.url)),
            '--registry',
            registry,
            '--candidate',
            'bubbletea-v2@v2.1.0',
            '--platform',
            certificationPlatform(),
            '--output',
            verdict,
          ],
          {
            env: {
              ...process.env,
              GITHUB_SHA: 'candidate-sha',
              TERMWRIGHT_UPSTREAM_GO_VERSION: '1.25',
            },
          },
        ),
      ).rejects.toMatchObject({ code: 1 });
      expect(JSON.parse(await readFile(verdict, 'utf8'))).toMatchObject({
        candidateId: 'bubbletea-v2@v2.1.0',
        platform: certificationPlatform(),
        state: 'red',
        detail:
          'bubbletea-v2@v2.1.0: requires Go >= 1.26.0; trusted certification is pinned to Go 1.25',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('accepts an exact Go source binding', () => {
    expect(() =>
      verifyCandidateEvidence(
        {
          id: 'tview@v0.42.0',
          package: 'github.com/rivo/tview',
          version: 'v0.42.0',
          registry: 'go',
          source: {
            sum: 'h1:module',
            goModSum: 'h1:gomod',
            zipSha256: 'a'.repeat(64),
          },
        },
        {
          behaviorallyCertified: true,
          stablePublishEligible: true,
          candidates: [
            {
              module: 'github.com/rivo/tview',
              upstreamVersion: 'v0.42.0',
              material: {
                sum: 'h1:module',
                goModSum: 'h1:gomod',
                zipDigest: `sha256:${'a'.repeat(64)}`,
              },
            },
          ],
        },
        { passed: true },
      ),
    ).not.toThrow();
  });

  it('rejects evidence for another source archive', () => {
    expect(() =>
      verifyCandidateEvidence(
        {
          id: 'ratatui-core@0.1.2',
          package: 'ratatui-core',
          version: '0.1.2',
          registry: 'crates.io',
          source: { checksum: 'b'.repeat(64) },
        },
        {
          behaviorallyCertified: true,
          stablePublishEligible: true,
          candidates: [
            {
              module: 'ratatui-core',
              upstreamVersion: '0.1.2',
              material: {
                checksum: `sha256:${'c'.repeat(64)}`,
                archiveDigest: `sha256:${'c'.repeat(64)}`,
              },
            },
          ],
        },
        { passed: true },
      ),
    ).toThrow(/does not match/u);
  });

  it('rejects deterministic patch application that lacks candidate-specific behavioral certification', () => {
    expect(() =>
      verifyCandidateEvidence(
        {
          id: 'tview@v0.43.0',
          package: 'github.com/rivo/tview',
          version: 'v0.43.0',
          registry: 'go',
          source: {
            sum: 'h1:module',
            goModSum: 'h1:gomod',
            zipSha256: 'a'.repeat(64),
          },
        },
        {
          behaviorallyCertified: false,
          stablePublishEligible: false,
          candidates: [],
        },
        { passed: false },
      ),
    ).toThrow(/not behaviorally certified/u);
  });
});
