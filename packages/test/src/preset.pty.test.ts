/**
 * The preset driving a real program over a real PTY: fixtures, retry-able
 * matchers, both snapshot oracles and trace collection.
 *
 * Skipped automatically where no pseudo-terminal can be opened (sandboxed CI,
 * missing prebuild), like the driver's own integration suite; set
 * `TERMWRIGHT_SKIP_PTY=1` to skip explicitly.
 */

import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect } from 'vitest';
import { collectCrashes, formatCrashSection } from './crash.js';
import { configureTermwright, ptyAvailable, test } from './index.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'driver', 'test-fixtures');
const RUNNING_IN_UI = process.env['TERMWRIGHT_UI_URL'] !== undefined;
// A normal test run is disposable. The same suite is also the repository's
// real `termwright ui` demo, where deleting its traces in `afterAll` leaves a
// convincing Runs list whose replay buttons all point at nothing. Keep that
// mode under the already ignored `.termwright/` tree so recordings remain
// available for playback without ever becoming source-control noise.
const OUTPUT = RUNNING_IN_UI
  ? join(process.cwd(), '.termwright', 'demo-preset')
  : mkdtempSync(join(tmpdir(), 'tw-preset-'));
const pauseForLiveDemo = (): Promise<void> =>
  RUNNING_IN_UI ? new Promise((resolve) => setTimeout(resolve, 3_000)) : Promise.resolve();

configureTermwright({
  columns: 60,
  rows: 10,
  trace: 'on',
  outputDir: OUTPUT,
  timeouts: { expect: 5_000 },
  command: [process.execPath, join(FIXTURES, 'semantic-app.mjs')],
});

// The preset's own probe, used the way a user's suite would use it.
const available = await ptyAvailable();

afterAll(() => {
  if (!RUNNING_IN_UI) rmSync(OUTPUT, { recursive: true, force: true });
});

