import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openTrace } from '@termwright/trace';
import { discoverTests, startUiServer } from '@termwright/ui';
import {
  discoverTermwrightListing,
  resolveVitestBin,
  startVitest,
  testNamePatternFromArgs,
  UI_URL_ENV,
  uiVitestHostPath,
  vitestArgsForBrowserRun,
  vitestRunTargetArgs,
} from './ui-command.js';

/** The monorepo root, which is a real project with Vitest installed. */
const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const builtUiHost = fileURLToPath(new URL('../dist/vitest-ui-host.js', import.meta.url));
const gherkinUiFixture = fileURLToPath(new URL('./__fixtures__/gherkin-ui/', import.meta.url));
const gherkinUiConfig = join(gherkinUiFixture, 'vitest.config.ts');
const gherkinUiFeature = join(gherkinUiFixture, 'mixed.feature');
const builtUiReporter = fileURLToPath(new URL('../../ui/dist/reporter.js', import.meta.url));

describe('resolveVitestBin', () => {
  it('finds the project’s own Vitest binary', () => {
    const bin = resolveVitestBin(projectRoot);
    expect(existsSync(bin)).toBe(true);
    expect(bin).toContain('vitest');
  });

  // The "no Vitest installed" branch is not exercised here on purpose: Node's
  // resolver falls back to the global module folders, so no path on a developer
  // machine reliably lacks Vitest. What matters — that the failure reaches the
  // user and the runner still shuts down — is asserted end to end in
  // `cli.test.ts`, "closes the runner even when starting the suite throws".
});

describe('the reporter contract', () => {
  it('publishes to the variable @termwright/ui reads', () => {
    expect(UI_URL_ENV).toBe('TERMWRIGHT_UI_URL');
  });
});

