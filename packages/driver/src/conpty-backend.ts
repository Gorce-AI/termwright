/**
 * The driver's view of Termwright's native Windows backend.
 *
 * Everything here is a translation, not a policy. `@termwright/conpty` owns the
 * pseudoconsole, the job object and the ordered event channel; this file states
 * what those mean in the vocabulary the driver already speaks, and refuses to
 * claim anything the session cannot prove.
 *
 * The two claims worth naming are the ones the node-pty path could not make.
 * `outputDrain` is `eof` because the stream ends when the pipe ends, so a
 * session can wait for the producer instead of spending a fallback budget on
 * every natural exit. `treeState` is a job-object query rather than a snapshot
 * of process ids, so "gone" is a fact about membership.
 */

import type { ExitStatus } from './api.js';
import { ProcessLifecycleError } from './internal/process-supervisor.js';
import type {
  PtyBackend,
  PtyProcess,
  PtySignal,
  PtySpawnOptions,
  PtyUnsubscribe,
} from './pty.js';

/** The part of `@termwright/conpty` this adapter needs. */
export interface ConPtySessionHandle {
  readonly pid: number;
  readonly outputEnded: Promise<void>;
  /** True only when the output pipe actually ended; disposal does not set it. */
  readonly sawRealEof: boolean;
  write(data: Uint8Array): void;
  resize(columns: number, rows: number): boolean;
  terminateTree(): void;
  activeProcesses(): number;
  onData(listener: (data: Uint8Array) => void): () => void;
  onExit(listener: (status: { code: number | null; signal: string | null }) => void): () => void;
  onError(listener: (error: Error) => void): () => void;
  dispose(): void;
}

/** The spawn entry point, injected so the translation is testable off Windows. */
export type ConPtySpawn = (options: {
  readonly command: readonly string[];
  readonly cwd?: string;
  readonly env: Readonly<Record<string, string>>;
  readonly columns: number;
  readonly rows: number;
}) => ConPtySessionHandle;

export const CONPTY_BACKEND_NAME = 'termwright-conpty';

/**
 * Wraps a ConPTY session as a driver backend.
 *
 * Signals are the one place a translation could lie. Windows has no signal
 * delivery, and inventing one would let a caller believe a `TERM` was received
 * and declined. Only `KILL` maps to anything — terminating the owned tree — and
 * the rest are refused loudly rather than silently dropped, because a test that
 * thinks it asked for a graceful shutdown and got nothing is worse off than one
 * told the platform has no such thing.
 */
export function createConPtyBackend(spawn: ConPtySpawn): PtyBackend {
  return {
    name: CONPTY_BACKEND_NAME,
    spawn(options: PtySpawnOptions): PtyProcess {
      const env: Record<string, string> = { ...options.env };
      env['TERM'] = options.term ?? env['TERM'] ?? 'xterm-256color';
      const session = spawn({
        command: options.command,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        env,
        columns: options.columns,
        rows: options.rows,
      });

      let disposed = false;
      const errorListeners = new Set<(error: Error) => void>();
      const releaseError = session.onError((error) => {
        for (const listener of [...errorListeners]) listener(error);
      });

      return {
        get pid(): number {
          return session.pid;
        },
        lifecycle: {
          // Owned by a job object created before the root could run, so
          // membership is decided rather than discovered.
          tree: 'conpty-console',
          // The reader ends on the pipe ending. Nothing here is timed.
          outputDrain: 'eof',
        },
        write(data: Uint8Array): void {
          session.write(data);
        },
        resize(columns: number, rows: number): void {
          session.resize(columns, rows);
        },
        signal(sig: PtySignal): void {
          if (sig !== 'KILL') {
            // The same refusal the node-pty path makes, and typed the same
            // way. A caller distinguishing "this platform cannot" from "this
            // failed" reads the code, not the sentence, and a backend swap
            // must not quietly change which of those it is saying.
            throw new ProcessLifecycleError(
              'unsupported-signal',
              `ConPTY cannot deliver ${sig}; use terminal input for Ctrl+C or KILL for hard termination`,
            );
          }
          session.terminateTree();
        },
        async hardKillTree(): Promise<void> {
          session.terminateTree();
        },
        onData(cb): PtyUnsubscribe {
          return session.onData(cb);
        },
        onExit(cb): PtyUnsubscribe {
          return session.onExit((status) => {
            const exit: ExitStatus = { code: status.code, signal: status.signal };
            cb(exit);
          });
        },
        outputEnded: session.outputEnded,
        sawOutputEnd: (): boolean => session.sawRealEof,
        // The session exists the moment spawn returns: the pseudoconsole, the
        // job and the root are all created before it does. There is nothing to
        // wait for, which is itself the difference from the node-pty path.
        attached: Promise.resolve(),
        onWriteError(cb): PtyUnsubscribe {
          errorListeners.add(cb);
          return () => errorListeners.delete(cb);
        },
        treeState(): 'alive' | 'gone' | 'unsupported' {
          const members = session.activeProcesses();
          if (members < 0) return 'unsupported';
          return members > 0 ? 'alive' : 'gone';
        },
        dispose(): void {
          if (disposed) return;
          disposed = true;
          releaseError();
          errorListeners.clear();
          session.dispose();
        },
      };
    },
  };
}
