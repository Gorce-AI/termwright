/**
 * Seeding a test's working directory.
 *
 * A terminal program's input is mostly files: a config it reads at startup, a
 * project it opens, a database it migrates. Writing them by hand in every test
 * turns the interesting part of the test into `mkdir`/`writeFile` noise, and
 * putting them in a shared fixtures directory makes tests share state they were
 * supposed to be isolated from. Both are avoided by declaring the files inline,
 * per test, into the directory that already exists only for that test.
 */

import { cpSync, lstatSync, mkdirSync, readlinkSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** File contents to write. A string is written as UTF-8. */
export type SeedFile = string | Uint8Array;

/** Files to create in the test's directory, keyed by relative path. */
export type SeedFiles = Readonly<Record<string, SeedFile>>;

/** A directory to copy in before the files are written. */
export interface SeedTemplate {
  /** Directory to copy from; relative paths resolve against the test's cwd. */
  readonly from: string;
  /** Subdirectory of the test's directory to copy into. Default: the root. */
  readonly into?: string;
}

/** What {@link seedDirectory} was asked to create. */
export interface SeedOptions {
  readonly files?: SeedFiles;
  readonly template?: SeedTemplate | string;
}

/**
 * Creates the declared files inside `directory`.
 *
 * A template is copied first and the declared files are written over it, so a
 * test can take a whole project as its starting point and change the one file
 * it is about.
 *
 * @throws TypeError when a path would leave `directory`. A test that writes
 * outside its own directory is not isolated, and `../../.ssh/config` is the
 * kind of typo that should stop a run rather than land somewhere real.
 */
export function seedDirectory(directory: string, options: SeedOptions): readonly string[] {
  const root = resolve(directory);
  const written: string[] = [];

  const template = typeof options.template === 'string' ? { from: options.template } : options.template;
  if (template !== undefined) {
    const target = template.into === undefined ? root : safeJoin(root, template.into, 'template.into');
    const source = resolve(root, template.from);
    validateTemplateSymlinks(source);
    mkdirSync(target, { recursive: true });
    cpSync(source, target, { recursive: true, verbatimSymlinks: true });
    written.push(target);
  }

  for (const [path, contents] of Object.entries(options.files ?? {})) {
    const file = safeJoin(root, path, 'files');
    assertNoSymlinkTraversal(root, file, `files: ${JSON.stringify(path)}`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, contents);
    written.push(file);
  }
  return written;
}

/**
 * Preserves useful in-template relative links while refusing links whose
 * meaning after the copy would escape the per-attempt sandbox.
 */
function validateTemplateSymlinks(source: string): void {
  const sourceRoot = realpathSync(source);
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const target = readlinkSync(path);
        if (isAbsolute(target) || escapes(sourceRoot, resolve(dirname(path), target))) {
          throw new TypeError(`template symlink ${JSON.stringify(path)} escapes its template root`);
        }
      } else if (entry.isDirectory()) {
        visit(path);
      }
    }
  };
  visit(sourceRoot);
}

/** A declared override must never follow even a safe copied symlink. */
function assertNoSymlinkTraversal(root: string, target: string, what: string): void {
  const parts = relative(root, target).split(sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) {
        throw new TypeError(`${what} traverses a symlink inside the test directory`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }
}

function escapes(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === '..' || path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(path);
}

/** Joins a declared path onto the root, refusing anything that escapes it. */
function safeJoin(root: string, path: string, what: string): string {
  if (isAbsolute(path)) {
    throw new TypeError(`${what}: ${JSON.stringify(path)} must be relative to the test's directory`);
  }
  const target = resolve(join(root, path));
  const inside = relative(root, target);
  if (inside === '' || inside.startsWith('..')) {
    throw new TypeError(`${what}: ${JSON.stringify(path)} escapes the test's directory`);
  }
  return target;
}
