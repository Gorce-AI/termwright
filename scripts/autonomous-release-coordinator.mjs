#!/usr/bin/env node

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA = /^[0-9a-f]{40}$/u;
const GITHUB_LOGIN = /^(?!.*--)[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u;
const GITHUB_ACTIONS_APP_ID = 15368;
const HEARTBEAT_INTERVAL_MS = 30 * 24 * 60 * 60 * 1_000;
export const CI_JOBS = [
  'package metadata',
  'build ubuntu-latest / node 22',
  'build ubuntu-latest / node 24',
  'build macos-latest / node 22',
  'build macos-latest / node 24',
  'build windows-latest / node 22',
  'build windows-latest / node 24',
  'hostile input (128 MiB heap)',
  'conformance ubuntu-latest',
  'conformance macos-latest',
  'conformance windows-latest',
  'runner UI end-to-end (Chromium)',
  'opentui adapter contract (Bun)',
  'clients (python 3.9)',
  'clients (python 3.12)',
  'clients (go)',
  'clients (rust)',
  'release hygiene',
  'clients (rust MSRV 1.74)',
  'Ratatui SDK (Rust MSRV 1.88)',
  'cross-language vectors are current',
  'examples (dogfooding)',
  'website builds',
];

const compatibilityFiles = [
  /^compatibility\/(?:certified-upstreams|registry)\.json$/u,
  /^\.changeset\/framework-compatibility-auto\.md$/u,
  /^packages\/(?:probe-tview|probe-charm)\/upstream-patches\/[A-Za-z0-9@._/+\-]+$/u,
  /^clients\/rust-probe\/upstream-patches\/[A-Za-z0-9@._/+\-]+$/u,
  /^clients\/python\/src\/termwright_probe\/certified_textual\.py$/u,
  /^packages\/(?:probe-ink|probe-opentui)\/src\/certified-instrumentation\.json$/u,
  /^packages\/(?:ink|probe-ink)\/package\.json$/u,
];

const versionFiles = [
  /^\.changeset\/[A-Za-z0-9._-]+\.md$/u,
  /^pnpm-lock\.yaml$/u,
  /^packages\/[^/]+\/(?:package\.json|CHANGELOG\.md)$/u,
  /^packages\/(?:termwright-cli\/src\/version|mcp\/src\/version|desktop-host\/src\/index|probe-ink\/src\/version|probe-opentui\/src\/version|probe-tview\/src\/launch|probe-charm\/src\/launch)\.ts$/u,
  /^packages\/(?:probe-tview|probe-charm)\/upstream-patches\/[A-Za-z0-9@._/+\-]+$/u,
  /^clients\/README\.md$/u,
  /^clients\/python\/(?:pyproject\.toml|uv\.lock|src\/termwright\/__init__\.py|src\/termwright_probe\/__init__\.py)$/u,
  /^clients\/(?:rust|rust-probe|rust-ratatui)\/(?:Cargo\.toml|Cargo\.lock)$/u,
  /^compatibility\/registry\.json$/u,
];

const heartbeatFiles = [/^compatibility\/workflow-heartbeat\.json$/u];

export function validateChangedFiles(kind, files) {
  const allowlist = kind === 'compatibility' ? compatibilityFiles : kind === 'version' ? versionFiles : kind === 'heartbeat' ? heartbeatFiles : null;
  if (allowlist === null) throw new Error(`unknown PR kind ${kind}`);
  if (!Array.isArray(files) || files.length === 0) throw new Error(`${kind} PR has no changed files`);
  for (const file of files) {
    const path = typeof file === 'string' ? file : file?.filename;
    if (typeof path !== 'string' || path.includes('\\') || path.startsWith('/') || path.split('/').some((part) => part === '' || part === '.' || part === '..') || !allowlist.some((pattern) => pattern.test(path))) {
      throw new Error(`${kind} PR contains forbidden path ${String(path)}`);
    }
    if (typeof file === 'object' && file !== null) {
      if (!['added', 'modified', 'removed', 'renamed', 'copied', 'changed'].includes(file.status)) throw new Error(`${kind} PR contains unknown file status ${String(file.status)}`);
      if (file.status === 'renamed' && (typeof file.previous_filename !== 'string' || !allowlist.some((pattern) => pattern.test(file.previous_filename)))) {
        throw new Error(`${kind} PR renames a forbidden path ${String(file.previous_filename)}`);
      }
    }
  }
}

export function validateChangedFileObjects(files, tree) {
  const entries = new Map((tree?.tree ?? []).map((entry) => [entry.path, entry]));
  let totalSize = 0;
  for (const file of files) {
    if (file.status === 'removed') continue;
    const entry = entries.get(file.filename);
    if (entry?.type !== 'blob' || !['100644', '100755'].includes(entry.mode)) throw new Error(`changed path is not a regular file: ${file.filename}`);
    if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > 2 * 1024 * 1024) throw new Error(`changed file exceeds the 2 MiB safety bound: ${file.filename}`);
    totalSize += entry.size;
  }
  if (totalSize > 10 * 1024 * 1024) throw new Error('changed files exceed the 10 MiB aggregate safety bound');
}

