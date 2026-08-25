import { performance } from 'node:perf_hooks';
import type { ExitStatus } from '../api.js';
import type { PtyProcess } from '../pty.js';

export type ProcessLifecycleErrorCode = 'cleanup-failed' | 'unsupported-signal';

export class ProcessLifecycleError extends Error {
  readonly code: ProcessLifecycleErrorCode;
  readonly exitObserved: boolean;

  constructor(
    code: ProcessLifecycleErrorCode,
    message: string,
    options?: ErrorOptions & { readonly exitObserved?: boolean },
  ) {
    super(message, options);
    this.name = 'ProcessLifecycleError';
    this.code = code;
    this.exitObserved = options?.exitObserved ?? false;
  }
}

class ProcessSignalPermissionError extends Error {
  constructor(signal: 'HUP' | 'KILL', cause: unknown) {
    super(`process-group ${signal} was refused with EPERM`, { cause });
    this.name = 'ProcessSignalPermissionError';
  }
}

interface TimerApi {
  set(callback: () => void, delayMs: number): unknown;
  clear(timer: unknown): void;
}

export interface ProcessSupervisorOptions {
  readonly monotonicNow?: () => number;
  readonly timers?: TimerApi;
  /**
   * Which platform's signal repertoire to assume. Defaults to the host's.
   * Injectable because the Windows branch is otherwise only reachable on
   * Windows, where a mistake in it costs a full CI round-trip to find.
   */
  readonly platform?: NodeJS.Platform;
}

export interface ProcessShutdownOptions {
  /** One absolute monotonic deadline for graceful request, escalation and confirmation. */
  readonly deadline: number;
  readonly gracefulMs: number;
  /** Real backend exit evidence captured before the supervisor subscribed. */
  readonly observedExit?: ExitStatus;
}

const DEFAULT_TIMERS: TimerApi = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

/**
 * Owns the distinction between terminal input, graceful process termination,
 * and a hard process-tree kill. It never manufactures an exit status: success
 * requires the PTY backend's real exit notification.
 */
export class ProcessSupervisor {
  readonly #pty: PtyProcess;
  readonly #now: () => number;
  readonly #timers: TimerApi;
  readonly #platform: NodeJS.Platform;
  #shutdownPromise: Promise<ExitStatus> | null = null;
  #observedExit: ExitStatus | null = null;
  #exitTreeCleanup: Promise<readonly unknown[]> | null = null;

  constructor(pty: PtyProcess, options: ProcessSupervisorOptions = {}) {
    this.#pty = pty;
    // Read the clock lazily rather than binding it here. Binding captures
    // whichever implementation is installed at construction, so a supervisor
    // built while a test's fake timers are active keeps calling that clock
    // after they are uninstalled — and then compares an epoch-scale reading
    // against a deadline computed from the real one, which makes every
    // shutdown look like its deadline had already expired.
    this.#now = options.monotonicNow ?? ((): number => performance.now());
    this.#timers = options.timers ?? DEFAULT_TIMERS;
    this.#platform = options.platform ?? process.platform;
  }

  shutdown(options: ProcessShutdownOptions): Promise<ExitStatus> {
    this.#shutdownPromise ??= this.#shutdown(options);
    return this.#shutdownPromise;
  }

  /**
   * Captures process-group ownership at the exact root-exit boundary.
   *
   * A numeric PGID can be reused after its leader is reaped. Probing it for the
   * first time later in close() can therefore inspect or kill an unrelated
   * process. The PTY exit callback must call this synchronously; any surviving
   * owned descendants are then killed while the group identity is still known.
   */
  observeExit(status: ExitStatus): void {
    if (this.#observedExit !== null) return;
    this.#observedExit = Object.freeze({ ...status });
    const failures: unknown[] = [];
    const treeState = this.#pty.treeState;
    if (treeState === undefined) {
      this.#exitTreeCleanup = Promise.resolve(failures);
      return;
    }
    try {
      const state = treeState.call(this.#pty);
      if (state !== 'alive') {
        this.#exitTreeCleanup = Promise.resolve(failures);
        return;
      }
      this.#trySignal('KILL', failures);
      const deadline = this.#now() + 2_000;
      this.#exitTreeCleanup = this.#waitForTreeGone(deadline).then((gone) => {
        if (!gone) failures.push(new ProcessLifecycleError(
          'cleanup-failed',
          `process group ${this.#pty.pid} remained alive after root exit and hard kill`,
        ));
        return failures;
      });
    } catch (error) {
      failures.push(error);
      this.#exitTreeCleanup = Promise.resolve(failures);
    }
  }

