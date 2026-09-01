#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, cp, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = process.env.TERMWRIGHT_REPOSITORY_ROOT
  ? resolve(process.env.TERMWRIGHT_REPOSITORY_ROOT)
  : join(dirname(fileURLToPath(import.meta.url)), '..');

// These three complete module graphs cover every Go package compiled by the
// ordinary test catalogue. Incomplete/minimal fixture modules deliberately do
// not participate: their dependencies are already present in one of these
// complete, checksum-pinned graphs.
export const GO_TEST_MODULES = Object.freeze([
  'clients/go',
  'packages/probe-charm/src/testing/fixture-v1-bubbles',
  'packages/probe-charm/src/testing/fixture-bubbles',
]);

// v2.0.9 is certified directly from its upstream module but is not the version
// selected by an application fixture. Materialise it explicitly before tests
// switch the proxy off.
export const UPSTREAM_BUILD_MODULES = Object.freeze([
  'github.com/charmbracelet/bubbletea@v1.3.9',
  'github.com/charmbracelet/bubbletea@v1.3.10',
  'charm.land/bubbletea/v2@v2.0.8',
  'charm.land/bubbletea/v2@v2.0.9',
  'github.com/charmbracelet/bubbles@v1.0.0',
  'charm.land/bubbles/v2@v2.1.1',
  'charm.land/lipgloss/v2@v2.0.6',
]);

export const BUBBLES_PACKAGE_PROBES = Object.freeze({
  'packages/probe-charm/src/testing/fixture-v1-bubbles': [
    'github.com/charmbracelet/bubbles/filepicker',
    'github.com/charmbracelet/bubbles/list',
    'github.com/charmbracelet/bubbles/progress',
    'github.com/charmbracelet/bubbles/spinner',
    'github.com/charmbracelet/bubbles/table',
  ],
  'packages/probe-charm/src/testing/fixture-bubbles': [
    'charm.land/bubbles/v2/filepicker',
    'charm.land/bubbles/v2/list',
    'charm.land/bubbles/v2/progress',
    'charm.land/bubbles/v2/spinner',
    'charm.land/bubbles/v2/table',
  ],
});

async function digest(path) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

async function makeWritable(directory) {
  await chmod(directory, 0o755);
  for (const entry of await readdir(directory)) {
    const path = join(directory, entry);
    const info = await stat(path);
    if (info.isDirectory()) await makeWritable(path);
    else await chmod(path, 0o644);
  }
}

async function materializeModuleGraph(cwd, environment) {
  const { stdout } = await run('go', ['mod', 'graph'], { cwd, env: environment });
  const modules = [
    ...new Set(
      stdout
        .split(/\s+/u)
        .filter(
          (entry) =>
            entry.includes('@') && !entry.startsWith('go@') && !entry.startsWith('toolchain@'),
        ),
    ),
  ].sort();
  if (modules.length > 0) {
    // An explicit version query materialises both the archive and go.mod even
    // for versions which lose MVS selection but remain observable graph edges.
    await run('go', ['mod', 'download', ...modules], { cwd, env: environment });
  }
}

async function downloadGraph(moduleDirectory, environment) {
  const source = join(root, moduleDirectory);
  const scratch = await mkdtemp(join(tmpdir(), 'tw-go-graph-'));
  const cwd = join(scratch, 'module');
  await cp(source, cwd, { recursive: true });
  const before = await Promise.all(
    ['go.mod', 'go.sum'].map(async (file) => [file, await digest(join(source, file))]),
  );
  const hermeticEnvironment = {
    ...environment,
    GOFLAGS: '-mod=readonly',
    GOTOOLCHAIN: environment.GOTOOLCHAIN ?? 'local',
    GOWORK: 'off',
  };
  try {
    await run('go', ['mod', 'download', 'all'], {
      cwd,
      env: hermeticEnvironment,
    });
    // `download all` follows versions selected by MVS. The launcher also asks
    // Go to inspect dependency packages from a generated workspace, which can
    // require historical go.mod files from losing graph edges. Reading the
    // complete graph materialises those edges before the network boundary.
    await materializeModuleGraph(cwd, hermeticEnvironment);
    await run('go', ['list', '-deps', './...'], { cwd, env: hermeticEnvironment });
    const probePackages = BUBBLES_PACKAGE_PROBES[moduleDirectory];
    if (probePackages !== undefined) {
      await run('go', ['list', '-f={{.ImportPath}}\t{{.Dir}}', ...probePackages], {
        cwd,
        env: hermeticEnvironment,
      });
    }
    await run('go', ['mod', 'verify'], { cwd, env: hermeticEnvironment });
    for (const [file, expected] of before) {
      const actual = await digest(join(cwd, file));
      if (actual !== expected) {
        throw new Error(`Go dependency preflight modified ${moduleDirectory}/${file}`);
      }
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function downloadExtraModules(environment) {
  for (const module of UPSTREAM_BUILD_MODULES) {
    const scratch = await mkdtemp(join(tmpdir(), 'tw-go-preflight-'));
    try {
      const separator = module.lastIndexOf('@');
      const modulePath = module.slice(0, separator);
      const version = module.slice(separator + 1);
      await writeFile(
        join(scratch, 'go.mod'),
        `module termwright.local/preflight\n\ngo 1.25\n\nrequire ${modulePath} ${version}\n`,
        'utf8',
      );
      const hermeticEnvironment = {
        ...environment,
        GOFLAGS: '',
        GOTOOLCHAIN: environment.GOTOOLCHAIN ?? 'local',
        GOWORK: 'off',
      };
      const downloaded = await run('go', ['mod', 'download', '-json', module], {
        cwd: scratch,
        env: { ...hermeticEnvironment, GOFLAGS: '' },
      });
      const upstream = JSON.parse(downloaded.stdout);
      if (upstream.Path !== modulePath || upstream.Version !== version || !upstream.Dir) {
        throw new Error(`Go did not materialise exact upstream module ${module}`);
      }
      const mainModule = join(scratch, 'upstream');
      await cp(upstream.Dir, mainModule, { recursive: true });
      await makeWritable(mainModule);
      await run('go', ['mod', 'download', 'all'], {
        cwd: mainModule,
        env: { ...hermeticEnvironment, GOFLAGS: '' },
      });
      await materializeModuleGraph(mainModule, hermeticEnvironment);
      await run('go', ['list', '-mod=readonly', '-deps', './...'], {
        cwd: mainModule,
        env: hermeticEnvironment,
      });
      await run('go', ['mod', 'verify'], { cwd: mainModule, env: hermeticEnvironment });
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
}

export async function prepareGoTestDependencies(environment = process.env) {
  // Deliberately sequential: the public module proxy is a setup dependency,
  // not a service every parallel Vitest worker should hammer independently.
  for (const moduleDirectory of GO_TEST_MODULES) {
    await downloadGraph(moduleDirectory, environment);
  }
  await downloadExtraModules(environment);

  // Prove that the declared closure, rather than an incidental open proxy, is
  // sufficient. This second pass starts from fresh module directories while
  // reusing only the cache populated above.
  const offlineEnvironment = {
    ...environment,
    GOPROXY: 'off',
    GOSUMDB: 'off',
    GOTOOLCHAIN: 'local',
  };
  for (const moduleDirectory of GO_TEST_MODULES) {
    await downloadGraph(moduleDirectory, offlineEnvironment);
  }
  await downloadExtraModules(offlineEnvironment);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await prepareGoTestDependencies();
  console.log('Go test dependency graph is materialised; test execution can run offline.');
}
