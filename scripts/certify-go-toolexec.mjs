import { execFile } from 'node:child_process';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { bindLocalTermwrightGoClient } from './certify-framework-candidate.mjs';

const run = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const probeGoEntry = join(root, 'packages', 'probe-go', 'dist', 'index.js');
const { digestGoToolExecSource, prepareGoToolExec } = await import(
  pathToFileURL(probeGoEntry).href
).catch((error) => {
  throw new Error(
    '@termwright/probe-go is not built; build it before running Go toolexec certification',
    { cause: error },
  );
});

const source = `package lib

func ProbeSecret(v Value) string { return v.secret }
`;
const extraSource = `package lib

import "unsafe"

func ProbeExtra(v Value) string {
	_ = unsafe.Sizeof(v)
	return "EXTRA:" + v.secret
}
`;
const units = [
  {
    packagePath: 'example.com/lib',
    targetFile: 'zz_termwright_probe.go',
    source,
    sourceDigest: digestGoToolExecSource(source),
  },
  {
    packagePath: 'example.com/lib',
    targetFile: 'zz_termwright_extra.go',
    source: extraSource,
    sourceDigest: digestGoToolExecSource(extraSource),
    imports: ['unsafe'],
  },
];

const temporaryRoot = await realpath(
  await mkdtemp(join(tmpdir(), 'tw-go-toolexec-certification-')),
);
let scratchIndex = 0;
let certificationFailure;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function errorText(error) {
  if (!(error instanceof Error)) return String(error);
  const stderr = 'stderr' in error ? String(error.stderr) : '';
  return `${error.message}\n${stderr}`;
}

async function expectFailure(operation, expected, description) {
  try {
    await operation();
  } catch (error) {
    if (typeof expected === 'string') {
      assert(
        error !== null && typeof error === 'object' && error.code === expected,
        `${description}: expected ${expected}, received ${errorText(error)}`,
      );
    } else {
      assert(
        expected.test(errorText(error)),
        `${description}: unexpected failure: ${errorText(error)}`,
      );
    }
    return;
  }
  throw new Error(`${description}: operation unexpectedly succeeded`);
}

async function scratch(label) {
  scratchIndex += 1;
  const directory = join(temporaryRoot, `${String(scratchIndex).padStart(2, '0')}-${label}`);
  await mkdir(directory, { recursive: true });
  return directory;
}

async function fixture(label, vendored = false) {
  const fixtureRoot = await scratch(label);
  const app = join(fixtureRoot, 'app');
  const lib = join(fixtureRoot, 'lib');
  const generated = join(fixtureRoot, 'generated tools');
  await mkdir(app, { recursive: true });
  await mkdir(lib, { recursive: true });
  await writeFile(join(lib, 'go.mod'), 'module example.com/lib\n\ngo 1.22\n', 'utf8');
  await writeFile(
    join(lib, 'lib.go'),
    'package lib\n\ntype Value struct { secret string }\nfunc NewValue() Value { return Value{secret: "seen"} }\n',
    'utf8',
  );
  await writeFile(
    join(app, 'go.mod'),
    `module example.com/app\n\ngo 1.22\n\nrequire example.com/lib v0.0.0\n\nreplace example.com/lib => ${JSON.stringify(lib)}\n`,
    'utf8',
  );
  await writeFile(
    join(app, 'main.go'),
    'package main\n\nimport "example.com/lib"\nfunc main() { v := lib.NewValue(); if lib.ProbeSecret(v)+"/"+lib.ProbeExtra(v) != "seen/EXTRA:seen" { panic("wrong probe result") } }\n',
    'utf8',
  );
  if (vendored) await run('go', ['mod', 'vendor'], { cwd: app });
  return { app, generated, lib };
}

async function hiddenImportFixture(label, value) {
  const fixtureRoot = await scratch(label);
  const lib = join(fixtureRoot, 'lib');
  const hidden = join(fixtureRoot, 'hidden');
  const generated = join(fixtureRoot, 'generated');
  await mkdir(lib, { recursive: true });
  await mkdir(hidden, { recursive: true });
  await writeFile(join(hidden, 'go.mod'), 'module example.com/hidden\n\ngo 1.22\n', 'utf8');
  await writeFile(
    join(hidden, 'hidden.go'),
    `package hidden\n\nfunc Value() string { return ${JSON.stringify(value)} }\n`,
    'utf8',
  );
  await writeFile(
    join(lib, 'go.mod'),
    `module example.com/lib\n\ngo 1.22\n\nrequire example.com/hidden v0.0.0\n\nreplace example.com/hidden => ${JSON.stringify(hidden)}\n`,
    'utf8',
  );
  await writeFile(join(lib, 'lib.go'), 'package lib\n', 'utf8');
  const importedSource = `package lib

import "example.com/hidden"

func ProbeHidden() string { return hidden.Value() }
`;
  return {
    generated,
    lib,
    unit: {
      packagePath: 'example.com/lib',
      targetFile: 'zz_termwright_hidden.go',
      source: importedSource,
      sourceDigest: digestGoToolExecSource(importedSource),
      imports: ['example.com/hidden'],
    },
  };
}

