/**
 * `termwright ui` — start the runner and, in live mode, the test suite that
 * feeds it.
 *
 * The division of labour is `@termwright/ui`'s: `startUiServer` owns the
 * server, the browser app and the recorder, and publishes to a URL. This file
 * owns the *process* around it — resolving the project's Vitest, handing it
 * `TERMWRIGHT_UI_URL`, leaving the terminal attached so watch-mode hotkeys keep
 * working, and isolating browser-started runs from the long-lived watcher that
 * keeps the runner UI alive.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseDiscoveredId,
  UI_SELECTION_ENV,
  type DiscoveryOptions,
  type UiServer,
  type UiServerOptions,
} from '@termwright/ui';

/** How the runner should be started. */
export interface VitestRun {
  /** Extra arguments, forwarded after `vitest`. */
  readonly args: readonly string[];
  /** Published to the test process so the reporter finds the server. */
  readonly uiUrl: string;
  readonly cwd: string;
  /** Cucumber tag expression forwarded privately to the managed transform. */
  readonly tags?: string;
}

/** A running test process the browser's controls can reach. */
export interface VitestHandle {
  /** Resolves with the long-lived watcher's exit code. */
  readonly exited: Promise<number>;
  /**
   * Runs the tests the panel asked for, and resolves when they finish.
   *
   * @param files - spec files to run; empty means the whole suite.
   * @throws Error when the run could not be started.
   */
  run(files: readonly string[]): Promise<void>;
  /** Cancel the run started from the panel; a watcher-only handle is a no-op. */
  stop(): Promise<void>;
  /** Cancel panel work and terminate the long-lived watcher. Idempotent. */
  shutdown(): Promise<void>;
}

/** The variable `@termwright/ui`'s reporter reads. */
export const UI_URL_ENV = 'TERMWRIGHT_UI_URL';

/**
 * Resolve the project's own Vitest binary.
 *
 * Resolution starts at the working directory, so the version under test is the
 * project's rather than whatever happens to be next to this package. Vitest is
 * an optional peer of the umbrella: a repository that only uses the driver
 * never installs it, and only ever sees this error if it asks for watch mode.
 *
 * @throws Error when Vitest is not installed in the project.
 */
export function resolveVitestBin(cwd: string): string {
  const require = createRequire(join(cwd, 'noop.js'));
  let manifestPath: string;
  try {
    manifestPath = require.resolve('vitest/package.json');
  } catch {
    throw new Error(
      'vitest is not installed in this project; `termwright ui` needs it to watch a run ' +
        '(install it, or pass --no-watch to only open the runner)',
    );
  }
  const manifest = require('vitest/package.json') as { bin?: string | Record<string, string> };
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.['vitest'];
  if (bin === undefined) throw new Error('the installed vitest declares no `vitest` binary');
  return join(dirname(manifestPath), bin);
}

/**
 * The reporter that talks to the panel, as an absolute path.
 *
 * A bare specifier does not resolve from the project under test — it depends on
 * `@termwright/test`, not on `@termwright/ui`, and a strict `node_modules` is
 * right to refuse it. This package *does* depend on the panel, so it can hand
 * Vitest the file.
 *
 * @throws Error when the panel's reporter cannot be found, which means a broken
 * installation rather than a project without something configured.
 */
export function uiReporterPath(): string {
  return fileURLToPath(import.meta.resolve('@termwright/ui/reporter'));
}

/** The fail-closed runner used only by UI-owned Vitest processes. */
export function uiTestRunnerPath(): string {
  return createRequire(import.meta.url).resolve('@termwright/test/ui-runner');
}

/** Built child host which installs the UI runner through Vitest's Node API. */
export function uiVitestHostPath(): string {
  const adjacent = fileURLToPath(new URL('./vitest-ui-host.js', import.meta.url));
  // Production code is bundled beside the host. Vitest executes this source
  // module directly, so package tests deliberately exercise the freshly built
  // host from `dist/` instead of requiring a second TypeScript subprocess.
  return existsSync(adjacent)
    ? adjacent
    : fileURLToPath(new URL('../dist/vitest-ui-host.js', import.meta.url));
}

/**
 * Public-API discovery for provider-owned cases.
 *
 * Vitest's built-in JSON listing intentionally omits task metadata. Its public
 * `collect()` model keeps it, so the UI reads that model and emits the same
 * compact shape `@termwright/ui` already validates.
 */
