/**
 * What the panel says it is looking at: the project's name, its branch, and
 * the version of termwright showing it.
 *
 * All three are context rather than data — they sit in the frame around every
 * view so that a screenshot of the panel answers "which project, which branch,
 * which version" without anyone having to ask. That is also why none of them
 * is fatal when missing: a directory that is not a git repository is a normal
 * thing to test in, and a panel that refused to start over a missing branch
 * would be absurd.
 *
 * @packageDocumentation
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The project the panel is showing, for the frame around every view. */
export interface ProjectInfo {
  /** `name` from the project's `package.json`, else the directory's name. */
  readonly name: string;
  /** Current git branch, or `null` outside a repository or on a detached head. */
  readonly branch: string | null;
  /** Version of `@termwright/ui` rendering this page. */
  readonly version: string;
}

/** Milliseconds before a git call is abandoned. */
const GIT_TIMEOUT_MS = 2_000;

/**
 * Reads the project's name, branch and this build's version.
 *
 * @param cwd - the project directory.
 */
export async function readProjectInfo(cwd: string): Promise<ProjectInfo> {
  const [name, branch, version] = await Promise.all([
    readProjectName(cwd),
    readBranch(cwd),
    readOwnVersion(),
  ]);
  return { name, branch, version };
}

/**
 * Runs a git command, or resolves `null`.
 *
 * Bounded and never fatal: git may be absent, the directory may not be a
 * repository, and a repository on a network filesystem may simply hang. The
 * frame shows one fewer fact in those cases, which is the correct outcome.
 */
export async function git(cwd: string, args: readonly string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'git',
      [...args],
      { cwd, timeout: GIT_TIMEOUT_MS, windowsHide: true, maxBuffer: 64 * 1024 },
      (error, stdout) => {
        if (error !== null) {
          resolve(null);
          return;
        }
        const value = stdout.toString().trim();
        resolve(value === '' ? null : value);
      },
    );
  });
}

/** The branch name, or `null` on a detached head — which names no branch. */
async function readBranch(cwd: string): Promise<string | null> {
  const branch = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return branch === 'HEAD' ? null : branch;
}

async function readProjectName(cwd: string): Promise<string> {
  try {
    const manifest: unknown = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8'));
    const name = (manifest as { name?: unknown } | null)?.name;
    if (typeof name === 'string' && name !== '') return name;
  } catch {
    // No manifest, or one that is not JSON: the directory's name still names
    // the project, and is what a person would call it anyway.
  }
  return basename(cwd) === '' ? 'project' : basename(cwd);
}

async function readOwnVersion(): Promise<string> {
  try {
    const path = fileURLToPath(new URL('../package.json', import.meta.url));
    const manifest: unknown = JSON.parse(await readFile(path, 'utf8'));
    const version = (manifest as { version?: unknown } | null)?.version;
    if (typeof version === 'string') return version;
  } catch {
    // Reported as unknown rather than guessed: a wrong version in a bug report
    // costs more than a missing one.
  }
  return 'unknown';
}
