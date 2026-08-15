/**
 * The names of every test *declared* in a file — skipped ones included.
 *
 * Obsolete-snapshot pruning hinges on this distinction. A snapshot is obsolete
 * when no test claims it any more (a rename, a deletion), not when its test did
 * not run: `describe.skipIf(!pty)` on a machine without a pseudo-terminal
 * declares its tests and skips them, and deleting their snapshots there would
 * quietly destroy the E2E baselines of everyone else.
 */

/** The slice of Vitest's task tree this module walks. */
export interface DeclaredTask {
  readonly type?: string | undefined;
  readonly name?: string | undefined;
  readonly tasks?: readonly DeclaredTask[] | undefined;
}

/**
 * Full names (`suite > nested > test`) of the tests declared in a file,
 * matching what `expect.getState().currentTestName` reports.
 *
 * @param file - the file task; its own name is the path and is not part of a
 * full name.
 */
export function collectTestNames(file: DeclaredTask): ReadonlySet<string> {
  const names = new Set<string>();
  const visit = (task: DeclaredTask, prefix: readonly string[]): void => {
    const path = task.name === undefined ? prefix : [...prefix, task.name];
    if (task.type === 'test') {
      names.add(path.join(' > '));
      return;
    }
    for (const child of task.tasks ?? []) visit(child, path);
  };
  for (const child of file.tasks ?? []) visit(child, []);
  return names;
}