export async function discoverTermwrightListing(
  options: DiscoveryOptions,
  tags?: string,
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [uiVitestHostPath(), 'list', ...(options.args ?? [])],
      {
        cwd: options.cwd,
        env: {
          ...process.env,
          ...(tags === undefined ? {} : { TERMWRIGHT_GHERKIN_TAGS: tags }),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `Termwright Vitest discovery exited with ${String(code)}`));
    });
  });
}

/**
 * Arguments that point a Vitest process at the panel.
 *
 * Injected rather than required in the project's config, because a runner you
 * have to configure before it shows you anything is a runner nobody sees work.
 * `default` comes first so the terminal keeps its usual output.
 *
 * The cost, stated because it is real: Vitest's `--reporter` *replaces* the
 * reporters a config declares, so a run the panel drives does not also produce
 * whatever that config sets up (an HTML report, JUnit XML). Anything the user
 * adds after `--` is appended to these rather than replacing them.
 */
export function reporterArgs(): readonly string[] {
  return ['--reporter=default', `--reporter=${uiReporterPath()}`];
}

/**
 * Turns the browser's discovered ids back into arguments understood by
 * Vitest. File rows already send plain paths; test rows send
 * `<file>::<full name>` so one click can select one case without a server-side
 * discovery table.
 *
 * Exact case selection is enforced by the UI-only runner from the original
 * array in `TERMWRIGHT_UI_SELECTION`. Passing only the deduplicated files here
 * avoids the cross product produced by a global Vitest name alternation.
 */
export function vitestRunTargetArgs(testIds: readonly string[]): readonly string[] {
  const parsed = testIds.map(parseDiscoveredId);
  if (parsed.some((target) => target === null)) return testIds;

  const targets = parsed.filter((target): target is NonNullable<typeof target> => target !== null);
  if (targets.length === 0) return [];
  return [...new Set(targets.map((target) => target.file))];
}

/** The first name filter Vitest will apply, in either supported CLI spelling. */
export function testNamePatternFromArgs(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '-t' || arg === '--testNamePattern') return args[index + 1];
    if (arg?.startsWith('--testNamePattern=') === true) return arg.slice('--testNamePattern='.length);
    if (arg?.startsWith('-t=') === true) return arg.slice('-t='.length);
  }
  return undefined;
}

/**
 * Replaces the filters which scoped the long-lived watcher with the target a
 * browser click selected. Keeping both makes `termwright ui -- a.test.ts` plus
 * a click on `b.test.ts` run both files, which is surprising and especially
 * expensive in a large project. Vitest's own parser identifies positional
 * filters without us maintaining a second copy of its option grammar.
 */
export async function vitestArgsForBrowserRun(
  baseArgs: readonly string[],
  targets: readonly string[],
): Promise<readonly string[]> {
  // “Run all” means every case in the UI's current CLI scope. If the runner
  // was opened as `termwright ui -- packages/a.test.ts`, throwing that filter
  // away can unexpectedly start an entire monorepo. Only an explicit row/file
  // click replaces the scope.
  if (targets.length === 0) return [...baseArgs];
  const { parseCLI } = await import('vitest/node');
  // Browser selections are members of the discovery catalogue for this CLI
  // scope. Preserve its name pattern as an intersection; exact pair selection
  // is applied independently by the UI-only runner.
  const args = [...baseArgs];
  const filters = parseCLI(['vitest', 'run', ...args], { allowUnknownOptions: true }).filter;
  // Remove from the end: an option value and a positional filter can
  // technically be identical, and the positional one conventionally comes
  // later. The parser remains the authority on which values are filters.
  for (const filter of filters) {
    const index = args.lastIndexOf(filter);
    if (index >= 0) args.splice(index, 1);
  }
  return [...args, ...targets];
}

/**
 * Start Vitest in watch mode with the runner's URL in its environment.
 *
 * The watcher inherits the terminal so its own hotkeys keep working. Runs
 * requested from the browser are separate one-shot children: this lets Stop
 * cancel precisely that work without quitting the watcher and taking the UI
 * server down with it.
 */
