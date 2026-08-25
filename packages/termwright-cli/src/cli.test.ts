import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { EXIT_CODES } from '@termwright/mcp';
import type { UiServer, UiServerOptions } from '@termwright/ui';
import { runCli, type CliDeps } from './cli.js';
import type { NativeHostHandle, NativeHostRun } from './ui-command.js';
import { CLI_VERSION } from './version.js';
import { TERMWRIGHT_RESOURCE_PROFILES } from './resource-profiles.js';
import type { DoctorReport } from './doctor.js';
import type { RunCompletion } from './test-host.js';

interface Harness {
  readonly deps: CliDeps;
  readonly out: string[];
  readonly err: string[];
  readonly uiOptions: UiServerOptions[];
  readonly runs: NativeHostRun[];
  readonly mcpArgs: string[][];
  readonly closed: () => number;
}

function harness(
  overrides: {
    readonly mode?: UiServer['mode'];
    readonly mcpExit?: number;
    /** Thrown by `startUi`, to stand in for an archive that will not open. */
    readonly startUiError?: unknown;
    readonly doctorOk?: boolean;
  } = {},
): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const uiOptions: UiServerOptions[] = [];
  const runs: NativeHostRun[] = [];
  const mcpArgs: string[][] = [];
  let closes = 0;

  const deps: CliDeps = {
    io: { out: (text) => out.push(text), err: (text) => err.push(text) },
    cwd: '/workspace',
    doctor: async () => doctorReport(overrides.doctorOk !== false),
    runMcp: async (argv) => {
      mcpArgs.push([...argv]);
      return overrides.mcpExit ?? EXIT_CODES.ok;
    },
    launchDesktop: async () => ({ closed: new Promise<void>(() => undefined), close: async () => undefined }),
    openBrowser: async () => true,
    processContext: { isTty: false, env: {} },
    ui: {
      startUi: async (options) => {
        if (overrides.startUiError !== undefined) throw overrides.startUiError;
        uiOptions.push(options);
        return {
          url: 'http://127.0.0.1:5000/?token=abc',
          producerUrl: 'http://127.0.0.1:5000/?token=producer',
          port: 5000,
          token: 'abc',
          producerToken: 'producer',
          mode: overrides.mode ?? 'live',
          hub: undefined as never,
          recorder: undefined,
          trace: undefined,
          attach: () => () => undefined,
          close: async () => {
            closes += 1;
          },
        } satisfies UiServer;
      },
      startHost: async (run): Promise<NativeHostHandle> => {
        runs.push(run);
        return {
          discover: async () => [],
          run: () => ({ runId: 'run:00000000-0000-4000-8000-000000000001' as never, completed: Promise.resolve() }),
          stop: async () => undefined,
subscribe: () => () => undefined,
shutdown: async () => undefined,
        };
      },
      waitForInterrupt: async () => undefined,
    },
  };

  return { deps, out, err, uiOptions, runs, mcpArgs, closed: () => closes };
}

function doctorReport(ok: boolean): DoctorReport {
  return {
    ok,
    checks: ok ? [] : [{ name: 'PTY backend', status: 'fail', detail: 'unavailable' }],
    effectiveConfig: {
      mode: 'termwright-native-only',
      engine: { name: 'vitest', version: '4.1.11' },
      defaultProfile: TERMWRIGHT_RESOURCE_PROFILES.local,
      profiles: TERMWRIGHT_RESOURCE_PROFILES,
      semantics: 'explicit-session-contract',
      flakyPolicy: 'fail',
      artifactValuePolicy: 'redacted',
      hostTimeouts: { startupMs: 30_000, runMs: 600_000, finalizationReserveMs: 30_000 },
    },
  };
}

