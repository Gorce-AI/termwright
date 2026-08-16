/**
 * Turning a pristine framework into the instrumented copy, reproducibly.
 *
 * The patch set is deliberately tiny: one anchored insertion into
 * `application.go`, and one whole file added beside it. Everything that reads
 * private state lives in the added file, so a new framework release usually
 * moves the anchor rather than invalidating the instrumentation.
 *
 * Checksums are the point of the manifest. A patch applied to the wrong
 * version fails somewhere inside a diff context and reports a line number; a
 * checksum failure reports *what the file is*, which is the sentence a user can
 * act on. Both the before and the after state are pinned, so a copy that
 * applied cleanly but produced something unexpected is caught too.
 */

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { copyFile, cp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** One file the patch set edits in place. */
export interface PatchedFile {
  readonly path: string;
  readonly patch: string;
  readonly sha256Before: string;
  readonly sha256After: string;
}

/** One file the patch set adds. */
export interface AddedFile {
  readonly path: string;
  readonly source: string;
  readonly sha256: string;
}

/** What a patch set declares about itself. */
export interface PatchManifest {
  readonly framework: string;
  readonly frameworkVersion: string;
  readonly patchSetVersion: number;
  readonly note?: string;
  readonly patched: readonly PatchedFile[];
  readonly added: readonly AddedFile[];
}

/** Failures a user can act on, each naming what is actually wrong. */
export class PatchError extends Error {
  constructor(
    readonly code:
      | 'version-mismatch'
      | 'unexpected-result'
      | 'apply-failed'
      | 'git-missing'
      | 'manifest-invalid',
    message: string,
  ) {
    super(message);
    this.name = 'PatchError';
  }
}

/** `sha256:<hex>` of a file's bytes. */
export async function digestFile(path: string): Promise<string> {
  return `sha256:${createHash('sha256').update(await readFile(path)).digest('hex')}`;
}

/** Stable digest of the whole patch set, for the cache key. */
export async function digestPatchSet(dir: string): Promise<string> {
  const files: string[] = [];
  const walk = async (current: string): Promise<void> => {
    for (const entry of (await readdir(current)).sort()) {
      const full = join(current, entry);
      if ((await stat(full)).isDirectory()) await walk(full);
      else files.push(full);
    }
  };
  await walk(dir);

  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file.slice(dir.length));
    hash.update('\0');
    hash.update(await readFile(file));
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

/** Reads and shape-checks a manifest. */
export async function readManifest(dir: string): Promise<PatchManifest> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  } catch (error) {
    throw new PatchError(
      'manifest-invalid',
      `could not read ${join(dir, 'manifest.json')}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const manifest = parsed as PatchManifest;
  if (
    typeof manifest?.framework !== 'string' ||
    typeof manifest?.frameworkVersion !== 'string' ||
    !Array.isArray(manifest?.patched) ||
    !Array.isArray(manifest?.added)
  ) {
    throw new PatchError('manifest-invalid', 'manifest is missing required fields');
  }
  return manifest;
}

/**
 * Checks that `copyDir` holds exactly the framework this patch set expects.
 *
 * Runs before anything is written, so a mismatched version leaves the copy
 * untouched instead of half-patched.
 */
export async function verifyUpstream(copyDir: string, manifest: PatchManifest): Promise<void> {
  for (const file of manifest.patched) {
    const path = join(copyDir, file.path);
    let actual: string;
    try {
      actual = await digestFile(path);
    } catch {
      throw new PatchError(
        'version-mismatch',
        `${file.path} is missing from the copy, so this is not ${manifest.framework} ${manifest.frameworkVersion}`,
      );
    }
    if (actual !== file.sha256Before) {
      throw new PatchError(
        'version-mismatch',
        `${file.path} does not match ${manifest.framework} ${manifest.frameworkVersion} ` +
          `(expected ${file.sha256Before}, found ${actual}). ` +
          'The probe ships a patch set per framework version; this one cannot instrument the version on disk.',
      );
    }
  }
}

/**
 * Applies the patch set to a pristine copy and verifies the result.
 *
 * @param copyDir - a writable copy of the framework at the expected version.
 * @param patchSetDir - the directory holding `manifest.json`.
 */
export async function applyPatchSet(copyDir: string, patchSetDir: string): Promise<PatchManifest> {
  const manifest = await readManifest(patchSetDir);
  await verifyUpstream(copyDir, manifest);

  for (const file of manifest.patched) {
    const patch = join(patchSetDir, file.patch);
    try {
      await run('git', ['apply', '-p1', '--whitespace=nowarn', patch], { cwd: copyDir });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (/ENOENT/u.test(detail)) {
        throw new PatchError(
          'git-missing',
          'applying the patch set needs `git` on PATH; the Go toolchain requires it too, so this is usually a container missing it',
        );
      }
      throw new PatchError('apply-failed', `${file.patch} did not apply to ${file.path}: ${detail}`);
    }

    const actual = await digestFile(join(copyDir, file.path));
    if (actual !== file.sha256After) {
      throw new PatchError(
        'unexpected-result',
        `${file.path} applied cleanly but produced ${actual}, not the expected ${file.sha256After}`,
      );
    }
  }

  for (const file of manifest.added) {
    const target = join(copyDir, file.path);
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(patchSetDir, file.source), target);

    const actual = await digestFile(target);
    if (actual !== file.sha256) {
      throw new PatchError(
        'unexpected-result',
        `${file.path} was added but hashes ${actual}, not the expected ${file.sha256}`,
      );
    }
  }

  return manifest;
}

/**
 * Copies a module out of the read-only module cache into a writable directory.
 *
 * The cache is deliberately read-only — Go removes the write bit — so the
 * copy's permissions are restored as it lands.
 */
export async function materializeUpstream(from: string, to: string): Promise<void> {
  await cp(from, to, { recursive: true });

  const { chmod } = await import('node:fs/promises');
  const chmodAll = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir)) {
      const full = join(dir, entry);
      const info = await stat(full);
      if (info.isDirectory()) {
        await chmod(full, 0o755);
        await chmodAll(full);
      } else {
        await chmod(full, 0o644);
      }
    }
  };

  // The root first, and not only its contents. `cp` carries the cache's
  // read-only mode onto the destination directory itself, and a patch tool
  // needs to unlink and rewrite files *inside* it — which a r-xr-xr-x
  // directory refuses with "unable to unlink … Permission denied" even though
  // every file in it is writable.
  await chmod(to, 0o755);
  await chmodAll(to);
}

/** Writes a short record of what produced a copy, for humans reading the cache. */
export async function writeProvenance(copyDir: string, manifest: PatchManifest): Promise<void> {
  await writeFile(
    join(copyDir, 'TERMWRIGHT.md'),
    `# Instrumented copy\n\n` +
      `This is ${manifest.framework} ${manifest.frameworkVersion} with termwright's patch set ` +
      `v${manifest.patchSetVersion} applied. It is generated; edit the patch set, not this copy.\n`,
    'utf8',
  );
}
