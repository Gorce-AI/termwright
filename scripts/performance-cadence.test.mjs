import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const workflow = await readFile(new URL('../.github/workflows/performance.yml', import.meta.url), 'utf8');
const collector = await readFile(new URL('./collect-quality-performance.mjs', import.meta.url), 'utf8');
const checkpoint = await readFile(new URL('./quality-performance-checkpoint.mjs', import.meta.url), 'utf8');
const stressFixture = await readFile(
  new URL('../quality/stress/terminal-concurrency.test.ts', import.meta.url),
  'utf8',
);
const pairedComparator = await readFile(new URL('./compare-paired-performance.mjs', import.meta.url), 'utf8');
const environment = await readFile(new URL('./performance-environment.mjs', import.meta.url), 'utf8');
const observations = await readFile(new URL('./performance-observations.mjs', import.meta.url), 'utf8');
const timing = await readFile(new URL('./quality-performance-timing.mjs', import.meta.url), 'utf8');
const policy = await readFile(
  new URL('../packages/performance/baselines/darwin-arm64-node24-go1.25-bun1.2.15.policy.json', import.meta.url),
  'utf8',
);
const charmFixture = await readFile(
  new URL('../packages/probe-charm/src/testing/fixture-v2/go.mod', import.meta.url),
  'utf8',
);

