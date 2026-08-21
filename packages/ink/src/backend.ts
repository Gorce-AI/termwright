/**
 * A {@link PtyBackend} whose "child process" is an Ink application running in
 * the current process.
 *
 * The driver is not aware of the difference. It creates its semantic endpoint,
 * computes the child environment, calls `spawn`, and from then on writes bytes,
 * reads bytes, resizes and hangs up exactly as it does over a real pty. That is
 * what makes `mountInk` and `launchInkFixture` return the same
 * `TerminalHarness`, with the same locators, actions and waits.
 */

import type { ExitStatus, PtyBackend, PtyProcess, PtySignal, PtySpawnOptions } from '@termwright/driver';
import { createHarnessStdin, createHarnessStdout, type HarnessStdin, type HarnessStdout } from './streams.js';

/** The wires and the environment handed to an in-process application. */
export interface InProcessIo {
  /** Ink's `stdout`: everything written here reaches the session's emulator. */
  readonly stdout: HarnessStdout;
  /** Ink's `stdin`: everything the driver sends arrives here as raw bytes. */
  readonly stdin: HarnessStdin;
  /**
   * The environment the driver computed for the child, including
   * `TERMWRIGHT_ENDPOINT` and `TERMWRIGHT_TOKEN`.
   *
   * Hand this to the internal injected probe. It is deliberately *not*
   * `process.env`: an in-process mount must not leave instrumentation variables
   * behind in the test runner (design §4.1, the dormant rule).
   */
  readonly env: Readonly<Record<string, string>>;
  /** Initial terminal size, already applied to {@link InProcessIo.stdout}. */
  readonly columns: number;
  readonly rows: number;
}

/** The handle the backend needs on a mounted application. */
export interface InProcessApp {
  /** Tears the application down; resolves once its final bytes are written. */
  stop(): Promise<void>;
  /** Resolves when the application finished on its own, without `stop()`. */
  readonly exited: Promise<void>;
}

/** Mounts an application onto a freshly created pair of wires. */
export type InProcessStart = (io: InProcessIo) => InProcessApp;

/** Cap on output buffered before the session subscribes. */
const MAX_BACKLOG_BYTES = 4 * 1024 * 1024;

/** Exit status reported when the harness hangs up on a still-running app. */
const HANGUP_STATUS: ExitStatus = Object.freeze({ code: 0, signal: null });

const SIGNAL_STATUS: Readonly<Record<PtySignal, ExitStatus>> = Object.freeze({
  INT: Object.freeze({ code: null, signal: 'SIGINT' }),
  TERM: Object.freeze({ code: null, signal: 'SIGTERM' }),
  KILL: Object.freeze({ code: null, signal: 'SIGKILL' }),
  HUP: Object.freeze({ code: null, signal: 'SIGHUP' }),
});

/**
 * Creates a backend that runs one application in this process.
 *
 * The backend is single-use: the driver spawns exactly once per session, and a
 * second `spawn` would need a second set of wires and a second Ink instance on
 * the same stdout, which Ink does not support.
 *
 * @param start - mounts the application; called synchronously from `spawn`
 *
 * @example
 * ```ts
 * const backend = createInProcessBackend((io) => {
 *   const instrumented = wrapInkRender({render, Box, measureElement}, {env: io.env});
 *   const app = instrumented(<App />, {
 *     stdout: io.stdout,
 *     stdin: io.stdin,
 *   });
 *   return { stop: async () => app.unmount(), exited: app.waitUntilExit() };
 * });
 * const harness = await launchTerminal({ command: ['<in-process>'], backend });
 * ```
 */
export function createInProcessBackend(start: InProcessStart): PtyBackend {
  let spawned = false;
  return {
    name: '@termwright/ink:in-process',
    spawn(options: PtySpawnOptions): PtyProcess {
      if (spawned) {
        throw new Error('an in-process backend hosts exactly one application; create another one');
      }
      spawned = true;
      return new InProcessPty(start, options);
    },
  };
}

class InProcessPty implements PtyProcess {
  /** This process. There is no child, and pretending otherwise would mislead. */
  readonly pid = process.pid;

