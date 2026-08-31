/** The public Charm launcher, including the parts a hand-assembled test misses. */

import { execFile } from 'node:child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect } from 'vitest';
import { it as resourceAwareIt } from '@termwright/resource-broker/vitest';
import { goTestCapability } from '../../../scripts/test-support/go-toolchain.mjs';
import { CharmDetectionError } from './detect.js';
import {
  CharmPrepareError,
  CLIENT_MODULE,
  prepareBubblesCapability,
  prepareInstrumentedBuild,
  type BubblesCapabilityPlan,
} from './launch.js';

const run = promisify(execFile);
const it = resourceAwareIt.resources({ hostPressure: 'exclusive' });
const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_V1 = join(here, 'testing', 'fixture-v1-bubbles');
const FIXTURE = join(here, 'testing', 'fixture-v2');
const roots: string[] = [];

async function goAvailable(): Promise<boolean> {
  return goTestCapability(
    async () => {
      await run('go', ['version']);
      return true;
    },
    false,
    'Go certification toolchain',
  );
}

const hasGo = await goAvailable();

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function scratch(prefix: string): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  roots.push(dir);
  return dir;
}

async function writeModule(
  dir: string,
  requires: readonly string[],
  source = 'package app\n',
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'go.mod'),
    `module example.com/app\n\ngo 1.24.0\n\n${requires
      .map((requirement) => `require ${requirement}\n`)
      .join('')}`,
    'utf8',
  );
  await writeFile(join(dir, 'main.go'), source, 'utf8');
}

async function snapshot(dir: string): Promise<Readonly<Record<string, Buffer>>> {
  const result: Record<string, Buffer> = {};
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else result[relative(dir, path)] = await readFile(path);
    }
  };
  await walk(dir);
  return result;
}

