/**
 * The project's specs as a tree of directories.
 *
 * A flat list of paths is readable in a demo and useless in a real repository,
 * where `src/features/checkout/steps/pay.test.ts` differs from its neighbours
 * in the last segment and nowhere else. Grouping by directory puts the part
 * that differs at the front of the eye.
 *
 * Pure and browser-safe: the panel builds this from what it already has, and
 * the tests pin the shape without a filesystem.
 *
 * @packageDocumentation
 */

import type { UiTestStatus } from './events.js';
import type { TestRow } from './test-model.js';

/** What a run left behind for one spec file, newest first. */
export interface SpecRun {
  /** Manifest id, so a click can open that run. */
  readonly runId: string;
  readonly status: UiTestStatus;
}

/** Facts about one spec file that the panel shows beside its name. */
export interface SpecFacts {
  /** Absolute path, as the producer reported it. */
  readonly file: string;
  /** Last modification, in epoch milliseconds; `null` when unknown. */
  readonly modifiedMs: number | null;
  /** Mean duration across the runs the history holds; `null` when never run. */
  readonly averageMs: number | null;
  /** The last four runs that touched this file, newest first. */
  readonly latest: readonly SpecRun[];
}

/** A directory in the tree. */
export interface SpecDirectory {
  readonly kind: 'directory';
  /** Segment name, e.g. `checkout`. */
  readonly name: string;
  /** Path from the root, for keys and for the "run these" action. */
  readonly path: string;
  readonly children: readonly SpecNode[];
  /** Tests below this directory, at any depth. */
  readonly testCount: number;
}

/** A spec file in the tree. */
export interface SpecFile {
  readonly kind: 'file';
  readonly name: string;
  readonly path: string;
  readonly tests: readonly TestRow[];
  readonly facts: SpecFacts | undefined;
}

export type SpecNode = SpecDirectory | SpecFile;

/**
 * Groups tests into a directory tree.
 *
 * Directories with a single child are collapsed into one row (`src/features`
 * rather than `src` containing `features` containing everything): a chain of
 * one-child folders is indentation carrying no information.
 *
 * @param tests - every test the panel knows about.
 * @param facts - per-file metadata, keyed by the file path.
 * @param root - project directory, stripped from the front of each path. A
 * list of absolute paths is a list of one repeated prefix.
 */
export function buildSpecTree(
  tests: readonly TestRow[],
  facts: ReadonlyMap<string, SpecFacts> = new Map(),
  root = '',
): readonly SpecNode[] {
  const byFile = new Map<string, TestRow[]>();
  for (const test of tests) {
    const file = test.file ?? '';
    const list = byFile.get(file) ?? [];
    list.push(test);
    byFile.set(file, list);
  }

  const tree: MutableDirectory = { name: '', path: '', directories: new Map(), files: [] };
  for (const [file, rows] of byFile) {
    const segments = split(relativeTo(root, file));
    const name = segments.pop() ?? file;
    let node = tree;
    for (const segment of segments) {
      const next = node.directories.get(segment) ?? {
        name: segment,
        path: node.path === '' ? segment : `${node.path}/${segment}`,
        directories: new Map(),
        files: [],
      };
      node.directories.set(segment, next);
      node = next;
    }
    node.files.push({
      kind: 'file',
      name,
      path: file,
      tests: rows,
      facts: facts.get(file),
    });
  }

  return childrenOf(tree);
}

/** Directory being assembled. */
interface MutableDirectory {
  name: string;
  path: string;
  readonly directories: Map<string, MutableDirectory>;
  readonly files: SpecFile[];
}

/**
 * The rows of one level: directories first, then files, each sorted by name.
 *
 * The root is a level, not a directory — folding it into its single child is
 * what would turn `repo/src` at the top into whatever happens to be inside it.
 */
function childrenOf(node: MutableDirectory): SpecNode[] {
  return [
    ...[...node.directories.values()].sort(byName).map(collapse),
    ...node.files.slice().sort(byName),
  ];
}

/** Freezes a directory, collapsing single-child chains as it goes. */
function collapse(node: MutableDirectory): SpecDirectory {
  let current = node;
  // A directory holding exactly one directory and no files says nothing the
  // child does not; fold the two into one row and keep folding.
  while (current.files.length === 0 && current.directories.size === 1) {
    const only = [...current.directories.values()][0] as MutableDirectory;
    current = {
      name: current.name === '' ? only.name : `${current.name}/${only.name}`,
      path: only.path,
      directories: only.directories,
      files: only.files,
    };
  }

  const children = childrenOf(current);
  return {
    kind: 'directory',
    name: current.name,
    path: current.path,
    children,
    testCount: children.reduce(
      (total, child) => total + (child.kind === 'file' ? child.tests.length : child.testCount),
      0,
    ),
  };
}

function byName(left: { readonly name: string }, right: { readonly name: string }): number {
  return left.name.localeCompare(right.name);
}

/**
 * A path as it reads inside the project.
 *
 * Only a real prefix is removed: a spec outside the project — a linked package,
 * a generated file in a temp directory — keeps its absolute path, because
 * shortening it would put it in a folder it is not in.
 */
export function relativeTo(root: string, file: string): string {
  if (root === '') return file;
  const prefix = root.endsWith('/') || root.endsWith('\\') ? root : `${root}/`;
  return file.startsWith(prefix) ? file.slice(prefix.length) : file;
}

/** Splits a path on either separator, dropping empty segments. */
function split(path: string): string[] {
  return path.split(/[/\\]/).filter((segment) => segment !== '');
}

/**
 * How long ago something happened, in the words a person would use.
 *
 * The exact timestamp is in the `title`; this is the column, and "3 days ago"
 * answers "is this spec stale" faster than a date does.
 */
export function relativeTime(thenMs: number, nowMs: number): string {
  const seconds = Math.max(Math.round((nowMs - thenMs) / 1000), 0);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.round(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}
