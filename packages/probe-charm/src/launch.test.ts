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
import { afterAll, describe, expect, it } from 'vitest';
import { goTestCapability } from '../../../scripts/test-support/go-toolchain.mjs';
import { CharmDetectionError } from './detect.js';
import { CharmPrepareError, CLIENT_MODULE, prepareInstrumentedBuild } from './launch.js';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, 'testing', 'fixture-v2');
const roots: string[] = [];

async function goAvailable(): Promise<boolean> {
  return goTestCapability(async () => {
    await run('go', ['version']);
    return true;
  }, false, 'Go certification toolchain');
}

const hasGo = await goAvailable();

afterAll(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
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

describe.skipIf(!hasGo)('prepareInstrumentedBuild', () => {
  it('detects v2, instruments optional Bubbles, reuses both caches and never edits the app', async () => {
    const dir = await scratch('tw-charm-launch-');
    const app = join(dir, 'app');
    await mkdir(app, { recursive: true });
    await cp(FIXTURE, app, { recursive: true });
    const appAlias = join(dir, 'app-alias');
    await symlink(app, appAlias, process.platform === 'win32' ? 'junction' : 'dir');
    const before = await snapshot(app);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PWD: appAlias,
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
    expect(first.builtModules).toEqual([
      'charm.land/bubbletea/v2',
      'charm.land/bubbles/v2',
    ]);
    expect(first.companionCopyDirs['charm.land/bubbles/v2']).toContain('v2.1.1');
    expect(first.workspaceFile.startsWith(app)).toBe(false);
    expect(first.env['PWD']).toBe(first.moduleDir);
    expect(first.env['GOWORK']).toBe(first.workspaceFile);
    expect(env['GOWORK']).toBeUndefined();

    const workspace = await readFile(first.workspaceFile, 'utf8');
    expect(workspace).toContain(`replace charm.land/bubbletea/v2 => ${first.copyDir}`);
    expect(workspace).toContain(
      `replace charm.land/bubbles/v2 => ${first.companionCopyDirs['charm.land/bubbles/v2']}`,
    );
    const client = await realpath(join(here, '..', '..', '..', 'clients', 'go'));
    expect(workspace).toContain(`use ${client}`);
    expect(workspace).toContain(`replace ${CLIENT_MODULE} v0.0.0 => ${client}`);
    // The launcher must consume the current manifest, not resurrect an
    // older handshake/capability patch through a parallel launcher patch set.
    await expect(readFile(join(first.copyDir, 'TERMWRIGHT.md'), 'utf8')).resolves.toContain(
      "patch set v17 applied",
    );

    await run('go', ['build', '-o', join(dir, 'app-bin'), '.'], {
      cwd: first.moduleDir,
      env: first.env,
    });

    const second = await prepareInstrumentedBuild({ moduleDir: app, env });
    expect(second.built).toBe(false);
    expect(second.builtModules).toEqual([]);
    expect(second.copyDir).toBe(first.copyDir);
    expect(second.companionCopyDirs).toEqual(first.companionCopyDirs);
    expect(await snapshot(app)).toEqual(before);
  }, 900_000);

  it('selects the independent v1 Bubble Tea and Bubbles patch sets', async () => {
    const dir = await scratch('tw-charm-launch-v1-');
    const app = join(dir, 'app');
    await writeModule(
      app,
      [
        'github.com/charmbracelet/bubbletea v1.3.10',
        'github.com/charmbracelet/bubbles v1.0.0',
      ],
      `package main

import tea "github.com/charmbracelet/bubbletea"

type model struct{}
func (model) Init() tea.Cmd { return nil }
func (m model) Update(tea.Msg) (tea.Model, tea.Cmd) { return m, nil }
func (model) View() string { return "ready" }
func main() { _, _ = tea.NewProgram(model{}).Run() }
`,
    );
    // Give the ordinary build everything it needs before the no-mutation
    // snapshot. This setup operation is not part of the launcher.
    await run('go', ['mod', 'download'], { cwd: app, env: { ...process.env, GOWORK: 'off' } });
    const before = await snapshot(app);
    const env = { ...process.env, TERMWRIGHT_CACHE_DIR: join(dir, 'cache') };

    const prepared = await prepareInstrumentedBuild({ moduleDir: app, env });
    expect(prepared.flavour.major).toBe('v1');
    expect(prepared.copyDir).toContain('v1.3.10');
    expect(prepared.companionCopyDirs['github.com/charmbracelet/bubbles']).toContain('v1.0.0');

    await run('go', ['build', '-o', join(dir, 'app-bin'), '.'], {
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

  it('refuses an unpinned Bubbles companion instead of changing semantic breadth', async () => {
    const dir = await scratch('tw-charm-launch-companion-');
    const app = join(dir, 'app');
    await writeModule(app, [
      'github.com/charmbracelet/bubbletea v1.3.10',
      'github.com/charmbracelet/bubbles v0.21.0',
    ]);
    const env = { ...process.env, TERMWRIGHT_CACHE_DIR: join(dir, 'cache') };

    await expect(prepareInstrumentedBuild({ moduleDir: app, env })).rejects.toMatchObject({
      code: 'unsupported-version',
      module: 'github.com/charmbracelet/bubbles',
      version: 'v0.21.0',
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
