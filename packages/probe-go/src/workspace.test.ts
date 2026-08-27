/**
 * The workspace generator, including the two failures the Phase 0 audit
 * measured: a dropped `use` line breaking a multi-module build, and a redirect
 * that silently stops applying.
 *
 * The pure rendering tests always run. The ones that invoke `go` skip
 * themselves where no toolchain is installed, the same way the PTY suites do.
 */

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { it as resourceAwareIt } from '@termwright/resource-broker/vitest';
import { goTestCapability } from '../../../scripts/test-support/go-toolchain.mjs';
import {
  assertNoVendorMode,
  canaryCheck,
  readWorkspace,
  renderWorkspace,
  writeWorkspace,
  WorkspaceError,
} from './workspace.js';

const run = promisify(execFile);
const goIt = resourceAwareIt.resources({ hostPressure: 'exclusive' });

async function goAvailable(): Promise<string | null> {
  return goTestCapability(
    async () => {
      const { stdout } = await run('go', ['version']);
      return stdout.trim();
    },
    null,
    'Go certification toolchain',
  );
}

const toolchain = await goAvailable();
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tw-probe-tview-'));
  roots.push(dir);
  // Canonical, because Go compares module directories after resolving symlinks
  // and macOS hands out /var/folders/… for /private/var/folders/….
  return realpath(dir);
}

describe('rendering', () => {
  it('adds the module being built when the project has no workspace', () => {
    const rendered = renderWorkspace({
      moduleDir: '/proj/app',
      inherited: { uses: [], replaces: [] },
      replaces: [{ from: 'github.com/rivo/tview', to: '/cache/tview' }],
    });

    expect(rendered).toContain('use /proj/app');
    expect(rendered).toContain('replace github.com/rivo/tview => /cache/tview');
  });

  it('keeps every use the project already had', () => {
    // The regression the audit measured: dropping ./lib sends Go to the network
    // for a module that only exists on disk.
    const rendered = renderWorkspace({
      moduleDir: '/proj/app',
      inherited: {
        goVersion: '1.23',
        uses: [{ dir: '/proj/app' }, { dir: '/proj/lib' }],
        replaces: [],
      },
      replaces: [{ from: 'github.com/rivo/tview', to: '/cache/tview' }],
    });

    expect(rendered).toContain('use /proj/app');
    expect(rendered).toContain('use /proj/lib');
    expect(rendered).toContain('go 1.23');
    // Listed once, not twice, even though it is also the module being built.
    expect(rendered.match(/use \/proj\/app/gu)).toHaveLength(1);
  });

  it('carries the project replaces across but drops one that fights ours', () => {
    const rendered = renderWorkspace({
      moduleDir: '/proj/app',
      inherited: {
        uses: [{ dir: '/proj/app' }],
        replaces: [
          { from: 'example.com/other', to: '/proj/vendored/other' },
          { from: 'github.com/rivo/tview', to: '/proj/my-own-fork' },
        ],
      },
      replaces: [{ from: 'github.com/rivo/tview', to: '/cache/tview' }],
    });

    expect(rendered).toContain('replace example.com/other => /proj/vendored/other');
    expect(rendered).not.toContain('/proj/my-own-fork');
    expect(rendered).toContain('replace github.com/rivo/tview => /cache/tview');
  });

  it('quotes a path with spaces', () => {
    const rendered = renderWorkspace({
      moduleDir: '/Users/me/My Projects/app',
      inherited: { uses: [], replaces: [] },
      replaces: [{ from: 'github.com/rivo/tview', to: '/cache/tview' }],
    });

    expect(rendered).toContain('use "/Users/me/My Projects/app"');
  });
});

