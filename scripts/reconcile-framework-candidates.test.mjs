import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { digestTree } from './prepare-framework-candidate.mjs';
import { canonicalJson } from './discover-framework-candidates.mjs';
import { reconcile, recordVerifiedFrameworkVersion, renderCertifiedTextualVersions, renderExactPeerRange, sameHookProfile, verifyGeneratedHookProfile, verifyGeneratedUpdate } from './reconcile-framework-candidates.mjs';

const candidate = { id: 'example@2.1.1', streamId: 'example', package: 'example', version: '2.1.1', publishedAt: '2026-01-03T00:00:00Z', source: { checksum: 'a'.repeat(64) }, patch: { status: 'ready', path: 'patches/2.1.1/manifest.json', manifestDigest: `sha256:${'b'.repeat(64)}` }, candidateDigest: `sha256:${'c'.repeat(64)}` };

describe('framework candidate reconciliation', () => {
  it('treats hook build order as non-semantic while preserving immutable bytes', () => {
    const node = { id: 'node-a', file: 'chunk-node-a.js', sha256: 'a'.repeat(64) };
    const bun = { id: 'bun-b', file: 'chunk-bun-b.js', sha256: 'b'.repeat(64) };
    expect(sameHookProfile({ version: '0.5.3', builds: [node, bun] }, { version: '0.5.3', builds: [bun, node] })).toBe(true);
    expect(sameHookProfile({ version: '0.5.3', builds: [node, bun] }, { version: '0.5.3', builds: [bun, { ...node, sha256: 'c'.repeat(64) }] })).toBe(false);
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

  it('promotes only the exact behaviorally green Textual candidate into registry and bundled allowlist', () => {
    const compatibility = { frameworks: [{
      id: 'textual',
      versions: { policy: 'exact', declared: '8.2.8', verified: ['8.2.8'] },
    }] };
    recordVerifiedFrameworkVersion(compatibility, {
      id: 'textual@8.2.9',
      frameworkId: 'textual',
      version: '8.2.9',
    });
    expect(compatibility.frameworks[0].versions).toEqual({
      policy: 'exact',
      declared: '8.2.8 or 8.2.9',
      verified: ['8.2.8', '8.2.9'],
    });
    expect(renderCertifiedTextualVersions(compatibility)).toContain('("8.2.8", "8.2.9",)');
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
    expect(result.plan.issues[0].key).toBe(candidate.id);
    expect(result.plan.issues[0]).toMatchObject({ owner: 'owner' });
    expect(result.plan.issues[0].body).toContain('https://github.com/owner/repo/actions/runs/1');
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
});
