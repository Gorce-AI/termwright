/**
 * PTY abstraction. The driver never talks to `@lydell/node-pty` directly: all
 * process I/O goes through {@link PtyBackend} so the pinned PTY implementation
 * can be swapped (upstream node-pty, ConPTY quirks, in-process fakes used by
 * `mountInk`) without touching sessions, locators or actions.
 */
import { spawn as spawnPty } from '@lydell/node-pty';
import { write as writeFd } from 'node:fs';
import type { ExitStatus } from './api.js';
import { EarlyPtyOutput } from './internal/early-pty-output.js';
import { ProcessLifecycleError } from './internal/process-supervisor.js';

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
    readonly tree: 'posix-process-group' | 'conpty-console' | 'delegated';
    readonly outputDrain: 'eof' | 'bounded-fallback';
  };
  /**
   * Queues raw bytes in the backend's ordered input stream. Never appends a
   * newline. A successful return proves queue admission, not child
   * consumption; semantic actions prove consumption through their committed
   * postcondition.
   */
  write(data: Uint8Array): void;
  resize(columns: number, rows: number): void;
  /** Delivers a POSIX signal. On Windows only `KILL` is honored (TerminateProcess). */
  signal(sig: PtySignal): void;
  /** Backend-native graceful lifecycle request; required when tree is delegated. */
  terminate?(): void;
  /**
   * Hard-kills an owned process tree and captures the exact members that must
   * subsequently be proven gone. Backends that claim tree ownership should
   * expose this when the preparation step is asynchronous.
   */
  hardKillTree?(): Promise<void>;
  onData(cb: (data: Uint8Array) => void): PtyUnsubscribe;
  onExit(cb: (status: ExitStatus) => void): PtyUnsubscribe;
  /** Settles once the backend's output producer can deliver no more bytes. */
  readonly outputEnded?: Promise<void>;
  /**
   * Whether the producer stopped because its source ended, as opposed to being
   * torn down with bytes still unread.
   *
   * `outputEnded` settles either way — a waiter must not outlive the thing it
   * waits for — so on its own it cannot say whether the stream is complete.
   * The two are different facts and a session that publishes an exit needs the
   * second one: a destroyed source has lost whatever had not been read yet,
   * and reporting that as a clean finish hands the caller a screen that is
   * missing its last line with nothing to indicate it.
   */
  readonly sawOutputEnd?: () => boolean;
  /**
   * Settles once the backend has finished attaching, if it attaches at all.
   *
   * ConPTY creates the child from a callback that fires when its output worker
   * is ready, so a freshly spawned pty has no pid and an empty console process
   * list until then — the same two values a reaped tree produces. A session
   * that waits for this before running cannot reach teardown in that state.
   */
  readonly attached?: Promise<void>;
  /** Fatal asynchronous failures after write() accepted bytes. */
  onWriteError?(cb: (error: Error) => void): PtyUnsubscribe;
  /** Queue-drained notification; it still does not claim child consumption. */
  onWriteDrain?(cb: () => void): PtyUnsubscribe;
  /** Liveness of the owned tree, when the backend has an OS primitive for it. */
  treeState?(): 'alive' | 'gone' | 'unsupported';
  /** Idempotent finalizer; hangs up a still-live PTY before releasing listeners. */
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
interface PtyWriteChannel {
  write(data: Uint8Array): void;
  dispose(): void;
}

