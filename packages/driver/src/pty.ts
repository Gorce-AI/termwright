/**
 * PTY abstraction. The driver never talks to `@lydell/node-pty` directly: all
 * process I/O goes through {@link PtyBackend} so the pinned PTY implementation
 * can be swapped (upstream node-pty, ConPTY quirks, in-process fakes used by
 * `mountInk`) without touching sessions, locators or actions.
 */
import { spawn as spawnPty } from '@lydell/node-pty';
import type { ExitStatus } from './api.js';

/** Options accepted by {@link PtyBackend.spawn}. */
export interface PtySpawnOptions {
  readonly command: readonly string[];
  readonly cwd?: string;
  readonly env: Readonly<Record<string, string>>;
  readonly columns: number;
  readonly rows: number;
  /** `$TERM` for the child. Defaults to `xterm-256color`. */
  readonly term?: string;
}

/** Unsubscribe handle returned by the `on*` registrations. */
export type PtyUnsubscribe = () => void;

/** A live pseudo-terminal hosting one child process. */
export interface PtyProcess {
  readonly pid: number;
  /** Writes raw bytes to the child's stdin. Never appends a newline. */
  write(data: Uint8Array): void;
  resize(columns: number, rows: number): void;
  /** Delivers a POSIX signal. On Windows only `KILL` is honored (TerminateProcess). */
  signal(sig: PtySignal): void;
  onData(cb: (data: Uint8Array) => void): PtyUnsubscribe;
  onExit(cb: (status: ExitStatus) => void): PtyUnsubscribe;
  /** Idempotent; releases the pty without signalling the child. */
  dispose(): void;
}

/** Signals the driver is allowed to deliver. */
export type PtySignal = 'INT' | 'TERM' | 'KILL' | 'HUP';

/** Factory for pseudo-terminals. */
export interface PtyBackend {
  readonly name: string;
  spawn(options: PtySpawnOptions): PtyProcess;
}

const SIGNAL_NAMES: Readonly<Record<PtySignal, string>> = Object.freeze({
  INT: 'SIGINT',
  TERM: 'SIGTERM',
  KILL: 'SIGKILL',
  HUP: 'SIGHUP',
});

/**
 * `@lydell/node-pty` typings declare `write(data: string)`, but the underlying
 * socket accepts a Buffer and writes it verbatim. Passing bytes is the only way
 * to send input that is not valid UTF-8 (raw mouse reports, control bytes).
 */
interface ByteWritablePty {
  write(data: Buffer): void;
}

/**
 * The production backend: `@lydell/node-pty` pinned to 1.1.0 (prebuilds for all
 * six platforms). The pty is opened with `encoding: null` so output arrives as
 * bytes; UTF-8 sequences split across reads are reassembled by the VT layer,
 * not here.
 */
export function createNodePtyBackend(): PtyBackend {
  return {
    name: '@lydell/node-pty',
    spawn(options: PtySpawnOptions): PtyProcess {
      const [file, ...args] = options.command;
      if (file === undefined) {
        throw new TypeError('command must contain at least the executable');
      }
      const pty = spawnPty(file, args, {
        name: options.term ?? 'xterm-256color',
        cols: options.columns,
        rows: options.rows,
        ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
        env: { ...options.env },
        encoding: null,
      });

      let disposed = false;
      let exited = false;
      let exitStatus: ExitStatus | null = null;
      const dataListeners = new Set<(data: Uint8Array) => void>();
      const exitListeners = new Set<(status: ExitStatus) => void>();
      const pendingData: Uint8Array[] = [];
      const disposables: { dispose(): void }[] = [
        pty.onData((chunk: unknown) => {
          const data = typeof chunk === 'string'
            ? Buffer.from(chunk, 'utf8')
            : Buffer.from(chunk as Uint8Array);
          if (dataListeners.size === 0) {
            // ConPTY can deliver a complete first frame before spawn() returns
            // to TerminalSession. Preserve it until the session subscribes.
            pendingData.push(data);
            return;
          }
          for (const listener of dataListeners) listener(data);
        }),
        pty.onExit(({ exitCode, signal }) => {
          exited = true;
          exitStatus = {
            code: signal === undefined || signal === 0 ? exitCode : null,
            signal: signal === undefined || signal === 0 ? null : signalName(signal),
          };
          for (const listener of exitListeners) listener(exitStatus);
          if (!disposed) return;
          for (const disposable of disposables) disposable.dispose();
          disposables.length = 0;
        }),
      ];

      const proc: PtyProcess = {
        pid: pty.pid,
        write(data: Uint8Array): void {
          if (disposed || exited) return;
          (pty as unknown as ByteWritablePty).write(Buffer.from(data));
        },
        resize(columns: number, rows: number): void {
          if (disposed || exited) return;
          pty.resize(columns, rows);
        },
        signal(sig: PtySignal): void {
          if (disposed || exited) return;
          if (process.platform === 'win32') {
            // ConPTY has no signal delivery; only a hard kill is available.
            pty.kill();
            return;
          }
          pty.kill(SIGNAL_NAMES[sig]);
        },
        onData(cb): PtyUnsubscribe {
          dataListeners.add(cb);
          if (pendingData.length > 0) {
            const buffered = pendingData.splice(0);
            for (const data of buffered) cb(data);
          }
          return () => dataListeners.delete(cb);
        },
        onExit(cb): PtyUnsubscribe {
          exitListeners.add(cb);
          if (exitStatus !== null) queueMicrotask(() => {
            if (exitListeners.has(cb)) cb(exitStatus!);
          });
          return () => exitListeners.delete(cb);
        },
        dispose(): void {
          if (disposed) return;
          disposed = true;
          if (exited) {
            for (const d of disposables) d.dispose();
            disposables.length = 0;
            return;
          }
          // Releasing a pty hangs the terminal up, exactly like closing a
          // terminal window. Listeners stay attached until the exit is
          // observed, so the session still learns the final status.
          try {
            pty.kill(process.platform === 'win32' ? undefined : 'SIGHUP');
          } catch {
            // The child is already gone; nothing to hang up.
          }
        },
      };
      return proc;
    },
  };
}

const SIGNAL_NUMBERS: Readonly<Record<number, string>> = Object.freeze({
  1: 'SIGHUP',
  2: 'SIGINT',
  3: 'SIGQUIT',
  9: 'SIGKILL',
  13: 'SIGPIPE',
  15: 'SIGTERM',
});

function signalName(signal: number): string {
  return SIGNAL_NUMBERS[signal] ?? `SIG${signal}`;
}