export function validateRequiredCiJobs(jobs) {
  const conclusions = new Map();
  for (const job of jobs ?? []) {
    if (conclusions.has(job.name)) throw new Error(`CI reported duplicate job ${job.name}`);
    conclusions.set(job.name, job.conclusion);
  }
  const missing = CI_JOBS.filter((name) => !conclusions.has(name));
  if (missing.length > 0) throw new Error(`CI is missing required jobs: ${missing.join(', ')}`);
  const unexpected = [...conclusions.keys()].filter((name) => !CI_JOBS.includes(name));
  if (unexpected.length > 0) throw new Error(`CI reported unexpected jobs not covered by the autonomous gate contract: ${unexpected.join(', ')}`);
  const ungreen = CI_JOBS.filter((name) => conclusions.get(name) !== 'success');
  if (ungreen.length > 0) throw new Error(`CI has non-success required jobs: ${ungreen.join(', ')}`);
}

export function validateTrustedUpstreamRun(run, { repository, defaultBranch, defaultHead }) {
  if (run?.name !== 'Framework compatibility candidates' || run?.status !== 'completed') throw new Error('unexpected workflow_run source');
  if (run.path !== '.github/workflows/upstream-candidates.yml') throw new Error('compatibility run used an unexpected workflow file');
  if (!['schedule', 'workflow_dispatch'].includes(run.event)) throw new Error(`untrusted compatibility event ${String(run.event)}`);
  if (run.head_repository?.full_name !== repository || run.repository?.full_name !== repository) throw new Error('compatibility run came from another repository');
  if (run.head_branch !== defaultBranch) throw new Error('compatibility run did not execute on the default branch');
  if (!SHA.test(run.head_sha ?? '') || run.head_sha !== defaultHead) throw new Error('stale compatibility workflow SHA');
}

export function validateRetryableReleaseRun(run, { repository, defaultBranch, maximumAttempts = 3 }) {
  if (run?.name !== 'Release' || run?.status !== 'completed' || run?.event !== 'workflow_dispatch') throw new Error('unexpected release workflow_run source');
  if (run.path !== '.github/workflows/release.yml') throw new Error('release run used an unexpected workflow file');
  if (run.head_repository?.full_name !== repository || run.repository?.full_name !== repository) throw new Error('release run came from another repository');
  if (run.head_branch !== defaultBranch || !SHA.test(run.head_sha ?? '')) throw new Error('release run did not execute from the trusted default branch');
  if (!['failure', 'cancelled', 'timed_out'].includes(run.conclusion)) throw new Error(`release run conclusion ${String(run.conclusion)} is not retryable`);
  if (!Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1) throw new Error('release run attempt is invalid');
  const escaped = defaultBranch.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const title = new RegExp(`^Release (prepare|publish) ${escaped} @ ([0-9a-f]{40})(?: \\(Version PR ([1-9][0-9]*)\\))?$`, 'u').exec(run.display_title ?? '');
  if (title === null || title[2] !== run.head_sha || (title[1] === 'prepare' && title[3] !== undefined) || (title[1] === 'publish' && title[3] === undefined)) throw new Error('release run title is not bound to its exact mode, branch, SHA and Version PR');
  return { retry: run.run_attempt < maximumAttempts, mode: title[1], sha: title[2], versionPr: title[3] ?? null };
}