/**
 * The production backend: `@lydell/node-pty` pinned to 1.2.0-beta.15 (prebuilds for all
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
      const writeErrorListeners = new Set<(error: Error) => void>();
      const writeDrainListeners = new Set<() => void>();
      const pendingData = new EarlyPtyOutput();
      const onWriteError = (error: Error): void => {
        for (const listener of writeErrorListeners) listener(error);
      };
      const onWriteDrain = (): void => {
        for (const listener of writeDrainListeners) listener();
      };
      const writable = createExactNodePtyWriteChannel(pty, onWriteError, onWriteDrain);
      const disposables: { dispose(): void }[] = [
        writable,
        pty.onData((chunk: unknown) => {
          const data = typeof chunk === 'string'
            ? Buffer.from(chunk, 'utf8')
            : Buffer.from(chunk as Uint8Array);
          if (dataListeners.size === 0) {
            // ConPTY can deliver a complete first frame before spawn() returns
            // to TerminalSession. Preserve it until the session subscribes,
            // but fail the transactional startup rather than silently drop or
            // buffer an unbounded stream from a hostile backend.
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

      let conptyTreePids: readonly number[] | undefined;
      let agentKilled = false;
      /**
       * The agent's immediate kill, at most once.
       *
       * WindowsPtyAgent.kill() has no guard of its own: every call re-enters
       * the native kill on the same HPCON handle, re-forks the console-list
       * helper and disposes the conout worker again. Teardown reaches it from
       * three directions — the KILL signal, the tree kill, and dispose — so the
       * second call hands an already-released handle back to native code and
       * the process disappears without a JavaScript frame to show for it.
       */
      const killAgentOnce = (): void => {
        if (agentKilled) {
          // TEMPORARY (remove once Windows CI is green): confirms from the
          // lane whether teardown really reached the agent kill more than
          // once, which is the diagnosis this guard is based on.
          process.stderr.write(`termwright-debug: suppressed a repeat ConPTY agent kill for pid ${pty.pid}\n`);
          return;
        }
        agentKilled = true;
        exactWindowsAgent(pty).kill();
      };
      const proc: PtyProcess = {
        // ConPTY connects asynchronously in node-pty 1.2. Reading this lazily
        // prevents its transient pre-connect value (0) becoming permanent in
        // Termwright's public wrapper.
        get pid(): number {
          return pty.pid;
        },
        lifecycle: Object.freeze({
          tree: process.platform === 'win32' ? 'conpty-console' : 'posix-process-group',
          // A capability, not an observation. This node-pty release cannot
          // certify a complete drain on either platform. On Linux, libuv may
          // invalidate a PTY master on POLLHUP before reading its queued tail;
          // the resulting EIO says that no more bytes can arrive, not that all
          // bytes the child wrote were delivered. ConPTY likewise timer-closes
          // its socket rather than exposing an OS-coupled output boundary.
          //
          // Deriving it from "has the end been seen yet" made it read
          // bounded-fallback at the one moment it is asked — exit is observed
          // before the socket finishes — so the caller took the degraded path
          // instead of waiting for the end that was about to arrive.
          outputDrain: 'bounded-fallback' as const,
        }),
        write(data: Uint8Array): void {
          if (disposed || exited) return;
          writable.write(data);
        },
        resize(columns: number, rows: number): void {
          if (disposed || exited) return;
          pty.resize(columns, rows);
        },
        signal(sig: PtySignal): void {
          if (disposed || exited) return;
          if (process.platform === 'win32') {
            if (sig !== 'KILL') {
              throw new ProcessLifecycleError(
                'unsupported-signal',
                `ConPTY cannot deliver ${SIGNAL_NAMES[sig]}; use terminal input for Ctrl+C or KILL for hard termination`,
              );
            }
            // The agent's tree kill, not WindowsTerminal's: the latter is
            // deferred until the child has produced output, so a silent child
            // could not be killed at all. This enumerates console processes
            // and closes the HPCON immediately.
            killAgentOnce();
            return;
          }
          // forkpty makes the child a session/process-group leader. Address
          // the negative PGID so children and grandchildren cannot outlive it.
          try {
            process.kill(-pty.pid, SIGNAL_NAMES[sig]);
          } catch (error) {
            // The group can disappear between the wrapper's exited check and
            // kill(2). That is already the requested outcome.
            if (!isErrno(error, 'ESRCH')) throw error;
          }
        },
        ...(process.platform === 'win32'
          ? {
              attached: agentAttached(exactWindowsAgent(pty)),
              async hardKillTree(): Promise<void> {
                if (disposed || exited) return;
                const agent = exactWindowsAgent(pty);
                // Wait for ConPTY to attach before asking it anything. Until
                // then the agent has no child and reports pid 0 with an empty
                // process list, which reads exactly like "the tree is already
                // gone" — so a session closed early killed nothing, waited for
                // an exit that could never arrive, and failed its own teardown
                // while the child kept running.
                await agentAttached(agent);
                const reported = await agent._getConsoleProcessList();
                conptyTreePids = ownedConsoleTreePids(reported, process.pid);
                // An empty list while the root is demonstrably alive means
                // AttachConsole/list enumeration failed. Closing HPCON might
                // still work, but it cannot certify complete tree ownership.
                if (conptyTreePids.length === 0 && pty.pid <= 0) {
                  // No list and no root pid is absence of evidence, not
                  // evidence of absence. Reporting cleanup as complete here
                  // would certify a tree nobody ever saw.
                  throw new ProcessLifecycleError(
                    'cleanup-failed',
                    'ConPTY reported neither a console process list nor a root pid, so no tree could be proven gone',
                  );
                }
                if (conptyTreePids.length === 0 && pty.pid > 0 && processAlive(pty.pid)) {
                  throw new ProcessLifecycleError(
                    'cleanup-failed',
                    `ConPTY could not enumerate the live console process tree rooted at ${pty.pid}`,
                  );
                }
                for (const pid of conptyTreePids) {
                  try {
                    process.kill(pid);
                  } catch (error) {
                    if (!isErrno(error, 'ESRCH')) throw error;
                  }
                }
                // Close HPCON and let node-pty reap its agent. Its own second
                // enumeration is redundant but harmless and exact-version
                // certified; our captured set is the verification boundary.
                // Again the agent's immediate kill: WindowsTerminal's would
                // queue behind first output and leave the HPCON and the conout
                // worker alive after the tree was already gone.
                killAgentOnce();
              },
            }
          : {}),
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
          exitListeners.add(cb);
          if (exitStatus !== null) queueMicrotask(() => {
            if (exitListeners.has(cb)) cb(exitStatus!);
          });
          return () => exitListeners.delete(cb);
        },
        onWriteError(cb): PtyUnsubscribe {
          writeErrorListeners.add(cb);
          return () => writeErrorListeners.delete(cb);
        },
        onWriteDrain(cb): PtyUnsubscribe {
          writeDrainListeners.add(cb);
          return () => writeDrainListeners.delete(cb);
        },
        treeState(): 'alive' | 'gone' | 'unsupported' {
          if (process.platform === 'win32') {
            if (conptyTreePids === undefined) return 'unsupported';
            return conptyTreePids.some(processAlive) ? 'alive' : 'gone';
          }
          try {
            process.kill(-pty.pid, 0);
            return 'alive';
          } catch (error) {
            if (isErrno(error, 'ESRCH')) return 'gone';
            if (isErrno(error, 'EPERM')) return 'alive';
            throw error;
          }
        },
        dispose(): void {
          if (disposed) return;
          disposed = true;
          if (exited) {
            for (const d of disposables) d.dispose();
            disposables.length = 0;
            // The child being gone does not release ConPTY. node-pty keeps a
            // conout worker thread per pty, and a live worker thread keeps the
            // whole Node process alive: a Windows CI step stayed open for 43
            // minutes after its work had finished and printed success. The
            // agent's kill closes the pseudoconsole and disposes that worker,
            // and is safe to call once the process has already exited.
            if (process.platform === 'win32') {
              try {
                killAgentOnce();
              } catch {
                // Already released.
              }
            }
            return;
          }
          // Releasing a pty hangs the terminal up, exactly like closing a
          // terminal window. Listeners stay attached until the exit is
          // observed, so the session still learns the final status.
          try {
            // WindowsTerminal.kill() is deferred behind the same `_isReady`
            // gate as its writes, so a child that never produced output could
            // not be killed at all — the hang-up simply queued forever. The
            // agent's kill runs immediately and is what actually releases the
            // ConPTY handles and the console process list.
            if (process.platform === 'win32') killAgentOnce();
            else process.kill(-pty.pid, 'SIGHUP');
          } catch {
            // The child is already gone; nothing to hang up.
          }
        },
      };
      return proc;
    },
  };
}

