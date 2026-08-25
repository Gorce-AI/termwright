import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const workflow = await readFile(new URL('../.github/workflows/performance.yml', import.meta.url), 'utf8');
const collector = await readFile(new URL('./collect-quality-performance.mjs', import.meta.url), 'utf8');
const comparator = await readFile(new URL('./compare-performance-baseline.mjs', import.meta.url), 'utf8');

describe('performance observation cadence', () => {
  it('is scheduled and manually runnable on the recorded runner class', () => {
    expect(workflow).toContain("cron: '17 4 * * 1'");
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('runs-on: macos-15');
    expect(workflow).toContain("node-version: '24'");
    expect(workflow).toContain("go-version: '1.24.4'");
    expect(workflow).toContain("bun-version: '1.2.15'");
  });

  it('runs every existing benchmark plus the soak and stress observations', () => {
    expect(workflow).toContain('benchmark --iterations 1000');
    expect(workflow).toContain('benchmark:charm --iterations 3');
    expect(workflow).toContain('benchmark:opentui --repetitions 3');
    expect(workflow).toContain('collect-quality-performance.mjs');
    expect(collector).toContain('quality/soak/vitest.config.ts');
    expect(collector).toContain('quality/stress/vitest.config.ts');
  });

  it('keeps retries and reruns disabled while the regression verdict annotates only', () => {
    expect(workflow).toContain("TERMWRIGHT_RETRIES: '0'");
    expect(workflow).toContain("TERMWRIGHT_REQUIRE_FIRST_WORKFLOW_ATTEMPT: '1'");
    expect(workflow).toContain('test "$GITHUB_RUN_ATTEMPT" = 1');
    expect(workflow).toContain('compare-performance-baseline.mjs');
    expect(workflow).not.toMatch(/\bretry\s*:/u);
    expect(workflow).not.toContain('continue-on-error');
  });

  it('retains raw observations even when an earlier measurement fails', () => {
    expect(workflow).toContain('if: always()');
    expect(workflow).toContain('retention-days: 90');
    expect(workflow).toContain('.termwright/runs');
  });

  it('fails closed when the declared runtime class or descriptor measurement is unavailable', () => {
    expect(collector).toContain('performance environment label does not match this runtime');
    expect(collector).toContain('cannot observe descriptors for live process');
    expect(collector).toContain("throw new Error('process resource sampling failed'");
    expect(collector).not.toMatch(/catch \{ return 0; \}/u);
  });

  it('fails the observation workflow when an exact cleanup invariant is violated', () => {
    expect(comparator).toContain("comparison.status === 'failure'");
    expect(comparator).toContain('formatGitHubError');
    expect(comparator).toContain('if (failureCount > 0) process.exitCode = 1');
  });
});
