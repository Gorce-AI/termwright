/**
 * Termwright's Windows PTY backend.
 *
 * One native session owns the pseudoconsole, both host pipe ends, the root
 * process and thread, and the job object holding the tree. Two facts follow
 * from that ownership and are the reason this package exists:
 *
 * - a session ends when the output pipe actually ends, never when a timer says
 *   nothing has arrived lately;
 * - the process tree is a job object from before the root can run, so proving
 *   it empty is a query rather than a race against process enumeration.
 */

import { createRequire } from "node:module";
import { NativeWriteDrainEpoch } from "./write-drain-epoch.js";

/** Ordered messages the native session emits. Data always precedes the end. */
type NativeEvent =
  | { readonly type: "data"; readonly data: Buffer }
  | { readonly type: "exit"; readonly exitCode: number }
  | { readonly type: "eof"; readonly code: number }
  | { readonly type: "drain"; readonly generation: bigint }
  | { readonly type: "notice"; readonly message: string }
  | { readonly type: "error"; readonly message: string; readonly code: number };

interface NativeSession {
  readonly pid: number;
  readonly releaseSupported: boolean;
  write(data: Buffer): void;
  resize(columns: number, rows: number): boolean;
  terminateTree(): void;
  activeProcesses(): number;
  dispose(): void;
}

interface NativeBindingConstructor {
  new (
    options: {
      readonly commandLine: string;
      readonly cwd?: string;
      readonly env?: readonly string[];
      readonly columns: number;
      readonly rows: number;
    },
    onEvent: (event: NativeEvent) => void,
  ): NativeSession;
}

interface LoadedWindowsBinding {
  readonly ConPtySession: NativeBindingConstructor;
}

let cachedBinding: LoadedWindowsBinding | undefined;

/**
 * Where the addon is looked for, in order.
 *
 * The locally compiled binary comes first so that a working tree tests what it
 * just built rather than a published prebuild that happens to be installed
 * beside it — the alternative is a change to this addon that CI certifies
 * against the previous release.
 */
export function windowsCandidatePaths(architecture: string): readonly string[] {
  return [
    "../build/Release/termwright_pty.node",
    `@termwright/pty-win32-${architecture}/termwright_pty.node`,
  ];
}