interface ExactUnixPty {
  readonly fd: number;
}

interface ExactWindowsSocket {
  write(data: Buffer): boolean;
  on(event: 'error', listener: (error: Error) => void): void;
  on(event: 'drain', listener: () => void): void;
  removeListener(event: 'error', listener: (error: Error) => void): void;
  removeListener(event: 'drain', listener: () => void): void;
}

interface ExactWindowsPty {
  readonly _agent: ExactWindowsAgent;
}

interface ExactWindowsAgent {
  readonly inSocket: ExactWindowsSocket;
  /** Emits `ready_datapipe` once ConPTY is connected to the output pipe. */
  readonly outSocket: ExactWindowsReadySocket;
  /** Immediate teardown; unlike WindowsTerminal.kill it is never deferred. */
  kill(): void;
  _getConsoleProcessList(): Promise<readonly number[]>;
}

interface ExactWindowsReadySocket {
  readonly connecting: boolean;
  readonly readyState: string;
  once(event: 'ready_datapipe', listener: () => void): void;
  removeListener(event: 'ready_datapipe', listener: () => void): void;
}

function exactWindowsAgent(value: unknown): ExactWindowsAgent {
  const agent = (value as Partial<ExactWindowsPty>)._agent;
  if (agent === undefined || typeof agent._getConsoleProcessList !== 'function' ||
      typeof agent.kill !== 'function') {
    throw new Error('certified @lydell/node-pty ConPTY process-list boundary changed');
  }
  return agent;
}

