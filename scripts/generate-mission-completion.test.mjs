import { describe, expect, it } from 'vitest';
import { buildMissionCompletionReport } from './generate-mission-completion.mjs';

describe('mission completion report', () => {
  it('separates missing external evidence from remaining implementation work', () => {
    const report = buildMissionCompletionReport();

    expect(report.summary).toEqual({
      alreadyFixed: 124,
      partiallyFixed: 3,
      obsoleteBecauseArchitectureChanged: 1,
      stillOpen: 3,
      remainingExternalEvidence: 0,
      remainingImplementation: 3,
      incorrectAfterDeeperEvidence: 0,
    });
    expect(report.sections.filter((section) => section.status === 'partially-fixed').map((section) => ({
      section: section.section,
      kind: section.remainingKind,
    }))).toEqual([
      { section: 81, kind: 'implementation' },
      { section: 112, kind: 'implementation' },
      { section: 113, kind: 'implementation' },
    ]);
    expect(report.releaseReadiness).toMatchObject({
      status: 'blocked',
      technicalMissionPartialSections: [81, 112, 113],
    });
    expect(report.releaseReadiness.missingNpmRegistryBootstraps).toHaveLength(7);
  });

  it('binds completed claims to reviewed first-attempt Windows evidence', () => {
    const report = buildMissionCompletionReport();

    expect(report.baselineHead).toBe('7cac4160c94868448c74e9b09ed7c082a2f3ef26');
    expect(report.baselineCiEvidence).toMatchObject({
      runId: '32918115508',
      headSha: '60f4db96df7611121e4ebec47dbdba99cbb40a21',
      mergedAs: report.baselineHead,
    });
    expect(report.vitestReliabilityEvidence.jobs).toEqual([
      expect.objectContaining({ name: 'Windows Node 22 / Vitest pool matrix', conclusion: 'success' }),
      expect.objectContaining({ name: 'Windows Node 24 / Vitest pool matrix', conclusion: 'success' }),
    ]);
    expect(report.postMergeRegressionEvidence).toMatchObject({
      runId: '32919169129',
      headSha: report.baselineHead,
      status: expect.stringContaining('awaiting first-attempt CI'),
    });
    expect([53, 70, 81, 110, 114].map((section) => report.sections[section - 1]?.status)).toEqual([
      'already-fixed',
      'already-fixed',
      'partially-fixed',
      'already-fixed',
      'already-fixed',
    ]);
  });
});
