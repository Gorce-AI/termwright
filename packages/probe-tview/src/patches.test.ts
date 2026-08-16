/**
 * The patch set, applied to the real framework.
 *
 * The interesting assertions are the refusals: a wrong version must be named
 * as a wrong version before anything is written, and a copy that applied
 * cleanly but produced something unexpected must not be handed to a build.
 */

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import {
  applyPatchSet,
  digestPatchSet,
  materializeUpstream,
  PatchError,
  readManifest,
  verifyUpstream,
} from './patches.js';

const run = promisify(execFile);

const PATCH_SET = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'upstream-patches',
  'tview',
  'v0.42.0',
);

/** The pristine module in the Go cache, or null when it is not downloaded. */
async function upstreamDir(): Promise<string | null> {
  if (process.env['TERMWRIGHT_SKIP_GO'] === '1') return null;
  try {
    const { stdout } = await run('go', ['env', 'GOMODCACHE']);
    const dir = join(stdout.trim(), 'github.com', 'rivo', 'tview@v0.42.0');
    await readFile(join(dir, 'application.go'));
    return dir;
  } catch {
    return null;
  }
}

const upstream = await upstreamDir();
const roots: string[] = [];

afterAll(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tw-patches-'));
  roots.push(dir);
  return realpath(dir);
}

describe('the manifest', () => {
  it('declares the framework and version it can instrument', async () => {
    const manifest = await readManifest(PATCH_SET);

    expect(manifest.framework).toBe('github.com/rivo/tview');
    expect(manifest.frameworkVersion).toBe('v0.42.0');
    expect(manifest.patched).toHaveLength(1);
    expect(manifest.patched[0]?.path).toBe('application.go');
    expect(manifest.added[0]?.path).toBe('termwright_probe.go');
  });

  it('digests to something stable that changes with its contents', async () => {
    const first = await digestPatchSet(PATCH_SET);
    const second = await digestPatchSet(PATCH_SET);

    expect(first).toBe(second);
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/u);

    // The digest feeds the cache key, so an edited patch must invalidate it.
    const copy = join(await scratch(), 'set');
    await materializeUpstream(PATCH_SET, copy);
    await writeFile(join(copy, 'patches', 'application.go.patch'), 'tampered\n', 'utf8');

    expect(await digestPatchSet(copy)).not.toBe(first);
  });
});

describe('refusals', () => {
  it('names a wrong version instead of failing inside a diff', async () => {
    const copy = join(await scratch(), 'tview');
    await mkdir(copy, { recursive: true });
    await writeFile(join(copy, 'application.go'), 'package tview\n// a different release\n', 'utf8');

    const manifest = await readManifest(PATCH_SET);

    await expect(verifyUpstream(copy, manifest)).rejects.toThrow(PatchError);
    await expect(verifyUpstream(copy, manifest)).rejects.toThrow(/does not match github.com\/rivo\/tview v0\.42\.0/u);
  });

  it('says which file is missing when the copy is not the framework at all', async () => {
    const copy = join(await scratch(), 'empty');
    await mkdir(copy, { recursive: true });

    await expect(verifyUpstream(copy, await readManifest(PATCH_SET))).rejects.toThrow(
      /application\.go is missing from the copy/u,
    );
  });

  it('leaves the copy untouched when the version check fails', async () => {
    const copy = join(await scratch(), 'tview');
    await mkdir(copy, { recursive: true });
    const original = 'package tview\n// a different release\n';
    await writeFile(join(copy, 'application.go'), original, 'utf8');

    await expect(applyPatchSet(copy, PATCH_SET)).rejects.toThrow(PatchError);

    expect(await readFile(join(copy, 'application.go'), 'utf8')).toBe(original);
    // And nothing was added alongside it.
    await expect(readFile(join(copy, 'termwright_probe.go'), 'utf8')).rejects.toThrow();
  });
});

describe.skipIf(upstream === null)('against the real framework', () => {
  it('applies to a pristine copy and lands the expected bytes', async () => {
    const copy = join(await scratch(), 'tview');
    await materializeUpstream(upstream as string, copy);

    const manifest = await applyPatchSet(copy, PATCH_SET);

    expect(manifest.frameworkVersion).toBe('v0.42.0');
    const patched = await readFile(join(copy, 'application.go'), 'utf8');
    expect(patched).toContain('termwrightAfterFrame(a, screen)');
    // Injected after the flush, which is the whole reason for the copy.
    expect(patched.indexOf('screen.Show()\n\n\t// Injected by termwright')).toBeGreaterThan(0);
    expect(await readFile(join(copy, 'termwright_probe.go'), 'utf8')).toContain('package tview');
  }, 120_000);

  it('compiles, and stays dormant without the handshake variables', async () => {
    const dir = await scratch();
    const copy = join(dir, 'tview');
    await materializeUpstream(upstream as string, copy);
    await applyPatchSet(copy, PATCH_SET);

    // `go vet` type-checks the package the same way a build would, without
    // needing a main package around it.
    await expect(run('go', ['vet', './...'], { cwd: copy })).resolves.toBeDefined();

    // Dormancy is a property of the source, so it is asserted on the source:
    // the constructor returns nil before anything is allocated.
    const probe = await readFile(join(copy, 'termwright_probe.go'), 'utf8');
    expect(probe).toContain('TERMWRIGHT_ENDPOINT');
    expect(probe).toContain('return nil');
  }, 180_000);

  it('is idempotent only through a fresh copy, and says so when it is not', async () => {
    const copy = join(await scratch(), 'tview');
    await materializeUpstream(upstream as string, copy);
    await applyPatchSet(copy, PATCH_SET);

    // Applying twice must not silently double the injection.
    await expect(applyPatchSet(copy, PATCH_SET)).rejects.toThrow(/does not match/u);
  }, 120_000);
});