async function certify(name, operation) {
  process.stdout.write(`certify go toolexec: ${name}\n`);
  await operation();
}

try {
  await run('go', ['version']);

  // Real toolchain ownership belongs to this process-level certification, not
  // to Vitest's short unit-test callback budget. The command must finish before
  // the shared scratch root is removed, including on Windows where its cwd is locked.
  await certify('candidate client replacement transaction', async () => {
    const fixtureRoot = await scratch('candidate-client-replacement');
    const client = join(fixtureRoot, 'client');
    const app = join(fixtureRoot, 'app');
    await Promise.all([mkdir(client), mkdir(app)]);
    await writeFile(
      join(client, 'go.mod'),
      'module github.com/gorce-ai/termwright/clients/go\n\ngo 1.22\n',
      'utf8',
    );
    await writeFile(
      join(app, 'go.mod'),
      'module example.com/candidate\n\ngo 1.22\n\nrequire github.com/gorce-ai/termwright/clients/go v0.0.0\n',
      'utf8',
    );
    const canonicalClient = await realpath(client);
    const bound = await bindLocalTermwrightGoClient(app, process.env, client);
    assert(bound === canonicalClient, 'candidate certification bound a non-canonical Go client');
  });

  await certify('owned source digest refusal', async () => {
    const fixtureRoot = await scratch('source-mismatch');
    await expectFailure(
      () =>
        prepareGoToolExec({
          moduleDir: fixtureRoot,
          outputDir: join(fixtureRoot, 'out'),
          units: [{ ...units[0], sourceDigest: 'sha256:wrong' }],
        }),
      'source-mismatch',
      'changed owned digest',
    );
  });

  await certify('target and global tool-executor collision refusal', async () => {
    const { app, generated } = await fixture('collisions');
    await expectFailure(
      () =>
        prepareGoToolExec({ moduleDir: app, outputDir: generated, units: [units[0], units[0]] }),
      'target-collision',
      'duplicate owner',
    );
    await expectFailure(
      () =>
        prepareGoToolExec({
          moduleDir: app,
          outputDir: generated,
          units,
          env: { ...process.env, GOFLAGS: '-count=1 -toolexec=/tmp/foreign' },
        }),
      'toolexec-conflict',
      'competing global tool executor',
    );
  });

  await certify('build-selected unit refusal', async () => {
    const fixtureRoot = await scratch('build-selected');
    for (const invalid of [
      { ...units[0], source: `//go:build linux\n\n${source}` },
      { ...units[0], targetFile: 'zz_termwright_probe_windows.go' },
    ]) {
      const candidate = {
        ...invalid,
        sourceDigest: digestGoToolExecSource(invalid.source),
      };
      await expectFailure(
        () =>
          prepareGoToolExec({
            moduleDir: fixtureRoot,
            outputDir: join(fixtureRoot, 'out'),
            units: [candidate],
          }),
        'invalid-unit',
        'build-selected unit',
      );
    }
  });

  await certify('GOENV tool-executor collision refusal', async () => {
    const { app, generated } = await fixture('goenv-conflict');
    const goenvRoot = await scratch('goenv-file');
    const goenv = join(goenvRoot, 'go.env');
    await writeFile(goenv, 'GOFLAGS=-toolexec=/tmp/foreign\n', 'utf8');
    await expectFailure(
      () =>
        prepareGoToolExec({
          moduleDir: app,
          outputDir: generated,
          units,
          env: { ...process.env, GOENV: goenv, GOFLAGS: undefined },
        }),
      'toolexec-conflict',
      'GOENV tool executor',
    );
  });

  await certify('cross-compilation refusal', async () => {
    const { app, generated } = await fixture('cross-compile');
    const { stdout } = await run('go', ['env', 'GOHOSTOS']);
    const other = stdout.trim() === 'windows' ? 'linux' : 'windows';
    await expectFailure(
      () =>
        prepareGoToolExec({
          moduleDir: app,
          outputDir: generated,
          units,
          env: { ...process.env, GOOS: other },
        }),
      'cross-compilation',
      'cross-compiled wrapper',
    );
  });

  await certify('uninstrumented dependency namespace', async () => {
    const { app } = await fixture('uninstrumented');
    await expectFailure(
      () => run('go', ['run', '.'], { cwd: app }),
      /undefined: lib\.ProbeSecret/u,
      'uninstrumented dependency',
    );
  });

  await certify('read-only dependency materialisation', async () => {
    const { app, generated, lib } = await fixture('read-only');
    const dependency = join(lib, 'lib.go');
    const pristine = await readFile(dependency, 'utf8');
    await chmod(dependency, 0o444);
    await chmod(lib, 0o555);
    try {
      const prepared = await prepareGoToolExec({ moduleDir: app, outputDir: generated, units });
      assert(prepared.sources.length === 2, 'both owned units must be materialised');
      assert((await readFile(dependency, 'utf8')) === pristine, 'dependency source bytes changed');
    } finally {
      await chmod(lib, 0o755);
      await chmod(dependency, 0o644);
    }
  });

  await certify('injected accessor execution', async () => {
    const { app, generated } = await fixture('execute');
    const prepared = await prepareGoToolExec({ moduleDir: app, outputDir: generated, units });
    const { stdout, stderr } = await run('go', ['run', ...prepared.goArgs, '.'], {
      cwd: app,
      env: prepared.env,
    });
    assert(stdout === '' && stderr === '', 'instrumented application produced unexpected output');
  });

  await certify('vendor-mode dependency selection', async () => {
    const { app, generated } = await fixture('vendor', true);
    const env = { ...process.env, GOFLAGS: '-mod=vendor' };
    const dependency = join(app, 'vendor', 'example.com', 'lib', 'lib.go');
    const before = await readFile(dependency, 'utf8');
    const prepared = await prepareGoToolExec({ moduleDir: app, outputDir: generated, units, env });
    const { stdout, stderr } = await run('go', ['run', ...prepared.goArgs, '.'], {
      cwd: app,
      env: prepared.env,
    });
    assert(stdout === '' && stderr === '', 'vendor-mode application produced unexpected output');
    assert(
      (await readFile(dependency, 'utf8')) === before,
      'vendored dependency source bytes changed',
    );
  });

  await certify('compiler identity changes with owned content', async () => {
    const { app, generated } = await fixture('identity-content');
    const first = await prepareGoToolExec({
      moduleDir: app,
      outputDir: join(generated, 'first wrapper'),
      units,
    });
    const changed = source.replace('return v.secret', 'return "changed:" + v.secret');
    const second = await prepareGoToolExec({
      moduleDir: app,
      outputDir: join(generated, 'second wrapper'),
      units: [
        { ...units[0], source: changed, sourceDigest: digestGoToolExecSource(changed) },
        units[1],
      ],
    });
    assert(
      second.configDigest !== first.configDigest,
      'owned content did not change config identity',
    );
    const { stdout: toolDir } = await run('go', ['env', 'GOTOOLDIR']);
    const compiler = join(toolDir.trim(), process.platform === 'win32' ? 'compile.exe' : 'compile');
    const firstVersion = await run(first.wrapperFile, [compiler, '-V=full']);
    const secondVersion = await run(second.wrapperFile, [compiler, '-V=full']);
    assert(
      firstVersion.stdout.includes(first.configDigest),
      'first compiler identity omitted config digest',
    );
    assert(
      secondVersion.stdout.includes(second.configDigest),
      'second compiler identity omitted config digest',
    );
    assert(secondVersion.stdout !== firstVersion.stdout, 'changed compiler identities were equal');

    const fakeRoot = await scratch('fake-compiler');
    const fakeSource = join(fakeRoot, 'fake-compiler.mjs');
    const fakeCompiler = join(fakeRoot, process.platform === 'win32' ? 'compile.exe' : 'compile');
    await writeFile(fakeSource, 'console.log(process.argv.slice(2).join("\\n"));\n', 'utf8');
    if (process.platform === 'win32') await copyFile(process.execPath, fakeCompiler);
    else await symlink(process.execPath, fakeCompiler);
    const fakeImportCfg = join(fakeRoot, 'importcfg');
    await writeFile(fakeImportCfg, '', 'utf8');
    const invoke = (importPath) =>
      run(
        first.wrapperFile,
        [fakeCompiler, fakeSource, '-importcfg', fakeImportCfg, '--sentinel'],
        { env: { ...first.env, TOOLEXEC_IMPORTPATH: importPath } },
      );
    for (const importPath of ['example.com/lib', 'example.com/lib [example.com/lib.test]']) {
      const { stdout } = await invoke(importPath);
      assert(stdout.includes('--sentinel'), `wrapper dropped compiler argv for ${importPath}`);
      for (const owned of first.sources) {
        assert(stdout.includes(owned), `wrapper omitted owned source for ${importPath}`);
      }
    }
    for (const importPath of [
      'example.com/lib [foreign.test]',
      'example.com/lib [example.com/lib.test] suffix',
      'example.com/lib_test [example.com/lib.test]',
    ]) {
      const { stdout } = await invoke(importPath);
      assert(stdout.includes('--sentinel'), `wrapper dropped compiler argv for ${importPath}`);
      for (const owned of first.sources) {
        assert(!stdout.includes(owned), `wrapper widened package matching for ${importPath}`);
      }
    }
  });

  await certify('compiler identity ignores materialisation directory', async () => {
    const { app, generated } = await fixture('identity-directory');
    const first = await prepareGoToolExec({
      moduleDir: app,
      outputDir: join(generated, 'first location'),
      units,
    });
    const second = await prepareGoToolExec({
      moduleDir: app,
      outputDir: join(generated, 'second location'),
      units,
    });
    assert(
      second.configDigest === first.configDigest,
      'materialisation path changed config identity',
    );
    const { stdout: toolDir } = await run('go', ['env', 'GOTOOLDIR']);
    const compiler = join(toolDir.trim(), process.platform === 'win32' ? 'compile.exe' : 'compile');
    const firstVersion = await run(first.wrapperFile, [compiler, '-V=full']);
    const secondVersion = await run(second.wrapperFile, [compiler, '-V=full']);
    assert(
      secondVersion.stdout === firstVersion.stdout,
      'materialisation path changed compiler identity',
    );
  });

  await certify('compiler identity includes imported archives', async () => {
    const firstFixture = await hiddenImportFixture('import-first', 'first');
    const secondFixture = await hiddenImportFixture('import-second', 'second');
    const first = await prepareGoToolExec({
      moduleDir: firstFixture.lib,
      outputDir: firstFixture.generated,
      units: [firstFixture.unit],
    });
    const second = await prepareGoToolExec({
      moduleDir: secondFixture.lib,
      outputDir: secondFixture.generated,
      units: [secondFixture.unit],
    });
    assert(
      second.configDigest !== first.configDigest,
      'import archive did not change config identity',
    );
    const { stdout: toolDir } = await run('go', ['env', 'GOTOOLDIR']);
    const compiler = join(toolDir.trim(), process.platform === 'win32' ? 'compile.exe' : 'compile');
    const firstVersion = await run(first.wrapperFile, [compiler, '-V=full']);
    const secondVersion = await run(second.wrapperFile, [compiler, '-V=full']);
    assert(
      secondVersion.stdout !== firstVersion.stdout,
      'import archive did not change compiler identity',
    );
  });

  await certify('warm-cache owned source tamper refusal', async () => {
    const { app, generated } = await fixture('warm-cache');
    const prepared = await prepareGoToolExec({ moduleDir: app, outputDir: generated, units });
    const first = await run('go', ['run', ...prepared.goArgs, '.'], {
      cwd: app,
      env: prepared.env,
    });
    assert(first.stdout === '' && first.stderr === '', 'warm-cache priming run produced output');
    await writeFile(
      prepared.sources[0],
      source.replace('return v.secret', 'return "tampered"'),
      'utf8',
    );
    await expectFailure(
      () => run('go', ['run', ...prepared.goArgs, '.'], { cwd: app, env: prepared.env }),
      /injected source .* content differs from owned sha256:/u,
      'tampered warm-cache source',
    );
  });

  await certify('internal go test package namespace', async () => {
    const fixtureRoot = await scratch('internal-test');
    const lib = join(fixtureRoot, 'lib');
    const generated = join(fixtureRoot, 'generated tools');
    await mkdir(lib, { recursive: true });
    await writeFile(join(lib, 'go.mod'), 'module example.com/lib\n\ngo 1.22\n', 'utf8');
    await writeFile(
      join(lib, 'lib.go'),
      'package lib\n\ntype Value struct { secret string }\nfunc NewValue() Value { return Value{secret: "seen"} }\n',
      'utf8',
    );
    await writeFile(
      join(lib, 'lib_test.go'),
      'package lib\n\nimport "testing"\nfunc TestProbe(t *testing.T) { value := NewValue(); if ProbeSecret(value)+"/"+ProbeExtra(value) != "seen/EXTRA:seen" { t.Fatal("missing injected accessors") } }\n',
      'utf8',
    );
    const prepared = await prepareGoToolExec({ moduleDir: lib, outputDir: generated, units });
    const result = await run(
      'go',
      ['test', '-vet=off', '-count=1', '-run', '^TestProbe$', ...prepared.goArgs, '.'],
      { cwd: lib, env: prepared.env },
    );
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
  });
} catch (error) {
  certificationFailure = error;
} finally {
  try {
    await rm(temporaryRoot, { recursive: true, force: true });
  } catch (cleanupFailure) {
    throw new AggregateError(
      certificationFailure === undefined
        ? [cleanupFailure]
        : [certificationFailure, cleanupFailure],
      'Go toolexec certification and cleanup failed',
    );
  }
}

if (certificationFailure !== undefined) throw certificationFailure;