/**
 * Own the async write boundary instead of relying on beta.15's private
 * CustomWriteStream, which prints EBADF/EIO to global stderr and exposes no
 * error/drain API. The only private facts used here are exact-version checked
 * (`fd` on Unix, `_agent.inSocket` + `_agent.outSocket` on ConPTY); all queue semantics
 * and failures belong to Termwright and therefore survive package install.
 */
function createExactNodePtyWriteChannel(
  pty: unknown,
  onError: (error: Error) => void,
  onDrain: () => void,
): PtyWriteChannel {
  return process.platform === 'win32'
    ? createWindowsWriteChannel(pty, onError, onDrain)
    : createUnixWriteChannel(pty, onError, onDrain);
}

function createUnixWriteChannel(
  value: unknown,
  onError: (error: Error) => void,
  onDrain: () => void,
): PtyWriteChannel {
  const pty = value as Partial<ExactUnixPty>;
  if (!Number.isSafeInteger(pty.fd) || (pty.fd ?? -1) < 0) {
    throw new Error('certified @lydell/node-pty Unix private fd boundary changed');
  }
  const queue: Buffer[] = [];
  let offset = 0;
  let writing = false;
  let disposed = false;
  let retry: NodeJS.Immediate | undefined;
  const processQueue = (): void => {
    retry = undefined;
    if (disposed || writing) return;
    const buffer = queue[0];
    if (buffer === undefined) {
      onDrain();
      return;
    }
    writing = true;
    writeFd(pty.fd!, buffer, offset, buffer.length - offset, null, (error, written) => {
      writing = false;
      if (disposed) return;
      if (error !== null) {
        if (isErrno(error, 'EAGAIN')) {
          retry = setImmediate(processQueue);
          return;
        }
        queue.length = 0;
        offset = 0;
        onError(error);
        return;
      }
      offset += written;
      if (offset >= buffer.length) {
        queue.shift();
        offset = 0;
      }
      processQueue();
    });
  };
  return {
    write(data): void {
      if (disposed) return;
      queue.push(Buffer.from(data));
      processQueue();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      queue.length = 0;
      if (retry !== undefined) clearImmediate(retry);
    },
  };
}

