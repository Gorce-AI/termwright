import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { digestTree } from './prepare-framework-candidate.mjs';
import { canonicalJson, selectCandidates } from './discover-framework-candidates.mjs';
import { addCertifiedRuntimeProfile, generatedUpdateDirectories, reconcile, recordVerifiedFrameworkVersion, renderCertifiedTextualPyproject, renderCertifiedTextualVersions, renderExactPeerRange, sameHookProfile, verifyGeneratedHookProfile, verifyGeneratedRuntimeProfile, verifyGeneratedTextualLock, verifyGeneratedUpdate } from './reconcile-framework-candidates.mjs';

const candidate = { id: 'example@2.1.1', streamId: 'example', package: 'example', version: '2.1.1', certificationRevision: 1, publishedAt: '2026-01-03T00:00:00Z', source: { checksum: 'a'.repeat(64) }, patch: { status: 'ready', path: 'patches/2.1.1/manifest.json', manifestDigest: `sha256:${'b'.repeat(64)}` }, candidateDigest: `sha256:${'c'.repeat(64)}` };

describe('framework candidate reconciliation', () => {
  it('compares exact-source Ink profiles canonically without OpenTUI chunk machinery', () => {
    const left = { version: '7.1.1', rendererSha256: 'a'.repeat(64), coreSha256: 'b'.repeat(64) };
    expect(sameHookProfile(left, { coreSha256: 'b'.repeat(64), rendererSha256: 'a'.repeat(64), version: '7.1.1' })).toBe(true);
    expect(sameHookProfile(left, { ...left, coreSha256: 'c'.repeat(64) })).toBe(false);
  });

  it('renders a deterministic exact peer range for every certified hook version', () => {
    expect(renderExactPeerRange(['7.2.0', '7.1.1', '7.1.2', '7.1.1'])).toBe('7.1.1 || 7.1.2 || 7.2.0');
    expect(() => renderExactPeerRange([])).toThrow(/at least one version/u);
  });

  it('renders the Python strong-instrumentation allowlist deterministically from exact registry versions', () => {
    const source = renderCertifiedTextualVersions({ frameworks: [{
      id: 'textual',
      versions: { verified: ['8.3.0', '8.2.8', '8.3.0'] },
    }] });
    expect(source).toContain('CERTIFIED_TEXTUAL_VERSIONS = ("8.2.8", "8.3.0",)');
  });

  it('pins the Textual extra and dev environment to the latest certified exact version', () => {
    const registry = { frameworks: [{ id: 'textual', versions: { verified: ['8.2.8', '8.2.10'] } }] };
    const source = '[project.optional-dependencies]\ntextual = ["textual==8.2.8"]\ndev = ["pytest>=7", "pytest-asyncio>=0.21", "textual==8.2.8"]\n\n[project.urls]\n';
    expect(renderCertifiedTextualPyproject(source, registry)).toContain('textual = ["textual==8.2.10"]\ndev = ["pytest>=7", "pytest-asyncio>=0.21", "textual==8.2.10"]');
    for (const malformedSource of [
      'textual = ["textual>=8"]\ndev = ["pytest>=7", "pytest-asyncio>=0.21", "textual==8.2.8"]\n',
      'textual = ["not-textual==8.2.8"]\ndev = ["pytest>=7", "pytest-asyncio>=0.21", "not-textual==8.2.8"]\n',
      'textual = ["textual==8.2.8; sys_platform == \'win32\'"]\ndev = ["pytest>=7", "pytest-asyncio>=0.21", "textual==8.2.8"]\n',
      '[tool.example]\ntextual = ["textual==8.2.8"]\ndev = ["pytest>=7", "pytest-asyncio>=0.21", "textual==8.2.8"]\n\n[project.urls]\n',
      `${source}\n${source}`,
    ]) expect(() => renderCertifiedTextualPyproject(malformedSource, registry)).toThrow(/exact certified pin grammar/u);
    for (const version of ['v8.2.10', '8.2.10rc1', '08.2.10', '9007199254740992.2.10', '8.2.10"\nmalicious = ["x']) {
      const malformed = { frameworks: [{ id: 'textual', versions: { verified: ['8.2.8', version] } }] };
      expect(() => renderCertifiedTextualPyproject(source, malformed)).toThrow(/invalid PyPI version/u);
      expect(() => renderCertifiedTextualVersions(malformed)).toThrow(/invalid PyPI version/u);
    }
  });

  it('accepts only the source-run-bound Textual lock artifact and its exact trusted pyproject', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tw-textual-lock-'));
    const candidate = {
      id: 'textual@8.2.9', frameworkId: 'textual', registry: 'pypi', version: '8.2.9',
      candidateDigest: `sha256:${'a'.repeat(64)}`,
    };
    const revision = 'b'.repeat(40);
    const verdict = { state: 'green', sourceRevision: revision };
    const pyproject = 'textual = ["textual==8.2.9"]\n';
    const lock = 'version = 1\n';
    await writeFile(join(directory, 'pyproject.toml'), pyproject);
    await writeFile(join(directory, 'uv.lock'), lock);
    await writeFile(join(directory, 'bundle.json'), canonicalJson({
      schemaVersion: 1,
      kind: 'termwright-generated-textual-lock',
      candidateId: candidate.id,
      candidateDigest: candidate.candidateDigest,
      sourceRevision: revision,
      framework: 'textual',
      version: candidate.version,
      pyprojectSha256: `sha256:${createHash('sha256').update(pyproject).digest('hex')}`,
      lockSha256: `sha256:${createHash('sha256').update(lock).digest('hex')}`,
    }));
    await expect(verifyGeneratedTextualLock({ candidate, verdict, updateDirectory: directory, expectedRevision: revision, expectedPyproject: pyproject }))
      .resolves.toEqual({ pyproject, lock: Buffer.from(lock) });
    await writeFile(join(directory, 'uv.lock'), `${lock}tampered = true\n`);
    await expect(verifyGeneratedTextualLock({ candidate, verdict, updateDirectory: directory, expectedRevision: revision, expectedPyproject: pyproject }))
      .rejects.toThrow(/lock digest mismatch/u);
  });

  it('discovers only direct aggregate-owned update namespaces, never nested forged bundles', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tw-update-discovery-'));
    const direct = join(directory, 'candidate-update-runtime-aaaaaaaaaaaaaaaa');
    const nested = join(direct, 'aaa-forged-textual');
    await mkdir(nested, { recursive: true });
    await writeFile(join(direct, 'bundle.json'), '{}\n');
    await writeFile(join(nested, 'bundle.json'), '{}\n');
    const updates = await generatedUpdateDirectories(directory);
    expect([...updates.keys()]).toEqual(['candidate-update-runtime-aaaaaaaaaaaaaaaa']);
    expect([...updates.values()]).toEqual([direct]);
  });

  it('promotes only the exact behaviorally green Textual candidate into registry and bundled allowlist', () => {
    const compatibility = { frameworks: [{
      id: 'textual', frameworkPackage: 'textual',
      versions: { policy: 'exact', declared: '8.2.8', verified: ['8.2.8'] },
      certification: { adapterVersion: '0.2.0', ids: ['textual@8.2.8/0.2.0'], strategy: 'native-hook' },
    }] };
    recordVerifiedFrameworkVersion(compatibility, {
      id: 'textual@8.2.9',
      frameworkId: 'textual',
      package: 'textual',
      version: '8.2.9',
    });
    expect(compatibility.frameworks[0].versions).toEqual({
      policy: 'exact',
      declared: '8.2.8 or 8.2.9',
      verified: ['8.2.8', '8.2.9'],
    });
    expect(compatibility.frameworks[0].certification.ids).toEqual([
      'textual@8.2.8/0.2.0',
      'textual@8.2.9/0.2.0',
    ]);
    expect(renderCertifiedTextualVersions(compatibility)).toContain('("8.2.8", "8.2.9",)');
  });

  it('adds the exact runtime module variant and certification id for a green OpenTUI version', () => {
    const compatibility = { frameworks: [{
      id: 'opentui', frameworkPackage: '@opentui/core',
      versions: { policy: 'exact', declared: '0.5.3', verified: ['0.5.3'] },
      instrumentation: { variants: [] },
      certification: {
        adapterVersion: '0.2.0', ids: ['opentui@0.5.3/0.2.0'],
        strategy: 'runtime-capability-and-behavior',
      },
    }] };
    const next = { id: 'opentui@0.5.4', frameworkId: 'opentui', package: '@opentui/core', version: '0.5.4' };

    recordVerifiedFrameworkVersion(compatibility, next);
    recordVerifiedFrameworkVersion(compatibility, next);

    expect(compatibility.frameworks[0].certification.ids).toEqual([
      'opentui@0.5.3/0.2.0', 'opentui@0.5.4/0.2.0',
    ]);
    expect(compatibility.frameworks[0].instrumentation.variants).toEqual([
      { id: 'opentui-0.5.3', frameworkVersion: '0.5.3', modules: [{ name: '@opentui/core', version: '0.5.3' }] },
      { id: 'opentui-0.5.4', frameworkVersion: '0.5.4', modules: [{ name: '@opentui/core', version: '0.5.4' }] },
    ]);

    const beforeWrongPackage = structuredClone(compatibility);
    expect(() => recordVerifiedFrameworkVersion(compatibility, {
      ...next, id: 'opentui@0.5.5', package: '@opentui/not-core', version: '0.5.5',
    })).toThrow(/does not match/u);
    expect(compatibility).toEqual(beforeWrongPackage);

    const conflicting = structuredClone(compatibility);
    conflicting.frameworks[0].instrumentation.variants[0].id = 'wrong-id';
    const beforeConflict = structuredClone(conflicting);
    expect(() => recordVerifiedFrameworkVersion(conflicting, {
      ...next, id: 'opentui@0.5.5', version: '0.5.5',
    })).toThrow(/another identity/u);
    expect(conflicting).toEqual(beforeConflict);
  });

  it('updates the ledger only for a matching green verdict and is idempotent', () => {
    const verdict = { candidateId: candidate.id, candidateDigest: candidate.candidateDigest, state: 'green', detail: 'ok' };
    const first = reconcile({ candidates: [candidate] }, { schemaVersion: 1, streams: {} }, [verdict]);
    const second = reconcile({ candidates: [candidate] }, first.ledger, [verdict]);
    expect(first.ledger.streams.example).toHaveLength(1);
    expect(second.ledger).toEqual(first.ledger);
    expect(first.plan.issues).toEqual([]);
  });

  it('keeps a red candidate out of the ledger and produces a stable issue key', () => {
    const result = reconcile({ candidates: [candidate] }, { schemaVersion: 1, streams: {} }, [{ candidateId: candidate.id, candidateDigest: candidate.candidateDigest, state: 'red', detail: 'failed' }], { runUrl: 'https://github.com/owner/repo/actions/runs/1', owner: 'owner' });
    expect(result.ledger.streams).toEqual({});
    expect(result.assessments.streams.example).toEqual([{
      state: 'red',
      version: candidate.version,
      certificationRevision: 1,
      candidateDigest: candidate.candidateDigest,
      source: candidate.source,
    }]);
    expect(result.plan.issues[0].key).toBe(candidate.id);
    expect(result.plan.issues[0]).toMatchObject({ owner: 'owner' });
    expect(result.plan.issues[0].body).toContain('https://github.com/owner/repo/actions/runs/1');
    expect(result.plan.issues[0].body).toContain('Certification revision: `1`');
    expect(result.plan.issues[0].body).toContain('increment `certificationRevision` for stream `example`');
  });

  it('records red assessments separately while promoting green candidates in the same batch', () => {
    const green = { ...candidate, id: 'green@2.1.2', streamId: 'green', version: '2.1.2', candidateDigest: `sha256:${'d'.repeat(64)}` };
    const result = reconcile(
      { candidates: [candidate, green] },
      { schemaVersion: 1, streams: {} },
      [
        { candidateId: candidate.id, candidateDigest: candidate.candidateDigest, state: 'red', detail: 'failed' },
        { candidateId: green.id, candidateDigest: green.candidateDigest, state: 'green', detail: 'ok' },
      ],
      { runUrl: 'https://github.com/owner/repo/actions/runs/4', owner: 'owner' },
    );
    expect(result.ledger.streams.green).toHaveLength(1);
    expect(result.ledger.streams.example).toBeUndefined();
    expect(result.assessments.streams.example).toHaveLength(1);
    expect(result.assessments.streams.green).toBeUndefined();
    expect(result.plan.green).toEqual([green.id]);
    expect(result.plan.issues.map((entry) => entry.key)).toEqual([candidate.id]);
  });

  it('removes a superseded red assessment only after that version turns green', () => {
    const assessments = { schemaVersion: 1, streams: { example: [{
      state: 'red',
      version: candidate.version,
      certificationRevision: 1,
      candidateDigest: `sha256:${'d'.repeat(64)}`,
      source: candidate.source,
    }] } };
    const result = reconcile(
      { candidates: [candidate] },
      { schemaVersion: 1, streams: {} },
      [{ candidateId: candidate.id, candidateDigest: candidate.candidateDigest, state: 'green', detail: 'ok' }],
      { assessments },
    );
    expect(result.ledger.streams.example).toHaveLength(1);
    expect(result.assessments.streams).toEqual({});
  });

  it('round-trips a red assessment through discovery and admits it again after a certifier revision bump', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tw-assessment-roundtrip-'));
    const stream = {
      id: 'example',
      frameworkId: 'example',
      ecosystem: 'rust',
      registry: 'crates.io',
      package: 'example',
      certificationRevision: 1,
      minimumVersion: '2.0.0',
      major: 2,
      patchRoot: 'patches/example',
    };
    const config = { maxCandidatesPerRun: 1, streams: [stream] };
    const catalogs = { example: [{ version: '2.1.1', publishedAt: '2026-01-03T00:00:00Z', source: { checksum: 'a'.repeat(64) } }] };
    const discovered = await selectCandidates({ rootDir: directory, config, ledger: { streams: {} }, catalogs });
    const exact = discovered.candidates[0];
    const red = reconcile(
      discovered,
      { schemaVersion: 1, streams: {} },
      [{ candidateId: exact.id, candidateDigest: exact.candidateDigest, state: 'red', detail: 'failed' }],
      { runUrl: 'https://github.com/owner/repo/actions/runs/5', owner: 'owner' },
    );
    const skipped = await selectCandidates({ rootDir: directory, config, ledger: red.ledger, assessments: red.assessments, catalogs });
    expect(skipped.candidates).toEqual([]);

    const revised = await selectCandidates({
      rootDir: directory,
      config: { ...config, streams: [{ ...stream, certificationRevision: 2 }] },
      ledger: red.ledger,
      assessments: red.assessments,
      catalogs,
    });
    expect(revised.candidates).toHaveLength(1);
    const revisedCandidate = revised.candidates[0];
    const green = reconcile(
      revised,
      red.ledger,
      [{ candidateId: revisedCandidate.id, candidateDigest: revisedCandidate.candidateDigest, state: 'green', detail: 'ok' }],
      { assessments: red.assessments },
    );
    expect(green.ledger.streams.example).toHaveLength(1);
    expect(green.assessments.streams).toEqual({});
  });

  it('does not prescribe a source patch for a runtime or hook candidate', () => {
    const hook = { ...candidate, mode: 'hook', hookStrategy: 'runtime', patch: { status: 'not-applicable', path: null, manifestDigest: null } };
    const result = reconcile({ candidates: [hook] }, { schemaVersion: 1, streams: {} }, [{ candidateId: hook.id, candidateDigest: hook.candidateDigest, state: 'red', detail: 'missing capability' }], { runUrl: 'https://github.com/owner/repo/actions/runs/1', owner: 'owner' });
    expect(result.plan.issues[0].body).toContain('Review the failed capability and behavioral evidence');
    expect(result.plan.issues[0].body).toContain('Integration mode: `hook`');
    expect(result.plan.issues[0].body).toContain('Hook strategy: `runtime`');
    expect(result.plan.issues[0].body).toContain('do not allowlist the version');
    expect(result.plan.issues[0].body).not.toContain('Patch status:');
    expect(result.plan.issues[0].body).not.toContain('Prepare an exact checksummed patch');
  });

  it('reports the trusted-toolchain remediation for a blocked Go candidate', () => {
    const blocked = { ...candidate, source: { ...candidate.source, requiredGoVersion: '1.26.0', toolchainSupported: false } };
    const result = reconcile({ candidates: [blocked] }, { schemaVersion: 1, streams: {} }, [{ candidateId: blocked.id, candidateDigest: blocked.candidateDigest, state: 'red', detail: 'unsupported Go floor' }], { runUrl: 'https://github.com/owner/repo/actions/runs/2', owner: 'owner' });
    expect(result.plan.issues[0].body).toContain('explicitly repin the trusted Go toolchain to >= 1.26.0');
    expect(result.plan.issues[0].body).not.toContain('Prepare an exact checksummed patch');
  });

  it('fails closed instead of opening an unowned issue without a source run URL', () => {
    expect(() => reconcile({ candidates: [candidate] }, { schemaVersion: 1, streams: {} }, [{ candidateId: candidate.id, candidateDigest: candidate.candidateDigest, state: 'red', detail: 'failed' }])).toThrow(/source run URL/u);
  });

  it('replaces a same-version ledger record when the closure-bound candidate changed', () => {
    const old = { ...candidate, candidateDigest: `sha256:${'d'.repeat(64)}` };
    const result = reconcile({ candidates: [candidate] }, { schemaVersion: 1, streams: { example: [{ version: candidate.version, candidateDigest: old.candidateDigest, source: { closureDigest: `sha256:${'e'.repeat(64)}` } }] } }, [{ candidateId: candidate.id, candidateDigest: candidate.candidateDigest, state: 'green', detail: 'ok' }]);
    expect(result.ledger.streams.example).toHaveLength(1);
    expect(result.ledger.streams.example[0].candidateDigest).toBe(candidate.candidateDigest);
  });

  it('rejects a verdict for different candidate bytes', () => {
    expect(() => reconcile({ candidates: [candidate] }, { schemaVersion: 1, streams: {} }, [{ candidateId: candidate.id, candidateDigest: `sha256:${'d'.repeat(64)}`, state: 'green' }])).toThrow(/stale verdict/u);
  });

  it('requires a complete revision-bound typed artifact set in trusted reconciliation', () => {
    const context = {
      runUrl: 'https://github.com/owner/repo/actions/runs/3',
      owner: 'owner',
      sourceRevision: 'a'.repeat(40),
      strictArtifacts: true,
    };
    expect(() => reconcile({ candidates: [candidate] }, { schemaVersion: 1, streams: {} }, [], context))
      .toThrow(/artifact set is incomplete/u);
    expect(() => reconcile({ candidates: [candidate] }, { schemaVersion: 1, streams: {} }, [{
      schemaVersion: 1,
      kind: 'termwright-framework-candidate-verdict',
      candidateId: candidate.id,
      candidateDigest: candidate.candidateDigest,
      sourceRevision: 'b'.repeat(40),
      state: 'red',
      detail: 'failed',
    }], context)).toThrow(/invalid or stale typed verdict/u);
    expect(() => reconcile({ candidates: [candidate] }, { schemaVersion: 1, streams: {} }, [{
      schemaVersion: 1,
      kind: 'termwright-framework-candidate-verdict',
      candidateId: candidate.id,
      candidateDigest: candidate.candidateDigest,
      sourceRevision: 'a'.repeat(40),
      state: 'red',
      detail: 'failed',
    }], context)).not.toThrow();
  });

  it('rejects a generated bundle from a stale revision', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tw-reconcile-'));
    await mkdir(join(directory, 'patch'));
    await writeFile(join(directory, 'patch/manifest.json'), '{}');
    await writeFile(join(directory, 'bundle.json'), JSON.stringify({ candidateId: candidate.id, candidateDigest: candidate.candidateDigest, sourceRevision: 'oldsha1', targetPath: 'patches/2.1.1', patchTreeDigest: await digestTree(join(directory, 'patch')) }));
    await expect(verifyGeneratedUpdate({ candidate, verdict: { state: 'green', sourceRevision: 'oldsha1' }, updateDirectory: directory, expectedRevision: 'newsha2' })).rejects.toThrow(/stale source revision/u);
  });

  it('rejects path traversal in a generated bundle', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tw-reconcile-'));
    await mkdir(join(directory, 'patch'));
    await writeFile(join(directory, 'patch/manifest.json'), '{}');
    await writeFile(join(directory, 'bundle.json'), JSON.stringify({ candidateId: candidate.id, candidateDigest: candidate.candidateDigest, sourceRevision: 'same-sha', targetPath: '../../outside', patchTreeDigest: await digestTree(join(directory, 'patch')) }));
    await expect(verifyGeneratedUpdate({ candidate, verdict: { state: 'green', sourceRevision: 'same-sha' }, updateDirectory: directory, expectedRevision: 'same-sha' })).rejects.toThrow(/unsafe/u);
  });

  it('accepts only a digest- and revision-bound generated hook profile', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tw-hook-reconcile-'));
    const hookCandidate = { ...candidate, id: 'ink@7.2.0', frameworkId: 'ink', version: '7.2.0' };
    const profile = { version: '7.2.0', rendererSha256: 'd'.repeat(64), coreSha256: 'e'.repeat(64) };
    await writeFile(join(directory, 'bundle.json'), JSON.stringify({
      schemaVersion: 1,
      kind: 'termwright-generated-hook-profile',
      candidateId: hookCandidate.id,
      candidateDigest: hookCandidate.candidateDigest,
      sourceRevision: 'same-sha',
      framework: 'ink',
      profile,
      profileDigest: `sha256:${createHash('sha256').update(canonicalJson(profile)).digest('hex')}`,
    }));
    await expect(verifyGeneratedHookProfile({ candidate: hookCandidate, verdict: { state: 'green', sourceRevision: 'same-sha' }, updateDirectory: directory, expectedRevision: 'same-sha' })).resolves.toEqual(profile);
    const tampered = JSON.parse(await readFile(join(directory, 'bundle.json'), 'utf8'));
    tampered.profile.coreSha256 = 'f'.repeat(64);
    await writeFile(join(directory, 'bundle.json'), JSON.stringify(tampered));
    await expect(verifyGeneratedHookProfile({ candidate: hookCandidate, verdict: { state: 'green', sourceRevision: 'same-sha' }, updateDirectory: directory, expectedRevision: 'same-sha' })).rejects.toThrow(/digest mismatch/u);
  });

  it('accepts a runtime profile only for the exact green candidate and no source identity fields', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tw-runtime-reconcile-'));
    const runtimeCandidate = { ...candidate, id: 'opentui@0.5.4', frameworkId: 'opentui', version: '0.5.4', hookStrategy: 'runtime' };
    const profile = { version: '0.5.4' };
    await writeFile(join(directory, 'bundle.json'), JSON.stringify({
      schemaVersion: 1,
      kind: 'termwright-generated-runtime-profile',
      candidateId: runtimeCandidate.id,
      candidateDigest: runtimeCandidate.candidateDigest,
      sourceRevision: 'same-sha',
      framework: 'opentui',
      profile,
      profileDigest: `sha256:${createHash('sha256').update(canonicalJson(profile)).digest('hex')}`,
    }));
    await expect(verifyGeneratedRuntimeProfile({ candidate: runtimeCandidate, verdict: { state: 'green', sourceRevision: 'same-sha' }, updateDirectory: directory, expectedRevision: 'same-sha' })).resolves.toEqual(profile);
    const tampered = JSON.parse(await readFile(join(directory, 'bundle.json'), 'utf8'));
    tampered.profile.chunkSha256 = 'f'.repeat(64);
    await writeFile(join(directory, 'bundle.json'), JSON.stringify(tampered));
    await expect(verifyGeneratedRuntimeProfile({ candidate: runtimeCandidate, verdict: { state: 'green', sourceRevision: 'same-sha' }, updateDirectory: directory, expectedRevision: 'same-sha' })).rejects.toThrow(/not bound/u);
  });

  it('adds only a version-only OpenTUI runtime profile and keeps it immutable', () => {
    const runtimeCandidate = { id: 'opentui@0.5.4', frameworkId: 'opentui', version: '0.5.4', hookStrategy: 'runtime' };
    const document = { schemaVersion: 1, framework: 'opentui', profiles: [{ version: '0.5.3' }] };
    expect(addCertifiedRuntimeProfile(document, runtimeCandidate, { version: '0.5.4' }).profiles).toEqual([{ version: '0.5.3' }, { version: '0.5.4' }]);
    expect(() => addCertifiedRuntimeProfile(document, runtimeCandidate, { version: '0.5.4', chunkSha256: 'legacy' })).toThrow(/immutable/u);
    expect(() => addCertifiedRuntimeProfile(document, { ...runtimeCandidate, frameworkId: 'ink' }, { version: '0.5.4' })).toThrow(/another framework/u);
  });
});
