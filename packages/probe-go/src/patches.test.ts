/**
 * The patch set, applied to the real framework.
 *
 * The interesting assertions are the refusals: a wrong version must be named
 * as a wrong version before anything is written, and a copy that applied
 * cleanly but produced something unexpected must not be handed to a build.
 */

import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { goTestCapability } from '../../../scripts/test-support/go-toolchain.mjs';
import { canaryCheck, writeWorkspace } from './workspace.js';
import {
  applyPatchSet,
  ensureUpstreamModule,
  digestPatchSet,
  materializeUpstream,
  PatchError,
  readManifest,
  verifyUpstream,
} from './patches.js';

const run = promisify(execFile);

// A real patch set to exercise the machinery against. It belongs to
// probe-tview; this package owns the mechanism, not the framework.
const PATCH_SET = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'probe-tview',
  'upstream-patches',
  'tview',
  'v0.42.0',
);

/** The pristine module in the Go cache, or null when it is not downloaded. */
async function upstreamDir(): Promise<string | null> {
  return goTestCapability(async () => {
    // Fetches when the cache is cold, which is every fresh CI runner.
    return await ensureUpstreamModule({
      module: 'github.com/rivo/tview',
      version: 'v0.42.0',
      cachePath: ['github.com', 'rivo', 'tview@v0.42.0'],
    });
  }, null, 'required upstream Go module');
}

/**
 * Whether a Go toolchain can actually be run.
 *
 * Reading the opt-out variable alone assumes Go is present unless someone says
 * otherwise, which is false on any lane that installs Node and nothing else:
 * the arms then ran and died on `spawn go ENOENT`. Ask the toolchain instead of
 * assuming it — the same question `workspace.test.ts` already asks.
 */
async function goAvailable(): Promise<boolean> {
  return goTestCapability(async () => {
    await run('go', ['version']);
    return true;
  }, false, 'Go certification toolchain');
}

const hasGo = await goAvailable();
const upstream = await upstreamDir();
const roots: string[] = [];

/**
 * Removes a tree that may contain a Go module cache.
 *
 * The cold-cache test points `GOMODCACHE` at a scratch directory, and the
 * toolchain writes what it downloads read-only — directories included. Removing
 * a file needs write permission on its *parent*, so a plain `rm -rf` fails with
 * `EACCES … unlink CONTRIBUTING.md` on files that are themselves irrelevant.
 * The failure only appears once the download actually happened, which is why an
 * offline run never saw it.
 */
async function removeTree(dir: string): Promise<void> {
  try {
    await chmod(dir, 0o700);
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) await removeTree(join(dir, entry.name));
    }
  } catch {
    // Already gone, or never a directory: rm below settles it either way.
  }
  await rm(dir, { recursive: true, force: true });
}