describe.skipIf(!available)('the preset against a real PTY', () => {
  test('opens an integrated shell and returns each command result', { timeout: 30_000 }, async ({ terminal }) => {
    const shell = await terminal.openShell();
    const printed = await shell.shell.run(
      process.platform === 'win32' ? "Write-Output 'hello from shell'" : "printf 'hello from shell\\n'",
    );
    expect(printed.exitCode).toBe(0);
    expect(printed.output).toContain('hello from shell');
    expect(printed.cwd).toBe(terminal.tmpdir);

    const failed = await shell.shell.run(process.platform === 'win32' ? 'cmd /c exit 1' : 'false');
    expect(failed.exitCode).toBe(1);
    expect(shell.shell.status()).toMatchObject({ supported: true, ready: true });
  });

  // Each test carries its own timeout: it must exceed the `expect` timeout
  // class, or a failing matcher is cut off by the runner before it can print
  // what it saw.
  test('asserts the semantic tree, the screen and the effect of an action', { timeout: 30_000 }, async ({ terminal, step }) => {
    const app = await terminal.launch();
    // A screen wait: the tree for this frame is paired with its render-commit
    // marker slightly later, so every semantic assertion below is landing in
    // that gap on purpose. They pass because the matchers re-probe.
    await app.waitForText('Permission required');
    expect(app.capabilities().semanticTree).toBe(true);

    await expect(app).toMatchSemanticSnapshot(`
      - dialog "Permission" [modal]:
          - button "Approve" [focused]
          - button "Reject" [!focused]
    `);
    // v1 adapter bounds are unqualified, so attachment is the strongest fact
    // this fixture can honestly assert. `toBeVisible` requires a qualified
    // viewport observation and must not turn missing clipping into true.
    await expect(app.getByRole('button', { name: 'Approve' })).toBeAttached();
    await expect(app.getByRole('button', { name: 'Approve' })).toBeFocused();
    await expect(app.getByTestId('reject')).toHaveState({ focused: false });
    await expect(app.getByTestId('approve')).toHaveText('Approve');
    await pauseForLiveDemo();

    await step('move the focus', async () => {
      await app.press('Tab');
      // No wait: the matcher polls until the adapter publishes the new tree.
      await expect(app.getByRole('button', { name: 'Reject' })).toBeFocused();
      await pauseForLiveDemo();
    });

    await step('activate the focused button', async () => {
      await app.getByRole('button', { name: 'Reject' }).activate();
      await expect(app).toHaveText('ACTIVATED reject');
      await pauseForLiveDemo();
    });

    await expect(app).toMatchCellSnapshot();
  });

  test('scopes a pattern to the inside of a locator', { timeout: 30_000 }, async ({ terminal }) => {
    const app = await terminal.launch();
    await app.waitForText('Permission required');

    // No `application` or `dialog` line to restate: the scope is the dialog,
    // and the pattern is what a reader cares about inside it.
    await expect(app).toMatchSemanticSnapshot(
      ['- button "Approve" [focused]', '- button /^Rej/'].join('\n'),
      { within: app.getByRole('dialog') },
    );
  });

  test('turns a real crash into the section a failure message carries', { timeout: 30_000 }, async ({
    terminal,
  }) => {
    const app = await terminal.launch({ command: [process.execPath, join(FIXTURES, 'crash-app.mjs')] });
    await app.waitForText('CRASH APP READY');

    await app.press('x'); // uncaught exception: stack on stderr, exit code 1
    const status = await app.waitForExit();
    expect(status.code).toBe(1);

    // What the fixture does on a failing test, against a real dead process.
    const crashes = collectCrashes([{ harness: app, dir: 'out/crash.twtrace' }]);
    expect(crashes).toHaveLength(1);
    const section = formatCrashSection(crashes);
    expect(section).toContain('Process crashed');
    expect(section).toContain('exited with code 1');
    expect(section).toContain('boom from the fixture');
    expect(section).toContain('full trace: out/crash.twtrace');
  });

  test('reports no crash when the program was asked to leave', { timeout: 30_000 }, async ({ terminal }) => {
    const app = await terminal.launch({ command: [process.execPath, join(FIXTURES, 'crash-app.mjs')] });
    await app.waitForText('CRASH APP READY');
    await app.press('e'); // clean exit
    expect(await app.waitForExit()).toEqual({ code: 0, signal: null });
    expect(collectCrashes([{ harness: app }])).toEqual([]);
  });

  test('follows a log file and answers questions about it', { timeout: 30_000 }, async ({
    terminal,
    termwright,
  }) => {
    const logPath = join(termwright.tmpdir, 'app.log');
    writeFileSync(logPath, '');
    const app = await terminal.launch({ logs: [{ path: logPath, label: 'app' }] });
    await app.waitForText('Permission required');

    appendFileSync(logPath, 'starting up\n');
    await expect(terminal).toHaveLogged({ source: 'file', message: 'starting up' });

    // A file line has no level, so it can never trip failOnLogLevel — this
    // test passing with "error" in the log IS the assertion.
    appendFileSync(logPath, 'error: could not reach the cache\n');
    await expect(terminal).toHaveLogged({ message: 'could not reach the cache' });
    expect(terminal.logs.filter({ minLevel: 'error' })).toEqual([]);

    // Exact equality: appends spread across polls must each arrive once.
    expect(terminal.logs.text({ source: 'file' })).toBe(
      ['[app] starting up', '[app] error: could not reach the cache', ''].join('\n'),
    );

    terminal.logs.clear();
    expect(terminal.logs.all()).toEqual([]);
  });

  test('notices records the session never delivered', { timeout: 30_000 }, async ({ terminal }) => {
    const app = await terminal.launch();
    await app.waitForText('Permission required');

    await app.press('g'); // a plain record, so the channel is known to work
    await expect(terminal).toHaveLogged({ source: 'adapter' });
    expect(terminal.logs.lostRecords()).toBe(0);

    await app.press('D'); // repeats a seq: refused, but nothing was lost
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(terminal.logs.lostRecords()).toBe(0);

    await app.press('S'); // skips ahead: the adapter lost records at the source
    await expect.poll(() => terminal.logs.lostRecords(), { timeout: 5_000 }).toBeGreaterThan(0);
  });

  test('starts the program on files the test declared', { timeout: 30_000 }, async ({ terminal }) => {
    const app = await terminal.launch({
      // A program that reads its config at startup must find it already there.
      command: [
        process.execPath,
        '-e',
        "const fs=require('node:fs');" +
          "process.stdout.write('CONFIG '+fs.readFileSync('config.json','utf8')+'\\r\\n');" +
          "process.stdout.write('NOTE '+fs.readFileSync('notes/todo.md','utf8')+'\\r\\n');" +
          'setInterval(() => {}, 1000);',
      ],
      files: { 'config.json': '{"theme":"dark"}', 'notes/todo.md': 'write tests' },
    });

    await expect(app).toHaveText('CONFIG {"theme":"dark"}');
    await expect(app).toHaveText('NOTE write tests');
  });

  test('isolates each test with its own directory and session', { timeout: 30_000 }, async ({ terminal, termwright }) => {
    const app = await terminal.launch();
    await app.waitForText('Permission required');
    expect(termwright.tmpdir).toContain('termwright-');
    expect(existsSync(termwright.tmpdir)).toBe(true);
    expect(terminal.sessions).toHaveLength(1);
    expect(app.sessionId).toEqual(expect.any(String));
  });

  test('records a trace archive with the steps it was given', { timeout: 30_000 }, async ({ terminal, step }) => {
    const app = await terminal.launch();
    await app.waitForText('Permission required');
    await step('a named step', async () => {
      await app.press('Tab');
      await expect(app.getByTestId('reject')).toBeFocused();
    });
  });
});