describe('informational commands', () => {
  it('prints the version, and a JSON object with --json', async () => {
    const plain = harness();
    expect(await runCli(['--version'], plain.deps)).toBe(EXIT_CODES.ok);
    expect(plain.out).toEqual([CLI_VERSION]);

    const json = harness();
    await runCli(['--version', '--json'], json.deps);
    expect(JSON.parse(json.out[0] as string)).toMatchObject({ name: 'termwright', version: CLI_VERSION });
  });

  it('prints help listing every command', async () => {
    const h = harness();
    expect(await runCli([], h.deps)).toBe(EXIT_CODES.ok);
    const help = h.out.join('\n');
    for (const command of ['ui', 'codegen', 'mcp', 'agent-context', 'usage', 'skill']) {
      expect(help).toContain(command);
    }
  });

  it('emits the agent context generated from the MCP schemas', async () => {
    const h = harness();
    expect(await runCli(['agent-context'], h.deps)).toBe(EXIT_CODES.ok);
    const context = JSON.parse(h.out.join('\n')) as {
      tools: { name: string }[];
      server: { version: string };
      exitCodes: Record<string, number>;
    };
    expect(context.server.version.length).toBeGreaterThan(0);
    expect(context.tools.map((tool) => tool.name)).toContain('terminal.snapshot');
    // The taxonomy the CLI reports is the one it actually exits with.
    expect(context.exitCodes).toMatchObject({ ...EXIT_CODES });
  });

  it('emits the skill package as files', async () => {
    const h = harness();
    expect(await runCli(['skill'], h.deps)).toBe(EXIT_CODES.ok);
    expect(h.out.join('\n')).toContain('SKILL.md');
  });

  it('describes THIS cli, not the MCP server', async () => {
    const plain = harness();
    expect(await runCli(['usage'], plain.deps)).toBe(EXIT_CODES.ok);
    const sheet = plain.out.join('\n');

    // The whole point of the fix: a CLI user asking for usage gets the CLI.
    for (const command of ['ui', 'report', 'codegen', 'mcp', 'agent-context', 'skill']) {
      expect(sheet).toContain(command);
    }
    // …and is told where the MCP sheet went.
    expect(sheet).toContain('termwright mcp usage');
    // The MCP cheat sheet's own headline must not be what a CLI user sees.
    expect(sheet).not.toContain('drive terminal programs over MCP');
  });

  it('emits the command table with --json', async () => {
    const json = harness();
    expect(await runCli(['usage', '--json'], json.deps)).toBe(EXIT_CODES.ok);
    const document = JSON.parse(json.out[0] as string) as {
      commands: { name: string; synopsis: string[]; summary: string }[];
      exitCodes: Record<string, number>;
    };

    expect(document.commands.map((command) => command.name)).toEqual([
      'test',
      'watch',
      'ui',
      'report',
      'screenshot',
      'codegen',
      'mcp',
      'agent-context',
      'usage',
      'skill',
      'doctor',
    ]);
    expect(document.exitCodes).toMatchObject({ ...EXIT_CODES });
    for (const command of document.commands) {
      expect(command.synopsis.length, command.name).toBeGreaterThan(0);
      expect(command.summary.length, command.name).toBeGreaterThan(0);
    }
  });

  it('prints doctor results and fails only for failed checks', async () => {
    const healthy = harness();
    expect(await runCli(['doctor'], healthy.deps)).toBe(EXIT_CODES.ok);
    expect(healthy.out.join('\n')).toContain('Ready to run Termwright');

    const broken = harness({ doctorOk: false });
    expect(await runCli(['doctor', '--json'], broken.deps)).toBe(EXIT_CODES.assertion);
    expect(JSON.parse(broken.out[0] ?? '{}')).toMatchObject({ ok: false });
  });

  it('keeps help and usage describing the same commands', async () => {
    const help = harness();
    await runCli(['--help'], help.deps);
    const usage = harness();
    await runCli(['usage'], usage.deps);

    const json = harness();
    await runCli(['usage', '--json'], json.deps);
    const names = (JSON.parse(json.out[0] as string) as { commands: { name: string }[] }).commands;

    // Both are rendered from CLI_COMMANDS, so neither can drift from the other.
    for (const { name } of names) {
      expect(help.out.join('\n'), name).toContain(name);
      expect(usage.out.join('\n'), name).toContain(name);
    }
  });

  it('still reaches the MCP cheat sheet through `mcp usage`', async () => {
    const h = harness();
    expect(await runCli(['mcp', 'usage'], h.deps)).toBe(EXIT_CODES.ok);
    // The delegate is called with the arguments untouched.
    expect(h.mcpArgs).toEqual([['usage']]);
  });
});