const prShape = {
  compatibility: (target) => ({ branch: 'automation/framework-compatibility', title: 'chore(compatibility): record certified upstream releases', target }),
  version: (target) => ({ branch: `release-pr/${target}`, title: `chore(release): version packages (${target})`, target }),
  heartbeat: (target) => ({ branch: 'automation/workflow-heartbeat', title: 'chore(automation): refresh schedule heartbeat', target }),
};

export function nextHeartbeatRecord(workflowRun, currentText) {
  if (!/^[1-9][0-9]*$/u.test(String(workflowRun?.id ?? '')) || !SHA.test(workflowRun?.head_sha ?? '')) throw new Error('heartbeat source run identity is invalid');
  const observed = Date.parse(workflowRun.created_at ?? '');
  if (!Number.isFinite(observed)) throw new Error('heartbeat source run timestamp is invalid');
  if (currentText !== undefined) {
    let current;
    try { current = JSON.parse(currentText); } catch { throw new Error('existing heartbeat is malformed'); }
    if (current?.schemaVersion !== 1 || current?.kind !== 'termwright-schedule-heartbeat' || !SHA.test(current.sourceRevision ?? '') || !/^[1-9][0-9]*$/u.test(current.sourceRunId ?? '')) throw new Error('existing heartbeat contract is invalid');
    const previous = Date.parse(current.observedAt ?? '');
    if (!Number.isFinite(previous) || previous > observed) throw new Error('existing heartbeat timestamp is invalid or from the future');
    if (observed - previous < HEARTBEAT_INTERVAL_MS) return null;
  }
  return `${JSON.stringify({ schemaVersion: 1, kind: 'termwright-schedule-heartbeat', sourceRunId: String(workflowRun.id), sourceRevision: workflowRun.head_sha, observedAt: new Date(observed).toISOString() }, null, 2)}\n`;
}

export function validateAutomationPr(kind, pr, files, { repository, defaultBranch, headSha, defaultHead, requireOpen = true, requireBaseSha = true }) {
  const expected = prShape[kind]?.(defaultBranch);
  if (expected === undefined) throw new Error(`unknown PR kind ${kind}`);
  if (pr?.head?.sha !== headSha || !SHA.test(headSha ?? '')) throw new Error(`${kind} PR head SHA does not match CI`);
  if (pr.head?.ref !== expected.branch || pr.head?.repo?.full_name !== repository) throw new Error(`${kind} PR head identity is not trusted`);
  if (pr.base?.ref !== defaultBranch || pr.base?.repo?.full_name !== repository || (requireBaseSha && pr.base?.sha !== defaultHead)) throw new Error(`${kind} PR base is stale or unexpected`);
  if (pr.user?.login !== 'github-actions[bot]' || pr.title !== expected.title) throw new Error(`${kind} PR author or title is unexpected`);
  if (requireOpen && (pr.state !== 'open' || pr.merged_at !== null)) throw new Error(`${kind} PR is not open`);
  if (!Number.isSafeInteger(pr.changed_files) || pr.changed_files !== files.length || pr.changed_files > 3000) throw new Error(`${kind} PR changed-file listing is incomplete`);
  validateChangedFiles(kind, files);
}

export function releaseDispatchTitle(mode, target, sha, versionPr = null) {
  return mode === 'prepare'
    ? `Release prepare ${target} @ ${sha}`
    : `Release publish ${target} @ ${sha} (Version PR ${versionPr})`;
}

export function shouldDispatchRelease(runs, expectedTitle) {
  return !(runs ?? []).some((run) => run.event === 'workflow_dispatch' && run.display_title === expectedTitle);
}

export function pendingChangesetFiles(entries) {
  return (entries ?? [])
    .filter((entry) => typeof entry === 'string' && entry !== 'README.md' && /^[A-Za-z0-9._-]+\.md$/u.test(entry))
    .sort();
}

