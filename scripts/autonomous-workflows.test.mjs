import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { certifiedProjectShards, projectSelectorArguments } from './ci-project-shards.mjs';

const readWorkflow = (name) =>
  readFile(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');

function jobBlock(workflow, jobName) {
  const marker = `  ${jobName}:\n`;
  const start = workflow.indexOf(marker);
  expect(start, `job ${jobName} must exist`).toBeGreaterThan(-1);
  const nextJob = workflow.slice(start + marker.length).search(/^  [a-z0-9-]+:\n/mu);
  return nextJob === -1
    ? workflow.slice(start)
    : workflow.slice(start, start + marker.length + nextJob);
}

describe('autonomous workflow security', () => {
  it('keeps write privileges out of upstream certification', async () => {
    const workflow = await readWorkflow('upstream-candidates.yml');
    const certifier = await readFile(
      new URL('./certify-framework-candidate.mjs', import.meta.url),
      'utf8',
    );
    expect(workflow).not.toMatch(/contents:\s*write|pull-requests:\s*write|issues:\s*write/u);
    expect(workflow).not.toContain('git push');
    expect(workflow.match(/persist-credentials: false/gu)).toHaveLength(4);
    expect(workflow).toContain('--candidate "$CANDIDATE_ID"');
    expect(workflow.match(/--platform "\$CANDIDATE_PLATFORM"/gu)).toHaveLength(2);
    expect(workflow).not.toContain('continue-on-error');
    const certificationStep = workflow.slice(
      workflow.indexOf('      - name: Certify artifact identity and behavioral conformance'),
      workflow.indexOf('      - name: Candidate summary'),
    );
    expect(certificationStep).not.toContain('if:');
    expect(workflow).toContain('      - name: Candidate summary\n        if: always()');
    expect(workflow).toMatch(
      /uses: actions\/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f # v6\n        if: always\(\)/u,
    );
    expect(workflow).not.toContain("--candidate '${{ matrix.id }}'");
    expect(workflow).toContain('runner: "macos-latest"');
    expect(workflow).toContain('runner: "windows-latest"');
    expect(workflow).toContain('runs-on: ${{ matrix.runner }}');
    expect(workflow).toContain(
      'name: framework-candidate-result-${{ matrix.slot }}-${{ matrix.platform }}',
    );
    expect(workflow).toContain(
      '"candidate-verdict/verdict-$CANDIDATE_SLOT-$CANDIDATE_PLATFORM.json"',
    );
    expect(workflow.match(/verdict-\$CANDIDATE_SLOT-\$CANDIDATE_PLATFORM\.json/gu)).toHaveLength(3);
    expect(workflow).toContain('name: framework-candidate-result-registry');
    expect(workflow).not.toContain('merge-multiple: true');
    expect(workflow).toContain('name: framework-verdict-aggregate');
    expect(workflow).toContain('aggregate-framework-candidate-verdicts.mjs');
    expect(workflow).toContain('--assessments compatibility/candidate-assessments.json');
    expect(workflow).toContain('discovery_args+=(--stream "$STREAM")');
    expect(certifier).toContain("'--ignore-scripts'");
    const pty = jobBlock(workflow, 'pty-native-build-x64');
    expect(pty).toContain('runs-on: windows-2022');
    expect(pty).toContain('shell: bash');
    expect(pty.match(/name: upstream-candidate-pty-addon-x64/gu)).toHaveLength(1);
    expect(pty).toContain('pnpm exec node-gyp rebuild --arch=x64');
    const certification = jobBlock(workflow, 'certify');
    expect(certification).toContain("if: matrix.platform == 'windows'");
    expect(certification).toContain('name: upstream-candidate-pty-addon-x64');
    expect(certification).toContain('path: packages/pty-win32-x64');
    expect(certification).toContain('node scripts/check-prebuild.mjs win32 x64');
    expect(certification).not.toMatch(/fallback|node-pty/u);
    const aggregate = jobBlock(workflow, 'aggregate');
    expect(jobBlock(workflow, 'certify')).not.toContain('astral-sh/setup-uv@');
    expect(aggregate).toContain(
      'astral-sh/setup-uv@20cfd1bf945f4377ade1205e4dbc17946fc9a30d # v10.0.1',
    );
    expect(aggregate).toContain("version: '0.12.6'");
    expect(aggregate).toContain('enable-cache: false');
    expect(aggregate).toContain("python-version: '3.12'");
  });

  it('coordinates only completed workflow_run events and never checks out the PR head in a write-token job', async () => {
    const workflow = await readWorkflow('autonomous-coordinator.yml');
    const coordinator = await readFile(
      new URL('./autonomous-release-coordinator.mjs', import.meta.url),
      'utf8',
    );
    expect(workflow.match(/--name framework-candidate-result-registry/gu)).toHaveLength(2);
    expect(workflow).not.toContain('--name framework-candidate-registry');
    const reconciler = await readFile(
      new URL('./reconcile-framework-candidates.mjs', import.meta.url),
      'utf8',
    );
    expect(workflow).toContain('workflow_run:');
    expect(workflow).toContain(
      'TERMWRIGHT_AUTONOMOUS_RELEASE_ENABLED: ${{ vars.TERMWRIGHT_AUTONOMOUS_RELEASE_ENABLED }}',
    );
    expect(workflow).toContain('types: [completed]');
    expect(workflow).toContain('autonomous-coordinator-${{ github.event.repository.full_name }}');
    expect(workflow).not.toMatch(/ref:\s*\$\{\{\s*github\.event\.workflow_run\.head_sha\s*\}\}/u);
    expect(workflow).toContain('Version PR differs from the deterministic transformation');
    expect(workflow).toContain(
      'Compatibility PR differs from exact trusted artifact reconciliation',
    );
    expect(workflow).toContain(
      "workflows: ['Framework compatibility candidates', 'CI', 'Release']",
    );
    expect(workflow).not.toContain('rerun-failed-jobs');
    const reconciliation = workflow.slice(
      workflow.indexOf('      - name: Commit only the compatibility allowlist'),
      workflow.indexOf('\n  inspect:'),
    );
    const manualGuard = reconciliation.indexOf(
      "if [ '${{ github.event.workflow_run.event }}' != schedule ]; then",
    );
    expect(manualGuard).toBeGreaterThan(-1);
    expect(manualGuard).toBeLessThan(reconciliation.indexOf('refresh-heartbeat'));
    expect(manualGuard).toBeLessThan(reconciliation.indexOf('dispatch-pending-changesets'));
    expect(workflow).toContain(
      'Manual certification found no compatibility changes; heartbeat and release dispatch are intentionally suppressed.',
    );
    expect(workflow).not.toContain('astral-sh/setup-uv@');
    expect(workflow).not.toContain("--pattern 'framework-verdict-*'");
    expect(workflow.match(/--name framework-verdict-aggregate --dir/gu)).toHaveLength(2);
    expect(workflow.match(/test "\$\{#verdict_artifacts\[@\]\}" -eq 1/gu)).toHaveLength(2);
    expect(
      workflow.match(/test "\$\{verdict_artifacts\[0\]\}" = framework-verdict-aggregate/gu),
    ).toHaveLength(2);
    expect(workflow).toContain('validate-release-failure');
    expect(workflow).toContain('gh pr list --state open --head "$BRANCH"');
    expect(workflow).not.toContain('gh pr view "$BRANCH"');
    expect(workflow).toContain('vars.UPSTREAM_COMPATIBILITY_OWNER');
    expect(workflow).not.toContain('UPSTREAM_COMPATIBILITY_OWNER ||');
    expect(workflow).toContain('/assignees/$ISSUE_OWNER');
    expect(workflow).toContain('gh api --paginate "/repos/$GITHUB_REPOSITORY/issues?state=all');
    expect(workflow).not.toContain('gh issue list --state all --search');
    expect(workflow).toContain('.user.login == "github-actions[bot]"');
    expect(workflow).toContain('dispatch-pending-changesets');
    expect(workflow).toContain('refresh-heartbeat');
    expect(coordinator).toContain('framework-semantic-completeness');
    expect(reconciler).toContain(
      "join(root, 'compatibility/framework-semantic-completeness.json')",
    );
    expect(reconciler).toContain('renderSemanticCompletenessReport(compatibility)');
    expect(workflow).toContain('automation/workflow-heartbeat');
    expect(workflow).toContain(
      'Heartbeat PR differs from the deterministic source-run-bound transformation',
    );
    expect(workflow).toContain('notify-upstream-failure:');
    const notify = jobBlock(workflow, 'notify-upstream-failure');
    expect(notify).toContain('needs: reconcile');
    expect(notify).toContain("needs.reconcile.result != 'success'");
    expect(notify).not.toContain("github.event.workflow_run.conclusion != 'success'");
    expect(notify).toContain('.user.login == "github-actions[bot]"');
    expect(notify).toContain('gh label create upstream-compatibility --repo "$GITHUB_REPOSITORY"');
    expect(notify).toContain('gh issue reopen "$number" --repo "$GITHUB_REPOSITORY"');
    expect(notify).toContain('gh issue edit "$number" --repo "$GITHUB_REPOSITORY"');
    expect(notify).toContain('gh issue create --repo "$GITHUB_REPOSITORY"');
    expect(workflow).toContain('[compatibility] daily certification workflow failed');
    expect(workflow).toContain('could not complete trusted artifact reconciliation');
    const reconcile = jobBlock(workflow, 'reconcile');
    expect(reconcile).not.toContain("github.event.workflow_run.conclusion == 'success'");
    expect(reconcile).toContain('Typed candidate artifacts reconciled from $SOURCE_RUN_URL.');
    expect(reconcile).not.toContain(
      'Close candidate issues only after the compatibility allowlist merged',
    );
    expect(
      reconcile.match(/--assessments compatibility\/candidate-assessments\.json/gu),
    ).toHaveLength(1);
    const publish = reconcile.slice(
      reconcile.indexOf('      - name: Commit only the compatibility allowlist'),
    );
    expect(publish).toContain('Source certification run: $SOURCE_RUN_ID');
    expect(publish).not.toContain('Source certification run: $RUN_ID');
    expect(publish).toContain('node scripts/resolve-push-lease.mjs "$push_remote" "$target_ref"');
    expect(publish).toContain('git push --force-with-lease="$target_ref:$expected_remote_sha"');
    expect(publish).toContain(
      '          push_remote="https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"',
    );
    expect(publish).not.toMatch(/git push --force-with-lease\s/u);
    expect(reconcile).not.toContain('refs/remotes/origin/$BRANCH');
    expect(coordinator).toContain('probe-ink\\/src\\/certified-instrumentation');
    expect(coordinator).toContain('probe-opentui\\/src\\/certified-runtime');
    expect(coordinator).toContain('release dispatch intentionally suppressed');
    expect(coordinator).toContain("releaseDecision === 'hold'");
    expect(coordinator).toContain('exact Version PR ${pr.number} remains open');
    expect(coordinator).toContain('pending changesets remain queued');
    expect(coordinator).toContain("releaseDecision === 'prepare'");
    expect(coordinator).toContain("releaseDecision === 'prepare' || releaseDecision === 'publish'");
    expect(coordinator).not.toMatch(
      /validateBranchProtection\([\s\S]*?\);\n  assertReleaseStateQuiescent\(/u,
    );
    expect(workflow).toContain(
      '"https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"',
    );
    const merge = jobBlock(workflow, 'merge');
    expect(merge).toContain('issues: write');
    expect(merge).toContain('Close candidate issues only after the compatibility allowlist merged');
    expect(merge.indexOf('coordinate-ci "$GITHUB_EVENT_PATH"')).toBeLessThan(
      merge.indexOf('gh issue close "$number"'),
    );
    expect(merge).toContain('closed only after the compatibility allowlist merged');
  });

  it('makes release prepare and publish explicit, SHA-bound dispatch modes with no push trigger', async () => {
    const workflow = await readWorkflow('release.yml');
    expect(workflow).toContain(
      'TERMWRIGHT_AUTONOMOUS_RELEASE_ENABLED: ${{ vars.TERMWRIGHT_AUTONOMOUS_RELEASE_ENABLED }}',
    );
    expect(workflow.match(/- name: Require autonomous release authorization/gu)).toHaveLength(2);
    expect(workflow.match(/test "\$TERMWRIGHT_AUTONOMOUS_RELEASE_ENABLED" = true/gu)).toHaveLength(
      2,
    );
    expect(workflow).toContain(
      'Set repository variable TERMWRIGHT_AUTONOMOUS_RELEASE_ENABLED to the exact value true',
    );
    for (const job of ['prepare', 'detect']) {
      const block = jobBlock(workflow, job);
      expect(block.indexOf('Require autonomous release authorization')).toBeLessThan(
        block.indexOf('uses: actions/checkout@'),
      );
    }
    expect(workflow).toContain('mode:');
    expect(workflow).toContain('options: [prepare, publish]');
    expect(workflow).toContain('expected_sha:');
    expect(workflow).toContain('version_pr:');
    expect(workflow).not.toMatch(/^\s{2}push:/mu);
    expect(workflow).toContain('validate-version-pr');
    expect(workflow).toContain('Independently reproduce the merged Version PR tree');
    expect(workflow).toContain(
      'Merged Version PR differs from the trusted deterministic transformation',
    );
    expect(workflow).toContain('verify-published-artifact.mjs npm');
    expect(workflow).toContain('verify-published-artifact.mjs pypi');
    expect(workflow).toContain('verify-published-artifact.mjs crate');
    expect(workflow).toContain('find npm pypi crates');
    expect(workflow).toContain('token: ${{ github.token }}');
    expect(workflow.match(/persist-credentials: false/gu)?.length).toBeGreaterThanOrEqual(8);
  });

  it('pins every external action in the autonomous and release workflows to a full commit SHA', async () => {
    for (const name of [
      'ci.yml',
      'reliability.yml',
      'docs.yml',
      'performance.yml',
      'preview-release.yml',
      'upstream-candidates.yml',
      'autonomous-coordinator.yml',
      'release.yml',
    ]) {
      const workflow = await readWorkflow(name);
      for (const line of workflow.split('\n').filter((value) => /^\s*(?:- )?uses:/u.test(value))) {
        if (/uses:\s+\.\//u.test(line)) continue;
        expect(line, `${name}: ${line}`).toMatch(/@[0-9a-f]{40}(?:\s+#.*)?$/u);
      }
    }
  });

  it('keeps JavaScript setup deduplicated without hiding checkout or the frozen install', async () => {
    const workflow = await readWorkflow('ci.yml');
    const setup = await readFile(
      new URL('../.github/actions/setup-js-workspace/action.yml', import.meta.url),
      'utf8',
    );
    const setupJobs = workflow
      .split(/(?=^ {2}[a-z0-9-]+:\n)/mu)
      .filter((job) => job.includes('uses: ./.github/actions/setup-js-workspace'));

    expect(setupJobs.length).toBeGreaterThan(10);
    for (const job of setupJobs) {
      expect(job.indexOf('uses: actions/checkout@')).toBeGreaterThan(-1);
      expect(job.indexOf('uses: actions/checkout@')).toBeLessThan(
        job.indexOf('uses: ./.github/actions/setup-js-workspace'),
      );
      expect(job).not.toContain('pnpm install --frozen-lockfile');
      expect(job).not.toContain('pnpm/action-setup@');
      expect(job).not.toContain('actions/setup-node@');
    }

    expect(setup).toContain('pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86 # v6');
    expect(setup).toContain('actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7');
    expect(setup).toContain('version: ${{ env.PNPM_VERSION }}');
    expect(setup).toContain('node-version: ${{ inputs.node-version }}');
    expect(setup).toContain('run: pnpm install --frozen-lockfile');
    expect(workflow).not.toContain('pnpm/action-setup@');
    expect(workflow).not.toContain('pnpm install --frozen-lockfile');
  });

  it('pins Bun in every supported-runtime build row that executes the full catalogue', async () => {
    const workflow = await readWorkflow('ci.yml');
    for (const job of ['build', 'windows-driver-native']) {
      const block = jobBlock(workflow, job);
      expect(block).toContain('oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2');
      expect(block).toContain("bun-version: '1.4.0'");
      expect(block.indexOf('oven-sh/setup-bun@')).toBeLessThan(
        block.indexOf('name: Run the certified Termwright host'),
      );
      expect(block).toContain("TERMWRIGHT_REQUIRE_BUN: '1'");
    }
  });

  it('partitions the Windows catalogue into explicit project groups', async () => {
    const workflow = await readWorkflow('ci.yml');
    const block = jobBlock(workflow, 'windows-driver-native');
    const invocations =
      block.match(
        /^          pnpm test -- --resource-profile windows-ci --json -- --project=.*$/gmu,
      ) ?? [];

    expect(invocations).toEqual(
      certifiedProjectShards.map(
        (projects) =>
          `          pnpm test -- --resource-profile windows-ci --json -- ${projectSelectorArguments(projects)}`,
      ),
    );
    expect(invocations.join('\n')).not.toContain('--project=!');
    expect(block).not.toContain('--shard');
    expect(block).not.toContain('--retry');
  });

  it('keeps the dedicated OpenTUI lane executable and fail-closed before optional skip policy applies', async () => {
    const workflow = await readWorkflow('ci.yml');
    const block = jobBlock(workflow, 'opentui');
    const bunProbe = block.indexOf('bun --version');
    const packageTest = block.indexOf('pnpm --filter @termwright/probe-opentui run test');

    expect(bunProbe).toBeGreaterThan(-1);
    expect(packageTest).toBeGreaterThan(bunProbe);
    expect(block).not.toContain('run test:conformance');
    expect(block).toContain("TERMWRIGHT_REQUIRE_BUN: '1'");
  });

  it('requires Bun in every certifying workflow job that intentionally installs it', async () => {
    const ci = await readWorkflow('ci.yml');
    const release = await readWorkflow('release.yml');
    const preview = await readWorkflow('preview-release.yml');
    const upstreamCandidates = await readWorkflow('upstream-candidates.yml');
    for (const job of ['build', 'windows-driver-native', 'opentui', 'examples']) {
      const block = jobBlock(ci, job);
      expect(block).toContain('oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2');
      expect(block).toContain("bun-version: '1.4.0'");
      expect(block).toContain("TERMWRIGHT_REQUIRE_BUN: '1'");
    }
    const verify = jobBlock(release, 'verify');
    expect(verify).toContain('oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2');
    expect(verify).toContain("bun-version: '1.4.0'");
    expect(verify).toContain("TERMWRIGHT_REQUIRE_BUN: '1'");
    for (const block of [
      jobBlock(release, 'certify-x64-on-arm64'),
      jobBlock(preview, 'certify-x64-on-arm64'),
    ]) {
      expect(block).toContain('oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2');
      expect(block).toContain("bun-version: '1.4.0'");
      expect(block).toContain('bun-windows-x64.zip');
      expect(block).toContain("TERMWRIGHT_REQUIRE_BUN: '1'");
    }
    const candidateCertification = jobBlock(upstreamCandidates, 'certify');
    expect(candidateCertification).toContain(
      'oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2',
    );
    expect(candidateCertification).toContain("bun-version: '1.4.0'");
    expect(candidateCertification).toContain("TERMWRIGHT_REQUIRE_BUN: '1'");
    expect(candidateCertification.indexOf('oven-sh/setup-bun@')).toBeLessThan(
      candidateCertification.indexOf('name: Certify artifact identity and behavioral conformance'),
    );
  });

  it('uses only reviewed Node 24 artifact actions in release automation', async () => {
    const workflows = [
      await readWorkflow('release.yml'),
      await readWorkflow('upstream-candidates.yml'),
      await readFile(
        new URL('../.github/actions/upload-termwright-runs/action.yml', import.meta.url),
        'utf8',
      ),
    ];
    const node24Pins = new Set([
      'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7',
      'actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f # v6',
      'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8',
    ]);

    for (const workflow of workflows) {
      const artifactActions =
        workflow.match(/actions\/(?:upload|download)-artifact@[^\n]+/gu) ?? [];
      expect(artifactActions.length).toBeGreaterThan(0);
      for (const action of artifactActions) expect(node24Pins.has(action), action).toBe(true);
    }
  });

  it('does not persist checkout credentials in any untrusted-code CI job', async () => {
    const workflow = await readWorkflow('ci.yml');
    expect(workflow).toMatch(/permissions:\n  contents: read/u);
    const checkoutSteps =
      workflow.match(/- uses: actions\/checkout@[^\n]+\n(?: {8}[^\n]*\n){0,8}/gu) ?? [];
    expect(checkoutSteps.length).toBeGreaterThan(0);
    for (const step of checkoutSteps) expect(step).toContain('persist-credentials: false');
  });

  it('runs npm registry readiness only for the trusted Version PR branch', async () => {
    const workflow = await readWorkflow('ci.yml');
    const marker = '      - name: Every Version PR package already exists on npm\n';
    const start = workflow.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const step = workflow.slice(start, workflow.indexOf('\n\n', start));
    expect(step).toContain("github.event_name == 'pull_request'");
    expect(step).toContain('github.event.pull_request.head.repo.full_name == github.repository');
    expect(step).toContain("github.event.pull_request.head.ref == 'release-pr/main'");
    expect(step).toContain("github.event_name == 'workflow_dispatch'");
    expect(step).toContain("github.ref == 'refs/heads/release-pr/main'");
    expect(step).not.toContain("contains(github.event.pull_request.labels.*.name, 'release')");
  });

  it('delegates publishable-package changeset policy to its tested classifier', async () => {
    const workflow = await readWorkflow('ci.yml');
    const marker = '      - name: Publishable package changes need a changeset\n';
    const start = workflow.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const step = workflow.slice(start, workflow.indexOf('\n\n', start));
    expect(step).toContain('run: node scripts/check-pr-changeset.mjs');
    expect(step).toContain('github.event.pull_request.head.repo.full_name == github.repository');
    expect(step).toContain("github.event.pull_request.head.ref == 'release-pr/main'");
    expect(step).not.toContain('github.event.pull_request.labels');
    expect(step).not.toContain('git diff --name-only');
  });

  it('retains hidden Termwright run evidence from failed main and nightly jobs', async () => {
    const ci = await readWorkflow('ci.yml');
    const reliability = await readWorkflow('reliability.yml');
    const uploader = await readFile(
      new URL('../.github/actions/upload-termwright-runs/action.yml', import.meta.url),
      'utf8',
    );
    const conformance = await readFile(
      new URL('../packages/conformance/scripts/conformance.mjs', import.meta.url),
      'utf8',
    );
    const runProducingJobs = [
      'deterministic-core-coverage',
      'build',
      'hostile',
      'pty-native',
      'windows-driver-native',
      'determinism',
      'concurrency-stress',
      'resource-leak',
      'fault-and-jitter',
      'randomized-race',
      'windows-native-stress',
      'conformance-posix',
      'ui-browser',
      'conformance-windows',
      'opentui',
      'release-hygiene',
      'examples',
    ];

    expect(uploader).toContain(
      'uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7',
    );
    expect(uploader).toContain('default: .termwright/runs');
    expect(uploader).toContain('path: ${{ inputs.runs-path }}');
    expect(uploader).toContain('if-no-files-found: warn');
    expect(uploader).not.toContain('if-no-files-found: ignore');
    expect(uploader).toContain('include-hidden-files: true');
    expect(uploader).toContain('overwrite: true');
    for (const job of runProducingJobs) {
      const block = jobBlock(ci, job);
      expect(block, job).toContain('if: ${{ failure() || cancelled() }}');
      expect(block, job).toContain('uses: ./.github/actions/upload-termwright-runs');
      expect(block, job).toContain('artifact-name: termwright-runs-${{ github.job }}-');
    }

    expect(conformance).toContain(
      "runsDir: join(REPOSITORY_ROOT, '.termwright', 'conformance-runs')",
    );
    for (const job of ['conformance-posix', 'conformance-windows']) {
      expect(jobBlock(ci, job), job).toContain('runs-path: .termwright/conformance-runs');
    }

    for (const job of ['nightly-soak-posix', 'nightly-soak-windows']) {
      const block = jobBlock(reliability, job);
      expect(block, job).toContain('if: ${{ failure() || cancelled() }}');
      expect(block, job).toContain('uses: ./.github/actions/upload-termwright-runs');
      expect(block, job).toContain('artifact-name: nightly-termwright-runs-');
    }
  });

  it('does not label reduced lifecycle samples as reliability certification', async () => {
    const reliability = await readWorkflow('reliability.yml');
    expect(reliability).toContain('name: Node host reliability certification');
    expect(reliability).toContain('certifying minimum 250');
    expect(reliability.match(/node scripts\/resolve-reliability-cycles\.mjs/gu)).toHaveLength(2);
  });

  it('fails website CI when generated documentation drifts from its sources', async () => {
    const workflow = await readWorkflow('ci.yml');
    const website = jobBlock(workflow, 'website');
    const certification = jobBlock(workflow, 'certification');
    const docs = await readWorkflow('docs.yml');
    const manifest = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    );
    const experimentalDocs = JSON.parse(
      await readFile(new URL('../typedoc.driver-experimental.json', import.meta.url), 'utf8'),
    );
    expect(website).toContain('run: pnpm check:generated-docs');
    expect(website).toContain('pnpm docs:api');
    expect(website).toContain('git diff --exit-code -- website/src/content/docs/api');
    expect(certification).toContain('      - website');
    expect(manifest.scripts['check:generated-docs']).toContain('generate-mcp-docs.mjs');
    expect(manifest.scripts['check:generated-docs']).toContain('generate-runtime-requirements.mjs');
    expect(manifest.scripts['check:generated-docs']).toContain(
      'generate-resource-profile-docs.mjs',
    );
    expect(docs).toContain("- 'packages/**'");
    expect(docs).toContain('pull_request:');
    expect(docs).toContain('run: pnpm check:package-metadata');
    expect(docs).toContain('run: pnpm check:generated-docs');
    expect(docs).toContain('pnpm docs:api');
    expect(docs).toContain('git diff --exit-code -- website/src/content/docs/api');
    expect(docs).toContain("if: ${{ github.event_name == 'push' }}");
    expect(experimentalDocs.name).toBe('@termwright/driver/experimental');
  });

  it('serializes only mutable Pages deploys, not pull-request documentation builds', async () => {
    const docs = await readWorkflow('docs.yml');
    const build = docs.slice(docs.indexOf('  build:'), docs.indexOf('  deploy:'));
    const deploy = docs.slice(docs.indexOf('  deploy:'));
    expect(build).not.toContain('concurrency:');
    expect(deploy).toContain('concurrency:');
    expect(deploy).toContain('group: pages');
    expect(deploy).toContain('cancel-in-progress: false');
  });
});
