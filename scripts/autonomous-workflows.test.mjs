import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const readWorkflow = (name) => readFile(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');

function artifactStep(workflow, artifactName) {
  const marker = `          name: ${artifactName}\n`;
  const markerIndex = workflow.indexOf(marker);
  expect(markerIndex, `artifact ${artifactName} must exist`).toBeGreaterThan(-1);
  const start = workflow.lastIndexOf('\n      - ', markerIndex);
  const end = workflow.indexOf('\n\n', markerIndex);
  return workflow.slice(start, end === -1 ? workflow.length : end);
}

describe('autonomous workflow security', () => {
  it('keeps write privileges out of upstream certification', async () => {
    const workflow = await readWorkflow('upstream-candidates.yml');
    const certifier = await readFile(new URL('./certify-framework-candidate.mjs', import.meta.url), 'utf8');
    expect(workflow).not.toMatch(/contents:\s*write|pull-requests:\s*write|issues:\s*write/u);
    expect(workflow).not.toContain('git push');
    expect(workflow.match(/persist-credentials: false/gu)).toHaveLength(2);
    expect(workflow).toContain('--candidate "$CANDIDATE_ID"');
    expect(workflow).toContain('continue-on-error: true');
    expect(workflow).not.toContain("--candidate '${{ matrix.id }}'");
    expect(certifier).toContain("'--ignore-scripts'");
  });

  it('coordinates only completed workflow_run events and never checks out the PR head in a write-token job', async () => {
    const workflow = await readWorkflow('autonomous-coordinator.yml');
    const coordinator = await readFile(new URL('./autonomous-release-coordinator.mjs', import.meta.url), 'utf8');
    expect(workflow).toContain('workflow_run:');
    expect(workflow).toContain("types: [completed]");
    expect(workflow).toContain('autonomous-coordinator-${{ github.event.repository.full_name }}');
    expect(workflow).not.toMatch(/ref:\s*\$\{\{\s*github\.event\.workflow_run\.head_sha\s*\}\}/u);
    expect(workflow).toContain('Version PR differs from the deterministic transformation');
    expect(workflow).toContain('Compatibility PR differs from exact trusted artifact reconciliation');
    expect(workflow).toContain("workflows: ['Framework compatibility candidates', 'CI', 'Release']");
    expect(workflow).not.toContain('rerun-failed-jobs');
    expect(workflow).toContain('validate-release-failure');
    expect(workflow).toContain('gh pr list --state open --head "$BRANCH"');
    expect(workflow).not.toContain('gh pr view "$BRANCH"');
    expect(workflow).toContain('vars.UPSTREAM_COMPATIBILITY_OWNER');
    expect(workflow).not.toContain('UPSTREAM_COMPATIBILITY_OWNER ||');
    expect(workflow).toContain('/assignees/$ISSUE_OWNER');
    expect(workflow).toContain('gh api --paginate "/repos/$GITHUB_REPOSITORY/issues?state=all');
    expect(workflow).not.toContain('gh issue list --state all --search');
    expect(workflow).toContain('dispatch-pending-changesets');
    expect(workflow).toContain('refresh-heartbeat');
    expect(workflow).toContain('automation/workflow-heartbeat');
    expect(workflow).toContain('Heartbeat PR differs from the deterministic source-run-bound transformation');
    expect(workflow).toContain('notify-upstream-failure:');
    expect(workflow).toContain("github.event.workflow_run.conclusion != 'success'");
    expect(workflow).toContain('[compatibility] daily certification workflow failed');
    expect(workflow).toContain('failed before trusted artifact reconciliation');
    expect(coordinator).toContain('probe-ink|probe-opentui');
    expect(coordinator).toContain('release dispatch intentionally suppressed');
    expect(workflow).toContain('"https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"');
  });

  it('makes release prepare and publish explicit, SHA-bound dispatch modes with no push trigger', async () => {
    const workflow = await readWorkflow('release.yml');
    expect(workflow).toContain('mode:');
    expect(workflow).toContain('options: [prepare, publish]');
    expect(workflow).toContain('expected_sha:');
    expect(workflow).toContain('version_pr:');
    expect(workflow).not.toMatch(/^\s{2}push:/mu);
    expect(workflow).toContain('validate-version-pr');
    expect(workflow).toContain('Independently reproduce the merged Version PR tree');
    expect(workflow).toContain('Merged Version PR differs from the trusted deterministic transformation');
    expect(workflow).toContain('verify-published-artifact.mjs npm');
    expect(workflow).toContain('verify-published-artifact.mjs pypi');
    expect(workflow).toContain('verify-published-artifact.mjs crate');
    expect(workflow).toContain('find npm pypi crates');
    expect(workflow).toContain('token: ${{ github.token }}');
    expect(workflow.match(/persist-credentials: false/gu)?.length).toBeGreaterThanOrEqual(8);
  });

  it('pins every external action in the autonomous and release workflows to a full commit SHA', async () => {
    for (const name of ['ci.yml', 'reliability.yml', 'docs.yml', 'preview-release.yml', 'upstream-candidates.yml', 'autonomous-coordinator.yml', 'release.yml']) {
      const workflow = await readWorkflow(name);
      for (const line of workflow.split('\n').filter((value) => /^\s*(?:- )?uses:/u.test(value))) {
        expect(line, `${name}: ${line}`).toMatch(/@[0-9a-f]{40}(?:\s+#.*)?$/u);
      }
    }
  });

  it('does not persist checkout credentials in any untrusted-code CI job', async () => {
    const workflow = await readWorkflow('ci.yml');
    expect(workflow).toMatch(/permissions:\n  contents: read/u);
    const checkoutSteps = workflow.match(/- uses: actions\/checkout@[^\n]+\n(?: {8}[^\n]*\n){0,8}/gu) ?? [];
    expect(checkoutSteps.length).toBeGreaterThan(0);
    for (const step of checkoutSteps) expect(step).toContain('persist-credentials: false');
  });

  it('retains hidden Termwright run evidence from failed main and nightly jobs', async () => {
    const ci = await readWorkflow('ci.yml');
    const reliability = await readWorkflow('reliability.yml');
    const artifacts = [
      artifactStep(ci, 'ui-browser-artifacts'),
      artifactStep(ci, 'example-termwright-reports'),
      artifactStep(reliability, 'nightly-termwright-runs-${{ matrix.os }}-node-${{ matrix.node }}'),
      artifactStep(reliability, 'nightly-termwright-runs-windows-latest-node-${{ matrix.node }}'),
    ];

    for (const artifact of artifacts) {
      expect(artifact).toContain('if: ${{ failure() || cancelled() }}');
      expect(artifact).toContain('uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7');
      expect(artifact).toContain('.termwright/runs');
      expect(artifact).toContain('include-hidden-files: true');
      expect(artifact).toContain('overwrite: true');
    }
  });

  it('fails website CI when generated documentation drifts from its sources', async () => {
    const workflow = await readWorkflow('ci.yml');
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    expect(workflow).toContain('run: pnpm check:generated-docs');
    expect(manifest.scripts['check:generated-docs']).toContain('generate-mcp-docs.mjs');
    expect(manifest.scripts['check:generated-docs']).toContain('generate-runtime-requirements.mjs');
  });
});
