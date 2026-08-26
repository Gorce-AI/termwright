/** Backend-neutral PTY contracts implemented by the Termwright-owned native package. */
import type { ExitStatus } from "./api.js";

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
  /** Truthful lifecycle properties when the backend can prove them. */
  readonly lifecycle?: {
    readonly tree: "posix-process-group" | "conpty-console" | "delegated";
    readonly outputDrain: "eof" | "bounded-fallback";
  };
  /**
   * Queues raw bytes in the backend's ordered input stream. Never appends a
   * newline. A successful return proves queue admission, not child
   * consumption; semantic actions prove consumption through their committed
   * postcondition.
   */
  write(data: Uint8Array): void;
  resize(columns: number, rows: number): void;
  /** Delivers a POSIX signal. On Windows only `KILL` is supported. */
  signal(sig: PtySignal): void;
  /** Synchronously closes the owned POSIX group at the root-exit boundary. */
  killOwnedTreeAtExitBoundary?(): void;
  /** Backend-native graceful lifecycle request; required when tree ownership is delegated. */
  terminate?(): void;
  /**
   * Hard-kills an owned process tree. The operation must reject promptly when
   * `signal` is aborted; dispose must settle any backend work started by it.
   */
  hardKillTree?(signal: AbortSignal): Promise<void>;
  onData(cb: (data: Uint8Array) => void): PtyUnsubscribe;
  onExit(cb: (status: ExitStatus) => void): PtyUnsubscribe;
  /** Settles once the backend's output producer can deliver no more bytes. */
  readonly outputEnded?: Promise<void>;
  /**
   * Whether the producer reached its authoritative EOF rather than being torn
   * down with bytes potentially unread. `outputEnded` settles in both cases.
   */
  readonly sawOutputEnd?: () => boolean;
  /** Settles once an asynchronously created native session is ready for lifecycle operations. */
  attach?(signal: AbortSignal): Promise<void>;
  /** Fatal asynchronous failures after `write()` accepted bytes. */
  onWriteError?(cb: (error: Error) => void): PtyUnsubscribe;
  /** Queue-drained notification; it does not claim child consumption. */
  onWriteDrain?(cb: () => void): PtyUnsubscribe;
  /** Liveness of the owned tree, when the backend has an OS primitive for it. */
  treeState?(): "alive" | "gone" | "unsupported";
  /** Idempotent finalizer; hangs up a live PTY before releasing listeners. */
  dispose(): void;
}

/** Signals the driver is allowed to deliver. */
export type PtySignal = "INT" | "TERM" | "KILL" | "HUP";

/** Factory for pseudo-terminals. */
export interface PtyBackend {
  readonly name: string;
  spawn(options: PtySpawnOptions): PtyProcess;
}
