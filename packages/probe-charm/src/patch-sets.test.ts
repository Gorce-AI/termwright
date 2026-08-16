/**
 * Both Charm patch sets, applied to the real frameworks and compiled.
 *
 * The two majors get separate patch sets because they are separate modules
 * with different shapes, and the test runs each rather than assuming the
 * second follows from the first.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  applyPatchSet,
  ensureUpstreamModule,
  materializeUpstream,
  writeWorkspace,
} from '@termwright/probe-go';
import { afterAll, describe, expect, it } from 'vitest';
import { BUBBLETEA_MODULES, type CharmMajor } from './detect.js';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(here, '..', '..', '..', 'clients', 'go');

/** Where each major's pristine source sits in the module cache. */
const UPSTREAM: Readonly<Record<CharmMajor, { version: string; path: readonly string[] }>> = {
  v1: { version: 'v1.3.10', path: ['github.com', 'charmbracelet', 'bubbletea@v1.3.10'] },
  v2: { version: 'v2.0.8', path: ['charm.land', 'bubbletea', 'v2@v2.0.8'] },
};

async function goAvailable(): Promise<boolean> {
  if (process.env['TERMWRIGHT_SKIP_GO'] === '1') return false;
  try {
    await run('go', ['version']);
    return true;
  } catch {
    return false;
  }
}

const hasGo = await goAvailable();
const roots: string[] = [];

afterAll(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
});

function patchSetFor(major: CharmMajor): string {
  return join(here, '..', 'upstream-patches', 'bubbletea', UPSTREAM[major].version);
}

async function instrumentedCopy(major: CharmMajor): Promise<{ copy: string; workspace: string }> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), `tw-charm-${major}-`)));
  roots.push(dir);

  const copy = join(dir, 'bubbletea');
  await materializeUpstream(
    await ensureUpstreamModule({
      module: BUBBLETEA_MODULES[major],
      version: UPSTREAM[major].version,
      cachePath: UPSTREAM[major].path,
    }),
    copy,
  );
  await applyPatchSet(copy, patchSetFor(major));

  const workspace = await writeWorkspace(join(dir, 'probe.work'), {
    moduleDir: copy,
    inherited: { uses: [], replaces: [] },
    replaces: [{ from: 'github.com/gorce-ai/termwright/clients/go', to: await realpath(CLIENT) }],
  });
  return { copy, workspace };
}

describe.skipIf(!hasGo)('the patch sets', () => {
  it('instruments v2 with a single anchor and compiles', async () => {
    const { copy, workspace } = await instrumentedCopy('v2');

    const tea = await readFile(join(copy, 'tea.go'), 'utf8');
    // v2 consolidated v1's three call sites into Program.render, so one hunk
    // covers the loop frame, the initial one and the final one.
    expect(tea.match(/termwrightAfterView\(p, model, view\)/gu)).toHaveLength(1);

    await expect(
      run('go', ['build', './...'], { cwd: copy, env: { ...process.env, GOWORK: workspace } }),
    ).resolves.toBeDefined();
  }, 900_000);

  it('instruments v1 at all three call sites and compiles', async () => {
    const { copy, workspace } = await instrumentedCopy('v1');

    const tea = await readFile(join(copy, 'tea.go'), 'utf8');
    // Three, and not because of style: v1 hands the renderer a string, so a
    // probe anchored in renderer.write would get the frame without the model
    // and have nothing to read. The model is only in scope where View() is
    // called.
    expect(tea.match(/termwrightRenderAndObserve\(p, model\)/gu)).toHaveLength(3);
    expect(tea).not.toContain('p.renderer.write(model.View())');

    await expect(
      run('go', ['build', './...'], { cwd: copy, env: { ...process.env, GOWORK: workspace } }),
    ).resolves.toBeDefined();
  }, 900_000);

  it('keeps the majors on separate patch sets, keyed by their own module path', async () => {
    const [v1, v2] = await Promise.all([
      readFile(join(patchSetFor('v1'), 'manifest.json'), 'utf8'),
      readFile(join(patchSetFor('v2'), 'manifest.json'), 'utf8'),
    ]);

    expect(JSON.parse(v1).framework).toBe(BUBBLETEA_MODULES.v1);
    expect(JSON.parse(v2).framework).toBe(BUBBLETEA_MODULES.v2);
  });

  it('refuses to apply one major to the other', async () => {
    // The checksums are what make this legible: without them the v1 patch
    // would fail somewhere inside a diff context on v2's tea.go.
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'tw-charm-cross-')));
    roots.push(dir);
    const copy = join(dir, 'bubbletea');
    await materializeUpstream(
      await ensureUpstreamModule({
        module: BUBBLETEA_MODULES.v2,
        version: UPSTREAM.v2.version,
        cachePath: UPSTREAM.v2.path,
      }),
      copy,
    );

    await expect(applyPatchSet(copy, patchSetFor('v1'))).rejects.toThrow(
      /does not match github\.com\/charmbracelet\/bubbletea v1\.3\.10/u,
    );
  }, 600_000);
});

describe.skipIf(!hasGo)('the Bubbles patch sets', () => {
  const BUBBLES: Readonly<Record<CharmMajor, { module: string; version: string; path: readonly string[] }>> = {
    v1: {
      module: 'github.com/charmbracelet/bubbles',
      version: 'v1.0.0',
      path: ['github.com', 'charmbracelet', 'bubbles@v1.0.0'],
    },
    v2: {
      module: 'charm.land/bubbles/v2',
      version: 'v2.1.1',
      path: ['charm.land', 'bubbles', 'v2@v2.1.1'],
    },
  };

  it.each(['v1', 'v2'] as const)('adds accessors to %s and still compiles', async (major) => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), `tw-bubbles-${major}-`)));
    roots.push(dir);

    const copy = join(dir, 'bubbles');
    await materializeUpstream(
      await ensureUpstreamModule({
        module: BUBBLES[major].module,
        version: BUBBLES[major].version,
        cachePath: BUBBLES[major].path,
      }),
      copy,
    );
    await applyPatchSet(copy, join(here, '..', 'upstream-patches', 'bubbles', BUBBLES[major].version));

    const workspace = await writeWorkspace(join(dir, 'bubbles.work'), {
      moduleDir: copy,
      inherited: { uses: [], replaces: [] },
      replaces: [],
    });

    await expect(
      run('go', ['build', './...'], { cwd: copy, env: { ...process.env, GOWORK: workspace } }),
    ).resolves.toBeDefined();
  }, 900_000);

  it('edits no upstream file in either major', async () => {
    // Accessors are added, never spliced in. That is why a Bubbles bump costs
    // nothing here: there is no diff context to drift.
    for (const major of ['v1', 'v2'] as const) {
      const manifest = JSON.parse(
        await readFile(
          join(here, '..', 'upstream-patches', 'bubbles', BUBBLES[major].version, 'manifest.json'),
          'utf8',
        ),
      );
      expect(manifest.patched).toEqual([]);
      expect(manifest.added).toHaveLength(5);
    }
  });
});

describe.skipIf(hasGo)('the patch-set arms', () => {
  it('skips because no go toolchain is reachable', () => {
    expect(hasGo).toBe(false);
  });
});
