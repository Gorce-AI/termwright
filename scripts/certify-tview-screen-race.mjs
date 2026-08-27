import { execFile } from 'node:child_process';
import { chmod, cp, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { launchTerminal } from '../packages/driver/dist/index.js';
import { prepareInstrumentedBuild } from '../packages/probe-tview/dist/index.js';

const run = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtureApp = join(root, 'packages', 'probe-tview', 'src', 'testing', 'fixture-app');
const assets = join(root, 'packages', 'probe-tview', 'assets');
const client = await realpath(join(root, 'clients', 'go'));
const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), 'tw-tview-screen-race-')));
let terminal;
let certificationFailure;

async function removeWritableTree(path) {
  try {
    await run('chmod', ['-R', 'u+w', path]);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
}

async function waitForPairedSemanticRevision(session, minimum) {
  const deadline = performance.now() + 5_000;
  let checkpoint = session.checkpoint();
  for (;;) {
    if (
      checkpoint.semanticRevision !== null &&
      checkpoint.semanticRevision >= minimum &&
      checkpoint.pairedScreenRevision !== null
    ) {
      return;
    }
    checkpoint = await session.waitForCheckpointChange({
      after: checkpoint,
      timeout: Math.max(0, deadline - performance.now()),
    });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  // Resolve the exact version from the production fixture's build graph. The
  // copied module-cache tree is deliberately left otherwise byte-identical.
  const resolved = await run('go', ['mod', 'download', '-json', 'github.com/rivo/tview'], {
    cwd: fixtureApp,
  });
  const module = JSON.parse(resolved.stdout);
  if (typeof module.Dir !== 'string' || module.Dir === '') {
    throw new Error('go mod download did not return the tview source directory');
  }

  const fixture = join(temporaryRoot, 'tview');
  await cp(module.Dir, fixture, { recursive: true });
  await chmod(fixture, 0o755);
  await chmod(join(fixture, 'go.mod'), 0o644);
  await chmod(join(fixture, 'go.sum'), 0o644);

  const [probe, tests] = await Promise.all([
    readFile(join(assets, 'tview_probe.go.txt'), 'utf8'),
    readFile(join(assets, 'tview_probe_test.go.txt'), 'utf8'),
  ]);
  await Promise.all([
    writeFile(join(fixture, 'zz_termwright_probe.go'), probe, 'utf8'),
    writeFile(join(fixture, 'zz_termwright_probe_test.go'), tests, 'utf8'),
  ]);

  await run(
    'go',
    [
      'mod',
      'edit',
      '-require=github.com/gorce-ai/termwright/clients/go@v0.0.0',
      `-replace=github.com/gorce-ai/termwright/clients/go=${client}`,
    ],
    { cwd: fixture },
  );
  await run('go', ['mod', 'tidy'], { cwd: fixture });

  // Run the injected tests and the upstream package's own tests together.
  // `go test` (rather than a separately executed test binary) retains the race
  // detector's build and runtime checks in one fail-closed command.
  const result = await run('go', ['test', '-race', '-count=1', '.'], {
    cwd: fixture,
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);

  // Keep the full-process half of the former Vitest race test here: the unit
  // above proves the injected lifecycle under Go's race detector, while this
  // fixture proves that the same -race build attaches through a real PTY,
  // publishes an authoritative semantic frame, and exits cleanly. These are
  // causal product assertions, not a second timeout/retry path in the main
  // native-host run.
  const app = join(temporaryRoot, 'app');
  await cp(fixtureApp, app, { recursive: true });
  await run('go', ['mod', 'edit', `-replace=github.com/gorce-ai/termwright/clients/go=${client}`], {
    cwd: app,
  });
  await run('go', ['mod', 'tidy'], { cwd: app });

  const raceEnvironment = {
    ...process.env,
    GOFLAGS: [process.env.GOFLAGS, '-race'].filter(Boolean).join(' '),
  };
  const prepared = await prepareInstrumentedBuild({
    moduleDir: app,
    outputDir: join(temporaryRoot, 'tool'),
    env: raceEnvironment,
  });
  const binary = join(temporaryRoot, 'tview-race-fixture');
  await run('go', ['build', ...prepared.goArgs, '-o', binary, '.'], {
    cwd: prepared.moduleDir,
    env: prepared.env,
  });

  terminal = await launchTerminal({
    command: [binary],
    columns: 80,
    rows: 24,
  });
  await terminal.waitForText('readme.md');
  await waitForPairedSemanticRevision(terminal, 1);
  assert(terminal.semanticTree()?.v === 2, 'race fixture did not publish SemanticTreeV2');
  assert(
    (await terminal.getByRole('list', { name: 'Files' }).count()) === 1,
    'race fixture did not publish the Files list',
  );
  assert(
    (await terminal.getByRole('button', { name: 'Save' }).count()) === 1,
    'race fixture did not publish the Save button',
  );
  await terminal.press('q');
  const exit = await terminal.waitForExit();
  assert(exit.code === 0, `race fixture exited with code ${String(exit.code)}`);
  assert(
    !terminal.screen().text().includes('DATA RACE'),
    'Go race detector reported a data race in the full tview fixture',
  );
} catch (error) {
  certificationFailure = error;
} finally {
  const cleanupFailures = [];
  try {
    await terminal?.close();
  } catch (error) {
    cleanupFailures.push(error);
  }
  try {
    await removeWritableTree(temporaryRoot);
  } catch (error) {
    cleanupFailures.push(error);
  }
  if (cleanupFailures.length > 0) {
    throw new AggregateError(
      certificationFailure === undefined
        ? cleanupFailures
        : [certificationFailure, ...cleanupFailures],
      'tview race certification and cleanup failed',
    );
  }
}
if (certificationFailure !== undefined) throw certificationFailure;
