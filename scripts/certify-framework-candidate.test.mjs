import { describe, expect, it } from 'vitest';
import { assertCandidateSemanticSession, candidateToolchainBlock, canonicalOpenTuiBuilds, verifyCandidateEvidence } from './certify-framework-candidate.mjs';

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