afterAll(async () => {
  await Promise.all(roots.map(removeTree));
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

describe.skipIf(!hasGo)('a cold module cache', () => {
  it('fetches the upstream instead of failing on a missing directory', async () => {
    // What CI is: a runner that has never seen this module. Pointing
    // GOMODCACHE at an empty directory reproduces it exactly, and the old
    // code failed here with a bare ENOENT on a path nobody recognises.
    const dir = await scratch();
    const cache = join(dir, 'empty-cache');
    await mkdir(cache, { recursive: true });

    const request = {
      module: 'github.com/rivo/tview',
      version: 'v0.42.0',
      cachePath: ['github.com', 'rivo', 'tview@v0.42.0'],
      env: { ...process.env, GOMODCACHE: cache },
    } as const;
    const fetchedModules = await Promise.all([
      ensureUpstreamModule(request),
      ensureUpstreamModule(request),
      ensureUpstreamModule(request),
    ]);
    const [fetched] = fetchedModules;
    if (fetched === undefined) throw new Error('concurrent module download returned no directory');

    expect(new Set(fetchedModules).size).toBe(1);
    expect(fetched.startsWith(cache)).toBe(true);
    expect(await readFile(join(fetched, 'application.go'), 'utf8')).toContain('package tview');
  }, 600_000);

  it('names an unreachable upstream instead of leaking a path error', async () => {
    const dir = await scratch();
    const cache = join(dir, 'empty-cache');
    await mkdir(cache, { recursive: true });

    await expect(
      ensureUpstreamModule({
        module: 'github.com/rivo/tview',
        version: 'v0.0.0-does-not-exist',
        cachePath: ['github.com', 'rivo', 'tview@v0.0.0-does-not-exist'],
        env: { ...process.env, GOMODCACHE: cache, GOPROXY: 'off' },
      }),
    ).rejects.toThrow(/is not in the module cache and could not be downloaded/u);
  }, 600_000);
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

  it('produces the same bytes under a checkout configured for CRLF', async () => {
    // The Windows lane failed here and nowhere else: `core.autocrlf=true` is
    // the default on GitHub's Windows runners, and `git apply` then rewrites
    // the patched file with CRLF. It applies cleanly and fails the after-hash,
    // so one patch produced two results depending on the machine.
    //
    // Reproduced on any platform by pointing git at a global config that turns
    // it on: without the override this throws with the sha the Windows lane
    // reported.
    const dir = await scratch();
    const copy = join(dir, 'tview');
    await materializeUpstream(upstream as string, copy);

    const globalConfig = join(dir, 'gitconfig-crlf');
    await writeFile(globalConfig, '[core]\n\tautocrlf = true\n');
    const previous = process.env['GIT_CONFIG_GLOBAL'];
    process.env['GIT_CONFIG_GLOBAL'] = globalConfig;
    try {
      await applyPatchSet(copy, PATCH_SET);
    } finally {
      if (previous === undefined) delete process.env['GIT_CONFIG_GLOBAL'];
      else process.env['GIT_CONFIG_GLOBAL'] = previous;
    }

    const patched = await readFile(join(copy, 'application.go'), 'utf8');
    expect(patched).not.toContain('\r\n');
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
      suppliedUses: [{ dir: client, module: 'github.com/gorce-ai/termwright/clients/go' }],
      replaces: [
        { from: 'github.com/rivo/tview', to: copy },
        {
          from: 'github.com/gorce-ai/termwright/clients/go',
          to: client,
          version: 'v0.0.0',
        },
      ],
    });

    await expect(
      run('go', ['build', './...'], { cwd: app, env: { ...process.env, GOWORK: file } }),
    ).resolves.toBeDefined();
    await expect(
      run('go', ['build', './...'], {
        cwd: app,
        env: { ...process.env, GOWORK: file, GOOS: 'windows', GOARCH: 'amd64' },
      }),
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
    const harness = join(dir, 'harness');
    await mkdir(harness, { recursive: true });
    await writeFile(
      join(harness, 'go.mod'),
      'module example.com/probe-tests\n\ngo 1.24\n\nrequire github.com/rivo/tview v0.42.0\n',
      'utf8',
    );
    const file = await writeWorkspace(join(dir, 'probe.work'), {
      // Test the patched package through the same shape a user builds: tview
      // is the replaced dependency of an application module, while the local
      // protocol client is a workspace member with its full OS-specific graph.
      moduleDir: harness,
      inherited: { uses: [], replaces: [] },
      suppliedUses: [{ dir: client, module: 'github.com/gorce-ai/termwright/clients/go' }],
      replaces: [
        { from: 'github.com/rivo/tview', to: copy },
        {
          from: 'github.com/gorce-ai/termwright/clients/go',
          to: client,
          version: 'v0.0.0',
        },
      ],
    });

    const args = [
      'test',
      '-run',
      'Termwright|Probe|Stalled|Marker|Dormant',
      '-count=1',
      '-v',
      'github.com/rivo/tview',
    ];
    let stdout: string;
    try {
      ({ stdout } = await run('go', args, {
        cwd: harness,
        env: { ...process.env, GOWORK: file },
      }));
    } catch (error) {
      const processError = error as Error & { stdout?: string; stderr?: string };
      throw new Error(
        [processError.message, processError.stdout, processError.stderr].filter(Boolean).join('\n'),
        { cause: error },
      );
    }

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
