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

import type { ExitStatus } from "./api.js";
import { EarlyPtyOutput } from "./internal/early-pty-output.js";
import { ProcessLifecycleError } from "./internal/process-supervisor.js";
import type {
  PtyBackend,
  PtyProcess,
  PtySignal,
  PtySpawnOptions,
  PtyUnsubscribe,
} from "./pty.js";

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
  onExit(
    listener: (status: { code: number | null; signal: string | null }) => void,
  ): () => void;
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

export const CONPTY_BACKEND_NAME = "termwright-conpty";

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
      env["TERM"] = options.term ?? env["TERM"] ?? "xterm-256color";
      const session = spawn({
        command: options.command,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        env,
        columns: options.columns,
        rows: options.rows,
      });

      let disposed = false;
      const dataListeners = new Set<(data: Uint8Array) => void>();
      const exitListeners = new Set<(status: ExitStatus) => void>();
      const errorListeners = new Set<(error: Error) => void>();
      const pendingData = new EarlyPtyOutput();
      let exitStatus: ExitStatus | null = null;
      let fatalError: Error | null = null;
      const releaseData = session.onData((data) => {
        if (dataListeners.size === 0) {
          // `ResourceScope.acquire()` yields even for a synchronous backend.
          // The native reader can publish in that gap, before TerminalSession
          // owns the journal listener. Preserve the exact bytes just like the
          // node-pty backend does instead of making startup scheduling visible.
          pendingData.push(data);
          return;
        }
        for (const listener of [...dataListeners]) listener(data);
      });
      const releaseExit = session.onExit((status) => {
        exitStatus = { code: status.code, signal: status.signal };
        for (const listener of [...exitListeners]) listener(exitStatus);
      });
      const releaseError = session.onError((error) => {
        if (fatalError !== null) return;
        fatalError = error;
        for (const listener of [...errorListeners]) listener(error);
      });

      return {
        get pid(): number {
          return session.pid;
        },
        lifecycle: {
          // Owned by a job object created before the root could run, so
          // membership is decided rather than discovered.
          tree: "conpty-console",
          // The reader ends on the pipe ending. Nothing here is timed.
          outputDrain: "eof",
        },
        write(data: Uint8Array): void {
          session.write(data);
        },
        resize(columns: number, rows: number): void {
          session.resize(columns, rows);
        },
        signal(sig: PtySignal): void {
          if (sig !== "KILL") {
            // The same refusal the node-pty path makes, and typed the same
            // way. A caller distinguishing "this platform cannot" from "this
            // failed" reads the code, not the sentence, and a backend swap
            // must not quietly change which of those it is saying.
            throw new ProcessLifecycleError(
              "unsupported-signal",
              `ConPTY cannot deliver ${sig}; use terminal input for Ctrl+C or KILL for hard termination`,
            );
          }
          session.terminateTree();
        },
        async hardKillTree(signal: AbortSignal): Promise<void> {
          signal.throwIfAborted();
          session.terminateTree();
        },
        onData(cb): PtyUnsubscribe {
          dataListeners.add(cb);
          try {
            pendingData.drain(cb);
          } catch (error) {
            dataListeners.delete(cb);
            throw error;
          }
          return () => dataListeners.delete(cb);
        },
        onExit(cb): PtyUnsubscribe {
          const listener = (status: ExitStatus): void => cb(status);
          exitListeners.add(listener);
          const observed = exitStatus;
          if (observed !== null)
            queueMicrotask(() => {
              if (exitListeners.has(listener)) cb(observed);
            });
          return () => exitListeners.delete(listener);
        },
        outputEnded: session.outputEnded,
        sawOutputEnd: (): boolean => session.sawRealEof,
        // The session exists the moment spawn returns: the pseudoconsole, the
        // job and the root are all created before it does. There is nothing to
        // wait for, which is itself the difference from the node-pty path.
        async attach(signal: AbortSignal): Promise<void> {
          signal.throwIfAborted();
        },
        onWriteError(cb): PtyUnsubscribe {
          const listener = (error: Error): void => cb(error);
          errorListeners.add(listener);
          const observed = fatalError;
          if (observed !== null)
            queueMicrotask(() => {
              if (errorListeners.has(listener)) cb(observed);
            });
          return () => errorListeners.delete(listener);
        },
        treeState(): "alive" | "gone" | "unsupported" {
          const members = session.activeProcesses();
          if (members < 0) return "unsupported";
          return members > 0 ? "alive" : "gone";
        },
        dispose(): void {
          if (disposed) return;
          disposed = true;
          dataListeners.clear();
          exitListeners.clear();
          errorListeners.clear();
          const errors: unknown[] = [];
          for (const release of [
            releaseData,
            releaseExit,
            releaseError,
            () => session.dispose(),
          ]) {
            try {
              release();
            } catch (error) {
              errors.push(error);
            }
          }
          if (errors.length === 1) throw errors[0];
          if (errors.length > 1) {
            throw new AggregateError(
              errors,
              "multiple errors while disposing the ConPTY backend",
            );
          }
        },
      };
    },
  };
}