describe('the UI-only runner contract', () => {
  it('uses a dedicated process host rather than an unsupported --runner flag', () => {
    expect(uiVitestHostPath()).toMatch(/vitest-ui-host\.js$/);
  });

  it('discovers only marked cases from a physically mixed test file', async () => {
    const output = await discoverTermwrightListing({
      cwd: projectRoot,
      args: [
        '--config',
        'packages/test/src/__fixtures__/ui-provider.vitest.config.ts',
        'packages/test/src/__fixtures__/ui-provider-mixed.fixture.ts',
      ],
    });
    const listing = JSON.parse(output) as { name: string; file: string }[];

    expect(listing.map((entry) => entry.name)).toEqual([
      'mixed providers > owned direct',
      'mixed providers > owned each 1',
      'mixed providers > owned each 2',
      "mixed providers > owned for 'for'",
      'mixed providers > owned conditional',
      'mixed providers > owned alias',
      'mixed providers > owned skip',
      'mixed providers > owned todo',
      'mixed providers > owned extended',
    ]);
    expect(listing.every((entry) => entry.file.endsWith('ui-provider-mixed.fixture.ts'))).toBe(true);
  }, 30_000);

  it('runs marked modes despite foreign only, while plain Vitest keeps normal only semantics', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'termwright-provider-'));
    const uiEffects = join(directory, 'ui.log');
    const plainEffects = join(directory, 'plain.log');
    const config = 'packages/test/src/__fixtures__/ui-provider.vitest.config.ts';
    try {
      const ui = await runProcess(
        builtUiHost,
        [
          'run',
          '--config',
          config,
          '--reporter=dot',
          'packages/test/src/__fixtures__/ui-provider-mixed.fixture.ts',
        ],
        { TERMWRIGHT_PROVIDER_EFFECTS: uiEffects, CI: 'true' },
      );
      expect(ui.code, ui.output).toBe(0);
      expect((await readFile(uiEffects, 'utf8')).trim().split('\n').sort()).toEqual([
        'owned alias',
        'owned conditional',
        'owned direct',
        'owned each 1',
        'owned each 2',
        'owned extended',
        'owned for',
      ]);
      expect(ui.output).toContain('7 passed');

      const plain = await runProcess(
        resolveVitestBin(projectRoot),
        ['run', '--config', config, '--allowOnly', '--reporter=dot'],
        { TERMWRIGHT_PROVIDER_EFFECTS: plainEffects },
      );
      expect(plain.code, plain.output).toBe(0);
      expect(await readFile(plainEffects, 'utf8')).toBe('FOREIGN\n');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 45_000);

  it('keeps managed physical features inside the effective config include scope', async () => {
    const discovery = await discoverTests({
      cwd: projectRoot,
      args: ['--config', gherkinUiConfig],
      run: discoverTermwrightListing,
    });
    expect(discovery.map(({ title }) => title).sort()).toEqual([
      'Permission workflow > focuses Reject with the keyboard',
      'Permission workflow > records an actionless business rule',
      'TypeScript opens the permission terminal',
    ]);
    expect(new Set(discovery.map(({ file }) => file))).toEqual(new Set([
      gherkinUiFeature,
      join(gherkinUiFixture, 'permission.test.ts'),
    ]));
    expect(discovery.every(({ file }) => file.startsWith(gherkinUiFixture))).toBe(true);

    const directory = await mkdtemp(join(tmpdir(), 'termwright-gherkin-config-scope-'));
    try {
      const effects = join(directory, 'effects.log');
      const run = await runProcess(
        builtUiHost,
        ['run', '--config', gherkinUiConfig, '--reporter=dot'],
        { TERMWRIGHT_GHERKIN_UI_EFFECTS: effects, CI: 'true' },
      );
      expect(run.code, run.output).toBe(0);
      expect((await readFile(effects, 'utf8')).trim().split('\n').sort()).toEqual([
        'ACTIONLESS RULE',
        'FEATURE',
        'TYPESCRIPT',
      ]);
      expect(run.output).not.toContain('packages/gherkin/test-fixtures');
      expect(run.output).not.toContain('packages/gherkin/src/__fixtures__');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('uses one mixed TypeScript + Gherkin catalogue and host for discovery, run all, line and rerun', async () => {
    const discovery = await discoverTests({
      cwd: projectRoot,
      args: ['--config', gherkinUiConfig, gherkinUiFixture],
      run: discoverTermwrightListing,
    });
    expect(discovery.map(({ title }) => title).sort()).toEqual([
      'Permission workflow > focuses Reject with the keyboard',
      'Permission workflow > records an actionless business rule',
      'TypeScript opens the permission terminal',
    ]);
    expect(discovery.some(({ title }) => title.includes('foreign'))).toBe(false);
    const scenario = discovery.find(({ file }) => file.endsWith('mixed.feature'));
    expect(scenario).toMatchObject({
      id: `${gherkinUiFeature}::Permission workflow > focuses Reject with the keyboard`,
      title: 'Permission workflow > focuses Reject with the keyboard',
      file: gherkinUiFeature,
      provider: { id: '@termwright/test', version: 1 },
      kind: 'gherkin-scenario',
      ancestors: [{ kind: 'feature', title: 'Permission workflow' }],
      tags: ['@smoke'],
      source: { file: gherkinUiFeature, line: 4, column: 3 },
    });

    const directory = await mkdtemp(join(tmpdir(), 'termwright-gherkin-ui-'));
    try {
      const allEffects = join(directory, 'all.log');
      const all = await runProcess(
        builtUiHost,
        ['run', '--config', gherkinUiConfig, '--reporter=dot', gherkinUiFixture],
        { TERMWRIGHT_GHERKIN_UI_EFFECTS: allEffects, CI: 'true' },
      );
      expect(all.code, all.output).toBe(0);
      expect((await readFile(allEffects, 'utf8')).trim().split('\n').sort()).toEqual([
        'ACTIONLESS RULE',
        'FEATURE',
        'TYPESCRIPT',
      ]);

      const plainEffects = join(directory, 'plain.log');
      const plain = await runProcess(
        resolveVitestBin(projectRoot),
        ['run', '--config', gherkinUiConfig, '--allowOnly', '--reporter=dot', gherkinUiFixture],
        { TERMWRIGHT_GHERKIN_UI_EFFECTS: plainEffects },
      );
      expect(plain.code, plain.output).toBe(0);
      expect((await readFile(plainEffects, 'utf8')).trim().split('\n').sort()).toEqual([
        'FOREIGN',
        'TYPESCRIPT',
      ]);

      const lineEffects = join(directory, 'line.log');
      const line = await runProcess(
        builtUiHost,
        ['run', '--config', gherkinUiConfig, `${gherkinUiFeature}:4`, '--reporter=dot'],
        { TERMWRIGHT_GHERKIN_UI_EFFECTS: lineEffects, CI: 'true' },
      );
      expect(line.code, line.output).toBe(0);
      expect(await readFile(lineEffects, 'utf8')).toBe('FEATURE\n');

      const rerunEffects = join(directory, 'rerun.log');
      const selectedRerunTargets = [
        `${gherkinUiFeature}::Permission workflow > focuses Reject with the keyboard`,
      ];
      const rerunTargets = vitestRunTargetArgs(selectedRerunTargets);
      const rerun = await runProcess(
        builtUiHost,
        ['run', '--config', gherkinUiConfig, '--reporter=dot', ...rerunTargets],
        {
          TERMWRIGHT_GHERKIN_UI_EFFECTS: rerunEffects,
          TERMWRIGHT_UI_SELECTION: JSON.stringify(selectedRerunTargets),
          CI: 'true',
        },
      );
      expect(rerun.code, rerun.output).toBe(0);
      expect(await readFile(rerunEffects, 'utf8')).toBe('FEATURE\n');

      expect((await readdir(gherkinUiFixture)).sort()).toEqual([
        'foreign.test.ts',
        'mixed.feature',
        'mixed.ts',
        'permission.test.ts',
        'vitest.config.ts',
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('streams physical Gherkin prose, terminal actions and a replayable trace through the real UI wire', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'termwright-gherkin-wire-'));
    const server = await startUiServer({ runsDir: join(directory, 'runs') });
    const selected = `${gherkinUiFeature}::Permission workflow > focuses Reject with the keyboard`;
    try {
      const run = await runProcess(
        builtUiHost,
        ['run', '--config', gherkinUiConfig, `--reporter=${builtUiReporter}`, gherkinUiFeature],
        {
          TERMWRIGHT_UI_URL: server.url,
          TERMWRIGHT_UI_SELECTION: JSON.stringify([selected]),
          TERMWRIGHT_GHERKIN_UI_EFFECTS: join(directory, 'effects.log'),
          CI: 'true',
        },
      );
      expect(run.code, run.output).toBe(0);
      const messages = server.hub.backlog;
      const starts = messages.filter((message) => message.type === 'step' && message.phase === 'start');
      expect(starts).toHaveLength(3);
      expect(starts.map((message) => message.type === 'step' ? message.gherkin?.keyword : undefined)).toEqual([
        'Given', 'When', 'Then',
      ]);
      expect(new Set(starts.map((message) => message.type === 'step' ? message.stepId : undefined)).size).toBe(3);
      const session = messages.find((message) => message.type === 'session');
      expect(session).toMatchObject({ type: 'session' });
      const action = messages.find((message) => message.type === 'action' && message.api === 'press');
      expect(action).toMatchObject({ type: 'action', stepId: 'tw-step-2', ok: true });
      const end = messages.find((message) => message.type === 'test-end' && message.id !== undefined);
      expect(end?.type === 'test-end' ? end.traceRef : undefined).toBeTypeOf('string');
      const trace = await openTrace((end as Extract<typeof end, { type: 'test-end' }>).traceRef as string);
      try {
        const steps = await trace.steps();
        expect(steps.map(({ stepId, gherkin }) => [stepId, gherkin?.keyword])).toEqual([
          ['tw-step-1', 'Given'], ['tw-step-2', 'When'], ['tw-step-3', 'Then'],
        ]);
        const events = [];
        for await (const event of trace.events()) events.push(event);
        expect(events).toContainEqual(expect.objectContaining({ kind: 'action', api: 'press', stepId: 'tw-step-2' }));
      } finally {
        await trace.close();
      }

    } finally {
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('streams an actionless physical Gherkin step without relying on a session or trace', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'termwright-gherkin-actionless-'));
    const server = await startUiServer({ runsDir: join(directory, 'runs') });
    const selected = `${gherkinUiFeature}::Permission workflow > records an actionless business rule`;
    try {
      const run = await runProcess(
        builtUiHost,
        ['run', '--config', gherkinUiConfig, `--reporter=${builtUiReporter}`, gherkinUiFeature],
        {
          TERMWRIGHT_UI_URL: server.url,
          TERMWRIGHT_UI_SELECTION: JSON.stringify([selected]),
          TERMWRIGHT_GHERKIN_UI_EFFECTS: join(directory, 'effects.log'),
          CI: 'true',
        },
      );
      expect(run.code, run.output).toBe(0);
      const messages = server.hub.backlog;
      const lifecycle = messages.filter((message) =>
        message.type === 'test-start' || message.type === 'step' || message.type === 'test-end');
      expect(lifecycle.map((message) => message.type === 'step' ? `${message.type}:${message.phase}` : message.type)).toEqual([
        'test-start', 'step:start', 'step:end', 'test-end',
      ]);
      expect(lifecycle[1]).toMatchObject({
        type: 'step', stepId: 'tw-step-1',
        gherkin: {
          keyword: 'Given', text: 'the approval policy is already recorded',
          source: { file: gherkinUiFeature, line: 10, column: 5 },
        },
      });
      expect(messages.some((message) => message.type === 'session')).toBe(false);
      expect(messages.some((message) => message.type === 'action')).toBe(false);
      const end = messages.find((message) => message.type === 'test-end');
      expect(end).toMatchObject({ type: 'test-end', status: 'passed' });
      expect(end).not.toHaveProperty('traceRef');
    } finally {
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('vitestRunTargetArgs', () => {
  it('keeps whole-suite and whole-file requests unchanged', () => {
    expect(vitestRunTargetArgs([])).toEqual([]);
    expect(vitestRunTargetArgs(['tests/login.test.ts'])).toEqual(['tests/login.test.ts']);
  });

  it('turns a discovered test id into its file', () => {
    expect(vitestRunTargetArgs(['/repo/login.test.ts::login > accepts [admin] (fast)?'])).toEqual([
      '/repo/login.test.ts',
    ]);
  });

  it('combines multiple discovered cases without duplicating their file', () => {
    expect(
      vitestRunTargetArgs(['/repo/a.test.ts::suite > first', '/repo/a.test.ts::suite > second']),
    ).toEqual(['/repo/a.test.ts']);
  });

  it('targets exact discovered cases across multiple files in one run', () => {
    expect(
      vitestRunTargetArgs(['/repo/a.test.ts::suite > first', '/repo/b.test.ts::suite > second']),
    ).toEqual([
      '/repo/a.test.ts',
      '/repo/b.test.ts',
    ]);
  });
});

describe('vitestArgsForBrowserRun', () => {
  it('replaces the watcher file filter while preserving Vitest options', async () => {
    await expect(
      vitestArgsForBrowserRun(
        ['tests/initial.test.ts', '--config', 'vitest.ui.ts', '--coverage', '--retry=2'],
        ['tests/clicked.test.ts'],
      ),
    ).resolves.toEqual(['--config', 'vitest.ui.ts', '--coverage', '--retry=2', 'tests/clicked.test.ts']);
  });

  it('keeps the CLI scope for a Run all click', async () => {
    await expect(
      vitestArgsForBrowserRun(['a.test.ts', 'b.test.ts', '--passWithNoTests'], []),
    ).resolves.toEqual(['a.test.ts', 'b.test.ts', '--passWithNoTests']);
  });

  it.each([
    ['short', ['-t', 'old case']],
    ['long', ['--testNamePattern', 'old case']],
    ['long equals', ['--testNamePattern=old case']],
    ['short equals', ['-t=old case']],
  ] as const)('preserves the scoped %s name filter as an intersection', async (_label, nameArgs) => {
    await expect(
      vitestArgsForBrowserRun(
        ['tests/initial.test.ts', ...nameArgs, '--coverage', '--pool', 'threads'],
        ['tests/clicked.test.ts'],
      ),
    ).resolves.toEqual([
      ...nameArgs,
      '--coverage',
      '--pool',
      'threads',
      'tests/clicked.test.ts',
    ]);
  });

  it('keeps the initial name filter when Run all means all cases in that scope', async () => {
    await expect(
      vitestArgsForBrowserRun(
        ['-t', 'first', '--bail=1', '--testNamePattern=second', '--passWithNoTests'],
        [],
      ),
    ).resolves.toEqual(['-t', 'first', '--bail=1', '--testNamePattern=second', '--passWithNoTests']);
  });
});

describe('testNamePatternFromArgs', () => {
  it('reads the first spelling Vitest applies to the initial watcher', () => {
    expect(testNamePatternFromArgs(['--pool', 'threads', '-t', 'selected case'])).toBe('selected case');
    expect(testNamePatternFromArgs(['--testNamePattern=selected case'])).toBe('selected case');
    expect(testNamePatternFromArgs(['-t', 'first', '--testNamePattern=second'])).toBe('first');
    expect(testNamePatternFromArgs(['--coverage'])).toBeUndefined();
  });
});

describe('startVitest', () => {
  it('stops only a browser-started run and leaves the watcher alive', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'termwright-stop-'));
    const bin = join(cwd, 'fake-vitest.mjs');
    const log = join(cwd, 'processes.log');
    await writeFile(
      bin,
      [
        "import { appendFileSync } from 'node:fs';",
        `const log = ${JSON.stringify(log)};`,
        "const mode = process.argv[2] ?? 'unknown';",
        "appendFileSync(log, `${mode}:start:${process.pid}\\n`);",
        "if (process.env.TERMWRIGHT_UI_SELECTION) appendFileSync(log, `${mode}:selection:${process.env.TERMWRIGHT_UI_SELECTION}\\n`);",
        "process.on('SIGTERM', () => {",
        "  appendFileSync(log, `${mode}:term:${process.pid}\\n`);",
        '  process.exit(0);',
        '});',
        'setInterval(() => undefined, 1_000);',
      ].join('\n'),
      'utf8',
    );

    const handle = startVitest(
      { args: ['--testNamePattern=watch selected'], uiUrl: 'http://127.0.0.1:1/?token=test', cwd },
      bin,
      [],
    );
    let watcherPid: number | undefined;
    try {
      const watchStart = await waitForLine(log, 'watch:start:');
      watcherPid = pidFrom(watchStart);
      expect(await waitForLine(log, 'watch:selection:')).toBe(
        'watch:selection:{"testNamePattern":"watch selected"}',
      );

      await handle.stop();
      await delay(50);
      expect(isAlive(watcherPid)).toBe(true);

      const runFinished = handle.run([]);
      const runStart = await waitForLine(log, 'run:start:');
      const runPid = pidFrom(runStart);
      expect(isAlive(runPid)).toBe(true);
      await expect(handle.run(['/repo/overlap.test.ts::must not start'])).rejects.toThrow(
        'a run started from the panel is still going',
      );
      expect(await waitForLine(log, 'run:selection:')).toBe(
        'run:selection:{"testNamePattern":"watch selected"}',
      );

      await handle.stop();
      await runFinished;
      expect(isAlive(runPid)).toBe(false);
      expect(isAlive(watcherPid)).toBe(true);

      await handle.stop();
      await delay(50);
      expect(isAlive(watcherPid)).toBe(true);

      const selectedRun = handle.run(['/repo/a.test.ts::suite > selected']);
      expect(await waitForLine(log, 'run:selection:', 2)).toBe(
        'run:selection:["/repo/a.test.ts::suite > selected"]',
      );
      await handle.stop();
      await selectedRun;

      await handle.shutdown();
      expect(isAlive(watcherPid)).toBe(false);
      await expect(handle.shutdown()).resolves.toBeUndefined();
    } finally {
      await handle.shutdown();
      if (watcherPid !== undefined && isAlive(watcherPid)) process.kill(watcherPid, 'SIGTERM');
      await handle.exited;
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

async function waitForLine(file: string, prefix: string, occurrence = 1): Promise<string> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const lines = await readFile(file, 'utf8').catch(() => '');
    const found = lines.split('\n').filter((line) => line.startsWith(prefix))[occurrence - 1];
    if (found !== undefined) return found;
    await delay(10);
  }
  throw new Error(`timed out waiting for ${prefix}`);
}

function pidFrom(line: string): number {
  const pid = Number(line.split(':').at(-1));
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`invalid pid in ${line}`);
  return pid;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runProcess(
  entry: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
): Promise<{ readonly code: number; readonly output: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], {
      cwd: projectRoot,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const append = (chunk: Buffer): void => {
      if (output.length < 2 * 1024 * 1024) output += chunk.toString('utf8');
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve({ code: signal === null ? (code ?? 1) : 1, output }));
  });
}
