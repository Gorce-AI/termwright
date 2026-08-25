import { posix, win32 } from 'node:path';

/**
 * Resolve npm as JavaScript on Windows instead of spawning npm.cmd.
 *
 * Node's child_process API does not execute batch files without a shell. Using
 * a shell would add a quoting boundary around package names and paths, so the
 * reliability harness invokes the CLI through the current Node executable.
 */
export function npmInvocation(options = {}) {
  const platform = options.platform ?? process.platform;
  const execPath = options.execPath ?? process.execPath;
  if (platform !== 'win32') return { file: 'npm', args: [] };
  const path = platform === 'win32' ? win32 : posix;
  return {
    file: execPath,
    args: [path.join(path.dirname(execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')],
  };
}

/** Invoke the installed Vitest entry point without a platform shell shim. */
export function vitestInvocation(project, execPath = process.execPath, platform = process.platform) {
  const path = platform === 'win32' ? win32 : posix;
  return {
    file: execPath,
    args: [path.join(project, 'node_modules', 'vitest', 'vitest.mjs')],
  };
}
