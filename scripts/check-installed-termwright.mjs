import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const installRoot = resolve(process.argv[2] ?? process.cwd());
const project = await mkdtemp(join(installRoot, 'termwright-clean-room-'));

try {
  await Promise.all([
    writeFile(
      join(project, 'package.json'),
      `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`,
      'utf8',
    ),
    writeFile(
      join(project, 'app.mjs'),
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
        "export default defineConfig({ test: { include: ['*.test.mjs'], setupFiles: ['./setup.mjs'], testTimeout: 15000 } });",
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
        "const program = fileURLToPath(new URL('./app.mjs', import.meta.url));",
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

  const cli = join(installRoot, 'node_modules', 'termwright', 'dist', 'bin.js');
  const execution = await execute(process.execPath, [cli, 'test', '--', '--run'], {
    cwd: project,
    env: {
      ...process.env,
      TERMWRIGHT_RETRIES: '0',
      TERMWRIGHT_UPDATE_SNAPSHOTS: 'none',
    },
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
    manifest.v !== 5 ||
    manifest.status !== 'passed' ||
    manifest.specs?.length !== 2 ||
    manifest.eventStream?.file !== 'events.ndjson' ||
    manifest.eventStream?.count < 1 ||
    manifest.telemetry?.coordinatorRssStartBytes <= 0
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

  const traces = (await readdir(join(project, 'artifacts', 'traces'))).filter((name) =>
    name.endsWith('.twtrace'),
  );
  if (traces.length !== 1) throw new Error(`packed host wrote ${traces.length} traces`);
  const traceDirectory = join(project, 'artifacts', 'traces', traces[0]);
  const [meta, commit] = await Promise.all([
    readFile(join(traceDirectory, 'meta.json'), 'utf8').then(JSON.parse),
    readFile(join(traceDirectory, 'COMMITTED'), 'utf8').then(JSON.parse),
  ]);
  if (meta.v !== 4 || commit.v !== 4) throw new Error('packed host did not write trace v4');

  process.stdout.write(execution.stdout);
  process.stderr.write(execution.stderr);
  console.log(
    `installed Termwright clean-room host verified on ${process.platform}-${process.arch} / ${process.version}`,
  );
} finally {
  await rm(project, { recursive: true, force: true });
}
