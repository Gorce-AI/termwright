import { describe, expect, it } from 'vitest';
import { verifyCandidateEvidence } from './certify-framework-candidate.mjs';

describe('framework candidate evidence binding', () => {
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
