/**
 * Termwright-owned native PTY session.
 *
 * The POSIX implementation owns the `forkpty()` master and reads it until the
 * kernel reports EOF (EIO after the queued tail on Linux). No JavaScript
 * stream, private node-pty field, quiet window, or retry decides that output
 * has ended.
 */
import { createRequire } from "node:module";
import { getSystemErrorName } from "node:util";
import {
  spawnWindowsPty,
  windowsConPtyRuntimeInfo,
  windowsPtyAvailable,
  windowsPtyUnavailableReason,
  type WindowsConPtyRuntimeInfo,
} from "./windows.js";
import { NativeWriteDrainEpoch } from "./write-drain-epoch.js";

type NativeEvent =
  | { readonly type: "data"; readonly data: Buffer }
  | { readonly type: "exit"; readonly exitCode: number; readonly signal: number }
  | { readonly type: "eof"; readonly code: number }
  | { readonly type: "drain"; readonly generation: bigint }
  | { readonly type: "error"; readonly message: string; readonly code: number };

interface NativeSession {
  readonly pid: number;
  write(data: Buffer): void;
  resize(columns: number, rows: number): boolean;
  /** Zero on delivery/already-gone; otherwise the positive POSIX errno. */
  signal(signal: number): number;
  treeState(): number;
  dispose(): void;
}

interface NativeBinding {
  new (
    options: {
      readonly command: readonly string[];
      readonly cwd?: string;
      readonly env: readonly string[];
      readonly columns: number;
      readonly rows: number;
    },
    onEvent: (event: NativeEvent) => void,
  ): NativeSession;
}

let cachedBinding: { readonly PosixPtySession: NativeBinding } | undefined;

export function candidatePaths(
  platform: NodeJS.Platform = process.platform,
  architecture: string = process.arch,
): readonly string[] {
  return [
    "../build/Release/termwright_pty.node",
    `@termwright/pty-${platform}-${architecture}/termwright_pty.node`,
  ];
}

