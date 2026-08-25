import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  CI_JOB_CONTRACT,
  CI_JOBS,
  REQUIRED_BRANCH_CHECKS,
  assertReleaseStateQuiescent,
  compatibilitySourceRunId,
  nextHeartbeatRecord,
  pendingChangesetFiles,
  releaseDispatchTitle,
  requireReproducedVersionTree,
  shouldDispatchRelease,
  validateAutomationPr,
  validateBranchProtection,
  validateChangedFiles,
  validateChangedFileObjects,
  validateIssueOwner,
  validateRequiredCiJobs,
  validateTrustedCiRun,
  validateFailedReleaseRun,
  validateTrustedUpstreamRun,
} from './autonomous-release-coordinator.mjs';

const repository = 'owner/repo';
const defaultBranch = 'main';
const base = 'a'.repeat(40);
const head = 'b'.repeat(40);

function scalar(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Read the deliberately small declarative surface which controls GitHub check
 * names. This is not a general YAML parser: job IDs, names, inline matrix axes
 * and include rows are the only fields the release coordinator trusts.
 */
function ciWorkflowSurface(source) {
  const lines = source.split(/\r?\n/u);
  const jobs = {};
  let seenJobs = false;
  let current;
  let inMatrix = false;
  let inInclude = false;
  let includeRow;

  for (const line of lines) {
    if (line === 'jobs:') {
      seenJobs = true;
      continue;
    }
    if (!seenJobs) continue;
    const job = /^  ([A-Za-z0-9_-]+):\s*$/u.exec(line);
    if (job !== null) {
      current = { workflowName: undefined, matrix: undefined };
      jobs[job[1]] = current;
      inMatrix = false;
      inInclude = false;
      includeRow = undefined;
      continue;
    }
    if (current === undefined) continue;
    const name = /^    name:\s*(.+)$/u.exec(line);
    if (name !== null) {
      current.workflowName = scalar(name[1]);
      continue;
    }
    if (/^      matrix:\s*$/u.test(line)) {
      current.matrix = {};
      inMatrix = true;
      inInclude = false;
      continue;
    }
    if (inMatrix && /^      \S/u.test(line)) {
      inMatrix = false;
      inInclude = false;
      includeRow = undefined;
    }
    if (!inMatrix) continue;
    if (/^        include:\s*$/u.test(line)) {
      current.matrix.include = [];
      inInclude = true;
      continue;
    }
    const axis = /^        ([A-Za-z0-9_-]+):\s*\[(.*)\]\s*$/u.exec(line);
    if (axis !== null) {
      current.matrix[axis[1]] = axis[2].split(',').map(scalar);
      continue;
    }
    if (inInclude) {
      const first = /^          - ([A-Za-z0-9_-]+):\s*(.+)$/u.exec(line);
      if (first !== null) {
        includeRow = { [first[1]]: scalar(first[2]) };
        current.matrix.include.push(includeRow);
        continue;
      }
      const rest = /^            ([A-Za-z0-9_-]+):\s*(.+)$/u.exec(line);
      if (rest !== null && includeRow !== undefined) includeRow[rest[1]] = scalar(rest[2]);
    }
  }
  return jobs;
}

function matrixRows(matrix) {
  if (matrix === undefined) return [{}];
  if (matrix.include !== undefined) return matrix.include;
  return Object.entries(matrix).reduce(
    (rows, [axis, values]) => rows.flatMap((row) => values.map((value) => ({ ...row, [axis]: value }))),
    [{}],
  );
}

function expandedCheckNames(job) {
  return matrixRows(job.matrix).map((row) => {
    const rendered = job.workflowName
      .replace(/\$\{\{ matrix\.python && format\(' \{0\}', matrix\.python\) \|\| '' \}\}/gu, row.python === undefined ? '' : ` ${row.python}`)
      .replace(/\$\{\{ matrix\.([A-Za-z0-9_-]+) \}\}/gu, (_expression, axis) => row[axis] ?? '');
    if (rendered.includes('${{')) throw new Error(`unsupported CI job-name expression: ${rendered}`);
    return rendered;
  });
}

describe('trusted autonomous coordinator', () => {
  it('requires an explicit stable issue owner instead of a scheduler/bot fallback', () => {
    expect(validateIssueOwner('SarukMyskam')).toBe('SarukMyskam');
    expect(() => validateIssueOwner('')).toThrow(/explicit valid GitHub user/u);
    expect(() => validateIssueOwner('github-actions[bot]')).toThrow(/explicit valid GitHub user/u);
    expect(() => validateIssueOwner('owner--name')).toThrow(/explicit valid GitHub user/u);
  });
  it('rejects a stale default-branch certification SHA', () => {
    const run = { name: 'Framework compatibility candidates', path: '.github/workflows/upstream-candidates.yml', status: 'completed', event: 'schedule', run_attempt: 1, head_repository: { full_name: repository }, repository: { full_name: repository }, head_branch: defaultBranch, head_sha: head };
    expect(() => validateTrustedUpstreamRun(run, { repository, defaultBranch, defaultHead: base })).toThrow(/stale/u);
    expect(() => validateTrustedUpstreamRun({ ...run, run_attempt: 2 }, { repository, defaultBranch, defaultHead: head })).toThrow(/clean first workflow attempt/u);
  });

  it('rejects malicious paths even when the rest of the compatibility PR is allowed', () => {
    expect(() => validateChangedFiles('compatibility', [
      'packages/probe-ink/src/certified-instrumentation.json',
      'packages/probe-ink/package.json',
      'packages/ink/package.json',
    ])).not.toThrow();
    expect(() => validateChangedFiles('compatibility', ['compatibility/registry.json', '.github/workflows/pwn.yml'])).toThrow(/forbidden path/u);
    expect(() => validateChangedFiles('compatibility', ['packages/probe-tview/upstream-patches/../../scripts/pwn.mjs'])).toThrow(/forbidden path/u);
    expect(() => validateChangedFiles('heartbeat', ['compatibility/workflow-heartbeat.json'])).not.toThrow();
    expect(() => validateChangedFiles('heartbeat', ['compatibility/registry.json'])).toThrow(/forbidden path/u);
  });

  it('refreshes a source-bound heartbeat only every 30 days and rejects time rollback', () => {
    const run = { id: 123, head_sha: head, created_at: '2026-01-31T00:00:00.000Z' };
    const first = nextHeartbeatRecord(run);
    expect(JSON.parse(first)).toEqual({ schemaVersion: 1, kind: 'termwright-schedule-heartbeat', sourceRunId: '123', sourceRevision: head, observedAt: run.created_at });
    expect(nextHeartbeatRecord({ ...run, id: 124, created_at: '2026-02-28T00:00:00.000Z' }, first)).toBeNull();
    expect(nextHeartbeatRecord({ ...run, id: 125, created_at: '2026-03-02T00:00:00.000Z' }, first)).not.toBeNull();
    expect(() => nextHeartbeatRecord({ ...run, id: 126, created_at: '2025-12-01T00:00:00.000Z' }, first)).toThrow(/future/u);
  });

  it('rejects symlinks and submodules hidden behind allowed changed paths', () => {
    const files = [{ filename: 'compatibility/registry.json', status: 'modified' }];
    expect(() => validateChangedFileObjects(files, { tree: [{ path: 'compatibility/registry.json', mode: '120000', type: 'blob', size: 12 }] })).toThrow(/regular file/u);
    expect(() => validateChangedFileObjects(files, { tree: [{ path: 'compatibility/registry.json', mode: '160000', type: 'commit', size: 12 }] })).toThrow(/regular file/u);
  });

  it('requires every exact CI job and rejects missing checks', () => {
    const jobs = CI_JOBS.slice(1).map((name) => ({ name, conclusion: 'success' }));
    expect(() => validateRequiredCiJobs(jobs)).toThrow(/missing required jobs/u);
    expect(() => validateRequiredCiJobs([...CI_JOBS.map((name) => ({ name, conclusion: 'success' })), { name: 'unreviewed new gate', conclusion: 'success' }])).toThrow(/unexpected jobs/u);
  });

  it('keeps the release authorization contract synchronized with every ci.yml job and matrix', async () => {
    const workflow = ciWorkflowSurface(await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));
    const contract = Object.fromEntries(Object.entries(CI_JOB_CONTRACT).map(([id, job]) => [id, {
      workflowName: job.workflowName,
      matrix: job.matrix,
    }]));
    expect(workflow).toEqual(contract);
    for (const job of Object.values(CI_JOB_CONTRACT)) {
      expect(job.requiredChecks).toEqual(expandedCheckNames(job));
    }
    expect(new Set(CI_JOBS).size).toBe(CI_JOBS.length);
    expect(CI_JOBS).toHaveLength(37);
  });

  it('rejects a CI workflow that became green only after a rerun', () => {
    const run = { name: 'CI', path: '.github/workflows/ci.yml', status: 'completed', event: 'workflow_dispatch', conclusion: 'success', run_attempt: 1, head_sha: head, head_repository: { full_name: repository }, repository: { full_name: repository } };
    expect(() => validateTrustedCiRun(run, { repository })).not.toThrow();
    expect(() => validateTrustedCiRun({ ...run, run_attempt: 2 }, { repository })).toThrow(/clean first-attempt/u);
  });

  it('accepts only the exact automation PR identity and file set', () => {
    const pr = {
      state: 'open', merged_at: null, title: 'chore(compatibility): record certified upstream releases', user: { login: 'github-actions[bot]' },
      changed_files: 1,
      head: { sha: head, ref: 'automation/framework-compatibility', repo: { full_name: repository } },
      base: { sha: base, ref: defaultBranch, repo: { full_name: repository } },
    };
    expect(() => validateAutomationPr('compatibility', pr, [{ filename: 'compatibility/certified-upstreams.json', status: 'modified' }], { repository, defaultBranch, headSha: head, defaultHead: base })).not.toThrow();
    expect(() => validateAutomationPr('compatibility', { ...pr, user: { login: 'attacker' } }, [{ filename: 'compatibility/certified-upstreams.json', status: 'modified' }], { repository, defaultBranch, headSha: head, defaultHead: base })).toThrow(/author/u);
    expect(() => validateAutomationPr('compatibility', { ...pr, changed_files: 2 }, [{ filename: 'compatibility/certified-upstreams.json', status: 'modified' }], { repository, defaultBranch, headSha: head, defaultHead: base })).toThrow(/incomplete/u);
    expect(() => validateAutomationPr('compatibility', pr, [{ filename: 'compatibility/registry.json', previous_filename: '.github/workflows/release.yml', status: 'renamed' }], { repository, defaultBranch, headSha: head, defaultHead: base })).toThrow(/renames a forbidden/u);
    const heartbeatPr = { ...pr, title: 'chore(automation): refresh schedule heartbeat', head: { ...pr.head, ref: 'automation/workflow-heartbeat' } };
    expect(() => validateAutomationPr('heartbeat', heartbeatPr, [{ filename: 'compatibility/workflow-heartbeat.json', status: 'modified' }], { repository, defaultBranch, headSha: head, defaultHead: base })).not.toThrow();
  });

  it('deduplicates an exact release dispatch', () => {
    const title = releaseDispatchTitle('publish', 'main', base, 42);
    expect(shouldDispatchRelease([{ event: 'workflow_dispatch', display_title: title }], title)).toBe(false);
    expect(shouldDispatchRelease([{ event: 'workflow_dispatch', display_title: `${title}-other` }], title)).toBe(true);
  });

  it('recognizes only ordinary safe pending changeset files', () => {
    expect(pendingChangesetFiles(['README.md', 'feature-one.md', 'fix_2.md', '.fake.md', '../escape.md', 'nested/file.md', 'not-markdown.txt']))
      .toEqual(['feature-one.md', 'fix_2.md']);
  });

  it('blocks a new merge until the latest trusted release state is successful', () => {
    const run = { id: 10, name: 'Release', path: '.github/workflows/release.yml', event: 'workflow_dispatch', status: 'completed', conclusion: 'failure', display_title: `Release publish main @ ${head} (Version PR 42)`, head_sha: head, head_branch: defaultBranch, created_at: '2026-08-21T10:00:00Z', head_repository: { full_name: repository }, repository: { full_name: repository } };
    expect(() => assertReleaseStateQuiescent([run], { repository, defaultBranch })).toThrow(/refusing to advance/u);
    expect(() => assertReleaseStateQuiescent([{ ...run, status: 'in_progress', conclusion: null }], { repository, defaultBranch })).toThrow(/refusing to advance/u);
    expect(() => assertReleaseStateQuiescent([{ ...run, conclusion: 'success' }], { repository, defaultBranch })).not.toThrow();
    expect(() => assertReleaseStateQuiescent([], { repository, defaultBranch })).not.toThrow();
    expect(() => assertReleaseStateQuiescent([{ ...run, id: 11, conclusion: 'success', created_at: '2026-08-21T11:00:00Z' }, run], { repository, defaultBranch })).toThrow(/run 10/u);
  });

  it('requires strict, non-bypassable branch protection with the exact CI gate set', () => {
    const protection = { required_status_checks: { strict: true, contexts: REQUIRED_BRANCH_CHECKS, checks: REQUIRED_BRANCH_CHECKS.map((context) => ({ context, app_id: 15368 })) }, enforce_admins: { enabled: true }, required_pull_request_reviews: { required_approving_review_count: 0, require_last_push_approval: false, require_code_owner_reviews: false, bypass_pull_request_allowances: { users: [], teams: [], apps: [] } }, restrictions: null, allow_force_pushes: { enabled: false }, allow_deletions: { enabled: false } };
    expect(() => validateBranchProtection(protection)).not.toThrow();
    expect(() => validateBranchProtection({ ...protection, required_status_checks: { ...protection.required_status_checks, strict: false } })).toThrow(/current branch/u);
    expect(() => validateBranchProtection({ ...protection, enforce_admins: { enabled: false } })).toThrow(/administrators/u);
    expect(() => validateBranchProtection({ ...protection, required_pull_request_reviews: { ...protection.required_pull_request_reviews, bypass_pull_request_allowances: { users: [], teams: [], apps: [{}] } } })).toThrow(/bypass/u);
    expect(() => validateBranchProtection({ ...protection, required_pull_request_reviews: { ...protection.required_pull_request_reviews, required_approving_review_count: 1 } })).toThrow(/zero approving reviews/u);
    expect(() => validateBranchProtection({ ...protection, required_pull_request_reviews: { ...protection.required_pull_request_reviews, require_last_push_approval: true } })).toThrow(/last-push/u);
    expect(() => validateBranchProtection({ ...protection, required_status_checks: { ...protection.required_status_checks, checks: [...protection.required_status_checks.checks, { context: 'unreviewed', app_id: 15368 }] } })).toThrow(/unexpected required CI check set/u);
    expect(() => validateBranchProtection({ ...protection, required_status_checks: { ...protection.required_status_checks, checks: protection.required_status_checks.checks.map((check, index) => index === 0 ? { ...check, app_id: 1 } : check) } })).toThrow(/GitHub Actions app/u);
  });

  it('rejects a Version PR with a tampered package script via exact reproduced-tree binding', () => {
    const trustedTree = 'c'.repeat(40);
    const tamperedScriptTree = 'd'.repeat(40);
    expect(() => requireReproducedVersionTree(trustedTree, tamperedScriptTree)).toThrow(/reproduced version transformation/u);
  });

  it('requires exactly one numeric source-run attestation on a compatibility PR', () => {
    expect(compatibilitySourceRunId('Automated compatibility certification.\n\nSource certification run: 12345')).toBe('12345');
    expect(() => compatibilitySourceRunId('no source')).toThrow(/exactly one/u);
    expect(() => compatibilitySourceRunId('Source certification run: 1\nSource certification run: 2')).toThrow(/exactly one/u);
  });

  it('accepts only a failed SHA-bound Release run for intervention', () => {
    const run = { name: 'Release', path: '.github/workflows/release.yml', status: 'completed', event: 'workflow_dispatch', conclusion: 'failure', run_attempt: 1, display_title: `Release publish main @ ${head} (Version PR 42)`, head_sha: head, head_branch: 'main', head_repository: { full_name: repository }, repository: { full_name: repository } };
    expect(validateFailedReleaseRun(run, { repository, defaultBranch })).toMatchObject({ mode: 'publish', sha: head, versionPr: '42' });
    expect(() => validateFailedReleaseRun({ ...run, conclusion: 'success' }, { repository, defaultBranch })).toThrow(/does not require intervention/u);
    expect(() => validateFailedReleaseRun({ ...run, display_title: `Release publish main @ ${base} (Version PR 42)` }, { repository, defaultBranch })).toThrow(/not bound/u);
    expect(() => validateFailedReleaseRun({ ...run, path: '.github/workflows/lookalike.yml' }, { repository, defaultBranch })).toThrow(/workflow file/u);
  });
});
