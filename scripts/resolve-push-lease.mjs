import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFile = promisify(execFileCallback);
const objectId = /^[0-9a-f]{40}$/u;
const automationBranchRef = /^refs\/heads\/automation\/[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function parseRemoteLeaseResult(ref, exitCode, stdout) {
  if (!automationBranchRef.test(ref)) {
    throw new Error('the push lease target must be an automation branch ref');
  }
  if (exitCode === 2 && stdout.length === 0) return '';
  if (exitCode !== 0) throw new Error(`git ls-remote failed with status ${String(exitCode)}`);

  const line = stdout.endsWith('\n') ? stdout.slice(0, -1) : stdout;
  if (line.length === 0 || line.includes('\n')) {
    throw new Error('git ls-remote returned an ambiguous branch result');
  }
  const fields = line.split('\t');
  if (fields.length !== 2 || !objectId.test(fields[0]) || fields[1] !== ref) {
    throw new Error('git ls-remote returned a malformed branch result');
  }
  return fields[0];
}

export async function resolvePushLease(remote, ref, runGit = execFile) {
  if (remote.length === 0) throw new Error('a git remote is required');
  try {
    const { stdout } = await runGit('git', ['ls-remote', '--exit-code', '--refs', remote, ref], {
      encoding: 'utf8',
    });
    return parseRemoteLeaseResult(ref, 0, stdout);
  } catch (error) {
    if (typeof error === 'object' && error !== null && typeof error.code === 'number') {
      return parseRemoteLeaseResult(
        ref,
        error.code,
        typeof error.stdout === 'string' ? error.stdout : '',
      );
    }
    throw new Error('git ls-remote could not be executed', { cause: error });
  }
}

async function main() {
  const [remote, ref] = process.argv.slice(2);
  if (remote === undefined || ref === undefined) {
    throw new Error('usage: resolve-push-lease.mjs <remote> <refs/heads/branch>');
  }
  process.stdout.write(`${await resolvePushLease(remote, ref)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