describe.skipIf(!available)('trace collection', () => {
  test('leaves finished archives behind for the reporter', { timeout: 30_000 }, async () => {
    const traces = join(OUTPUT, 'traces');
    const archives = readdirSync(traces).filter((entry) => entry.endsWith('.twtrace'));
    expect(archives.length).toBeGreaterThan(0);
    const archive = join(traces, archives[0] as string);
    const meta = JSON.parse(readFileSync(join(archive, 'meta.json'), 'utf8')) as { v: number; semanticTree: boolean };
    expect(meta.v).toBe(1);
    expect(meta.semanticTree).toBe(true);
    expect(existsSync(join(archive, 'session.cast'))).toBe(true);
    expect(existsSync(join(archive, 'events.jsonl'))).toBe(true);
    expect(existsSync(join(archive, 'semantics.jsonl'))).toBe(true);

    const events = archives.flatMap((entry) =>
      readFileSync(join(traces, entry, 'events.jsonl'), 'utf8')
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as { kind: string; api?: string; title?: string; ref?: string; selector?: string }),
    );
    expect(events.some((event) => event.kind === 'step-start' && event.title === 'a named step')).toBe(true);
    expect(events.some((event) => event.kind === 'assert' && event.api === 'toBeFocused')).toBe(true);

    // Every assertion about a node carries that node's ref: the runner UI
    // lights up its bounds when someone clicks the row in the command log.
    const asserts = events.filter(
      (event): event is { kind: string; api?: string; ref?: string; selector?: string } =>
        event.kind === 'assert',
    );
    const aboutANode = asserts.filter((event) => event.selector?.startsWith('getBy') === true);
    expect(aboutANode.length).toBeGreaterThan(0);
    for (const event of aboutANode) {
      expect(event.ref, `${event.api ?? '?'} on ${event.selector ?? '?'}`).toMatch(/^n\d+@\d+$/u);
    }
  });
});
