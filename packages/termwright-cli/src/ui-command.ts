/**
 * `termwright ui` — start the runner and, in live mode, the test suite that
 * feeds it.
 *
 * The division of labour is `@termwright/ui`'s: `startUiServer` owns the
 * server, the browser app and the recorder, and publishes to a URL. This file
 * owns the *process* around it — resolving the project's Vitest, handing it
 * `TERMWRIGHT_UI_URL`, forwarding the terminal's keystrokes so watch-mode
 * hotkeys keep working, and wiring the browser's rerun and stop buttons to the
 * same two keys.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { UiServer, UiServerOptions } from '@termwright/ui';

/** How the runner should be started. */
export interface VitestRun {
  /** Extra arguments, forwarded after `vitest`. */
  readonly args: readonly string[];
  /** Published to the test process so the reporter finds the server. */
  readonly uiUrl: string;
  readonly cwd: string;
}

/** A running test process the browser's controls can reach. */
export interface VitestHandle {
  /** Resolves with the runner's exit code. */
  readonly exited: Promise<number>;
  /**
   * Runs the tests the panel asked for, and resolves when they finish.
   *
   * @param files - spec files to run; empty means the whole suite.
   * @throws Error when the run could not be started.
   */
  run(files: readonly string[]): Promise<void>;
  /** Ask the runner to quit. */
  stop(): void;
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
 * Start Vitest in watch mode with the runner's URL in its environment.
 *
 * `stdin` is piped rather than inherited so that the browser's rerun and stop
 * controls can press the same keys a person would; the terminal's own input is
 * forwarded on to keep every other hotkey working.
 */
export function startVitest(run: VitestRun, bin = resolveVitestBin(run.cwd)): VitestHandle {
  // `inherit`, not `pipe`. Vitest registers its watch-mode hotkeys only when
  // its stdin is a TTY, so piping stdin to forward keystrokes disabled the very
  // keys we were forwarding — `r` and `q` did nothing, for the terminal and for
  // the browser alike. The terminal owns its keys again, and the panel starts
  // runs of its own rather than pretending to type.
  const child = spawn(process.execPath, [bin, 'watch', ...reporterArgs(), ...run.args], {
    cwd: run.cwd,
    env: { ...process.env, [UI_URL_ENV]: run.uiUrl },
    stdio: 'inherit',
  });

  const exited = new Promise<number>((resolve) => {
    child.on('exit', (code, signal) => {
      // A signalled runner is a stop, not a failure.
      resolve(signal !== null ? 0 : (code ?? 0));
    });
    child.on('error', () => resolve(1));
  });

  /** The run the panel started, so a second request does not race the first. */
  let current: ChildProcess | undefined;

  return {
    exited,
    async run(files: readonly string[]): Promise<void> {
      if (current !== undefined) throw new Error('a run started from the panel is still going');
      // A fresh `vitest run` rather than a keystroke into the watcher: it can
      // be told *which* files to run, which is what "Run this spec" means, and
      // the watcher's `r` can only ever rerun everything.
      const started = spawn(process.execPath, [bin, 'run', ...files, ...reporterArgs(), ...run.args], {
        cwd: run.cwd,
        env: { ...process.env, [UI_URL_ENV]: run.uiUrl },
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      current = started;
      try {
        await new Promise<void>((resolve, reject) => {
          started.on('error', (error: Error) => reject(new Error(`could not start vitest: ${error.message}`)));
          // A failing test is a result, not a failure to run: the panel already
          // shows which tests failed, and reporting it here as an error would
          // put a scary notice over an ordinary red run.
          started.on('exit', () => resolve());
        });
      } finally {
        current = undefined;
      }
    },
    stop: () => {
      current?.kill('SIGTERM');
      child.kill('SIGTERM');
    },
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

/**
 * Start the runner, and in live mode the suite that feeds it.
 *
 * The server is always closed before this resolves, including when the runner
 * failed: a leaked server holds a port and a token for the rest of the session.
 */
export async function runUi(
  request: UiRequest,
  runtime: UiRuntime,
  onReady: (result: Omit<UiResult, 'runnerExitCode'>) => void,
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
      ? { discovery: { cwd: request.cwd, watch: request.watch } }
      : {}),
    onRerun: async (testIds) => {
      if (handle === undefined) throw new Error('this panel has no test runner behind it');
      await handle.run(testIds ?? []);
    },
    onStop: () => handle?.stop(),
  });

  onReady({ url: server.url, port: server.port, mode: server.mode });

  try {
    // Only a live run has a suite to drive; a trace is already recorded and a
    // recording is driven from the browser.
    if (server.mode === 'live' && request.watch) {
      handle = runtime.startVitest({
        args: request.rest,
        uiUrl: server.url,
        cwd: request.cwd,
      });
      const runnerExitCode = await handle.exited;
      return { url: server.url, port: server.port, mode: server.mode, runnerExitCode };
    }

    await runtime.waitForInterrupt();
    return { url: server.url, port: server.port, mode: server.mode, runnerExitCode: undefined };
  } finally {
    await server.close();
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
