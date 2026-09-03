import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { readQuickstartContract } from './docs-contract.mjs';

const execute = promisify(execFile);
const installRoot = resolve(process.argv[2] ?? process.cwd());
const project = await mkdtemp(join(installRoot, 'termwright-clean-room-'));
const quickstart = await readQuickstartContract();

try {
  await mkdir(join(project, 'tests'));
  await Promise.all([
    writeFile(
      join(project, 'package.json'),
      `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`,
      'utf8',
    ),
    writeFile(join(project, 'app.mjs'), quickstart.app, 'utf8'),
    writeFile(join(project, 'tests', 'permission.test.ts'), quickstart.docsTest, 'utf8'),
    writeFile(
      join(project, 'unicode-app.mjs'),
      [
        "import readline from 'node:readline';",
        'readline.emitKeypressEvents(process.stdin);',
        'process.stdin.setRawMode?.(true);',
        "process.stdout.write('Unicode: 👨‍👩‍👧‍👦 देवनागरी 界\\n[Approve]\\n');",
        "process.stdin.once('keypress', (_input, key) => {",
        "  if (key.name === 'return') { process.stdout.write('approved\\n'); process.exit(0); }",
        '});',
      ].join('\n'),
      'utf8',
    ),
    writeFile(
      join(project, 'setup.mjs'),
      [
        "import { configureTermwright } from 'termwright/test';",
        "configureTermwright({ outputDir: 'artifacts', trace: 'on' });",
      ].join('\n'),
      'utf8',
    ),
    writeFile(
      join(project, 'vitest.config.mjs'),
      [
        "import { defineConfig } from 'vitest/config';",
        "export default defineConfig({ test: { include: ['**/*.test.{mjs,ts}'], setupFiles: ['./setup.mjs'], testTimeout: 15000 } });",
      ].join('\n'),
      'utf8',
    ),
    writeFile(
      join(project, 'user-vitest.test.mjs'),
      [
        "import { expect, test } from 'vitest';",
        "test('user Vitest remains independently discoverable', () => expect(2 + 2).toBe(4));",
      ].join('\n'),
      'utf8',
    ),
    writeFile(
      join(project, 'terminal.test.mjs'),
      [
        "import { fileURLToPath } from 'node:url';",
        "import { expect, test } from 'termwright/test';",
        "const program = fileURLToPath(new URL('./unicode-app.mjs', import.meta.url));",
        "test.resources({ terminals: 1, traceWriters: 1 })('drives a packed Unicode TUI', async ({ terminal }) => {",
        '  const app = await terminal.launch({ command: [process.execPath, program] });',
        "  await app.waitForText('Unicode: 👨‍👩‍👧‍👦 देवनागरी 界');",
        "  expect(app.screen().text()).toContain('[Approve]');",
        "  await app.press('Enter');",
        "  await expect(app).toHaveText('approved');",
        '});',
      ].join('\n'),
      'utf8',
    ),
  ]);

  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const environment = {
    ...process.env,
    TERMWRIGHT_RETRIES: '0',
    TERMWRIGHT_UPDATE_SNAPSHOTS: 'none',
  };
  await execute(npx, ['--no-install', 'termwright', 'doctor'], {
    cwd: project,
    env: environment,
    timeout: 60_000,
  });
  const execution = await execute(npx, ['--no-install', 'termwright', 'test'], {
    cwd: project,
    env: environment,
    timeout: 60_000,
  });

  const runDirectories = await readdir(join(project, '.termwright', 'runs'));
  if (runDirectories.length !== 1) {
    throw new Error(`packed host wrote ${runDirectories.length} run directories`);
  }
  const manifest = JSON.parse(
    await readFile(
      join(project, '.termwright', 'runs', runDirectories[0], 'manifest.json'),
      'utf8',
    ),
  );
  if (
    manifest.v !== 8 ||
    manifest.status !== 'passed' ||
    manifest.specs?.length !== 3 ||
    manifest.eventStream?.file !== 'events.ndjson' ||
    manifest.eventStream?.count < 1 ||
    manifest.telemetry?.coordinatorRssStartBytes <= 0 ||
    manifest.telemetry?.terminalOutputBytes <= 0 ||
    manifest.telemetry?.traceBytes <= 0 ||
    manifest.telemetry?.finalArtifactBytes <= 0
  ) {
    throw new Error(`packed host manifest failed certification: ${JSON.stringify(manifest)}`);
  }
  const eventBytes = await readFile(
    join(project, '.termwright', 'runs', runDirectories[0], 'events.ndjson'),
  );
  const eventCount = eventBytes.toString('utf8').trimEnd().split('\n').length;
  if (
    eventBytes.byteLength !== manifest.eventStream.bytes ||
    eventCount !== manifest.eventStream.count ||
    createHash('sha256').update(eventBytes).digest('hex') !== manifest.eventStream.sha256
  ) {
    throw new Error('packed host run-event stream differs from its manifest commitment');
  }
  const events = eventBytes.toString('utf8').trimEnd().split('\n').map(JSON.parse);
  const traceResources = events
    .filter((event) => event.type === 'trace.resource')
    .map((event) => event.payload);
  if (traceResources.length !== 2) {
    throw new Error(`packed host wrote ${traceResources.length} trace resource records`);
  }
  for (const metric of [
    'terminalOutputBytes',
    'semanticBytes',
    'semanticFullCount',
    'semanticDeltaCount',
    'traceBytes',
    'finalArtifactBytes',
  ]) {
    const total = traceResources.reduce((sum, resource) => sum + resource[metric], 0);
    if (manifest.telemetry[metric] !== total) {
      throw new Error(`packed host ${metric} differs from canonical trace resource evidence`);
    }
  }

  const traces = (await readdir(join(project, 'artifacts', 'traces'))).filter((name) =>
    name.endsWith('.twtrace'),
  );
  if (traces.length !== 2) throw new Error(`packed host wrote ${traces.length} traces`);
  for (const trace of traces) {
    const traceDirectory = join(project, 'artifacts', 'traces', trace);
    const [meta, commit] = await Promise.all([
      readFile(join(traceDirectory, 'meta.json'), 'utf8').then(JSON.parse),
      readFile(join(traceDirectory, 'COMMITTED'), 'utf8').then(JSON.parse),
    ]);
    if (meta.v !== 4 || commit.v !== 4) throw new Error('packed host did not write trace v4');
  }

  process.stdout.write(execution.stdout);
  process.stderr.write(execution.stderr);
  console.log(
    `installed Termwright clean-room host verified on ${process.platform}-${process.arch} / ${process.version}`,
  );
} finally {
  await rm(project, { recursive: true, force: true });
}