  readonly #stdout: HarnessStdout;
  readonly #stdin: HarnessStdin;
  readonly #app: InProcessApp;
  readonly #dataListeners = new Set<(data: Uint8Array) => void>();
  readonly #exitListeners = new Set<(status: ExitStatus) => void>();
  /**
   * Output produced before anyone subscribed.
   *
   * A real child process writes into a pty buffer that exists before the driver
   * reads from it. An in-process app has no such buffer, and it needs one:
   * mounting Ink is synchronous, so the entire first frame — the alternate
   * screen, the hidden cursor, the initial paint, and whatever the mount
   * effects write — is produced *inside* `spawn()`, one statement before the
   * session attaches its listener. Without this queue all of it is lost, and
   * the session sees an application that renders nothing.
   */
  #backlog: Uint8Array[] | null = [];
  #backlogBytes = 0;

  #status: ExitStatus | null = null;
  #intended: ExitStatus | null = null;
  #stopping: Promise<void> | null = null;

  constructor(start: InProcessStart, options: PtySpawnOptions) {
    this.#stdout = createHarnessStdout(options.columns, options.rows, (data) => this.#emit(data));
    this.#stdin = createHarnessStdin();
    this.#app = start({
      stdout: this.#stdout,
      stdin: this.#stdin,
      env: options.env,
      columns: options.columns,
      rows: options.rows,
    });
    // An app that unmounts itself (Ctrl+C, `useApp().exit()`) must look like a
    // child that exited on its own.
    void this.#app.exited.then(
      () => this.#finish(HANGUP_STATUS),
      () => this.#finish(HANGUP_STATUS),
    );
  }

  write(data: Uint8Array): void {
    if (this.#status !== null) return;
    this.#stdin.deliver(data);
  }

  resize(columns: number, rows: number): void {
    if (this.#status !== null) return;
    this.#stdout.setSize(columns, rows);
  }

  signal(sig: PtySignal): void {
    if (this.#status !== null) return;
    // There is no process to signal. The observable effect of a signal on a
    // terminal application — it stops, and the session learns how — is
    // reproduced by tearing the app down and reporting that status.
    void this.#stop(SIGNAL_STATUS[sig]);
  }

  onData(cb: (data: Uint8Array) => void): () => void {
    this.#dataListeners.add(cb);
    const backlog = this.#backlog;
    if (backlog !== null) {
      this.#backlog = null;
      this.#backlogBytes = 0;
      for (const chunk of backlog) cb(chunk);
    }
    return () => this.#dataListeners.delete(cb);
  }

  onExit(cb: (status: ExitStatus) => void): () => void {
    this.#exitListeners.add(cb);
    if (this.#status !== null) {
      const status = this.#status;
      queueMicrotask(() => cb(status));
    }
    return () => this.#exitListeners.delete(cb);
  }

  dispose(): void {
    void this.#stop(HANGUP_STATUS);
  }

  #emit(data: Uint8Array): void {
    const backlog = this.#backlog;
    if (backlog !== null) {
      // Bounded, like the pty buffer it stands in for: an application that
      // floods stdout before anyone reads must not exhaust the test runner.
      if (this.#backlogBytes + data.length > MAX_BACKLOG_BYTES) return;
      this.#backlogBytes += data.length;
      backlog.push(data);
      return;
    }
    for (const listener of [...this.#dataListeners]) listener(data);
  }

  /** Unmounts the app, then reports the exit. Idempotent and bounded. */
  async #stop(status: ExitStatus): Promise<void> {
    if (this.#stopping !== null) return this.#stopping;
    // Unmounting resolves the app's own `exited` promise, which would otherwise
    // report a plain hang-up and lose the reason we are stopping.
    this.#intended = status;
    this.#stopping = (async () => {
      try {
        await this.#app.stop();
      } finally {
        this.#stdin.finish();
        this.#finish(status);
      }
    })();
    return this.#stopping;
  }

  #finish(status: ExitStatus): void {
    if (this.#status !== null) return;
    const reported = this.#intended ?? status;
    this.#status = reported;
    for (const listener of [...this.#exitListeners]) listener(reported);
  }
}