export function loadPtyBinding(): { readonly PosixPtySession: NativeBinding } {
  if (cachedBinding !== undefined) return cachedBinding;
  if (process.platform === "win32") {
    throw new Error("the POSIX @termwright/pty binding cannot load on Windows");
  }
  if (process.platform !== "darwin" && process.platform !== "linux") {
    throw new Error(`@termwright/pty does not support ${process.platform}-${process.arch}`);
  }
  const require = createRequire(import.meta.url);
  const attempts: string[] = [];
  for (const candidate of candidatePaths()) {
    try {
      cachedBinding = require(candidate) as { readonly PosixPtySession: NativeBinding };
      return cachedBinding;
    } catch (error) {
      attempts.push(
        `${candidate}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
      );
    }
  }
  throw new Error(
    `no Termwright PTY addon could be loaded for ${process.platform}-${process.arch}. Tried:\n  ${attempts.join("\n  ")}`,
  );
}

let unavailableReason: string | undefined;

export function ptyAvailable(): boolean {
  if (process.platform === "win32") return windowsPtyAvailable();
  try {
    loadPtyBinding();
    unavailableReason = undefined;
    return true;
  } catch (error) {
    unavailableReason = error instanceof Error ? error.message : String(error);
    return false;
  }
}

export function ptyUnavailableReason(): string | undefined {
  return process.platform === "win32" ? windowsPtyUnavailableReason() : unavailableReason;
}

export interface PtySpawnOptions {
  readonly command: readonly string[];
  readonly cwd?: string;
  readonly env: Readonly<Record<string, string>>;
  readonly columns: number;
  readonly rows: number;
}

export interface PtyExit {
  readonly code: number | null;
  readonly signal: string | null;
}

export type PtySignal = "INT" | "TERM" | "KILL" | "HUP";
export type { WindowsConPtyRuntimeInfo };

/** Runtime provenance and strict initialization status for the Windows backend. */
export function conPtyRuntimeInfo(): WindowsConPtyRuntimeInfo {
  if (process.platform !== "win32") {
    throw new Error("ConPTY runtime information is only available on Windows");
  }
  return windowsConPtyRuntimeInfo();
}

export interface PtyHandle {
  readonly pid: number;
  readonly outputEnded: Promise<void>;
  readonly sawRealEof: boolean;
  readonly endReason: number | undefined;
  write(data: Uint8Array): void;
  resize(columns: number, rows: number): boolean;
  signal(signal: PtySignal): boolean;
  treeState(): "alive" | "gone" | "unsupported";
  onData(listener: (data: Uint8Array) => void): () => void;
  onExit(listener: (status: PtyExit) => void): () => void;
  onError(listener: (error: Error) => void): () => void;
  onDrain(listener: () => void): () => void;
  dispose(): void;
}

const signalNumbers: Readonly<Record<PtySignal, number>> = Object.freeze({
  HUP: 1,
  INT: 2,
  KILL: 9,
  TERM: 15,
});

const signalNames: Readonly<Record<number, string>> = Object.freeze({
  1: "SIGHUP",
  2: "SIGINT",
  3: "SIGQUIT",
  6: "SIGABRT",
  9: "SIGKILL",
  13: "SIGPIPE",
  15: "SIGTERM",
});

function validateOptions(options: PtySpawnOptions): void {
  if (options.command.length === 0 || options.command.some((part) =>
    typeof part !== "string" || part.includes("\0")
  )) {
    throw new TypeError("command must be a non-empty array of NUL-free strings");
  }
  if (options.cwd !== undefined && (typeof options.cwd !== "string" || options.cwd.includes("\0"))) {
    throw new TypeError("cwd must be a NUL-free string");
  }
  for (const [key, value] of Object.entries(options.env)) {
    if (key.length === 0 || key.includes("=") || key.includes("\0") ||
        typeof value !== "string" || value.includes("\0")) {
      throw new TypeError("environment keys and values must be valid execve strings");
    }
  }
  for (const [field, value] of [["columns", options.columns], ["rows", options.rows]] as const) {
    if (!Number.isInteger(value) || value < 1 || value > 32_767) {
      throw new RangeError(`${field} must be an integer from 1 through 32767`);
    }
  }
}

export function spawnPty(options: PtySpawnOptions): PtyHandle {
  validateOptions(options);
  if (process.platform === "win32") {
    const session = spawnWindowsPty(options);
    return {
      get pid(): number { return session.pid; },
      get sawRealEof(): boolean { return session.sawRealEof; },
      get endReason(): number | undefined { return session.endReason; },
      outputEnded: session.outputEnded,
      write(data): void { session.write(data); },
      resize(columns, rows): boolean { return session.resize(columns, rows); },
      signal(signal): boolean {
        if (signal !== "KILL") return false;
        session.terminateTree();
        return true;
      },
      treeState(): "alive" | "gone" | "unsupported" {
        const members = session.activeProcesses();
        return members < 0 ? "unsupported" : members === 0 ? "gone" : "alive";
      },
      onData(listener): () => void { return session.onData(listener); },
      onExit(listener): () => void { return session.onExit(listener); },
      onError(listener): () => void { return session.onError(listener); },
      onDrain(listener): () => void { return session.onDrain(listener); },
      dispose(): void { session.dispose(); },
    };
  }
  const dataListeners = new Set<(data: Uint8Array) => void>();
  const exitListeners = new Set<(status: PtyExit) => void>();
  const errorListeners = new Set<(error: Error) => void>();
  const drainListeners = new Set<() => void>();
  let exitStatus: PtyExit | undefined;
  let fatalError: Error | undefined;
  let resolveEnded: (() => void) | undefined;
  const outputEnded = new Promise<void>((resolve) => { resolveEnded = resolve; });
  let ended = false;
  let endReason: number | undefined;
  let disposed = false;
  const writeEpoch = new NativeWriteDrainEpoch();

  const session = new (loadPtyBinding().PosixPtySession)(
    {
      command: [...options.command],
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      env: Object.entries(options.env).map(([key, value]) => `${key}=${value}`),
      columns: options.columns,
      rows: options.rows,
    },
    (event) => {
      switch (event.type) {
        case "data":
          for (const listener of [...dataListeners]) listener(event.data);
          return;
        case "exit": {
          exitStatus = event.signal === 0
            ? { code: event.exitCode, signal: null }
            : { code: null, signal: signalNames[event.signal] ?? `SIG${event.signal}` };
          for (const listener of [...exitListeners]) listener(exitStatus);
          return;
        }
        case "eof":
          endReason = event.code;
          ended = event.code === 0;
          resolveEnded?.();
          return;
        case "drain":
          if (!writeEpoch.isCurrent(event.generation)) return;
          for (const listener of [...drainListeners]) listener();
          return;
        case "error":
          fatalError ??= Object.assign(new Error(event.message), { errno: event.code });
          for (const listener of [...errorListeners]) listener(fatalError);
          return;
      }
    },
  );

  return {
    get pid(): number { return session.pid; },
    get sawRealEof(): boolean { return ended; },
    get endReason(): number | undefined { return endReason; },
    outputEnded,
    write(data): void {
      if (disposed) throw new Error("PTY input is closed");
      const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      writeEpoch.admit(bytes, (admitted) => session.write(admitted));
    },
    resize(columns, rows): boolean {
      if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1 ||
          columns > 32_767 || rows > 32_767) return false;
      return !disposed && session.resize(columns, rows);
    },
    signal(signal): boolean {
      if (disposed) return false;
      const code = session.signal(signalNumbers[signal]);
      if (code === 0) return true;
      throw Object.assign(
        new Error(`kill(PTY process group) failed with errno ${code}`),
        { code: getSystemErrorName(-code), errno: code },
      );
    },
    treeState(): "alive" | "gone" | "unsupported" {
      const state = disposed ? -1 : session.treeState();
      return state > 0 ? "alive" : state === 0 ? "gone" : "unsupported";
    },
    onData(listener): () => void {
      dataListeners.add(listener);
      return () => dataListeners.delete(listener);
    },
    onExit(listener): () => void {
      exitListeners.add(listener);
      const observed = exitStatus;
      if (observed !== undefined) queueMicrotask(() => {
        if (exitListeners.has(listener)) listener(observed);
      });
      return () => exitListeners.delete(listener);
    },
    onError(listener): () => void {
      errorListeners.add(listener);
      const observed = fatalError;
      if (observed !== undefined) queueMicrotask(() => {
        if (errorListeners.has(listener)) listener(observed);
      });
      return () => errorListeners.delete(listener);
    },
    onDrain(listener): () => void {
      drainListeners.add(listener);
      return () => drainListeners.delete(listener);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      session.dispose();
      resolveEnded?.();
      dataListeners.clear();
      exitListeners.clear();
      errorListeners.clear();
      drainListeners.clear();
    },
  };
}