/** Loads the compiled addon, or explains why this platform has none. */
export function loadWindowsBinding(): LoadedWindowsBinding {
  if (cachedBinding !== undefined) return cachedBinding;
  if (process.platform !== "win32") {
    throw new Error(
      "@termwright/pty Windows binding cannot load on a non-Windows host",
    );
  }
  const require = createRequire(import.meta.url);
  const attempts: string[] = [];
  for (const candidate of windowsCandidatePaths(process.arch)) {
    try {
      const resolved = require.resolve(candidate);
      cachedBinding = require(resolved) as LoadedWindowsBinding;
      return cachedBinding;
    } catch (error) {
      // Kept per candidate. "No addon" is the same sentence whether the
      // prebuild for this architecture was never published, the install
      // skipped it, or it is present and failed to load — and those are three
      // different things to do next.
      attempts.push(
        `${candidate}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
      );
    }
  }
  throw new Error(
    `no termwright ConPTY addon could be loaded for win32-${process.arch}. Tried:\n  ${attempts.join("\n  ")}`,
  );
}

let unavailableReason: string | undefined;

/** True when the addon is present and usable in this process. */
export function windowsPtyAvailable(): boolean {
  try {
    loadWindowsBinding();
    unavailableReason = undefined;
    return true;
  } catch (error) {
    // Kept, because "not available" is the least useful half of the answer.
    // A missing file, an ABI mismatch and a load-time failure inside the addon
    // all arrive here, and they are three different pieces of work.
    unavailableReason = error instanceof Error ? error.message : String(error);
    return false;
  }
}

/** Why the addon could not be loaded, as the loader reported it. */
export function windowsPtyUnavailableReason(): string | undefined {
  return unavailableReason;
}

/**
 * Quotes one argument the way CommandLineToArgvW parses it.
 *
 * Windows has no argv: the child re-parses a single string, so the caller's
 * exact arguments only survive if they are quoted to that specific grammar.
 * Backslashes are literal except immediately before a quote, where they are
 * doubled — including the run that precedes the closing quote.
 */
export function quoteWindowsArgument(argument: string): string {
  if (argument.length > 0 && !/[\s"]/u.test(argument)) return argument;
  let quoted = '"';
  let backslashes = 0;
  for (const character of argument) {
    if (character === "\\") {
      backslashes += 1;
      continue;
    }
    if (character === '"') {
      quoted += "\\".repeat(backslashes * 2 + 1);
      quoted += '"';
      backslashes = 0;
      continue;
    }
    quoted += "\\".repeat(backslashes);
    quoted += character;
    backslashes = 0;
  }
  quoted += "\\".repeat(backslashes * 2);
  return `${quoted}"`;
}

/** Joins a command into the single string CreateProcessW takes. */
export function buildCommandLine(command: readonly string[]): string {
  if (command.length === 0)
    throw new TypeError("a ConPTY command needs at least an executable");
  return command.map(quoteWindowsArgument).join(" ");
}

/** Renders an environment map as the block CreateProcessW expects. */
export function buildEnvironment(
  env: Readonly<Record<string, string>>,
): readonly string[] {
  return Object.entries(env)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value}`);
}

export interface WindowsPtySpawnOptions {
  readonly command: readonly string[];
  readonly cwd?: string;
  readonly env: Readonly<Record<string, string>>;
  readonly columns: number;
  readonly rows: number;
}

export interface WindowsPtyExit {
  readonly code: number | null;
  readonly signal: string | null;
}

/**
 * A live ConPTY session.
 *
 * `exited` and `outputEnded` are deliberately separate. A root process can
 * finish while its descendants still hold the pseudoconsole, so the last byte
 * of a session routinely arrives after the process that started it is gone.
 */
export interface WindowsPtyHandle {
  readonly pid: number;
  readonly releaseSupported: boolean;
  readonly outputEnded: Promise<void>;
  /**
   * True only when the output pipe actually ended.
   *
   * `outputEnded` also settles on disposal so a teardown cannot hang, which
   * means resolving it is not by itself evidence of EOF. This is the flag that
   * separates the two, and nothing but the reader sets it.
   *
   * The end itself is reached by the tree emptying: the job reports zero
   * active processes, which means no byte can follow, and the console is
   * closed only then. The reader still ends on the pipe rather than on a
   * timer — what changed is that the moment is chosen by evidence.
   */
  readonly sawRealEof: boolean;
  /**
   * The Win32 code the terminating read reported, or 0 for a clean end.
   *
   * A stream that ended for the wrong reason looks exactly like one that ended
   * properly, and telling them apart is the claim this backend exists to make.
   */
  readonly endReason: number | undefined;
  /**
   * The session's own account of its lifecycle, oldest first.
   *
   * Root exit, what the job said, and when the console was closed. These
   * moments are only observable while they happen: the console takes its
   * evidence with it when it goes, so anything reconstructed afterwards is
   * inference. Kept bounded, because a session is not a log file.
   */
  readonly notices: readonly string[];
  write(data: Uint8Array): void;
  resize(columns: number, rows: number): boolean;
  terminateTree(): void;
  activeProcesses(): number;
  onData(listener: (data: Uint8Array) => void): () => void;
  onExit(listener: (status: WindowsPtyExit) => void): () => void;
  onError(listener: (error: Error) => void): () => void;
  onDrain(listener: () => void): () => void;
  /**
   * Lifecycle notices as they are recorded.
   *
   * A notice describing an instant arrives after the event it follows, so
   * reading `notices` inside an exit listener sees the state before it. This
   * is how a caller waits for the account rather than racing it.
   */
  onNotice(listener: (message: string) => void): () => void;
  dispose(): void;
}

export function spawnWindowsPty(
  options: WindowsPtySpawnOptions,
): WindowsPtyHandle {
  const binding = loadWindowsBinding();
  const dataListeners = new Set<(data: Uint8Array) => void>();
  const exitListeners = new Set<(status: WindowsPtyExit) => void>();
  const errorListeners = new Set<(error: Error) => void>();
  const drainListeners = new Set<() => void>();
  const noticeListeners = new Set<(message: string) => void>();

  let resolveEnded: (() => void) | undefined;
  const outputEnded = new Promise<void>((resolve) => {
    resolveEnded = resolve;
  });
  let ended = false;
  let endReason: number | undefined;
  let disposed = false;
  const writeEpoch = new NativeWriteDrainEpoch();
  const notices: string[] = [];
  const NOTICE_LIMIT = 64;

  const session = new binding.ConPtySession(
    {
      commandLine: buildCommandLine(options.command),
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      env: buildEnvironment(options.env),
      columns: options.columns,
      rows: options.rows,
    },
    (event) => {
      switch (event.type) {
        case "data":
          for (const listener of [...dataListeners]) listener(event.data);
          return;
        case "exit": {
          // A Windows exit code is not a signal. Reporting it as one would
          // invent POSIX semantics the platform does not have.
          const status: WindowsPtyExit = { code: event.exitCode, signal: null };
          for (const listener of [...exitListeners]) listener(status);
          return;
        }
        case "eof":
          endReason = event.code;
          // Delivered on the same ordered channel as the data before it, so
          // every chunk has already reached its listeners by now.
          ended = true;
          resolveEnded?.();
          return;
        case "drain":
          if (!writeEpoch.isCurrent(event.generation)) return;
          for (const listener of [...drainListeners]) listener();
          return;
        case "notice":
          // Oldest dropped first: a session that somehow produces more of
          // these than the bound must not grow without limit, and the last
          // ones are the ones that describe how it ended.
          if (notices.length >= NOTICE_LIMIT) notices.shift();
          notices.push(event.message);
          for (const listener of [...noticeListeners]) listener(event.message);
          return;
        case "error": {
          const failure = Object.assign(new Error(event.message), {
            win32: event.code,
          });
          for (const listener of [...errorListeners]) listener(failure);
          return;
        }
      }
    },
  );

  return {
    get pid(): number {
      return session.pid;
    },
    get releaseSupported(): boolean {
      return session.releaseSupported;
    },
    get sawRealEof(): boolean {
      return ended;
    },
    get endReason(): number | undefined {
      return endReason;
    },
    get notices(): readonly string[] {
      return [...notices];
    },
    outputEnded,
    write(data: Uint8Array): void {
      if (disposed) throw new Error("ConPTY input is closed");
      const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      writeEpoch.admit(bytes, (admitted) => session.write(admitted));
    },
    resize(columns: number, rows: number): boolean {
      return disposed ? false : session.resize(columns, rows);
    },
    terminateTree(): void {
      if (!disposed) session.terminateTree();
    },
    activeProcesses(): number {
      return disposed ? -1 : session.activeProcesses();
    },
    onData(listener): () => void {
      dataListeners.add(listener);
      return () => dataListeners.delete(listener);
    },
    onExit(listener): () => void {
      exitListeners.add(listener);
      return () => exitListeners.delete(listener);
    },
    onError(listener): () => void {
      errorListeners.add(listener);
      return () => errorListeners.delete(listener);
    },
    onDrain(listener): () => void {
      drainListeners.add(listener);
      return () => drainListeners.delete(listener);
    },
    onNotice(listener): () => void {
      noticeListeners.add(listener);
      return () => noticeListeners.delete(listener);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      session.dispose();
      // Disposal is not evidence of EOF. It unblocks anyone waiting only so a
      // teardown cannot hang; whether the stream truly ended is recorded by
      // `ended`, which nothing but the reader sets.
      resolveEnded?.();
      dataListeners.clear();
      exitListeners.clear();
      errorListeners.clear();
      drainListeners.clear();
      noticeListeners.clear();
    },
  };
}