export function startVitest(
  run: VitestRun,
  bin = uiVitestHostPath(),
  // Injectable because the process-lifecycle test uses a tiny executable in
  // place of Vitest; production always resolves the real UI reporter here.
  reporters = reporterArgs(),
): VitestHandle {
  // Keep the explicit, project-relative validation and its actionable error.
  // The actual process is our API host because Vitest 3.2 has no --runner CLI
  // flag; its peer import resolves to this project installation.
  if (bin === uiVitestHostPath()) resolveVitestBin(run.cwd);
  // `inherit`, not `pipe`. Vitest registers its watch-mode hotkeys only when
  // its stdin is a TTY, so piping stdin to forward keystrokes disabled the very
  // keys we were forwarding — `r` and `q` did nothing, for the terminal and for
  // the browser alike. The terminal owns its keys again, and the panel starts
  // runs of its own rather than pretending to type.
  const watcherNamePattern = testNamePatternFromArgs(run.args);
  const watcher = spawn(process.execPath, [bin, 'watch', ...reporters, ...run.args], {
    cwd: run.cwd,
    env: {
      ...process.env,
      [UI_URL_ENV]: run.uiUrl,
      ...(watcherNamePattern === undefined || watcherNamePattern === ''
        ? {}
        : { [UI_SELECTION_ENV]: JSON.stringify({ testNamePattern: watcherNamePattern }) }),
      ...(run.tags === undefined ? {} : { TERMWRIGHT_GHERKIN_TAGS: run.tags }),
    },
    stdio: 'inherit',
  });

  const exited = new Promise<number>((resolve) => {
    watcher.on('exit', (code, signal) => {
      // A signalled watcher is an intentional terminal-side shutdown, not a
      // failed test run.
      resolve(signal !== null ? 0 : (code ?? 0));
    });
    watcher.on('error', () => resolve(1));
  });

  /** The run the panel started, so a second request does not race the first. */
  let current: ChildProcess | undefined;
  let currentDone: Promise<void> | undefined;
  let shuttingDown: Promise<void> | undefined;

  const shutdown = (): Promise<void> => {
    shuttingDown ??= (async () => {
      const started = current;
      const done = currentDone;
      if (started !== undefined && done !== undefined) {
        started.kill('SIGTERM');
        const forceRun = setTimeout(() => started.kill('SIGKILL'), 2_000);
        try {
          await done;
        } finally {
          clearTimeout(forceRun);
        }
      }
      if (watcher.exitCode !== null || watcher.signalCode !== null) return;
      watcher.kill('SIGTERM');
      const forceWatcher = setTimeout(() => watcher.kill('SIGKILL'), 2_000);
      try {
        await exited;
      } finally {
        clearTimeout(forceWatcher);
      }
    })();
    return shuttingDown;
  };

  return {
    exited,
    async run(files: readonly string[]): Promise<void> {
      if (current !== undefined) throw new Error('a run started from the panel is still going');
      // A fresh `vitest run` rather than a keystroke into the watcher: it can
      // be told *which* files to run, which is what "Run this spec" means, and
      // the watcher's `r` can only ever rerun everything.
      const targets = vitestRunTargetArgs(files);
      const runArgs = await vitestArgsForBrowserRun(run.args, targets);
      const selection =
        files.length > 0
          ? JSON.stringify(files)
          : watcherNamePattern === undefined || watcherNamePattern === ''
            ? undefined
            : JSON.stringify({ testNamePattern: watcherNamePattern });
      const started = spawn(process.execPath, [bin, 'run', ...reporters, ...runArgs], {
        cwd: run.cwd,
        env: {
          ...process.env,
          [UI_URL_ENV]: run.uiUrl,
          ...(selection === undefined ? {} : { [UI_SELECTION_ENV]: selection }),
          ...(run.tags === undefined ? {} : { TERMWRIGHT_GHERKIN_TAGS: run.tags }),
        },
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      current = started;
      const done = new Promise<void>((resolve, reject) => {
        started.on('error', (error: Error) => reject(new Error(`could not start vitest: ${error.message}`)));
        // A failing test is a result, not a failure to run: the panel already
        // shows which tests failed, and reporting it here as an error would
        // put a scary notice over an ordinary red run.
        started.on('exit', () => resolve());
      });
      currentDone = done;
      try {
        await done;
      } finally {
        if (current === started) {
          current = undefined;
          currentDone = undefined;
        }
      }
    },
    async stop(): Promise<void> {
      // Stop belongs to the one-shot run the browser launched. Killing the
      // watcher here would resolve `exited`, which makes `runUi` close the UI
      // server; with no current run there is deliberately nothing to do.
      const started = current;
      const done = currentDone;
      if (started === undefined || done === undefined) return;
      started.kill('SIGTERM');
      const force = setTimeout(() => started.kill('SIGKILL'), 2_000);
      try {
        await done;
      } finally {
        clearTimeout(force);
      }
    },
    shutdown,
  };
}

/** Everything `runUi` needs, injectable so the CLI is testable without a server. */
export interface UiRuntime {
  readonly startUi: (options: UiServerOptions) => Promise<UiServer>;
  readonly startVitest: (run: VitestRun) => VitestHandle;
  /** Resolves when the user interrupts a server that has nothing to wait for. */
  readonly waitForInterrupt: () => Promise<void>;
}

/** What `runUi` was asked to do, already parsed. */
export interface UiRequest {
  readonly trace: string | undefined;
  readonly record: readonly string[] | undefined;
  readonly outFile: string | undefined;
  readonly port: number | undefined;
  readonly host: string | undefined;
  readonly tags: string | undefined;
  readonly watch: boolean;
  readonly rest: readonly string[];
  readonly cwd: string;
}

/** What the command produced, for the caller to render. */
export interface UiResult {
  readonly url: string;
  readonly port: number;
  readonly mode: UiServer['mode'];
  /** Vitest's exit code, when the command ran it. */
  readonly runnerExitCode: number | undefined;
}

/** A visual client whose lifetime is tied to this UI command. */
export interface UiSurfaceHandle {
  readonly closed: Promise<void>;
  close(): Promise<void>;
}

/**
 * Start the runner, and in live mode the suite that feeds it.
 *
 * The server is always closed before this resolves, including when the runner
 * failed: a leaked server holds a port and a token for the rest of the session.
 */
export async function runUi(
  request: UiRequest,
  runtime: UiRuntime,
  onReady: (result: Omit<UiResult, 'runnerExitCode'>) => void | UiSurfaceHandle | Promise<void | UiSurfaceHandle>,
): Promise<UiResult> {
  let handle: VitestHandle | undefined;

  const server = await runtime.startUi({
    ...(request.port === undefined ? {} : { port: request.port }),
    ...(request.host === undefined ? {} : { host: request.host }),
    ...(request.trace === undefined ? {} : { trace: request.trace }),
    ...(request.record === undefined
      ? {}
      : {
          record: {
            command: request.record,
            cwd: request.cwd,
            ...(request.outFile === undefined ? {} : { outFile: request.outFile }),
          },
        }),
    // Discovery is about a run that has not happened yet, so it belongs to the
    // live mode only: a replayed archive and a recording already know what they
    // contain. Re-listing follows watch mode, which is when files change.
    ...(request.trace === undefined && request.record === undefined
      ? {
          discovery: {
            cwd: request.cwd,
            watch: request.watch,
            args: request.rest,
            run: (options: DiscoveryOptions) => discoverTermwrightListing(options, request.tags),
          },
        }
      : {}),
    ...(request.trace === undefined && request.record === undefined && request.watch
      ? {
          onRerun: async (testIds: readonly string[] | undefined) => {
            if (handle === undefined) throw new Error('this panel has no test runner behind it');
            await handle.run(testIds ?? []);
          },
          onStop: async () => {
            await handle?.stop();
          },
        }
      : {}),
  });

  const surface = (await onReady({ url: server.url, port: server.port, mode: server.mode })) ?? undefined;

  try {
    // Only a live run has a suite to drive; a trace is already recorded and a
    // recording is driven from the browser.
    if (server.mode === 'live' && request.watch) {
      handle = runtime.startVitest({
        args: request.rest,
        uiUrl: server.url,
        cwd: request.cwd,
        ...(request.tags === undefined ? {} : { tags: request.tags }),
      });
      const outcome = surface === undefined
        ? { type: 'runner' as const, code: await handle.exited }
        : await Promise.race([
            handle.exited.then((code) => ({ type: 'runner' as const, code })),
            surface.closed.then(() => ({ type: 'surface' as const })),
          ]);
      if (outcome.type === 'surface') {
        return { url: server.url, port: server.port, mode: server.mode, runnerExitCode: 0 };
      }
      const runnerExitCode = outcome.code;
      return { url: server.url, port: server.port, mode: server.mode, runnerExitCode };
    }

    if (surface === undefined) await runtime.waitForInterrupt();
    else await Promise.race([runtime.waitForInterrupt(), surface.closed]);
    return { url: server.url, port: server.port, mode: server.mode, runnerExitCode: undefined };
  } finally {
    await handle?.shutdown();
    await server.close();
    await surface?.close();
  }
}

/** Resolves on the first SIGINT or SIGTERM. */
export function waitForInterrupt(): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      process.off('SIGINT', done);
      process.off('SIGTERM', done);
      resolve();
    };
    process.once('SIGINT', done);
    process.once('SIGTERM', done);
  });
}
