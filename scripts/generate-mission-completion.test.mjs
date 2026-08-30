import { describe, expect, it } from 'vitest';
import { buildMissionCompletionReport } from './generate-mission-completion.mjs';

describe('mission completion report', () => {
  it('separates missing external evidence from remaining implementation work', () => {
    const report = buildMissionCompletionReport();

    expect(report.summary).toEqual({
      alreadyFixed: 127,
      partiallyFixed: 0,
      obsoleteBecauseArchitectureChanged: 1,
      stillOpen: 0,
      remainingExternalEvidence: 0,
      remainingImplementation: 0,
      incorrectAfterDeeperEvidence: 0,
    });
    expect(
      report.sections
        .filter((section) => section.status === 'partially-fixed')
        .map((section) => ({
          section: section.section,
          kind: section.remainingKind,
        })),
    ).toEqual([]);
    expect(report.releaseReadiness).toMatchObject({
      status: 'blocked',
      blockingScope: 'external-release-infrastructure-state-only',
      technicalMissionPartialSections: [],
      registryConfiguration: expect.stringContaining('remaining npm registry blockers'),
      automationConfiguration: expect.stringContaining('remaining GitHub configuration blockers'),
    });
    expect(report.releaseReadiness.missingNpmRegistryBootstraps).toHaveLength(11);
    expect(report.releaseReadiness.registryConfiguration).toContain('0.0.0-bootstrap.0');
    expect(report.releaseReadiness.registryConfiguration).toContain('bootstrap tag');
  });

  it('binds completed claims to reviewed PR and post-merge first-attempt evidence', () => {
    const report = buildMissionCompletionReport();

    expect(report.baselineHead).toBe('6f4ea467e6a8fd2b7789d9eb955557a414f0f59d');
    expect(report.baselineCiEvidence).toMatchObject({
      runId: '32918115508',
      headSha: '60f4db96df7611121e4ebec47dbdba99cbb40a21',
      mergedAs: '7cac4160c94868448c74e9b09ed7c082a2f3ef26',
    });
    expect(report.vitestReliabilityEvidence.jobs).toEqual([
      expect.objectContaining({
        name: 'Windows Node 22 / Vitest pool matrix',
        conclusion: 'success',
      }),
      expect.objectContaining({
        name: 'Windows Node 24 / Vitest pool matrix',
        conclusion: 'success',
      }),
    ]);
    expect(report.postMergeRegressionEvidence).toMatchObject({
      runId: '32919169129',
      headSha: '7cac4160c94868448c74e9b09ed7c082a2f3ef26',
      status: expect.stringContaining('resolved'),
    });
    expect(report.postMergeRegressionEvidence.status).not.toContain('awaiting');
    expect(report.finalCertificationEvidence).toMatchObject({
      treeSha: 'b2386e2a9a4e18953a9c896e99e7437a29c97581',
      pr: {
        runId: '33311771962',
        headSha: '56feb020668ea43b8dc85246a356caf4f70307b2',
        runAttempt: 1,
        jobsPassed: 41,
        jobsTotal: 41,
        conclusion: 'success',
      },
      postMerge: {
        runId: '33312798807',
        headSha: report.baselineHead,
        runAttempt: 1,
        jobsPassed: 41,
        jobsTotal: 41,
        conclusion: 'success',
      },
    });
    expect([53, 70, 81, 110, 114].map((section) => report.sections[section - 1]?.status)).toEqual([
      'already-fixed',
      'already-fixed',
      'already-fixed',
      'already-fixed',
      'already-fixed',
    ]);
  });
});