describe('the go directive', () => {
  it('takes the highest requirement, not the inherited one', () => {
    // A workspace older than any member is refused outright by the toolchain:
    // "module . listed in go.work file requires go >= 1.25.0, but go.work
    // lists go 1.24". Charm v2 is exactly that case.
    const rendered = renderWorkspace({
      moduleDir: '/proj/app',
      inherited: { goVersion: '1.22', uses: [], replaces: [] },
      replaces: [],
      fallbackGoVersion: '1.25.0',
    });

    expect(rendered).toContain('go 1.25.0');
  });

  it('keeps the inherited one when it is already the highest', () => {
    const rendered = renderWorkspace({
      moduleDir: '/proj/app',
      inherited: { goVersion: '1.24', uses: [], replaces: [] },
      replaces: [],
      fallbackGoVersion: '1.22',
    });

    expect(rendered).toContain('go 1.24');
  });

  it('orders versions numerically, so 1.10 beats 1.9', () => {
    const rendered = renderWorkspace({
      moduleDir: '/proj/app',
      inherited: { goVersion: '1.9', uses: [], replaces: [] },
      replaces: [],
      fallbackGoVersion: '1.10',
    });

    expect(rendered).toContain('go 1.10');
  });
});

describe('use and replace cannot name the same directory', () => {
  it('drops a use that points at something we redirect', () => {
    // Go refuses the combination outright: "workspace module … is replaced at
    // all versions in the go.work file". The replace is the one we need, since
    // a use does not satisfy a versioned require.
    const rendered = renderWorkspace({
      moduleDir: '/proj/app',
      inherited: {
        uses: [{ dir: '/proj/app' }, { dir: '/cache/bubbles', module: 'charm.land/bubbles/v2' }],
        replaces: [],
      },
      replaces: [{ from: 'charm.land/bubbles/v2', to: '/cache/bubbles' }],
    });

    expect(rendered).toContain('use /proj/app');
    expect(rendered).not.toContain('use /cache/bubbles');
    expect(rendered).toContain('replace charm.land/bubbles/v2 => /cache/bubbles');
  });

  it('keeps a use whose directory is a replacement target for a different module', () => {
    // Matched by module path, not by directory: redirecting some other module
    // at a used directory is legal and must not disturb the use.
    const rendered = renderWorkspace({
      moduleDir: '/proj/app',
      inherited: { uses: [{ dir: '/proj/lib', module: 'example.com/lib' }], replaces: [] },
      replaces: [{ from: 'example.com/absent', to: '/proj/lib' }],
    });

    expect(rendered).toContain('use /proj/lib');
  });

  it('keeps a supplied module beside an exact-version replacement', () => {
    const rendered = renderWorkspace({
      moduleDir: '/proj/app',
      inherited: { uses: [], replaces: [] },
      suppliedUses: [{ dir: '/sdk/client', module: 'example.com/client' }],
      replaces: [{ from: 'example.com/client', to: '/sdk/client', version: 'v0.1.0' }],
    });

    expect(rendered).toContain('use /sdk/client');
    expect(rendered).toContain('replace example.com/client v0.1.0 => /sdk/client');
  });
});

