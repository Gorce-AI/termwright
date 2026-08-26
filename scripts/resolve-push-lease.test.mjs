import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { parseRemoteLeaseResult, resolvePushLease } from './resolve-push-lease.mjs';

const execFile = promisify(execFileCallback);
const ref = 'refs/heads/automation/framework-compatibility';
const sha = '0123456789abcdef0123456789abcdef01234567';

describe('atomic push lease resolution', () => {
  it('returns the exact existing remote branch object ID', () => {
    expect(parseRemoteLeaseResult(ref, 0, `${sha}\t${ref}\n`)).toBe(sha);
  });

  it('represents an absent remote branch as an empty expected object ID', () => {
    expect(parseRemoteLeaseResult(ref, 2, '')).toBe('');
  });

  it.each([
    [0, ''],
    [0, `${sha}\trefs/heads/other\n`],
    [0, `not-an-object-id\t${ref}\n`],
    [0, `${sha}\t${ref}\n${sha}\t${ref}\n`],
    [0, `\n${sha}\t${ref}\n`],
    [0, `${sha}\t${ref}\n\n`],
    [2, `${sha}\t${ref}\n`],
  ])('rejects malformed or ambiguous output (status %s)', (status, stdout) => {
    expect(() => parseRemoteLeaseResult(ref, status, stdout)).toThrow();
  });

  it.each([1, 128])('fails closed on git/transport status %s', (status) => {
    expect(() => parseRemoteLeaseResult(ref, status, '')).toThrow(
      `git ls-remote failed with status ${status}`,
    );
  });

  it.each([
    'refs/heads/main',
    'refs/heads/automation/foo.lock',
    'refs/heads/automation/foo/.bar',
    'refs/heads/automation/foo.',
    'refs/heads/automation/foo_bar',
  ])('rejects a target outside the owned automation branch shape: %s', (invalidRef) => {
    expect(() => parseRemoteLeaseResult(invalidRef, 2, '')).toThrow(
      'the push lease target must be an automation branch ref',
    );
  });

  it('queries the exact branch without relying on a tracking ref', async () => {
    const runGit = vi.fn().mockResolvedValue({ stdout: `${sha}\t${ref}\n` });

    await expect(resolvePushLease('origin', ref, runGit)).resolves.toBe(sha);
    expect(runGit).toHaveBeenCalledWith(
      'git',
      ['ls-remote', '--exit-code', '--refs', 'origin', ref],
      { encoding: 'utf8' },
    );
  });

  it('accepts only exit status 2 as the branch-absent result', async () => {
    const absent = Object.assign(new Error('not found'), { code: 2, stdout: '' });
    const transport = Object.assign(new Error('transport failure'), { code: 128, stdout: '' });

    await expect(resolvePushLease('origin', ref, vi.fn().mockRejectedValue(absent))).resolves.toBe('');
    await expect(resolvePushLease('origin', ref, vi.fn().mockRejectedValue(transport))).rejects.toThrow(
      'git ls-remote failed with status 128',
    );
  });

  it('creates and updates a real remote branch while rejecting a stale lease', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'termwright-push-lease-'));
    const remote = join(directory, 'remote.git');
    const worktree = join(directory, 'worktree');
    try {
      await execFile('git', ['init', '--bare', remote]);
      await execFile('git', ['init', worktree]);
      await execFile('git', ['-C', worktree, 'config', 'user.name', 'Termwright Test']);
      await execFile('git', ['-C', worktree, 'config', 'user.email', 'test@termwright.invalid']);
      await execFile('git', ['-C', worktree, 'commit', '--allow-empty', '-m', 'initial']);

      const absentLease = await resolvePushLease(remote, ref);
      expect(absentLease).toBe('');
      await execFile('git', [
        '-C', worktree, 'push', `--force-with-lease=${ref}:${absentLease}`, remote, `HEAD:${ref}`,
      ]);

      const initialLease = await resolvePushLease(remote, ref);
      await execFile('git', ['-C', worktree, 'commit', '--allow-empty', '-m', 'update']);
      await execFile('git', [
        '-C', worktree, 'push', `--force-with-lease=${ref}:${initialLease}`, remote, `HEAD:${ref}`,
      ]);
      const updatedLease = await resolvePushLease(remote, ref);
      expect(updatedLease).not.toBe(initialLease);

      await execFile('git', ['-C', worktree, 'commit', '--allow-empty', '-m', 'stale update']);
      await expect(execFile('git', [
        '-C', worktree, 'push', `--force-with-lease=${ref}:${initialLease}`, remote, `HEAD:${ref}`,
      ])).rejects.toThrow();
      await expect(resolvePushLease(remote, ref)).resolves.toBe(updatedLease);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