describe('mcp delegation', () => {
  it('forwards its arguments to @termwright/mcp untouched', async () => {
    const h = harness();
    expect(await runCli(['mcp', '--http', '--port', '7333'], h.deps)).toBe(EXIT_CODES.ok);
    expect(h.mcpArgs).toEqual([['--http', '--port', '7333']]);
  });

  it('carries --json through, and returns the delegate exit code', async () => {
    const h = harness({ mcpExit: EXIT_CODES.noSession });
    expect(await runCli(['mcp', '--json'], h.deps)).toBe(EXIT_CODES.noSession);
    expect(h.mcpArgs[0]).toContain('--json');
  });
});

describe('the native test command', () => {
  it('projects only Bun policy controls into test workers', async () => {
    const h = harness();
    Object.assign(h.deps.processContext.env, {
      TERMWRIGHT_REQUIRE_BUN: '1',
      TERMWRIGHT_SKIP_BUN: '0',
      SECRET_FROM_CLI_PROCESS: 'must-not-leak',
    });
    const value = completion('passed', 1);
    const options: unknown[] = [];
    Object.assign(h.deps, {
      openTestHost: async (received: unknown) => {
        options.push(received);
        return {
          requestRun: () => ({ invocationId: value.invocationId, runId: value.runId, completed: Promise.resolve(value) }),
          watch: vi.fn(),
          close: async () => undefined,
        };
      },
    });

    expect(await runCli(['test'], h.deps)).toBe(EXIT_CODES.ok);
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({
      workerEnv: { TERMWRIGHT_REQUIRE_BUN: '1', TERMWRIGHT_SKIP_BUN: '0' },
    });
    expect((options[0] as { workerEnv: Record<string, string> }).workerEnv)
      .not.toHaveProperty('SECRET_FROM_CLI_PROCESS');
  });

  it('repeats complete cycles in one host and fails on the worst run', async () => {
    const h = harness();
    const close = vi.fn(async () => undefined);
    const requestRun = vi.fn();
    const completions = [completion('passed', 1), completion('failed', 2), completion('passed', 3)];
    for (const value of completions) {
      requestRun.mockReturnValueOnce({
        invocationId: value.invocationId,
        runId: value.runId,
        completed: Promise.resolve(value),
      });
    }
    Object.assign(h.deps, {
      openTestHost: async () => ({ requestRun, watch: vi.fn(), close }),
    });

    expect(await runCli(['test', '--runs', '3', '--json'], h.deps)).toBe(EXIT_CODES.assertion);
    expect(requestRun).toHaveBeenCalledTimes(3);
    expect(close).toHaveBeenCalledOnce();
    const report = JSON.parse(h.out[0] ?? '{}') as Record<string, unknown>;
    expect(report).toMatchObject({ state: 'failed', requestedRuns: 3, completedRuns: 3 });
    expect(report['runs']).toHaveLength(3);
  });

  it('stops repeating when the persistent host loses certification', async () => {
    const h = harness();
    const close = vi.fn(async () => undefined);
    const requestRun = vi.fn();
    for (const value of [completion('passed', 1), completion('infrastructure-failed', 2)]) {
      requestRun.mockReturnValueOnce({
        invocationId: value.invocationId,
        runId: value.runId,
        completed: Promise.resolve(value),
      });
    }
    Object.assign(h.deps, {
      openTestHost: async () => ({ requestRun, watch: vi.fn(), close }),
    });

    expect(await runCli(['test', '--runs', '50', '--json'], h.deps)).toBe(EXIT_CODES.internal);
    expect(requestRun).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledOnce();
    expect(JSON.parse(h.out[0] ?? '{}')).toMatchObject({
      state: 'infrastructure-failed', requestedRuns: 50, completedRuns: 2,
    });
  });

  it('does not certify an empty or entirely skipped run', async () => {
    const h = harness();
    const value = completion('skipped', 1);
    Object.assign(h.deps, {
      openTestHost: async () => ({
        requestRun: () => ({ invocationId: value.invocationId, runId: value.runId, completed: Promise.resolve(value) }),
        watch: vi.fn(),
        close: async () => undefined,
      }),
    });

    expect(await runCli(['test', '--json'], h.deps)).toBe(EXIT_CODES.assertion);
    expect(JSON.parse(h.out[0] ?? '{}')).toMatchObject({ state: 'skipped', completedRuns: 1 });
  });

  it('prints a yellow mixed-skip verdict and certifies only an exact declaration match', async () => {
    const allowed = {
      ...completion('passed-with-skips', 1),
      skips: [{
        runnerTaskId: 'runner-task:00000000-0000-4000-8000-000000000001' as never,
        nativeTaskId: 'native-skip',
        file: '/repo/platform.test.ts',
        fullName: 'platform case',
      }],
      skipPolicy: { status: 'matched' as const, declarations: 1, issues: [] },
    };
    const h = harness();
    Object.assign(h.deps, {
      openTestHost: async () => ({
        requestRun: () => ({ invocationId: allowed.invocationId, runId: allowed.runId, completed: Promise.resolve(allowed) }),
        watch: vi.fn(),
        close: async () => undefined,
      }),
    });
    expect(await runCli(['test', '--json'], h.deps)).toBe(EXIT_CODES.ok);
    expect(JSON.parse(h.out[0] ?? '{}')).toMatchObject({
      state: 'passed-with-skips',
      skipPolicy: 'matched',
    });

    const rejected = {
      ...allowed,
      skipPolicy: { status: 'mismatch' as const, declarations: 0, issues: ['undeclared skip'] },
    };
    const red = harness();
    Object.assign(red.deps, {
      openTestHost: async () => ({
        requestRun: () => ({ invocationId: rejected.invocationId, runId: rejected.runId, completed: Promise.resolve(rejected) }),
        watch: vi.fn(),
        close: async () => undefined,
      }),
    });
    expect(await runCli(['test', '--json'], red.deps)).toBe(EXIT_CODES.assertion);
  });
});