function createWindowsWriteChannel(
  value: unknown,
  onError: (error: Error) => void,
  onDrain: () => void,
): PtyWriteChannel {
  const pty = value as Partial<ExactWindowsPty>;
  const agent = pty._agent;
  const socket = agent?.inSocket;
  const ready = agent?.outSocket;
  if (socket === undefined || typeof socket.write !== 'function' ||
      ready === undefined || typeof ready.once !== 'function') {
    throw new Error('certified @lydell/node-pty ConPTY private input boundary changed');
  }
  const queue: Buffer[] = [];
  let scheduled = false;
  let backpressured = false;
  let disposed = false;
  const fail = (error: Error): void => {
    if (disposed) return;
    queue.length = 0;
    backpressured = false;
    onError(error);
  };
  const flush = (): void => {
    scheduled = false;
    if (disposed || backpressured) return;
    while (queue.length > 0) {
      const buffer = queue.shift()!;
      if (!socket.write(buffer)) {
        backpressured = true;
        return;
      }
    }
    onDrain();
  };
  const drain = (): void => {
    if (disposed) return;
    backpressured = false;
    flush();
  };
  // Gate the first write on the output pipe being connected, not on the child
  // having produced output.
  //
  // beta.15 defers every write — and its own kill — until `_isReady`, which it
  // only sets after the first `data` event. A program that prints nothing until
  // it is written to therefore deadlocks: the write waits for output, the
  // output waits for the write, and because kill is deferred the same way, the
  // session cannot even be torn down. `ready_datapipe` is the honest barrier:
  // conin is opened synchronously in the agent's constructor, and this event
  // fires once ConPTY is attached to conout, so from here on bytes are
  // deliverable regardless of whether the child has said anything.
  let piped = !ready.connecting && ready.readyState === 'open';
  const onReady = (): void => {
    piped = true;
    if (!disposed && queue.length > 0) flush();
  };
  if (!piped) ready.once('ready_datapipe', onReady);
  socket.on('error', fail);
  socket.on('drain', drain);
  return {
    write(data): void {
      if (disposed) return;
      queue.push(Buffer.from(data));
      if (scheduled || backpressured || !piped) return;
      scheduled = true;
      setImmediate(flush);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      queue.length = 0;
      ready.removeListener('ready_datapipe', onReady);
      socket.removeListener('error', fail);
      socket.removeListener('drain', drain);
    },
  };
}

/**
 * Resolves once ConPTY has attached to the output pipe.
 *
 * Before that the agent has not created the child: `pid` reads 0 and the
 * console process list is empty. Both are the same values a fully reaped tree
 * produces, so anything that inspects the tree earlier cannot tell "not
 * started yet" from "already gone".
 */
function agentAttached(agent: ExactWindowsAgent): Promise<void> {
  const ready = agent.outSocket;
  if (!ready.connecting && ready.readyState === 'open') return Promise.resolve();
  return new Promise<void>((resolve) => {
    // Bounded, because teardown owns a deadline of its own and an agent that
    // never attaches must not hold it open. Giving up here is not a verdict:
    // the tree checks that follow still have to prove what they claim, and
    // with no pid and no process list they will refuse to.
    const timer = setTimeout(() => {
      ready.removeListener('ready_datapipe', onReady);
      resolve();
    }, CONPTY_ATTACH_TIMEOUT_MS);
    timer.unref?.();
    const onReady = (): void => {
      clearTimeout(timer);
      resolve();
    };
    ready.once('ready_datapipe', onReady);
  });
}

/**
 * The console-tree members a teardown may kill.
 *
 * Never the caller. Enumerating a ConPTY's processes means attaching to that
 * console, and the attaching process is a member of it while it looks — so the
 * list can name the caller. Killing everything on it then kills the test
 * worker, which is what "Worker exited unexpectedly" was: no JavaScript ran
 * afterwards because no process was left to run it. Whatever a tree kill is
 * for, it is not for the process performing it.
 */
export function ownedConsoleTreePids(reported: readonly number[], selfPid: number): readonly number[] {
  return Object.freeze([...new Set(reported.filter((pid) =>
    Number.isSafeInteger(pid) && pid > 0 && pid !== selfPid,
  ))]);
}

/**
 * How long to wait for ConPTY to attach.
 *
 * Above node-pty's own 5 s connection timeout on purpose: until that expires
 * the connection can still legitimately complete, and giving up earlier turns
 * a slow start into "no pid, no process list", which teardown can only report
 * as a tree it could not prove gone.
 */
const CONPTY_ATTACH_TIMEOUT_MS = 6_000;

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isErrno(error, 'ESRCH')) return false;
    if (isErrno(error, 'EPERM')) return true;
    throw error;
  }
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
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