  async #shutdown(options: ProcessShutdownOptions): Promise<ExitStatus> {
    // A non-finite deadline or a negative grace interval is a caller mistake,
    // and rejecting one must not release a backend the caller still owns.
    if (!Number.isFinite(options.deadline)) {
      throw new ProcessLifecycleError('cleanup-failed', 'process shutdown deadline must be a finite monotonic instant');
    }
    if (!Number.isFinite(options.gracefulMs) || options.gracefulMs < 0) {
      throw new ProcessLifecycleError('cleanup-failed', 'process graceful interval must be non-negative');
    }
    // An expired deadline is not a caller mistake — it means an earlier phase
    // consumed the budget — and it used to throw from here, above the block
    // whose `finally` disposes the pseudo-terminal. That leaked the backend
    // handle at the one moment it most needed releasing. It is now recorded as
    // a cleanup failure and drives the escalation below, so the shutdown still
    // reports the same problem and still hands the handle back.
    const budgetSpent = options.deadline <= this.#now();

    if (options.observedExit !== undefined) this.observeExit(options.observedExit);
    let observed: ExitStatus | null = this.#observedExit;
    let resolveExit: ((status: ExitStatus) => void) | undefined;
    const exit = new Promise<ExitStatus>((resolve) => { resolveExit = resolve; });
    const failures: unknown[] = budgetSpent
      ? [new ProcessLifecycleError('cleanup-failed', 'process shutdown deadline already expired')]
      : [];
    let deadlineTimer: unknown;
    const deadlineExpired = new Promise<null>((resolve) => {
      deadlineTimer = this.#timers.set(() => resolve(null), options.deadline - this.#now());
    });
    let unsubscribe = (): void => undefined;
    let canObserveExit = observed !== null;
    if (observed === null) {
      try {
        unsubscribe = this.#pty.onExit((status) => {
          this.observeExit(status);
          observed = status;
          resolveExit?.(status);
        });
        canObserveExit = true;
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      const lifecycle = this.#pty.lifecycle;
      if (budgetSpent && observed === null) {
        // No time remains for a graceful request or for waiting on one, so the
        // strongest operation available is the only honest one left.
        this.#trySignal('KILL', failures);
      } else if (observed !== null) {
        // The backend already proved exit. Do not signal a dead process or
        // wait for a one-shot event that cannot be replayed.
      } else if (!canObserveExit) {
        // We cannot truthfully confirm cleanup, but still attempt the strongest
        // available operation before releasing backend handles.
        this.#trySignal('KILL', failures);
      } else if (lifecycle?.tree === 'conpty-console') {
        // ConPTY exposes no graceful signal or Job Object through node-pty.
        // Its public kill() enumerates the attached console tree and closes the
        // pseudoconsole, so this is deliberately the hard-kill path.
        if (this.#pty.hardKillTree === undefined) {
          failures.push(new ProcessLifecycleError(
            'cleanup-failed',
            `ConPTY backend for process ${this.#pty.pid} cannot prove complete tree termination`,
          ));
          this.#trySignal('KILL', failures);
        } else {
          try {
            await this.#pty.hardKillTree();
          } catch (error) {
            failures.push(error);
            this.#trySignal('KILL', failures);
          }
        }
      } else if (lifecycle?.tree === 'delegated') {
        if (this.#pty.terminate === undefined) {
          failures.push(new ProcessLifecycleError(
            'cleanup-failed',
            `delegated PTY backend for process ${this.#pty.pid} exposes no graceful terminate operation`,
          ));
          this.#trySignal('KILL', failures);
        } else {
          try {
            this.#pty.terminate();
          } catch (error) {
            failures.push(error);
          }
          const graceDeadline = Math.min(options.deadline, this.#now() + options.gracefulMs);
          if (observed === null) observed = await this.#waitForExit(exit, graceDeadline);
          if (observed === null) this.#trySignal('KILL', failures);
        }
      } else {
        // ConPTY has no hang-up signal: the backend rejects HUP outright, so
        // sending it recorded a cleanup failure on every Windows teardown for
        // a signal the platform cannot carry. Only the signal is skipped. The
        // grace window still applies, because the process may already be
        // exiting on its own — after the Ctrl+C the caller sent through
        // terminal input, say — and taking that window away would replace a
        // graceful exit with a hard kill.
        if (this.#platform !== 'win32') this.#trySignal('HUP', failures);
        const graceDeadline = Math.min(options.deadline, this.#now() + options.gracefulMs);
        if (observed === null) observed = await this.#waitForExit(exit, graceDeadline);
        if (observed === null) this.#trySignal('KILL', failures);
      }

      if (canObserveExit && observed === null) observed = await Promise.race([exit, deadlineExpired]);
      if (canObserveExit && observed === null) {
        failures.push(new ProcessLifecycleError(
          'cleanup-failed',
          `process ${this.#pty.pid} did not report a real exit before the shutdown deadline`,
        ));
      }

      let exitTreeFailures: readonly unknown[] = [];
      if (observed !== null && this.#exitTreeCleanup !== null) {
        exitTreeFailures = await this.#exitTreeCleanup;
        failures.push(...exitTreeFailures);
      }
      if (observed !== null && exitTreeFailures.length === 0) {
        // An EPERM from a numeric PGID followed by real root-exit evidence and
        // a `gone` snapshot at that exact boundary means the number was reused
        // by a foreign process before node-pty delivered its callback. Keeping
        // the error would be false failure; retrying the signal would be worse
        // because it would target a process Termwright does not own.
        for (let index = failures.length - 1; index >= 0; index -= 1) {
          if (failures[index] instanceof ProcessSignalPermissionError) failures.splice(index, 1);
        }
      }
    } finally {
      this.#timers.clear(deadlineTimer);
      unsubscribe();
      try {
        this.#pty.dispose();
      } catch (error) {
        failures.push(error);
      }
    }

    if (failures.length > 0) {
      throw new ProcessLifecycleError(
        'cleanup-failed',
        `failed to confirm cleanup of process tree ${this.#pty.pid}: ${failures.map(describeFailure).join('; ')}`,
        {
          cause: new AggregateError(failures, 'process cleanup operations failed'),
          exitObserved: observed !== null,
        },
      );
    }
    return observed!;
  }

  #trySignal(signal: 'HUP' | 'KILL', failures: unknown[]): void {
    try {
      this.#pty.signal(signal);
    } catch (error) {
      failures.push(isErrno(error, 'EPERM') ? new ProcessSignalPermissionError(signal, error) : error);
    }
  }

  async #waitForExit(exit: Promise<ExitStatus>, deadline: number): Promise<ExitStatus | null> {
    const remaining = deadline - this.#now();
    if (remaining <= 0) return null;
    let timer: unknown;
    const timeout = new Promise<null>((resolve) => {
      timer = this.#timers.set(() => resolve(null), remaining);
    });
    try {
      return await Promise.race([exit, timeout]);
    } finally {
      this.#timers.clear(timer);
    }
  }

  async #waitForTreeGone(deadline: number): Promise<boolean> {
    for (;;) {
      const state = this.#pty.treeState?.();
      if (state === 'gone') return true;
      if (state === 'unsupported' || this.#now() >= deadline) return false;
      await new Promise<void>((resolve) => {
        this.#timers.set(resolve, Math.min(10, Math.max(0, deadline - this.#now())));
      });
    }
  }
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function describeFailure(error: unknown): string {
  if (error instanceof AggregateError) {
    return `${error.message}: ${[...error.errors].map(describeFailure).join('; ')}`;
  }
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return typeof error === 'string' ? error : 'unknown process lifecycle failure';
}
