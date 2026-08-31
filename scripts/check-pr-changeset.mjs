import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { isDirectExecution } from './is-direct-execution.mjs';

const execFile = promisify(execFileCallback);

const nonPublishableSegment = /\/(?:__snapshots__|__tests__|test|tests)\//u;
const testModule = /(?:^|\.)(?:e2e|spec|test)\.[^/]+$/u;
const testConfig = /^(?:coverage|vitest)\.config\.[^/]+$/u;

export function isPublishablePackagePath(path) {
  if (!path.startsWith('packages/')) return false;
  const relativePath = path.split('/').slice(2).join('/');
  const filename = path.slice(path.lastIndexOf('/') + 1);
  if (nonPublishableSegment.test(`/${relativePath}`)) return false;
  if (testModule.test(filename) || testConfig.test(filename) || filename.endsWith('.snap'))
    return false;
  if (/^(?:CHANGELOG|README)(?:\.[^.]+)?\.md$/iu.test(filename)) return false;
  return true;
}

export function changesetDecision(packagePaths, changedChangesets) {
  const publishable = packagePaths.filter(isPublishablePackagePath);
  return {
    publishable,
    needsChangeset: publishable.length > 0 && changedChangesets.length === 0,
  };
}

export function isConsumableChangesetPath(path) {
  return /^\.changeset\/(?!README\.md$)[A-Za-z0-9][A-Za-z0-9._-]*\.md$/u.test(path);
}

export async function changedFiles(base, head, args, cwd, runGit = execFile) {
  // Report both sides of a rename. Otherwise moving production code to a
  // test-looking destination could hide the deleted publishable path.
  const { stdout } = await runGit(
    'git',
    ['diff', '--name-only', '-z', '--no-renames', ...args, base, head, '--'],
    { cwd },
  );
  return stdout.split('\0').filter(Boolean);
}

export async function changedConsumableChangesets(base, head, cwd, runGit = execFile) {
  // Compatibility certification intentionally accumulates releases in one generated
  // changeset until the next Version PR consumes it. Therefore a later certification
  // modifies an existing consumable changeset instead of adding another file.
  return (await changedFiles(base, head, ['--diff-filter=AM'], cwd, runGit)).filter(
    isConsumableChangesetPath,
  );
}

async function main() {
  const base = process.env['BASE'];
  const head = process.env['HEAD'];
  if (base === undefined || head === undefined) throw new Error('BASE and HEAD are required');
  const packagePaths = (await changedFiles(base, head, [])).filter((path) =>
    path.startsWith('packages/'),
  );
  const changedChangesets = await changedConsumableChangesets(base, head);
  const decision = changesetDecision(packagePaths, changedChangesets);

  if (decision.publishable.length === 0) {
    console.log('no publishable package changes — tests and documentation do not need a changeset');
    return;
  }
  if (!decision.needsChangeset) {
    console.log(`changeset present:\n${changedChangesets.join('\n')}`);
    return;
  }
  console.error(
    '::error::this PR changes published package contents but adds or updates no changeset. Run `pnpm changeset`, or use the release exemption only for an intentional non-versioned change.',
  );
  console.error(`Publishable files:\n${decision.publishable.join('\n')}`);
  process.exitCode = 1;
}

if (isDirectExecution(import.meta.url)) await main();
