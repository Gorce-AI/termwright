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
import { CharmPrepareError, CLIENT_MODULE, prepareInstrumentedBuild } from './launch.js';

const run = promisify(execFile);
const it = resourceAwareIt.resources({ hostPressure: 'exclusive' });
const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_V1 = join(here, 'testing', 'fixture-v1-bubbles');
const FIXTURE = join(here, 'testing', 'fixture-v2');
const roots: string[] = [];
const moduleCaches: string[] = [];

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
  const cacheResults = await Promise.allSettled(
    moduleCaches.splice(0).map((cache) =>
      run('go', ['clean', '-modcache'], {
        env: { ...process.env, GOMODCACHE: cache, GOWORK: 'off' },
      }),
    ),
  );
  const rootResults = await Promise.allSettled(
    roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
  const failures = [...cacheResults, ...rootResults]
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason);
  if (failures.length > 0) throw new AggregateError(failures, 'Charm test cleanup failed');
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
      'patch set v21 applied',
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
    const moduleCache = join(dir, 'gomodcache');
    moduleCaches.push(moduleCache);
    const env = {
      ...process.env,
      GOMODCACHE: moduleCache,
      GONOSUMDB: '*',
      GONOPROXY: '',
      GOPRIVATE: '',
      GOPROXY: 'https://proxy.golang.org',
      GOTOOLCHAIN: 'local',
      TERMWRIGHT_CACHE_DIR: join(dir, 'prefetch-cache'),
    };
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

  it('admits Bubbles by compiling the owned capability profile, never by a near-enough version guess', async () => {
    const dir = await scratch('tw-charm-launch-companion-');
    const app = join(dir, 'app');
    await writeModule(app, [
      'github.com/charmbracelet/bubbletea v1.3.10',
      'github.com/charmbracelet/bubbles v0.21.0',
    ]);
    const env = { ...process.env, TERMWRIGHT_CACHE_DIR: join(dir, 'cache') };

    const prepared = await prepareInstrumentedBuild({ moduleDir: app, env });
    expect(prepared.flavour.companions['github.com/charmbracelet/bubbles']).toBe('v0.21.0');
    expect(prepared.injectedModules).toEqual(['github.com/charmbracelet/bubbles']);
  }, 600_000);

  it('fails closed when a resolved Bubbles module lacks the owned private-state capability', async () => {
    const dir = await scratch('tw-charm-launch-incompatible-companion-');
    const app = join(dir, 'app');
    const bubbles = join(dir, 'bubbles');
    await writeModule(app, [
      'github.com/charmbracelet/bubbletea v1.3.10',
      'github.com/charmbracelet/bubbles v1.0.0',
    ]);
    await mkdir(bubbles, { recursive: true });
    await writeFile(
      join(bubbles, 'go.mod'),
      'module github.com/charmbracelet/bubbles\n\ngo 1.24.0\n',
      'utf8',
    );
    for (const name of ['spinner', 'progress', 'filepicker', 'list', 'table']) {
      const packageDir = join(bubbles, name);
      await mkdir(packageDir, { recursive: true });
      await writeFile(
        join(packageDir, `${name}.go`),
        `package ${name}\n\ntype Model struct{}\n`,
        'utf8',
      );
    }
    const goMod = await readFile(join(app, 'go.mod'), 'utf8');
    await writeFile(
      join(app, 'go.mod'),
      `${goMod}\nreplace github.com/charmbracelet/bubbles => ${JSON.stringify(bubbles)}\n`,
      'utf8',
    );
    const env = { ...process.env, TERMWRIGHT_CACHE_DIR: join(dir, 'cache') };
    await expect(prepareInstrumentedBuild({ moduleDir: app, env })).rejects.toMatchObject({
      code: 'unsupported-capability',
      module: 'github.com/charmbracelet/bubbles',
      version: 'v1.0.0',
    });
  }, 600_000);

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