export function assertReleaseStateQuiescent(runs, { repository, defaultBranch }) {
  const trusted = (runs ?? []).filter((run) => (
    run?.name === 'Release'
    && run.path === '.github/workflows/release.yml'
    && run.event === 'workflow_dispatch'
    && run.repository?.full_name === repository
    && run.head_repository?.full_name === repository
    && run.head_branch === defaultBranch
    && SHA.test(run.head_sha ?? '')
    && /^Release (?:prepare|publish) .+ @ [0-9a-f]{40}/u.test(run.display_title ?? '')
  )).sort((left, right) => Date.parse(right.created_at ?? 0) - Date.parse(left.created_at ?? 0) || Number(right.id ?? 0) - Number(left.id ?? 0));
  const unresolved = trusted.find((run) => run.status !== 'completed' || run.conclusion !== 'success');
  if (unresolved === undefined) return;
  throw new Error(`trusted Release run ${String(unresolved.id)} is ${String(unresolved.status)}/${String(unresolved.conclusion)}; refusing to advance the release state machine`);
}

export function validateBranchProtection(protection) {
  if (protection?.required_status_checks?.strict !== true) throw new Error('default branch must require status checks against the current branch');
  if (protection?.enforce_admins?.enabled !== true) throw new Error('default branch protections must apply to administrators');
  const checks = protection.required_status_checks.checks ?? [];
  const contexts = new Set(checks.map((check) => check.context));
  const missing = CI_JOBS.filter((name) => !contexts.has(name));
  if (missing.length > 0) throw new Error(`branch protection is missing required CI checks: ${missing.join(', ')}`);
  const unexpected = [...contexts].filter((name) => !CI_JOBS.includes(name));
  if (unexpected.length > 0 || checks.length !== CI_JOBS.length) throw new Error(`branch protection has an unexpected required CI check set: ${unexpected.join(', ')}`);
  if (checks.some((check) => check.app_id !== GITHUB_ACTIONS_APP_ID)) throw new Error('every required CI check must be bound to the GitHub Actions app');
  if (protection.required_pull_request_reviews == null) throw new Error('default branch must require pull requests');
  if (protection.required_pull_request_reviews.required_approving_review_count !== 0) {
    throw new Error('unattended automation requires zero approving reviews; exact tree reproduction and strict CI are its merge authorization');
  }
  if (protection.required_pull_request_reviews.require_last_push_approval === true) {
    throw new Error('last-push approval blocks the bot-owned unattended PR flow');
  }
  if (protection.required_pull_request_reviews.require_code_owner_reviews === true) {
    throw new Error('code-owner approval blocks the bot-owned unattended PR flow');
  }
  const bypass = protection.required_pull_request_reviews.bypass_pull_request_allowances;
  if ((bypass?.users?.length ?? 0) > 0 || (bypass?.teams?.length ?? 0) > 0 || (bypass?.apps?.length ?? 0) > 0) throw new Error('pull-request review bypass allowances are incompatible with autonomous release safety');
  if (protection.restrictions != null) throw new Error('default-branch push restrictions can silently block the coordinator merge token');
  if (protection.allow_force_pushes?.enabled === true || protection.allow_deletions?.enabled === true) throw new Error('default branch must forbid force pushes and deletion');
}

export function validateIssueOwner(owner) {
  if (typeof owner !== 'string' || !GITHUB_LOGIN.test(owner)) {
    throw new Error('UPSTREAM_COMPATIBILITY_OWNER must name one explicit valid GitHub user; actor fallback is forbidden');
  }
  return owner;
}

export function requireReproducedVersionTree(expectedTree, prTree) {
  if (!SHA.test(expectedTree ?? '') || !SHA.test(prTree ?? '') || expectedTree !== prTree) throw new Error('Version PR tree differs from the trusted, reproduced version transformation');
}