function workspacePath(path: string): string {
  return /[\s"]/u.test(path) ? JSON.stringify(path) : path;
}

describe.skipIf(!hasGo)('prepareInstrumentedBuild', () => {
  it('detects v2, injects optional Bubbles, reuses the Bubble Tea cache and never edits the app', async () => {
    const dir = await scratch('tw charm launch ');
    const app = join(dir, 'app');
    await mkdir(app, { recursive: true });
    await cp(FIXTURE, app, { recursive: true });
    const appAlias = join(dir, 'app-alias');
    await symlink(app, appAlias, process.platform === 'win32' ? 'junction' : 'dir');
    const before = await snapshot(app);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      TERMWRIGHT_CACHE_DIR: join(dir, 'cache'),
    };

    const first = await prepareInstrumentedBuild({ moduleDir: appAlias, env });
    expect(first.moduleDir).toBe(await realpath(app));
    expect(first.flavour).toMatchObject({
      major: 'v2',
      module: 'charm.land/bubbletea/v2',
      version: 'v2.0.8',
    });
    expect(first.built).toBe(true);
    expect(first.builtModules).toEqual(['charm.land/bubbletea/v2']);
    expect(first.goArgs).toEqual(['-toolexec', expect.any(String)]);
    expect(first.toolExecFile).toContain('bubbles-toolexec');
    expect(first.injectedModules).toEqual(['charm.land/bubbles/v2']);
    expect(first.workspaceFile.startsWith(app)).toBe(false);
    expect(first.env['PWD']).toBe(first.moduleDir);
    expect(first.env['GOWORK']).toBe(first.workspaceFile);
    expect(env['GOWORK']).toBeUndefined();

    const workspace = await readFile(first.workspaceFile, 'utf8');
    expect(workspace).toContain('replace charm.land/bubbletea/v2 =>');
    expect(workspace).toContain(
      `replace charm.land/bubbletea/v2 => ${workspacePath(first.copyDir)}`,
    );
    expect(workspace).not.toContain('replace charm.land/bubbles/v2');
    const client = await realpath(join(here, '..', '..', '..', 'clients', 'go'));
    expect(workspace).toContain(`use ${workspacePath(client)}`);
    expect(workspace).toContain(`replace ${CLIENT_MODULE} v0.0.0 => ${workspacePath(client)}`);
    // The launcher must consume the current manifest, not resurrect an
    // older handshake/capability patch through a parallel launcher patch set.
    await expect(readFile(join(first.copyDir, 'TERMWRIGHT.md'), 'utf8')).resolves.toContain(
      'patch set v23 applied',
    );

    await run('go', ['build', ...first.goArgs, '-o', join(dir, 'app-bin'), '.'], {
      cwd: first.moduleDir,
      env: first.env,
    });

    const second = await prepareInstrumentedBuild({ moduleDir: appAlias, env });
    expect(second.built).toBe(false);
    expect(second.builtModules).toEqual([]);
    expect(second.copyDir).toBe(first.copyDir);
    expect(second.goArgs).toEqual(first.goArgs);
    expect(second.toolExecFile).toBe(first.toolExecFile);
    expect(second.injectedModules).toEqual(first.injectedModules);
    expect(await snapshot(app)).toEqual(before);
  }, 900_000);

  it('selects the independent v1 Bubble Tea and Bubbles patch sets', async () => {
    const dir = await scratch('tw-charm-launch-v1-');
    const app = join(dir, 'app');
    await cp(FIXTURE_V1, app, { recursive: true });
    const moduleCache = await realpath(await mkdtemp(join(tmpdir(), 'tw-charm-modcache-')));
    const env = {
      ...process.env,
      // Go otherwise makes unpacked module directories read-only; keeping this
      // isolated cache writable lets Windows remove it atomically in `finally`.
      GOFLAGS: '-modcacherw',
      GOMODCACHE: moduleCache,
      GONOSUMDB: '*',
      GONOPROXY: '',
      GOPRIVATE: '',
      GOPROXY: 'https://proxy.golang.org',
      GOTOOLCHAIN: 'local',
      TERMWRIGHT_CACHE_DIR: join(dir, 'prefetch-cache'),
    };
    try {
      // Give the ordinary build everything it needs before the no-mutation
      // snapshot. The checked-in complete go.sum remains the hash authority while
      // GONOSUMDB removes the remote transparency service from the test path;
      // `all` warms every transitive module before launcher assertions. This
      // setup operation is not part of the launcher.
      const before = await snapshot(app);
      await run('go', ['mod', 'download', 'all'], {
        cwd: app,
        env: { ...env, GOWORK: 'off' },
      });
      const client = await realpath(join(here, '..', '..', '..', 'clients', 'go'));
      const clientManifest = await readFile(join(client, 'go.mod'));
      const clientSums = await readFile(join(client, 'go.sum'));
      await run('go', ['mod', 'download', 'all'], {
        cwd: client,
        env: { ...env, GOWORK: 'off' },
      });
      // Resolve the exact generated workspace graph once while the pinned proxy
      // is available. Go's lazy module loading can request historical go.mod
      // files which `go mod download all` deliberately omits. The certification
      // below uses a distinct Termwright cache with the proxy disabled.
      await prepareInstrumentedBuild({ moduleDir: app, env });
      const offlineEnv = {
        ...env,
        GOPROXY: 'off',
        TERMWRIGHT_CACHE_DIR: join(dir, 'cache'),
      };
      expect(await snapshot(app)).toEqual(before);
      await expect(readFile(join(client, 'go.mod'))).resolves.toEqual(clientManifest);
      await expect(readFile(join(client, 'go.sum'))).resolves.toEqual(clientSums);
      await run('go', ['mod', 'verify'], {
        cwd: app,
        env: { ...offlineEnv, GOWORK: 'off' },
      });
      await run('go', ['mod', 'verify'], {
        cwd: client,
        env: { ...offlineEnv, GOWORK: 'off' },
      });

      const prepared = await prepareInstrumentedBuild({
        moduleDir: app,
        env: offlineEnv,
      });
      expect(prepared.flavour.major).toBe('v1');
      expect(prepared.copyDir).toContain('v1.3.10');
      expect(prepared.goArgs).toEqual(['-toolexec', expect.any(String)]);
      expect(prepared.injectedModules).toEqual(['github.com/charmbracelet/bubbles']);

      await run('go', ['build', ...prepared.goArgs, '-o', join(dir, 'app-bin'), '.'], {
        cwd: prepared.moduleDir,
        env: prepared.env,
      });
      expect(await snapshot(app)).toEqual(before);
    } finally {
      await rm(moduleCache, { recursive: true, force: true });
    }
  }, 900_000);

  it('rejects an unsupported Bubble Tea version before selecting a near-enough patch', async () => {
    const dir = await scratch('tw-charm-launch-unsupported-');
    const app = join(dir, 'app');
    await writeModule(app, ['github.com/charmbracelet/bubbletea v1.3.9']);
    const before = await snapshot(app);

    const failure = prepareInstrumentedBuild({
      moduleDir: app,
      env: { ...process.env, TERMWRIGHT_CACHE_DIR: join(dir, 'cache') },
    });
    await expect(failure).rejects.toBeInstanceOf(CharmPrepareError);
    await expect(failure).rejects.toMatchObject({
      code: 'unsupported-version',
      module: 'github.com/charmbracelet/bubbletea',
      version: 'v1.3.9',
    });
    expect(await snapshot(app)).toEqual(before);
  }, 300_000);

  it('refuses a dual-major module instead of instrumenting one event loop', async () => {
    const dir = await scratch('tw-charm-launch-dual-');
    const app = join(dir, 'app');
    await writeModule(app, [
      'github.com/charmbracelet/bubbletea v1.3.10',
      'charm.land/bubbletea/v2 v2.0.8',
    ]);

    const failure = prepareInstrumentedBuild({ moduleDir: app });
    await expect(failure).rejects.toBeInstanceOf(CharmDetectionError);
    await expect(failure).rejects.toMatchObject({ code: 'both-majors' });
  }, 300_000);

  it('admits any Bubbles version only after the compiler service accepts the owned capability plan', async () => {
    const dir = await scratch('tw-charm-launch-companion-');
    const app = join(dir, 'app');
    await mkdir(app, { recursive: true });
    let receivedPlan: BubblesCapabilityPlan | undefined;
    let receivedBuild:
      | {
          readonly args: readonly string[];
          readonly cwd: string;
          readonly env: NodeJS.ProcessEnv;
        }
      | undefined;
    const preparedToolExec = {
      wrapperFile: join(dir, 'fake-toolexec'),
      configDigest: `sha256:${'0'.repeat(64)}`,
      goArgs: ['-toolexec', 'fake'] as const,
      env: { ...process.env, TW_PREPARED: 'true' },
      sources: [],
    };

    const prepared = await prepareBubblesCapability({
      moduleDir: app,
      major: 'v1',
      companions: { 'github.com/charmbracelet/bubbles': 'v0.21.0' },
      outputDir: join(dir, 'tool-exec'),
      env: process.env,
      compilerDependencies: {
        prepareToolExec: async (plan) => {
          receivedPlan = plan;
          return preparedToolExec;
        },
        runGo: async (args, options) => {
          receivedBuild = { args, ...options };
        },
      },
    });
    expect(prepared.module).toBe('github.com/charmbracelet/bubbles');
    expect(prepared.toolExec?.goArgs).toEqual(['-toolexec', 'fake']);
    expect(receivedPlan).toMatchObject({
      module: 'github.com/charmbracelet/bubbles',
      version: 'v0.21.0',
      moduleDir: app,
    });
    expect(receivedPlan?.units).toHaveLength(5);
    expect(receivedPlan?.units.map((unit) => unit.packagePath)).toEqual([
      'github.com/charmbracelet/bubbles/spinner',
      'github.com/charmbracelet/bubbles/progress',
      'github.com/charmbracelet/bubbles/filepicker',
      'github.com/charmbracelet/bubbles/list',
      'github.com/charmbracelet/bubbles/table',
    ]);
    for (const unit of receivedPlan?.units ?? []) {
      expect(unit.targetFile).toBe('zz_termwright_probe.go');
      expect(unit.sourceDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(unit.source.length).toBeGreaterThan(0);
    }
    expect(receivedBuild).toEqual({
      args: [
        'build',
        '-toolexec',
        'fake',
        'github.com/charmbracelet/bubbles/spinner',
        'github.com/charmbracelet/bubbles/progress',
        'github.com/charmbracelet/bubbles/filepicker',
        'github.com/charmbracelet/bubbles/list',
        'github.com/charmbracelet/bubbles/table',
      ],
      cwd: app,
      env: preparedToolExec.env,
    });
  });

  it('fails closed when the compiler rejects a resolved Bubbles private-state capability', async () => {
    const dir = await scratch('tw-charm-launch-incompatible-companion-');
    const app = join(dir, 'app');
    await mkdir(app, { recursive: true });

    await expect(
      prepareBubblesCapability({
        moduleDir: app,
        major: 'v1',
        companions: { 'github.com/charmbracelet/bubbles': 'v1.0.0' },
        outputDir: join(dir, 'tool-exec'),
        env: process.env,
        compilerDependencies: {
          prepareToolExec: async (plan) => ({
            wrapperFile: join(dir, 'fake-toolexec'),
            configDigest: `sha256:${'0'.repeat(64)}`,
            goArgs: ['-toolexec', 'fake'],
            env: plan.env,
            sources: [],
          }),
          runGo: async () => {
            throw new Error('synthetic private-state mismatch');
          },
        },
      }),
    ).rejects.toMatchObject({
      code: 'unsupported-capability',
      module: 'github.com/charmbracelet/bubbles',
      version: 'v1.0.0',
      message: expect.stringContaining('synthetic private-state mismatch'),
    });
  });

  it('refuses vendor mode instead of silently changing the dependency graph', async () => {
    const dir = await scratch('tw-charm-launch-vendor-');
    const app = join(dir, 'app');
    await writeModule(app, ['github.com/charmbracelet/bubbletea v1.3.10']);

    await expect(
      prepareInstrumentedBuild({
        moduleDir: app,
        env: { ...process.env, GOFLAGS: '-mod=vendor' },
      }),
    ).rejects.toThrow(/-mod=vendor/u);
  });
});
