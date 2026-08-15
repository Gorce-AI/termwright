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

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
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
  /** Ask for a rerun (watch-mode `r`). */
  rerun(): void;
  /** Ask the runner to quit (watch-mode `q`). */
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
 * Start Vitest in watch mode with the runner's URL in its environment.
 *
 * `stdin` is piped rather than inherited so that the browser's rerun and stop
 * controls can press the same keys a person would; the terminal's own input is
 * forwarded on to keep every other hotkey working.
 */
export function startVitest(run: VitestRun, bin = resolveVitestBin(run.cwd)): VitestHandle {
  const child = spawn(process.execPath, [bin, 'watch', ...run.args], {
    cwd: run.cwd,
    env: { ...process.env, [UI_URL_ENV]: run.uiUrl },
    stdio: ['pipe', 'inherit', 'inherit'],
  });

  const forward = (chunk: Buffer): void => {
    child.stdin?.write(chunk);
  };
  const wasRaw = process.stdin.isTTY === true && process.stdin.isRaw;
  if (process.stdin.isTTY === true) process.stdin.setRawMode(true);
  process.stdin.on('data', forward);
  process.stdin.resume();

  const detach = (): void => {
    process.stdin.off('data', forward);
    if (process.stdin.isTTY === true) process.stdin.setRawMode(wasRaw);
    process.stdin.pause();
  };

  const exited = new Promise<number>((resolve) => {
    child.on('exit', (code, signal) => {
      detach();
      // A signalled runner is a stop, not a failure.
      resolve(signal !== null ? 0 : (code ?? 0));
    });
    child.on('error', () => {
      detach();
      resolve(1);
    });
  });

  return {
    exited,
    rerun: () => {
      child.stdin?.write('r');
    },
    stop: () => {
      child.stdin?.write('q');
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
    onRerun: () => handle?.rerun(),
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
