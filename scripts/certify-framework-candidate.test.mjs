import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { assertCandidateSemanticSession, candidateToolchainBlock, canonicalOpenTuiBuilds, verifyCandidateEvidence } from './certify-framework-candidate.mjs';

const exec = promisify(execFile);

describe('framework candidate evidence binding', () => {
  it('canonicalizes OpenTUI build pairs independently of filesystem order', () => {
    expect(canonicalOpenTuiBuilds([
      { id: 'bun-b', file: 'chunk-bun-b.js' },
      { id: 'node-a', file: 'chunk-node-a.js' },
    ]).map((entry) => entry.id)).toEqual(['node-a', 'bun-b']);
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
