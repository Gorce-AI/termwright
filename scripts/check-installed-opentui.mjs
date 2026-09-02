import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const installRoot = resolve(process.argv[2] ?? process.cwd());
const project = await mkdtemp(join(installRoot, 'termwright-opentui-clean-room-'));

try {
  await Promise.all([
    write('package.json', JSON.stringify({ private: true, type: 'module' }, null, 2)),
    write(
      'app.ts',
      `import {BoxRenderable, createCliRenderer, InputRenderable, InputRenderableEvents, TextRenderable} from '@opentui/core';
const renderer = await createCliRenderer({exitOnCtrlC: true, targetFps: 30});
const form = new BoxRenderable(renderer, {id: 'release-form', border: true, width: 44, height: 8, flexDirection: 'column'});
const heading = new TextRenderable(renderer, {id: 'heading', content: 'Release 👨‍👩‍👧 👍🏽 किं 世', height: 1});
const name = new InputRenderable(renderer, {id: 'release-name', placeholder: 'Release name'});
const status = new TextRenderable(renderer, {id: 'status', content: 'status: editing', height: 1});
name.on(InputRenderableEvents.ENTER, () => { status.content = 'status: created ' + name.value; });
form.add(heading);
form.add(name);
form.add(status);
renderer.root.add(form);
renderer.start();
name.focus();
`,
    ),
    write(
      'setup.mjs',
      `import {configureTermwright} from 'termwright/test';
configureTermwright({columns: 50, rows: 12, outputDir: 'artifacts', trace: 'on', requiredCapabilities: ['semantic-tree', 'paired-revisions']});
`,
    ),
    write(
      'vitest.config.mjs',
      `import {defineConfig} from 'vitest/config';
export default defineConfig({test: {include: ['opentui.test.mjs'], setupFiles: ['./setup.mjs'], testTimeout: 30000}});
`,
    ),
    write(
      'opentui.test.mjs',
      `import {fileURLToPath} from 'node:url';
import {withProbe} from '@termwright/probe-opentui';
import {expect, test} from 'termwright/test';
const application = fileURLToPath(new URL('./app.ts', import.meta.url));
const command = withProbe('bun', ['bun', application]).command;
test.resources({terminals: 1, traceWriters: 1})('drives packed OpenTUI', async ({terminal}) => {
  const app = await terminal.launch({command});
  await expect(app.getByRole('textbox')).toBeFocused();
  await expect(app).toHaveText('Release 👨‍👩‍👧 👍🏽 किं 世');
  await app.type('v4');
  await expect(app.getByRole('textbox')).toHaveText('v4');
  await app.press('Enter');
  await expect(app).toHaveText('status: created v4');
  const field = app.getByRole('textbox');
  expect((await field.geometry()).intendedRect.status).toBe('known');
  await expect(field).toReceivePointerEvents();
});
`,
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
    timeout: 90_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const runDirectories = await readdir(join(project, '.termwright', 'runs'));
  if (runDirectories.length !== 1)
    throw new Error(`packed OpenTUI wrote ${runDirectories.length} run directories`);
  const runDir = join(project, '.termwright', 'runs', runDirectories[0]);
  const [manifest, eventsBody] = await Promise.all([
    readFile(join(runDir, 'manifest.json'), 'utf8').then(JSON.parse),
    readFile(join(runDir, 'events.ndjson'), 'utf8'),
  ]);
  const resources = eventsBody
    .trimEnd()
    .split('\n')
    .map(JSON.parse)
    .filter((event) => event.type === 'trace.resource')
    .map((event) => event.payload);
  if (
    manifest.v !== 7 ||
    manifest.status !== 'passed' ||
    resources.length !== 1 ||
    resources[0].semanticFullCount !== 1 ||
    resources[0].semanticDeltaCount < 1 ||
    resources[0].traceBytes <= 0
  ) {
    throw new Error(`packed OpenTUI evidence failed: ${JSON.stringify({ manifest, resources })}`);
  }
  process.stderr.write(execution.stdout);
  process.stderr.write(execution.stderr);
  console.log(
    JSON.stringify({
      status: 'PASS',
      runtime: { platform: process.platform, arch: process.arch, node: process.version },
      bun: (await execute('bun', ['--version'])).stdout.trim(),
      resources: resources[0],
    }),
  );
} finally {
  await rm(project, { recursive: true, force: true });
}

function write(name, body) {
  return writeFile(join(project, name), `${body}\n`, 'utf8');
}