export function compatibilitySourceRunId(body) {
  if (typeof body !== 'string') throw new Error('compatibility PR has no source-run attestation');
  const matches = [...body.matchAll(/^Source certification run: ([1-9][0-9]*)$/gmu)];
  if (matches.length !== 1) throw new Error('compatibility PR must name exactly one source certification run');
  return matches[0][1];
}

async function githubApi(path, options = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (typeof token !== 'string' || token.length === 0) throw new Error('GITHUB_TOKEN is required');
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28', ...options.headers },
  });
  if (!response.ok) throw new Error(`GitHub API ${options.method ?? 'GET'} ${path} failed with ${response.status}: ${(await response.text()).slice(0, 1000)}`);
  if (response.status === 204) return null;
  return response.json();
}

async function paged(path, field) {
  const values = [];
  for (let page = 1; ; page += 1) {
    const separator = path.includes('?') ? '&' : '?';
    const body = await githubApi(`${path}${separator}per_page=100&page=${page}`);
    const pageValues = field === undefined ? body : body[field];
    values.push(...pageValues);
    if (pageValues.length < 100) return values;
  }
}

async function defaultHead(repository, branch) {
  return (await githubApi(`/repos/${repository}/git/ref/heads/${encodeURIComponent(branch)}`)).object.sha;
}

async function releaseRuns(repository, sha) {
  const response = await githubApi(`/repos/${repository}/actions/workflows/release.yml/runs?event=workflow_dispatch&head_sha=${sha}&per_page=100`);
  return response.workflow_runs ?? [];
}

async function recentReleaseRuns(repository, branch) {
  return paged(`/repos/${repository}/actions/workflows/release.yml/runs?branch=${encodeURIComponent(branch)}`, 'workflow_runs');
}