describe('the native watch command', () => {
  it('projects only Bun policy controls into watch workers', async () => {
    const h = harness();
    Object.assign(h.deps.processContext.env, {
      TERMWRIGHT_REQUIRE_BUN: '1',
      SECRET_FROM_CLI_PROCESS: 'must-not-leak',
    });
    const value = completion('passed', 1);
    const options: unknown[] = [];
    Object.assign(h.deps, {
      openTestHost: async (received: unknown) => {
        options.push(received);
        return {
          requestRun: vi.fn(),
          watch: () => ({
            initial: { invocationId: value.invocationId, runId: value.runId, completed: Promise.resolve(value) },
            close: async () => undefined,
          }),
          close: async () => undefined,
        };
      },
    });

    expect(await runCli(['watch'], h.deps)).toBe(EXIT_CODES.ok);
    expect(options[0]).toMatchObject({ workerEnv: { TERMWRIGHT_REQUIRE_BUN: '1' } });
    expect((options[0] as { workerEnv: Record<string, string> }).workerEnv)
      .not.toHaveProperty('SECRET_FROM_CLI_PROCESS');
  });

  it('does not certify an all-skipped initial cycle', async () => {
    const h = harness();
    const value = {
      ...completion('skipped', 1),
      skips: [{
        runnerTaskId: 'runner-task:00000000-0000-4000-8000-000000000001' as never,
        nativeTaskId: 'native-skip', file: '/repo/skipped.test.ts', fullName: 'skipped case',
      }],
      skipPolicy: { status: 'mismatch' as const, declarations: 0, issues: ['undeclared skip'] },
    };
    const close = vi.fn(async () => undefined);
    Object.assign(h.deps, {
      openTestHost: async () => ({
        requestRun: vi.fn(),
        watch: () => ({
          initial: { invocationId: value.invocationId, runId: value.runId, completed: Promise.resolve(value) },
          close,
        }),
        close,
      }),
    });

    expect(await runCli(['watch', '--json'], h.deps)).toBe(EXIT_CODES.assertion);
    expect(JSON.parse(h.out[0] ?? '{}')).toMatchObject({
      state: 'skipped', watching: true,
      skips: [{ nativeTaskId: 'native-skip' }],
      skipPolicy: { status: 'mismatch', issues: ['undeclared skip'] },
    });
  });
});

function completion(state: RunCompletion['state'], ordinal: number): RunCompletion {
  return {
    invocationId: 'invocation:00000000-0000-4000-8000-000000000001' as never,
    runId: `run:00000000-0000-4000-8000-${String(ordinal).padStart(12, '0')}` as never,
    state,
    catalog: undefined,
    events: [],
    failures: [],
    skips: [],
    skipPolicy: { status: 'matched', declarations: 0, issues: [] },
  };
}

