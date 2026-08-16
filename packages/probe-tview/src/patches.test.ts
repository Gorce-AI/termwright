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
import { canaryCheck, writeWorkspace } from './workspace.js';
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
    // Two files: the anchored hook, and the go.mod line that lets the probe
    // import the protocol client instead of reimplementing framing.
    expect(manifest.patched.map((file) => file.path)).toEqual(['application.go', 'go.mod']);
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

// Runs exactly when the Go arms do not, so a reduced run says so instead of
// looking fully green. Borrowed from probe-opentui's Bun lane.
it.skipIf(upstream !== null)('skips the Go arms because no go toolchain is reachable', () => {
  expect(upstream).toBeNull();
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

  it('leaves the copy dormant without the handshake variables', async () => {
    const dir = await scratch();
    const copy = join(dir, 'tview');
    await materializeUpstream(upstream as string, copy);
    await applyPatchSet(copy, PATCH_SET);

    // Dormancy is delegated to the client's own FromEnv, so there is one
    // definition of "not instrumented" rather than a second one here that
    // could drift. Compilation is proven by the application test below.
    const probe = await readFile(join(copy, 'termwright_probe.go'), 'utf8');
    expect(probe).toContain('protocol.FromEnv');
    expect(probe).toMatch(/if client == nil \{\n\t\treturn nil/u);
  }, 180_000);

  it('catches a patch that applies cleanly but produces the wrong bytes', async () => {
    // Deliberate sabotage, because a checksum test that cannot fail is not a
    // test. The patch still applies — only its inserted text differs — so the
    // before-hash passes and only the after-hash can catch this.
    const dir = await scratch();
    const set = join(dir, 'set');
    await materializeUpstream(PATCH_SET, set);
    const patchFile = join(set, 'patches', 'application.go.patch');
    const tampered = (await readFile(patchFile, 'utf8')).replace(
      'Injected by termwright',
      'Injected by someone else',
    );
    await writeFile(patchFile, tampered, 'utf8');

    const copy = join(dir, 'tview');
    await materializeUpstream(upstream as string, copy);

    await expect(applyPatchSet(copy, set)).rejects.toThrow(/applied cleanly but produced/u);
  }, 120_000);

  it('catches an added file whose contents were swapped', async () => {
    const dir = await scratch();
    const set = join(dir, 'set');
    await materializeUpstream(PATCH_SET, set);
    await writeFile(
      join(set, 'add', 'termwright_probe.go'),
      'package tview\n\n// not the probe that was signed for\n',
      'utf8',
    );

    const copy = join(dir, 'tview');
    await materializeUpstream(upstream as string, copy);

    await expect(applyPatchSet(copy, set)).rejects.toThrow(/hashes sha256:.*not the expected/u);
  }, 120_000);

  it('compiles a real tview application against the instrumented copy', async () => {
    // The end-to-end shape of the whole slice: an application that imports
    // plain `github.com/rivo/tview` is built through the generated workspace
    // and gets the patched package, including the probe's own dependency on
    // the protocol client.
    const dir = await scratch();
    const copy = join(dir, 'tview');
    await materializeUpstream(upstream as string, copy);
    await applyPatchSet(copy, PATCH_SET);

    const app = join(dir, 'app');
    await mkdir(app, { recursive: true });
    await writeFile(
      join(app, 'go.mod'),
      'module example.com/app\n\ngo 1.22\n\nrequire github.com/rivo/tview v0.42.0\n',
      'utf8',
    );
    await writeFile(
      join(app, 'main.go'),
      'package main\n\nimport "github.com/rivo/tview"\n\n' +
        'func main() {\n\tapp := tview.NewApplication()\n' +
        '\tapp.SetRoot(tview.NewBox().SetTitle("hi"), true)\n}\n',
      'utf8',
    );

    const client = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'clients', 'go');
    const file = await writeWorkspace(join(dir, 'generated.work'), {
      moduleDir: app,
      inherited: { uses: [], replaces: [] },
      replaces: [
        { from: 'github.com/rivo/tview', to: copy },
        // A `use` entry does not satisfy a versioned require; the client has
        // to be replaced, exactly like the framework.
        { from: 'github.com/gorce-ai/termwright/clients/go', to: client },
      ],
    });

    await expect(
      run('go', ['build', './...'], { cwd: app, env: { ...process.env, GOWORK: file } }),
    ).resolves.toBeDefined();

    // And the canary proves it was our copy that compiled, not the cache.
    const canary = await canaryCheck({
      copyDir: copy,
      moduleDir: app,
      workspaceFile: file,
      packageName: 'tview',
    });
    expect(canary.proved).toBe(true);
  }, 300_000);

  it('runs the probe suite that ships with the patch set', async () => {
    // The Go tests live in the patch set because they need the probe's
    // internals, which exist only inside the copy. Running them from here is
    // what keeps them from rotting unnoticed.
    const dir = await scratch();
    const copy = join(dir, 'tview');
    await materializeUpstream(upstream as string, copy);
    await applyPatchSet(copy, PATCH_SET);

    const client = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'clients', 'go');
    const file = await writeWorkspace(join(dir, 'probe.work'), {
      moduleDir: copy,
      inherited: { uses: [], replaces: [] },
      replaces: [{ from: 'github.com/gorce-ai/termwright/clients/go', to: client }],
    });

    const { stdout } = await run(
      'go',
      ['test', '-run', 'Termwright|Probe|Stalled|Marker|Dormant', '-count=1', '-v', '.'],
      { cwd: copy, env: { ...process.env, GOWORK: file } },
    );

    // Named, so a suite that quietly stopped covering the stall is visible.
    expect(stdout).toContain('PASS: TestAStalledDriverCostsFramesAndNotTheApplication');
    expect(stdout).toContain('PASS: TestAFailedPublishWritesNoMarker');
    expect(stdout).toContain('PASS: TestTheProbeIsDormantWithoutTheHandshakeVariables');
    // A skip here means the socket buffer swallowed everything and the stall
    // was never exercised; that is a gap, not a pass.
    expect(stdout).not.toContain('SKIP: TestAStalledDriverCostsFramesAndNotTheApplication');
  }, 300_000);

  it('is idempotent only through a fresh copy, and says so when it is not', async () => {
    const copy = join(await scratch(), 'tview');
    await materializeUpstream(upstream as string, copy);
    await applyPatchSet(copy, PATCH_SET);

    // Applying twice must not silently double the injection.
    await expect(applyPatchSet(copy, PATCH_SET)).rejects.toThrow(/does not match/u);
  }, 120_000);
});