async function dispatchRelease(repository, target, mode, sha, versionPr = '') {
  const title = releaseDispatchTitle(mode, target, sha, versionPr || null);
  if (!shouldDispatchRelease(await releaseRuns(repository, sha), title)) {
    process.stdout.write(`release dispatch already exists: ${title}\n`);
    return;
  }
  await githubApi(`/repos/${repository}/actions/workflows/release.yml/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref: target, inputs: { mode, target, expected_sha: sha, version_pr: String(versionPr) } }),
  });
  // workflow_dispatch has no caller-supplied idempotency key and its 204 can
  // precede run-list visibility. Keep the repository-wide coordinator lock
  // until the SHA/title key is observable; otherwise the next queued event can
  // race the eventually-consistent list endpoint and dispatch a duplicate.
  let visible = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (!shouldDispatchRelease(await releaseRuns(repository, sha), title)) {
      visible = true;
      break;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
  }
  if (!visible) throw new Error(`release dispatch was accepted but did not become observable: ${title}`);
  process.stdout.write(`dispatched ${title}\n`);
}

async function inspectCi(event) {
  const run = event.workflow_run;
  const repository = event.repository.full_name;
  const branch = event.repository.default_branch;
  if (run.name !== 'CI' || run.status !== 'completed') throw new Error('unexpected coordinator event');
  if (run.path !== '.github/workflows/ci.yml') throw new Error('CI run used an unexpected workflow file');
  if (run.event !== 'workflow_dispatch' || run.conclusion !== 'success') throw new Error('automation requires an explicitly dispatched, successful CI run');
  if (run.head_repository?.full_name !== repository || run.repository?.full_name !== repository || !SHA.test(run.head_sha ?? '')) throw new Error('CI run repository or SHA is untrusted');
  validateRequiredCiJobs(await paged(`/repos/${repository}/actions/runs/${run.id}/jobs?filter=latest`, 'jobs'));
  const current = await defaultHead(repository, branch);
  const prs = await paged(`/repos/${repository}/commits/${run.head_sha}/pulls`);
  const recognized = prs.filter((pr) => pr.head?.ref === 'automation/framework-compatibility' || pr.head?.ref === 'automation/workflow-heartbeat' || pr.head?.ref === `release-pr/${branch}`);
  if (recognized.length === 0) {
    return { kind: 'none', headSha: run.head_sha, baseSha: current };
  }
  if (recognized.length !== 1) throw new Error('CI commit is attached to multiple autonomous PRs');
  const pr = recognized[0];
  if (run.head_branch !== pr.head?.ref) throw new Error('CI run branch does not match the autonomous PR head');
  const kind = pr.head.ref === 'automation/framework-compatibility' ? 'compatibility' : pr.head.ref === 'automation/workflow-heartbeat' ? 'heartbeat' : 'version';
  const files = await paged(`/repos/${repository}/pulls/${pr.number}/files`);
  const alreadyMerged = pr.merged_at !== null;
  validateAutomationPr(kind, pr, files, { repository, defaultBranch: branch, headSha: run.head_sha, defaultHead: current, requireOpen: !alreadyMerged, requireBaseSha: !alreadyMerged });
  if (alreadyMerged && pr.merge_commit_sha !== current) throw new Error(`merged ${kind} PR is no longer the exact current default-branch HEAD`);
  let trustedBase = current;
  if (alreadyMerged) {
    const mergeCommit = await githubApi(`/repos/${repository}/git/commits/${current}`);
    if (mergeCommit.parents?.length !== 1 || !SHA.test(mergeCommit.parents[0]?.sha ?? '')) throw new Error(`merged ${kind} PR is not an exact squash commit`);
    trustedBase = mergeCommit.parents[0].sha;
  }
  const tree = await githubApi(`/repos/${repository}/git/trees/${run.head_sha}?recursive=1`);
  if (tree.truncated === true) throw new Error('PR head tree response was truncated');
  validateChangedFileObjects(files, tree);
  return {
    kind,
    pr,
    headSha: run.head_sha,
    baseSha: trustedBase,
    alreadyMerged,
    mergedSha: pr.merge_commit_sha,
    sourceRunId: kind === 'compatibility' || kind === 'heartbeat' ? compatibilitySourceRunId(pr.body) : null,
  };
}

async function coordinateCi(event) {
  const inspected = await inspectCi(event);
  if (inspected.kind === 'none') {
    process.stdout.write('CI commit is not an autonomous PR; nothing to do\n');
    return;
  }
  if (process.env.AUTOMATION_TREE_VERIFIED !== 'true') throw new Error(`${inspected.kind} PR tree was not reproduced by the read-only coordinator job`);
  const { pr, kind } = inspected;
  const run = event.workflow_run;
  const repository = event.repository.full_name;
  const branch = event.repository.default_branch;
  validateBranchProtection(await githubApi(`/repos/${repository}/branches/${encodeURIComponent(branch)}/protection`));
  assertReleaseStateQuiescent(await recentReleaseRuns(repository, branch), { repository, defaultBranch: branch });
  const merged = inspected.alreadyMerged
    ? { merged: true, sha: inspected.mergedSha }
    : await githubApi(`/repos/${repository}/pulls/${pr.number}/merge`, { method: 'PUT', body: JSON.stringify({ sha: run.head_sha, merge_method: 'squash' }) });
  if (merged?.merged !== true || !SHA.test(merged.sha ?? '')) throw new Error(`GitHub refused to merge exact ${kind} PR head`);
  const after = await defaultHead(repository, branch);
  if (after !== merged.sha) throw new Error(`default branch did not advance to the exact merged ${kind} PR SHA`);
  if (kind === 'compatibility') await dispatchRelease(repository, branch, 'prepare', merged.sha);
  else if (kind === 'version') await dispatchRelease(repository, branch, 'publish', merged.sha, pr.number);
  else process.stdout.write(`merged exact heartbeat ${merged.sha}; release dispatch intentionally suppressed\n`);
}

async function dispatchPendingChangesets(event, expectedSha) {
  const repository = event.repository.full_name;
  const branch = event.repository.default_branch;
  validateTrustedUpstreamRun(event.workflow_run, { repository, defaultBranch: branch, defaultHead: expectedSha });
  if ((await defaultHead(repository, branch)) !== expectedSha) throw new Error('default branch advanced before pending changesets could be dispatched');
  const pending = pendingChangesetFiles(await readdir(resolve('.changeset')));
  if (pending.length === 0) {
    process.stdout.write('no pending changesets on the exact default-branch HEAD\n');
    return;
  }
  assertReleaseStateQuiescent(await recentReleaseRuns(repository, branch), { repository, defaultBranch: branch });
  await dispatchRelease(repository, branch, 'prepare', expectedSha);
}

async function main(argv) {
  const command = argv[0];
  if (['coordinate-ci', 'dispatch-pending-changesets', 'inspect-ci', 'refresh-heartbeat', 'validate-release-retry', 'validate-upstream'].includes(command)) {
    validateIssueOwner(process.env.ISSUE_OWNER);
  }
  if (command === 'validate-upstream') {
    const event = JSON.parse(await readFile(resolve(argv[1]), 'utf8'));
    validateTrustedUpstreamRun(event.workflow_run, { repository: event.repository.full_name, defaultBranch: event.repository.default_branch, defaultHead: argv[2] });
  } else if (command === 'refresh-heartbeat') {
    const event = JSON.parse(await readFile(resolve(argv[1]), 'utf8'));
    const destination = resolve(argv[2]);
    const current = await readFile(destination, 'utf8').catch((error) => error?.code === 'ENOENT' ? undefined : Promise.reject(error));
    const rendered = nextHeartbeatRecord(event.workflow_run, current);
    if (rendered !== null) await writeFile(destination, rendered);
    if (process.env.GITHUB_OUTPUT !== undefined) {
      const { appendFile } = await import('node:fs/promises');
      await appendFile(process.env.GITHUB_OUTPUT, `updated=${String(rendered !== null)}\n`);
    } else process.stdout.write(`${rendered !== null ? 'updated' : 'current'}\n`);
  } else if (command === 'validate-files') {
    validateChangedFiles(argv[1], argv.slice(2));
  } else if (command === 'validate-version-pr') {
    const event = JSON.parse(await readFile(resolve(argv[1]), 'utf8'));
    const pr = JSON.parse(await readFile(resolve(argv[2]), 'utf8'));
    const files = JSON.parse(await readFile(resolve(argv[3]), 'utf8'));
    validateAutomationPr('version', pr, files, { repository: event.repository.full_name, defaultBranch: event.inputs.target, headSha: pr.head.sha, defaultHead: event.inputs.expected_sha, requireOpen: false, requireBaseSha: false });
    if (pr.merged_at === null || pr.merge_commit_sha !== event.inputs.expected_sha) throw new Error('Version PR is not merged as the expected default-branch SHA');
  } else if (command === 'coordinate-ci') {
    await coordinateCi(JSON.parse(await readFile(resolve(argv[1]), 'utf8')));
  } else if (command === 'dispatch-pending-changesets') {
    await dispatchPendingChangesets(JSON.parse(await readFile(resolve(argv[1]), 'utf8')), argv[2]);
  } else if (command === 'validate-release-retry') {
    const event = JSON.parse(await readFile(resolve(argv[1]), 'utf8'));
    const result = validateRetryableReleaseRun(event.workflow_run, { repository: event.repository.full_name, defaultBranch: event.repository.default_branch });
    const output = process.env.GITHUB_OUTPUT;
    if (output !== undefined) {
      const { appendFile } = await import('node:fs/promises');
      await appendFile(output, `retry=${String(result.retry)}\nmode=${result.mode}\nsha=${result.sha}\nversion-pr=${result.versionPr ?? ''}\n`);
    } else process.stdout.write(`${JSON.stringify(result)}\n`);
  } else if (command === 'inspect-ci') {
    const result = await inspectCi(JSON.parse(await readFile(resolve(argv[1]), 'utf8')));
    const output = process.env.GITHUB_OUTPUT;
    if (output !== undefined) {
      const { appendFile } = await import('node:fs/promises');
      await appendFile(output, `kind=${result.kind}\nhead-sha=${result.headSha}\nbase-sha=${result.baseSha}\npr-number=${result.pr?.number ?? ''}\nsource-run-id=${result.sourceRunId ?? ''}\n`);
    } else process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    throw new Error(`unknown command ${String(command)}`);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
