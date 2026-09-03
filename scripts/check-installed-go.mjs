import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const installRoot = resolve(process.argv[2] ?? process.cwd());
if (process.argv[3] === undefined)
  throw new Error('clean-room Go checker requires packaged client');
const clientDir = await realpath(resolve(process.argv[3]));
const project = await mkdtemp(join(installRoot, 'termwright-go-clean-room-'));
const moduleDir = join(project, 'app');

try {
  if (clientDir.includes('/clients/go') || clientDir.includes('\\clients\\go')) {
    throw new Error(`Go client still points into the workspace: ${clientDir}`);
  }
  await mkdir(moduleDir);
  await Promise.all([
    write(
      'app/go.mod',
      `module example.com/termwright-clean-room

go 1.24

require (
  github.com/charmbracelet/bubbles v1.0.0
  github.com/charmbracelet/bubbletea v1.3.10
)
`,
    ),
    write(
      'app/main.go',
      `package main

import (
  "fmt"
  "os"
  "github.com/charmbracelet/bubbles/textinput"
  tea "github.com/charmbracelet/bubbletea"
)

type model struct { Name textinput.Model; Status string }

func initialModel() model {
  name := textinput.New()
  name.Placeholder = "release"
  name.Cursor.Blink = false
  name.Focus()
  return model{Name: name, Status: "editing"}
}

func (m model) Init() tea.Cmd { return nil }
func (m model) Update(message tea.Msg) (tea.Model, tea.Cmd) {
  if key, ok := message.(tea.KeyMsg); ok {
    switch key.String() {
    case "ctrl+c", "esc": return m, tea.Quit
    case "enter": m.Status = "created " + m.Name.Value(); return m, nil
    }
  }
  var command tea.Cmd
  m.Name, command = m.Name.Update(message)
  return m, command
}
func (m model) View() string {
  return fmt.Sprintf("Release 👨‍👩‍👧 👍🏽 किं 世\\n\\n%s\\n\\nstatus: %s\\n", m.Name.View(), m.Status)
}
func main() {
  if _, err := tea.NewProgram(initialModel()).Run(); err != nil { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
}
`,
    ),
    write('package.json', JSON.stringify({ private: true, type: 'module' }, null, 2)),
    write(
      'setup.mjs',
      `import {configureTermwright} from 'termwright/test';
configureTermwright({columns: 60, rows: 12, outputDir: 'artifacts', trace: 'on', requiredCapabilities: ['semantic-tree', 'paired-revisions']});
`,
    ),
    write(
      'vitest.config.mjs',
      `import {defineConfig} from 'vitest/config';
export default defineConfig({test: {include: ['go.test.mjs'], setupFiles: ['./setup.mjs'], testTimeout: 30000}});
`,
    ),
    write(
      'go.test.mjs',
      `import {fileURLToPath} from 'node:url';
import {expect, test} from 'termwright/test';
const binary = fileURLToPath(new URL('./app/clean-room-go', import.meta.url));
test.resources({terminals: 1, traceWriters: 1})('drives packed Bubble Tea', async ({terminal}) => {
  const app = await terminal.launch({command: [binary]});
  await expect(app).toHaveText('Release 👨‍👩‍👧 👍🏽 किं 世');
  const field = app.getByRole('textbox');
  await expect(field).toBeFocused();
  await app.type('v4');
  await expect(field).toHaveText('v4');
  await app.press('Enter');
  await expect(app).toHaveText('status: created v4');
  await app.press('Escape');
  expect((await app.exit).code).toBe(0);
});
`,
    ),
  ]);

  const goEnvironment = { ...process.env, GOWORK: 'off', GOTOOLCHAIN: 'local' };
  await execute('go', ['mod', 'tidy'], { cwd: moduleDir, env: goEnvironment, timeout: 60_000 });
  const probeUrl = pathToFileURL(
    join(installRoot, 'node_modules', '@termwright', 'probe-charm', 'dist', 'index.js'),
  ).href;
  const { prepareInstrumentedBuild } = await import(probeUrl);
  const prepared = await prepareInstrumentedBuild({
    moduleDir,
    clientDir,
    env: goEnvironment,
  });
  await execute('go', ['build', ...prepared.goArgs, '-o', 'clean-room-go', '.'], {
    cwd: prepared.moduleDir,
    env: prepared.env,
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
  });

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
    throw new Error(`packed Go run wrote ${runDirectories.length} run directories`);
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
    throw new Error(`packed Go evidence failed: ${JSON.stringify({ manifest, resources })}`);
  }
  process.stderr.write(execution.stdout);
  process.stderr.write(execution.stderr);
  console.log(
    JSON.stringify({
      status: 'PASS',
      runtime: { platform: process.platform, arch: process.arch, node: process.version },
      go: (await execute('go', ['version'])).stdout.trim(),
      clientDir,
      framework: prepared.flavour,
      resources: resources[0],
    }),
  );
} finally {
  await rm(project, { recursive: true, force: true });
}

function write(name, body) {
  const path = join(project, name);
  return writeFile(path, `${body}\n`, 'utf8');
}