describe('vendor mode', () => {
  it('refuses -mod=vendor by name instead of overriding it', () => {
    expect(() => assertNoVendorMode({ GOFLAGS: '-mod=vendor' })).toThrow(WorkspaceError);
    try {
      assertNoVendorMode({ GOFLAGS: '-count=1 -mod=vendor' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(WorkspaceError);
      expect((error as WorkspaceError).code).toBe('vendor-mode');
      expect((error as WorkspaceError).message).toContain('-mod=vendor');
    }
  });

  it('allows other GOFLAGS through, including one that merely mentions vendor', () => {
    expect(() => assertNoVendorMode({})).not.toThrow();
    expect(() => assertNoVendorMode({ GOFLAGS: '-count=1' })).not.toThrow();
    expect(() => assertNoVendorMode({ GOFLAGS: '-mod=mod' })).not.toThrow();
    expect(() => assertNoVendorMode({ GOFLAGS: '-tags=vendor' })).not.toThrow();
  });
});

describe.skipIf(toolchain === null)('against a real toolchain', () => {
  goIt('reads no workspace from a plain module without calling it an error', async () => {
    const dir = await scratch();
    await writeFile(join(dir, 'go.mod'), 'module example.com/plain\n\ngo 1.22\n', 'utf8');

    const inherited = await readWorkspace(dir);

    expect(inherited.uses).toEqual([]);
    expect(inherited.replaces).toEqual([]);
  });

  goIt('reads the uses of a workspace and resolves them to absolute paths', async () => {
    const dir = await scratch();
    await mkdir(join(dir, 'app'), { recursive: true });
    await mkdir(join(dir, 'lib'), { recursive: true });
    await writeFile(join(dir, 'app', 'go.mod'), 'module example.com/app\n\ngo 1.22\n', 'utf8');
    await writeFile(join(dir, 'lib', 'go.mod'), 'module example.com/lib\n\ngo 1.22\n', 'utf8');
    await writeFile(join(dir, 'go.work'), 'go 1.22\n\nuse ./app\nuse ./lib\n', 'utf8');

    const inherited = await readWorkspace(join(dir, 'app'));

    expect(inherited.goVersion).toBe('1.22');
    expect(inherited.uses.map((entry) => entry.dir).sort()).toEqual(
      [join(dir, 'app'), join(dir, 'lib')].sort(),
    );
  });

  goIt(
    'builds a multi-module project through the generated workspace',
    async () => {
      // The end-to-end form of the rendering test above: this is the build that
      // failed with "unrecognized import path" when the generator invented a
      // workspace instead of inheriting one.
      const dir = await scratch();
      await mkdir(join(dir, 'app'), { recursive: true });
      await mkdir(join(dir, 'lib'), { recursive: true });
      await writeFile(
        join(dir, 'app', 'go.mod'),
        'module example.com/app\n\ngo 1.22\n\nrequire example.com/lib v0.0.0\n',
        'utf8',
      );
      await writeFile(
        join(dir, 'app', 'main.go'),
        'package main\n\nimport "example.com/lib"\n\nfunc main() { _ = lib.Hello() }\n',
        'utf8',
      );
      await writeFile(join(dir, 'lib', 'go.mod'), 'module example.com/lib\n\ngo 1.22\n', 'utf8');
      await writeFile(
        join(dir, 'lib', 'lib.go'),
        'package lib\n\nfunc Hello() string { return "hi" }\n',
        'utf8',
      );
      await writeFile(join(dir, 'go.work'), 'go 1.22\n\nuse ./app\nuse ./lib\n', 'utf8');

      const inherited = await readWorkspace(join(dir, 'app'));
      const file = await writeWorkspace(join(dir, 'generated.work'), {
        moduleDir: join(dir, 'app'),
        inherited,
        // Nothing to redirect in this fixture; the point is the inherited uses.
        replaces: [{ from: 'example.com/absent', to: join(dir, 'lib') }],
      });

      await expect(
        run('go', ['build', './...'], {
          cwd: join(dir, 'app'),
          env: { ...process.env, GOWORK: file },
        }),
      ).resolves.toBeDefined();
    },
    120_000,
  );

  goIt(
    'leaves go.mod, go.sum and the project workspace untouched',
    async () => {
      const dir = await scratch();
      await mkdir(join(dir, 'app'), { recursive: true });
      const gomod = 'module example.com/app\n\ngo 1.22\n';
      const gowork = 'go 1.22\n\nuse ./app\n';
      await writeFile(join(dir, 'app', 'go.mod'), gomod, 'utf8');
      await writeFile(join(dir, 'app', 'main.go'), 'package main\n\nfunc main() {}\n', 'utf8');
      await writeFile(join(dir, 'go.work'), gowork, 'utf8');

      const file = await writeWorkspace(join(dir, 'generated.work'), {
        moduleDir: join(dir, 'app'),
        inherited: await readWorkspace(join(dir, 'app')),
        replaces: [{ from: 'example.com/absent', to: join(dir, 'app') }],
      });
      await run('go', ['build', './...'], {
        cwd: join(dir, 'app'),
        env: { ...process.env, GOWORK: file },
      });

      const { readFile } = await import('node:fs/promises');
      expect(await readFile(join(dir, 'app', 'go.mod'), 'utf8')).toBe(gomod);
      expect(await readFile(join(dir, 'go.work'), 'utf8')).toBe(gowork);
      // A filesystem replace needs no checksum, so no go.work.sum is minted.
      await expect(readFile(join(dir, 'generated.work.sum'), 'utf8')).rejects.toThrow();
    },
    120_000,
  );

  goIt(
    'proves through the canary that the copy is what compiles',
    async () => {
      const dir = await scratch();
      await mkdir(join(dir, 'app'), { recursive: true });
      await mkdir(join(dir, 'copy'), { recursive: true });
      await writeFile(
        join(dir, 'copy', 'go.mod'),
        'module example.com/framework\n\ngo 1.22\n',
        'utf8',
      );
      await writeFile(
        join(dir, 'copy', 'framework.go'),
        'package framework\n\nfunc Version() string { return "instrumented" }\n',
        'utf8',
      );
      await writeFile(
        join(dir, 'app', 'go.mod'),
        'module example.com/app\n\ngo 1.22\n\nrequire example.com/framework v0.0.0\n',
        'utf8',
      );
      await writeFile(
        join(dir, 'app', 'main.go'),
        'package main\n\nimport "example.com/framework"\n\nfunc main() { _ = framework.Version() }\n',
        'utf8',
      );

      const file = await writeWorkspace(join(dir, 'generated.work'), {
        moduleDir: join(dir, 'app'),
        inherited: { uses: [], replaces: [] },
        replaces: [{ from: 'example.com/framework', to: join(dir, 'copy') }],
      });

      const result = await canaryCheck({
        copyDir: join(dir, 'copy'),
        moduleDir: join(dir, 'app'),
        workspaceFile: file,
        packageName: 'framework',
      });

      expect(result.proved).toBe(true);
      expect(result.detail).toContain('termwrightCanaryUndefinedOnPurpose');

      // And the build is healthy again once the canary file is gone.
      await expect(
        run('go', ['build', './...'], {
          cwd: join(dir, 'app'),
          env: { ...process.env, GOWORK: file },
        }),
      ).resolves.toBeDefined();
    },
    120_000,
  );

  goIt(
    'reports an unproved canary rather than throwing, when the redirect is not applied',
    async () => {
      const dir = await scratch();
      await mkdir(join(dir, 'app'), { recursive: true });
      await mkdir(join(dir, 'copy'), { recursive: true });
      await writeFile(
        join(dir, 'copy', 'go.mod'),
        'module example.com/unused\n\ngo 1.22\n',
        'utf8',
      );
      await writeFile(join(dir, 'app', 'go.mod'), 'module example.com/app\n\ngo 1.22\n', 'utf8');
      await writeFile(join(dir, 'app', 'main.go'), 'package main\n\nfunc main() {}\n', 'utf8');

      const file = await writeWorkspace(join(dir, 'generated.work'), {
        moduleDir: join(dir, 'app'),
        inherited: { uses: [], replaces: [] },
        // Redirects a module the app never imports: the copy is never compiled.
        replaces: [{ from: 'example.com/unused', to: join(dir, 'copy') }],
      });

      const result = await canaryCheck({
        copyDir: join(dir, 'copy'),
        moduleDir: join(dir, 'app'),
        workspaceFile: file,
        packageName: 'unused',
      });

      expect(result.proved).toBe(false);
      expect(result.detail).toContain('the copy is not what was compiled');
    },
    120_000,
  );
});