describe('the ui command', () => {
  it('starts the native host and UI server, and prints the URL', async () => {
    const h = harness();
    Object.assign(h.deps.processContext.env, {
      TERMWRIGHT_REQUIRE_BUN: '1',
      SECRET_FROM_CLI_PROCESS: 'must-not-leak',
    });
    expect(await runCli(['ui'], h.deps)).toBe(EXIT_CODES.ok);

    expect(h.out.join('\n')).toContain('http://127.0.0.1:5000/?token=abc');
    expect(h.runs).toHaveLength(1);
    expect(h.runs[0]).toMatchObject({
      args: [], cwd: '/workspace', resourceProfile: 'local',
      workerEnv: { TERMWRIGHT_REQUIRE_BUN: '1' },
    });
    expect(h.runs[0]?.workerEnv).not.toHaveProperty('SECRET_FROM_CLI_PROCESS');
    expect(h.closed()).toBe(1);
  });

  it('forwards Gherkin tag selection to discovery and every managed run', async () => {
    const h = harness();
    expect(await runCli(['ui', '--tags', '@component and not @slow'], h.deps)).toBe(EXIT_CODES.ok);

    expect(h.runs).toHaveLength(1);
    expect(h.runs[0]).toMatchObject({ tags: '@component and not @slow' });
  });

  it('opens Electron by default for an interactive terminal', async () => {
    const h = harness();
    const launchDesktop = vi.fn(async () => ({
      closed: new Promise<void>(() => undefined),
      close: async () => undefined,
    }));
    Object.assign(h.deps, {
      launchDesktop,
      processContext: { isTty: true, env: {} },
    });

    expect(await runCli(['ui'], h.deps)).toBe(EXIT_CODES.ok);
    expect(launchDesktop).toHaveBeenCalledWith('http://127.0.0.1:5000/?token=abc');
  });

  it('uses the browser only when selected explicitly', async () => {
    const h = harness();
    const launchDesktop = vi.fn(h.deps.launchDesktop);
    const openBrowser = vi.fn(async () => true);
    Object.assign(h.deps, {
      launchDesktop,
      openBrowser,
      processContext: { isTty: true, env: {} },
    });

    await runCli(['ui', '--browser'], h.deps);
    expect(openBrowser).toHaveBeenCalledWith('http://127.0.0.1:5000/?token=abc');
    expect(launchDesktop).not.toHaveBeenCalled();
  });

  it.each([
    ['--no-open', ['ui', '--no-open'], { isTty: true, env: {} }],
    ['JSON', ['ui', '--json'], { isTty: true, env: {} }],
    ['non-TTY', ['ui'], { isTty: false, env: {} }],
    ['CI', ['ui'], { isTty: true, env: { CI: 'true' } }],
  ] as const)('opens no window for %s', async (_label, argv, processContext) => {
    const h = harness();
    const launchDesktop = vi.fn(h.deps.launchDesktop);
    const openBrowser = vi.fn(h.deps.openBrowser);
    Object.assign(h.deps, { launchDesktop, openBrowser, processContext });
    await runCli(argv, h.deps);
    expect(launchDesktop).not.toHaveBeenCalled();
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it('reports a desktop failure and falls back once to the browser', async () => {
    const h = harness();
    const openBrowser = vi.fn(async () => true);
    Object.assign(h.deps, {
      launchDesktop: async () => { throw new Error('host unavailable'); },
      openBrowser,
      processContext: { isTty: true, env: {} },
    });
    await runCli(['ui'], h.deps);
    expect(h.err.join('\n')).toContain('falling back to the browser');
    expect(openBrowser).toHaveBeenCalledOnce();
  });

  it('closing the desktop window shuts down the watcher and server', async () => {
    const h = harness();
    let closeWindow: (() => void) | undefined;
    const closed = new Promise<void>((resolve) => { closeWindow = resolve; });
    const shutdown = vi.fn(async () => undefined);
    const closeHost = vi.fn(async () => undefined);
    const ui = h.deps.ui as { startHost: CliDeps['ui']['startHost'] };
    ui.startHost = async () => ({
      discover: async () => [],
      run: () => ({ runId: 'run:00000000-0000-4000-8000-000000000001' as never, completed: new Promise(() => undefined) }),
      stop: async () => undefined,
      subscribe: () => () => undefined,
      shutdown,
    });
    Object.assign(h.deps, {
      launchDesktop: async () => ({ closed, close: closeHost }),
      processContext: { isTty: true, env: {} },
    });

    const running = runCli(['ui'], h.deps);
    await vi.waitFor(() => expect(closeWindow).toBeTypeOf('function'));
    closeWindow?.();
    expect(await running).toBe(EXIT_CODES.ok);
    expect(shutdown).toHaveBeenCalledOnce();
    expect(closeHost).toHaveBeenCalledOnce();
    expect(h.closed()).toBe(1);
  });

  it('forwards runner arguments after --', async () => {
    const h = harness();
    await runCli(['ui', '--', 'src/login.test.ts'], h.deps);
    expect(h.runs[0]?.args).toEqual(['src/login.test.ts']);
  });

  it('prints machine-readable readiness with --json', async () => {
    const h = harness();
    await runCli(['ui', '--json'], h.deps);
    expect(JSON.parse(h.out[0] as string)).toEqual({
      url: 'http://127.0.0.1:5000/?token=abc',
      port: 5000,
      mode: 'live',
    });
  });

  it('lists the project’s tests before the run that fills them in', async () => {
    // Without this the panel stays empty until tests start reporting, which is
    // the opposite of what discovery is for.
    const h = harness();
    await runCli(['ui', '--', 'src/login.test.ts'], h.deps);
    expect(h.uiOptions[0]?.discovery).toMatchObject({
      cwd: '/workspace',
      watch: true,
    });
    expect(h.runs[0]?.args).toEqual(['src/login.test.ts']);
    expect(h.uiOptions[0]?.discovery?.load).toBeTypeOf('function');
  });

  it('does not list a project’s tests for a replay or a recording', async () => {
    // Neither shows a run that has not happened: an archive and a recording
    // already know what they contain.
    const replay = harness({ mode: 'post-mortem' });
    await runCli(['ui', '--trace', 'out/login.twtrace'], replay.deps);
    expect(replay.uiOptions[0]?.discovery).toBeUndefined();

    const recording = harness({ mode: 'record' });
    await runCli(['codegen', '--', 'node', 'agent.js'], recording.deps);
    expect(recording.uiOptions[0]?.discovery).toBeUndefined();
  });

  it('calls a path that does not open a usage error, not an internal fault', async () => {
    // The taxonomy is a contract for agents and CI: 2 means "you typed
    // something wrong", 5 means "termwright broke". A missing file is the user's
    // input, however it surfaces — the trace reader calls it a protocol
    // violation and the filesystem calls it ENOENT.
    const archiveMissing = Object.assign(new Error('trace not found: /nowhere.twtrace'), {
      code: 'protocol-violation',
    });
    const h = harness({ mode: 'post-mortem', startUiError: archiveMissing });

    expect(await runCli(['ui', '--trace', '/nowhere.twtrace'], h.deps)).toBe(EXIT_CODES.usage);
    expect(h.err.join('\n')).toContain('/nowhere.twtrace');
  });

  it('points at the path when the archive is missing, and at the file when it is broken', async () => {
    // Both are the user's input, so both are exit 2 — but "check the path" is
    // the wrong advice for a truncated artifact off a CI job, which is the
    // case where looking in the wrong place costs the most.
    const missing = harness({
      mode: 'post-mortem',
      startUiError: Object.assign(new Error('trace not found: /gone.twtrace'), { code: 'ENOENT' }),
    });
    expect(await runCli(['ui', '--trace', '/gone.twtrace'], missing.deps)).toBe(EXIT_CODES.usage);
    expect(missing.err.join('\n')).toContain('check the path');

    // A path that really is there, because "is it there?" is answered by the
    // filesystem: `openTrace` currently reports a missing archive as a protocol
    // violation, so the code alone cannot tell these two cases apart.
    const broken = harness({
      mode: 'post-mortem',
      startUiError: Object.assign(new Error('meta.json is not valid JSON'), {
        code: 'protocol-violation',
      }),
    });
    const present = fileURLToPath(import.meta.url);
    expect(await runCli(['ui', '--trace', present], broken.deps)).toBe(EXIT_CODES.usage);
    expect(broken.err.join('\n')).toContain('does not read as an archive');
    expect(broken.err.join('\n')).not.toContain('check the path');
  });

  it('keeps a fault of our own reading as internal', async () => {
    // Reclassifying everything would hide our bugs behind "you typed it wrong".
    const bug = new TypeError('cannot read properties of undefined');
    const h = harness({ mode: 'post-mortem', startUiError: bug });
    expect(await runCli(['ui', '--trace', '/out/login.twtrace'], h.deps)).toBe(EXIT_CODES.internal);
  });

  it('opens an archive without starting a runner', async () => {
    const h = harness({ mode: 'post-mortem' });
    expect(await runCli(['ui', '--trace', 'out/login.twtrace'], h.deps)).toBe(EXIT_CODES.ok);
    expect(h.uiOptions[0]).toMatchObject({ trace: 'out/login.twtrace' });
    expect(h.runs).toHaveLength(0);
    expect(h.closed()).toBe(1);
  });

  it('records a command instead of watching a suite', async () => {
    const h = harness({ mode: 'record' });
    expect(
      await runCli(['codegen', '--out-file', 'src/rec.test.ts', '--', 'node', 'agent.js'], h.deps),
    ).toBe(EXIT_CODES.ok);

    expect(h.uiOptions[0]?.record).toMatchObject({
      command: ['node', 'agent.js'],
      outFile: 'src/rec.test.ts',
      cwd: '/workspace',
    });
    expect(h.runs).toHaveLength(0);
  });

  it('keeps native discovery and exact run controls with --no-watch', async () => {
    const h = harness();
    await runCli(['ui', '--no-watch'], h.deps);
    expect(h.runs).toHaveLength(1);
    expect(h.uiOptions[0]?.discovery).toMatchObject({ watch: false });
    expect(h.uiOptions[0]?.onRun).toBeTypeOf('function');
    expect(h.uiOptions[0]?.onStop).toBeTypeOf('function');
    expect(h.closed()).toBe(1);
  });

  it('wires the browser controls to the runner', async () => {
    const h = harness();
    const run = vi.fn(async (_ids: readonly string[]) => undefined);
    const stop = vi.fn(async () => undefined);
    const ui = h.deps.ui as { startHost: CliDeps['ui']['startHost'] };
    let released: (() => void) | undefined;
    ui.startHost = async () => ({
      discover: async () => [],
      run: (ids) => {
        void run(ids);
        return { runId: 'run:00000000-0000-4000-8000-000000000001' as never, completed: new Promise<void>((resolve) => { released = resolve; }) };
      },
      stop: async () => { await stop(); },
subscribe: () => () => undefined,
shutdown: async () => undefined,
    });

    const running = runCli(['ui'], h.deps);
    await vi.waitFor(() => expect(h.uiOptions).toHaveLength(1));

    const started = await h.uiOptions[0]?.onRun?.(['tests/a.test.ts']);
    expect(released).toBeTypeOf('function');
    if (started !== undefined) await h.uiOptions[0]?.onStop?.(started.runId);
    // The panel sends native RunnerTaskIds to the one persistent host.
    expect(run).toHaveBeenCalledWith(['tests/a.test.ts']);
    expect(stop).toHaveBeenCalledOnce();

    released?.();
    expect(await running).toBe(EXIT_CODES.ok);
  });

  it('closes the UI server when native host startup fails', async () => {
    const h = harness();
    const ui = h.deps.ui as { startHost: CliDeps['ui']['startHost'] };
    ui.startHost = async () => {
      throw new Error('vitest is not installed in this project');
    };

    expect(await runCli(['ui'], h.deps)).toBe(EXIT_CODES.internal);
    expect(h.err.join('\n')).toContain('vitest is not installed');
    expect(h.uiOptions).toHaveLength(1);
    expect(h.closed()).toBe(1);
  });
});

describe('failures', () => {
  it('maps a usage error to exit code 2', async () => {
    const h = harness();
    expect(await runCli(['--nope'], h.deps)).toBe(EXIT_CODES.usage);
    expect(h.err.join('\n')).toContain('usage:');
  });

  it('renders failures as JSON carrying kind when asked, even for a later argument', async () => {
    const h = harness();
    expect(await runCli(['--json', 'ui', '--port', 'soon'], h.deps)).toBe(EXIT_CODES.usage);
    expect(JSON.parse(h.err[0] as string)).toMatchObject({ kind: 'usage' });
  });

  it('honours --json when the failing argument comes before it', async () => {
    const h = harness();
    expect(await runCli(['ui', '--port', 'soon', '--json'], h.deps)).toBe(EXIT_CODES.usage);
    expect(JSON.parse(h.err[0] as string)).toMatchObject({ kind: 'usage' });
  });
});
