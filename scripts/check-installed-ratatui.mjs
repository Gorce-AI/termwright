import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const installRoot = resolve(process.argv[2] ?? process.cwd());
if (process.argv[3] === undefined || process.argv[4] === undefined) {
  throw new Error('clean-room Ratatui checker requires packaged protocol and probe crates');
}
const protocolDir = await realpath(resolve(process.argv[3]));
const probeDir = await realpath(resolve(process.argv[4]));
const project = await mkdtemp(join(installRoot, 'termwright-ratatui-clean-room-'));
const appDir = join(project, 'app');
const builderDir = join(project, 'builder');

try {
  for (const path of [protocolDir, probeDir]) {
    if (path.includes('/clients/rust'))
      throw new Error(`Rust crate points into workspace: ${path}`);
  }
  await Promise.all([
    mkdir(join(appDir, 'src'), { recursive: true }),
    mkdir(join(appDir, '.cargo'), { recursive: true }),
    mkdir(join(builderDir, 'src'), { recursive: true }),
  ]);
  await Promise.all([
    write(
      'app/.cargo/config.toml',
      `[patch.crates-io]
termwright-protocol = { path = ${JSON.stringify(protocolDir)} }
`,
    ),
    write(
      'builder/Cargo.toml',
      `[package]
name = "termwright-clean-room-builder"
version = "0.0.0"
edition = "2021"
publish = false

[dependencies]
termwright-probe-ratatui = { path = ${JSON.stringify(probeDir)} }

[patch.crates-io]
termwright-protocol = { path = ${JSON.stringify(protocolDir)} }
`,
    ),
    write(
      'builder/src/main.rs',
      `use std::env;
use std::process::{Command, ExitCode};
use termwright_probe_ratatui::launch::{prepare_instrumented_build, PrepareOptions};

fn main() -> ExitCode {
    let project = env::args().nth(1).expect("usage: builder <app>");
    let prepared = prepare_instrumented_build(&PrepareOptions::new(&project)).expect("prepare");
    let mut cargo = Command::new("cargo");
    cargo.args(["build", "--manifest-path"]).arg(format!("{project}/Cargo.toml"));
    for config in &prepared.config_args { cargo.arg("--config").arg(config); }
    for (key, value) in &prepared.env { cargo.env(key, value); }
    let success = cargo.status().expect("cargo build").success();
    prepared.finish().expect("restore lock");
    if success { ExitCode::SUCCESS } else { ExitCode::FAILURE }
}
`,
    ),
    write(
      'app/Cargo.toml',
      `[package]
name = "termwright-clean-room-ratatui"
version = "0.0.0"
edition = "2021"
rust-version = "1.88"
publish = false

[dependencies]
crossterm = "0.29"
ratatui = "=0.30.2"
`,
    ),
    write(
      'app/src/main.rs',
      `use std::io::{self, stdout};
use std::time::Duration;
use crossterm::event::{self, Event, KeyCode};
use crossterm::execute;
use crossterm::terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen};
use ratatui::backend::CrosstermBackend;
use ratatui::widgets::{Block, Borders, List, ListItem, ListState};
use ratatui::Terminal;

fn main() -> io::Result<()> {
    enable_raw_mode()?;
    execute!(stdout(), EnterAlternateScreen)?;
    let mut terminal = Terminal::new(CrosstermBackend::new(stdout()))?;
    let result = run(&mut terminal);
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    result
}

fn run(terminal: &mut Terminal<CrosstermBackend<std::io::Stdout>>) -> io::Result<()> {
    let items = ["Draft", "Ready", "Shipped"];
    let mut state = ListState::default().with_selected(Some(0));
    loop {
        terminal.draw(|frame| {
            let list = List::new(items.map(ListItem::new))
                .block(Block::default().title("Release 👨‍👩‍👧 👍🏽 किं 世").borders(Borders::ALL))
                .highlight_symbol("> ");
            frame.render_stateful_widget(list, frame.area(), &mut state);
        })?;
        if !event::poll(Duration::from_millis(250))? { continue; }
        if let Event::Key(key) = event::read()? {
            match key.code {
                KeyCode::Down => state.select_next(),
                KeyCode::Up => state.select_previous(),
                KeyCode::Esc | KeyCode::Char('q') => return Ok(()),
                _ => {}
            }
        }
    }
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
export default defineConfig({test: {include: ['ratatui.test.mjs'], setupFiles: ['./setup.mjs'], testTimeout: 30000}});
`,
    ),
    write(
      'ratatui.test.mjs',
      `import {fileURLToPath} from 'node:url';
import {expect, test} from 'termwright/test';
const binary = fileURLToPath(new URL('./app/target/debug/termwright-clean-room-ratatui', import.meta.url));
test.resources({terminals: 1, traceWriters: 1})('drives packaged Ratatui', async ({terminal}) => {
  const app = await terminal.launch({command: [binary]});
  await expect(app).toHaveText('Release 👨‍👩‍👧 👍🏽 किं 世');
  await expect(app.getByRole('listitem', {name: 'Draft'})).toHaveState({selected: true});
  await app.press('ArrowDown');
  await expect(app.getByRole('listitem', {name: 'Ready'})).toHaveState({selected: true});
  await app.press('q');
  expect((await app.exit).code).toBe(0);
});
`,
    ),
  ]);

  const cargoEnvironment = { ...process.env };
  await execute('cargo', ['build', '--manifest-path', join(builderDir, 'Cargo.toml')], {
    cwd: builderDir,
    env: cargoEnvironment,
    timeout: 180_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const builder = join(
    builderDir,
    'target',
    'debug',
    process.platform === 'win32'
      ? 'termwright-clean-room-builder.exe'
      : 'termwright-clean-room-builder',
  );
  await execute(builder, [appDir], {
    // Cargo discovers .cargo/config.toml from cwd ancestors, not from the
    // directory named by --manifest-path inside the builder.
    cwd: appDir,
    env: cargoEnvironment,
    timeout: 240_000,
    maxBuffer: 8 * 1024 * 1024,
  });

  const cli = join(installRoot, 'node_modules', 'termwright', 'dist', 'bin.js');
  const execution = await execute(process.execPath, [cli, 'test', '--', '--run'], {
    cwd: project,
    env: { ...process.env, TERMWRIGHT_RETRIES: '0', TERMWRIGHT_UPDATE_SNAPSHOTS: 'none' },
    timeout: 90_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const runDirectories = await readdir(join(project, '.termwright', 'runs'));
  if (runDirectories.length !== 1)
    throw new Error(`packaged Ratatui wrote ${runDirectories.length} run directories`);
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
    throw new Error(`packaged Ratatui evidence failed: ${JSON.stringify({ manifest, resources })}`);
  }
  process.stderr.write(execution.stdout);
  process.stderr.write(execution.stderr);
  console.log(
    JSON.stringify({
      status: 'PASS',
      runtime: { platform: process.platform, arch: process.arch, node: process.version },
      rustc: (await execute('rustc', ['--version'])).stdout.trim(),
      protocolDir,
      probeDir,
      resources: resources[0],
    }),
  );
} finally {
  await rm(project, { recursive: true, force: true });
}

function write(name, body) {
  return writeFile(join(project, name), `${body}\n`, 'utf8');
}