describe('performance observation cadence', () => {
  it('is scheduled and manually runnable on the recorded runner class', () => {
    expect(workflow).toContain("cron: '17 4 * * 1'");
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('runs-on: macos-15');
    expect(workflow).toContain("node-version: '24'");
    expect(workflow).toContain("go-version: '1.25'");
    expect(workflow).toContain("bun-version: '1.2.15'");
    expect(workflow).toContain("TERMWRIGHT_REQUIRE_BUN: '1'");
    expect(workflow).toContain("PERFORMANCE_RUNNER_CLASS: 'darwin-arm64-node24-go1.25-bun1.2.15'");
    expect(workflow).toContain('--output "$output/environment.json"');
    expect(workflow).toContain('--environment-file "$output/environment.json"');
    const requiredGo = /^go (\d+\.\d+)/mu.exec(charmFixture)?.[1];
    expect(requiredGo).toBeDefined();
    expect(workflow).toContain(`go-version: '${requiredGo}'`);
  });

  it('measures exact isolated subjects twice in paired R,C,C,R order', () => {
    const reference = 'bea638edc4589b3d4b15c4f87ed397de878ae40d';
    expect(workflow).toContain(`default: ${reference}`);
    expect(workflow).toContain('path: reference');
    expect(workflow).toContain('path: candidate');
    expect(workflow).toContain("REFERENCE_SHA: ${{ inputs.reference_sha || 'bea638edc4589b3d4b15c4f87ed397de878ae40d' }}");
    expect(workflow).toContain('CANDIDATE_SHA: ${{ github.sha }}');
    expect(workflow).toContain('test "$(git -C reference rev-parse HEAD)" = "$REFERENCE_SHA"');
    expect(workflow).toContain('test "$(git -C candidate rev-parse HEAD)" = "$CANDIDATE_SHA"');
    expect(workflow).toContain('export GITHUB_SHA="$subject_sha"');
    expect(workflow).toContain('seal-performance-round.mjs');
    expect(workflow).toContain('--subject "$subject" --round "$round"');
    expect(workflow).toContain('Precondition both subjects without retaining calibration as evidence');
    expect(workflow.match(/precondition reference "\$REFERENCE_SHA"/gu)).toHaveLength(2);
    expect(workflow.match(/precondition candidate "\$CANDIDATE_SHA"/gu)).toHaveLength(2);
    const rounds = [
      'measure reference 1 "$REFERENCE_SHA" 1',
      'measure candidate 1 "$CANDIDATE_SHA" 2',
      'measure candidate 2 "$CANDIDATE_SHA" 3',
      'measure reference 2 "$REFERENCE_SHA" 4',
    ];
    for (let index = 1; index < rounds.length; index += 1) {
      expect(workflow.indexOf(rounds[index - 1])).toBeLessThan(workflow.indexOf(rounds[index]));
    }
    expect(workflow.match(/pnpm install --frozen-lockfile/gu)).toHaveLength(2);
    expect(workflow).toContain('timeout-minutes: 45');
    expect(workflow).toContain('--root reference \\');
    expect(workflow).toContain('--root candidate \\');
    expect(workflow).toContain('cmp performance-results/reference-harness.json performance-results/candidate-harness.json');
    expect(workflow).toContain('compare-paired-performance.mjs');
    expect(workflow.match(/--reference performance-results\/reference\//gu)).toHaveLength(2);
    expect(workflow.match(/--candidate performance-results\/candidate\//gu)).toHaveLength(2);
    expect(workflow).toContain('--reference-harness performance-results/reference-harness.json');
    expect(workflow).toContain('--candidate-harness performance-results/candidate-harness.json');
    expect(workflow).not.toContain('capture-performance-baseline.mjs');
    expect(workflow).not.toContain('compare-performance-baseline.mjs');
    expect(workflow).not.toContain('PERFORMANCE_BASELINE:');
    expect(JSON.parse(policy)).not.toHaveProperty('metrics.firstRunPreAttemptMs.value');
  });

  it('runs every existing benchmark plus the soak and stress observations', () => {
    expect(workflow).toContain('@termwright/performance benchmark \\');
    expect(workflow).toContain('--iterations 1000 --warmup 100 --nodes 96');
    expect(workflow).toContain('@termwright/performance benchmark:charm \\');
    expect(workflow).toContain('--iterations 8 --output "$output/charm-immediate.json"');
    expect(workflow).toContain('@termwright/performance benchmark:opentui \\');
    expect(workflow).toContain('--repetitions 3 --window-ms 1000');
    expect(workflow).toContain('--output "$output/semantic-pipeline.json"');
    expect(workflow).toContain('--output "$output/charm-immediate.json"');
    expect(workflow).toContain('--output "$output/opentui-marker-route.json"');
    expect(workflow).toContain('collect-quality-performance.mjs');
    expect(collector).toContain('quality/soak/vitest.config.ts');
    expect(collector).toContain('quality/stress/vitest.config.ts');
    expect(collector).toContain('await observeTiming(soakArgs, args.cycles)');
    expect(collector).toContain('const resourceSoak = await observeResources(soakArgs, undefined, args.cycles)');
    expect(collector).toContain('stress = await observeResources([');
    expect(collector).toContain('createQualityCheckpoint(16)');
    expect(collector).toContain('waitForQualityReady(checkpoint');
    expect(collector).toContain("publishQualityTerminal(checkpoint, { status: 'failure'");
    expect(collector).toContain("execute('/usr/bin/footprint'");
    expect(collector).toContain('peakMemoryFootprintBytes');
    expect(collector).toContain('Math.max(resourceSoak.peakMemoryFootprintBytes, stress.peakMemoryFootprintBytes)');
    expect(collector).toContain('summarizeQualityTiming(timingManifests)');
    expect(collector).toContain('hostReportRunIds(stdout, expectedRuns)');
    expect(collector).toContain('await readRunManifest(runsDir, runId)');
    expect(collector).toContain("record.state !== 'complete'");
    expect(collector).toContain('const manifestSha256 = sha256(raw)');
    expect(collector).toContain('RUN_HISTORY_COMMIT_VERSION} sha256:${manifestSha256}');
    expect(collector).toContain("collectorSha256: sha256(collector)");
    expect(collector).toContain('githubCiProvenance(process.env, gitCommit)');
    expect(observations).toContain('await validateQualityProvenance(quality.provenance, expectedSubjectSha)');
    expect(observations).toContain('quality provenance collector SHA-256 differs');
    expect(observations).toContain('quality provenance roles must use distinct host invocations');
    expect(collector).toContain('runDirectoryName(runId)');
    expect(collector).not.toContain('filter((name) => !before.has(name))');
    expect(timing).toContain('attempts[0].startedAfterRunMs');
    expect(timing).toContain('attempt.finishedAfterRunMs - attempt.startedAfterRunMs');
    expect(collector).not.toContain('manifest.finishedAt - manifest.startedAt');
    expect(collector).not.toContain('event.wallTime');
    expect(collector).not.toContain('peakRssBytes');
    expect(collector).not.toContain('pids.reduce((sum, pid) => sum + (table.get(pid)?.rssBytes');
    expect(collector).toContain('discoverProcesses');
    expect(collector.indexOf('const discoveryInterval')).toBeLessThan(collector.indexOf('const memoryInterval'));
    expect(checkpoint).toContain('The second read closes the read-before-watch lost-wakeup window.');
    expect(checkpoint).toContain('await rename(temporary, staged)');
    expect(checkpoint).toContain('await link(staged, path)');
    expect(stressFixture).toContain('await Promise.all(sessions.map');
    expect(stressFixture).toContain('await publishQualityReady(checkpoint, processPids)');
    expect(stressFixture).toContain('await waitForQualityTerminal(checkpoint,');
    expect(stressFixture.indexOf('await waitForQualityTerminal(checkpoint,'))
      .toBeLessThan(stressFixture.indexOf('// The fixture owns all sessions.'));
  });

  it('keeps retries and reruns disabled while every regression fails the gate', () => {
    expect(workflow).toContain("TERMWRIGHT_RETRIES: '0'");
    expect(workflow).toContain("TERMWRIGHT_REQUIRE_FIRST_WORKFLOW_ATTEMPT: '1'");
    expect(workflow).toContain('test "$GITHUB_RUN_ATTEMPT" = 1');
    expect(workflow).toContain('compare-paired-performance.mjs');
    expect(workflow).not.toMatch(/\bretry\s*:/u);
    expect(workflow).not.toContain('continue-on-error');
  });

  it('retains raw observations even when an earlier measurement fails', () => {
    expect(workflow).toContain('if: always()');
    expect(workflow).toContain('retention-days: 90');
    expect(workflow).toContain('.termwright/runs');
  });

  it('fails closed when the declared runtime class or descriptor measurement is unavailable', () => {
    expect(collector).toContain('validatePerformanceEnvironment(environmentDescriptor');
    expect(environment).toContain('performance runner class ${runnerClass} requires');
    expect(environment).toContain("execute('go', ['version'])");
    expect(environment).toContain("execute('bun', ['--version'])");
    expect(collector).toContain('cannot observe descriptors for the live process tree');
    expect(collector).toContain("'process resource sampling failed'");
    expect(collector).toContain('AbortSignal.timeout(RESOURCE_SAMPLE_DEADLINE_MS)');
    expect(collector).toContain('AbortSignal.timeout(CHECKPOINT_SNAPSHOT_DEADLINE_MS)');
    expect(collector).not.toMatch(/catch \{ return 0; \}/u);
  });

  it('fails the paired workflow when any reviewed threshold is violated', () => {
    expect(pairedComparator).toContain("comparison.status === 'failure'");
    expect(pairedComparator).toContain('formatGitHubError');
    expect(pairedComparator).toContain('if (failureCount > 0) process.exitCode = 1');
    expect(pairedComparator).not.toContain('formatGitHubWarning');
    expect(pairedComparator).toContain("gate: 'performance-regression-fail'");
    expect(pairedComparator).toContain('options.reference.length !== 2');
    expect(pairedComparator).toContain('options.candidate.length !== 2');
  });
});
