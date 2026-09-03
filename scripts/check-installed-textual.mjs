import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const installRoot = resolve(process.argv[2] ?? process.cwd());
const python = resolve(process.argv[3] ?? '');
if (process.argv[3] === undefined)
  throw new Error('clean-room Textual checker requires venv Python');
const pythonManifest = await readFile(
  fileURLToPath(new URL('../clients/python/pyproject.toml', import.meta.url)),
  'utf8',
);
const expectedVersion = /^version\s*=\s*"([^"]+)"$/m.exec(pythonManifest)?.[1];
if (expectedVersion === undefined)
  throw new Error('Python client manifest has no unambiguous project version');
const project = await mkdtemp(join(installRoot, 'termwright-textual-clean-room-'));

try {
  const provenance = JSON.parse(
    (
      await execute(python, [
        '-c',
        "import importlib.metadata,json,termwright,textual; print(json.dumps({'termwright':importlib.metadata.version('termwright'),'textual':importlib.metadata.version('textual'),'source':termwright.__file__}))",
      ])
    ).stdout,
  );
  if (typeof provenance.source !== 'string') {
    throw new Error(`Textual dependency reported no source: ${JSON.stringify(provenance)}`);
  }
  const [installedSource, venvRoot] = await Promise.all([
    realpath(provenance.source),
    realpath(resolve(python, '..', '..')),
  ]);
  if (
    provenance.termwright !== expectedVersion ||
    !installedSource.startsWith(`${venvRoot}/`) ||
    installedSource.includes('/clients/python/')
  ) {
    throw new Error(`Textual dependency is not wheel-isolated: ${JSON.stringify(provenance)}`);
  }

  await Promise.all([
    write('package.json', JSON.stringify({ private: true, type: 'module' }, null, 2)),
    write(
      'app.py',
      `from textual.app import App, ComposeResult
from textual.containers import Vertical
from textual.widgets import Button, Input, Label

class ReleaseApp(App[None]):
    CSS = "Vertical { width: 48; height: 8; }"
    def compose(self) -> ComposeResult:
        with Vertical():
            yield Label("Release 👨‍👩‍👧 👍🏽 किं 世", id="heading")
            yield Input(placeholder="Release name", id="name")
            yield Button("Create", id="create")
            yield Label("status: editing", id="status")
    def on_mount(self) -> None:
        self.query_one("#name", Input).focus()
    def on_button_pressed(self, event: Button.Pressed) -> None:
        value = self.query_one("#name", Input).value
        self.query_one("#status", Label).update(f"status: created {value}")

if __name__ == "__main__":
    ReleaseApp().run()
`,
    ),
    write(
      'setup.mjs',
      `import {configureTermwright} from 'termwright/test';
configureTermwright({columns: 60, rows: 14, outputDir: 'artifacts', trace: 'on', requiredCapabilities: ['semantic-tree', 'paired-revisions']});
`,
    ),
    write(
      'vitest.config.mjs',
      `import {defineConfig} from 'vitest/config';
export default defineConfig({test: {include: ['textual.test.mjs'], setupFiles: ['./setup.mjs'], testTimeout: 30000}});
`,
    ),
    write(
      'textual.test.mjs',
      `import {fileURLToPath} from 'node:url';
import {expect, test} from 'termwright/test';
const application = fileURLToPath(new URL('./app.py', import.meta.url));
const command = [${JSON.stringify(python)}, '-m', 'termwright_probe', '--', ${JSON.stringify(python)}, application];
test.resources({terminals: 1, traceWriters: 1})('drives packed Textual', async ({terminal}) => {
  const app = await terminal.launch({command});
  await expect(app.getByRole('textbox')).toBeFocused();
  await expect(app).toHaveText('Release 👨‍👩‍👧 👍🏽 किं 世');
  const field = app.getByRole('textbox');
  await field.click();
  await app.type('v4');
  await expect(field).toHaveText('v4');
  const create = app.getByRole('button', {name: 'Create'});
  expect((await create.geometry()).intendedRect.status).toBe('known');
  await expect(create).toReceivePointerEvents();
  await create.activate();
  await expect(app).toHaveText('status: created v4');
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
    throw new Error(`packed Textual wrote ${runDirectories.length} run directories`);
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
    manifest.v !== 8 ||
    manifest.status !== 'passed' ||
    resources.length !== 1 ||
    resources[0].semanticFullCount !== 1 ||
    resources[0].semanticDeltaCount < 1 ||
    resources[0].traceBytes <= 0
  ) {
    throw new Error(`packed Textual evidence failed: ${JSON.stringify({ manifest, resources })}`);
  }
  process.stderr.write(execution.stdout);
  process.stderr.write(execution.stderr);
  console.log(
    JSON.stringify({
      status: 'PASS',
      runtime: { platform: process.platform, arch: process.arch, node: process.version },
      python: (await execute(python, ['--version'])).stdout.trim(),
      provenance,
      resources: resources[0],
    }),
  );
} finally {
  await rm(project, { recursive: true, force: true });
}

function write(name, body) {
  return writeFile(join(project, name), `${body}\n`, 'utf8');
}
