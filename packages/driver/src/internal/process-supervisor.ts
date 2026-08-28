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
  /** Closes session-owned input producers immediately before PTY input is disposed. */
  readonly beforeDispose?: () => void;
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
  #exitTreeFailures: unknown[] | null = null;
  #exitTreeNeedsConfirmation = false;
  #exitTreeConfirmedGone = false;
  #exitTreeConfirmation: Promise<boolean> | null = null;
  #cancelExitTreeConfirmation: (() => void) | null = null;

  constructor(pty: PtyProcess, options: ProcessSupervisorOptions = {}) {
    this.#pty = pty;
    // Read the clock lazily rather than binding it here. Binding captures
    // whichever implementation is installed at construction, so a supervisor
    // built while a test's fake timers are active keeps calling that clock
    // after they are uninstalled — and then compares an epoch-scale reading
    // against a deadline computed from the real one, which makes every
    // shutdown look like its deadline had already expired.
    this.#now = options.monotonicNow ?? ((): number => globalThis.performance.now());
    this.#timers = options.timers ?? DEFAULT_TIMERS;
    this.#platform = options.platform ?? process.platform;
  }

  shutdown(options: ProcessShutdownOptions): Promise<ExitStatus> {
    this.#shutdownPromise ??= this.#shutdown(options);
    return this.#shutdownPromise;
  }

  /** Settles only after descendants owned at the root-exit boundary are gone. */
  waitForOwnedTreeExit(): Promise<boolean> {
    return this.#exitTreeConfirmation ?? Promise.resolve(false);
  }

  ownedTreeExitFailure(): ProcessLifecycleError {
    const failures = this.#exitTreeFailures ?? [];
    const evidence =
      failures.length > 0
        ? failures
        : [
            new ProcessLifecycleError(
              'cleanup-failed',
              `process tree ${this.#pty.pid} was not confirmed gone`,
            ),
          ];
    return new ProcessLifecycleError(
      'cleanup-failed',
      `failed to confirm cleanup of process tree ${this.#pty.pid}: ${evidence.map(describeFailure).join('; ')}`,
      {
        cause: new AggregateError(evidence, 'process tree exit confirmation failed'),
        exitObserved: this.#observedExit !== null,
      },
    );
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
      const treeClaim = this.#pty.lifecycle?.tree;
      if (treeClaim === 'posix-process-group' || treeClaim === 'conpty-console') {
        failures.push(
          new ProcessLifecycleError(
            'cleanup-failed',
            `${treeClaim} backend for process ${this.#pty.pid} exposes no tree-state confirmation`,
          ),
        );
        this.#exitTreeNeedsConfirmation = true;
        this.#exitTreeConfirmation = Promise.resolve(false);
      } else {
        // A delegated backend owns its lifecycle behind terminate(); a legacy
        // backend made no process-tree claim that Termwright could confirm.
        this.#exitTreeConfirmedGone = true;
        this.#exitTreeConfirmation = Promise.resolve(true);
      }
      this.#exitTreeFailures = failures;
      return;
    }
    try {
      const state = treeState.call(this.#pty);
      if (state !== 'alive') {
        this.#exitTreeConfirmedGone = state === 'gone';
        if (state === 'unsupported') {
          failures.push(
            new ProcessLifecycleError(
              'cleanup-failed',
              `backend for process ${this.#pty.pid} could not confirm its declared process tree`,
            ),
          );
          this.#exitTreeNeedsConfirmation = true;
        }
        this.#exitTreeConfirmation = Promise.resolve(state === 'gone');
        this.#exitTreeFailures = failures;
        return;
      }
      try {
        if (this.#pty.killOwnedTreeAtExitBoundary !== undefined) {
          this.#pty.killOwnedTreeAtExitBoundary();
        } else {
          this.#trySignal('KILL', failures);
        }
      } catch (error) {
        failures.push(
          isErrno(error, 'EPERM') ? new ProcessSignalPermissionError('KILL', error) : error,
        );
      }
      // Preserve the exact ownership snapshot and begin one owned confirmation
      // now. Natural exit waits without an invented timeout; close() can cancel
      // this same operation when its absolute cleanup deadline is exhausted.
      this.#exitTreeFailures = failures;
      this.#exitTreeNeedsConfirmation = true;
      this.#exitTreeConfirmation = this.#startExitTreeConfirmation();
    } catch (error) {
      failures.push(error);
      this.#exitTreeFailures = failures;
      this.#exitTreeNeedsConfirmation = true;
      this.#exitTreeConfirmation = Promise.resolve(false);
    }
  }

  async #shutdown(options: ProcessShutdownOptions): Promise<ExitStatus> {
    // A non-finite deadline or a negative grace interval is a caller mistake,
    // and rejecting one must not release a backend the caller still owns.
    if (!Number.isFinite(options.deadline)) {
      throw new ProcessLifecycleError(
        'cleanup-failed',
        'process shutdown deadline must be a finite monotonic instant',
      );
    }
    if (!Number.isFinite(options.gracefulMs) || options.gracefulMs < 0) {
      throw new ProcessLifecycleError(
        'cleanup-failed',
        'process graceful interval must be non-negative',
      );
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
    let activeExitWaiter: ((status: ExitStatus | null) => void) | undefined;
    const failures: unknown[] = budgetSpent
      ? [new ProcessLifecycleError('cleanup-failed', 'process shutdown deadline already expired')]
      : [];
    let deadlineReached = budgetSpent;
    let hardKillController: AbortController | undefined;
    const deadlineTimer = { value: undefined as unknown, assigned: false, clearAfterAssign: false };
    const expireDeadline = (): void => {
      deadlineReached = true;
      hardKillController?.abort();
      this.#cancelExitTreeConfirmation?.();
      if (!deadlineTimer.assigned) deadlineTimer.clearAfterAssign = true;
      activeExitWaiter?.(null);
    };
    if (!budgetSpent) {
      deadlineTimer.value = this.#timers.set(expireDeadline, options.deadline - this.#now());
      deadlineTimer.assigned = true;
      if (deadlineTimer.clearAfterAssign) this.#timers.clear(deadlineTimer.value);
    }
    let unsubscribe = (): void => undefined;
    let canObserveExit = observed !== null;
    if (observed === null) {
      try {
        unsubscribe = this.#pty.onExit((status) => {
          this.observeExit(status);
          observed = status;
          activeExitWaiter?.(status);
        });
        canObserveExit = true;
      } catch (error) {
        failures.push(error);
      }
    }
    const waitForExit = (deadline: number): Promise<ExitStatus | null> => {
      const remaining = deadline - this.#now();
      if (remaining <= 0) return Promise.resolve(null);
      return new Promise<ExitStatus | null>((resolve) => {
        const timer = { value: undefined as unknown, assigned: false, clearAfterAssign: false };
        let timerAssigned = false;
        let clearAfterAssign = false;
        let settled = false;
        const settle = (status: ExitStatus | null): void => {
          if (settled) return;
          settled = true;
          if (timerAssigned) this.#timers.clear(timer.value);
          else clearAfterAssign = true;
          if (activeExitWaiter === settle) activeExitWaiter = undefined;
          resolve(status);
        };
        activeExitWaiter = settle;
        timer.value = this.#timers.set(() => settle(null), remaining);
        timer.assigned = true;
        timerAssigned = true;
        if (clearAfterAssign) this.#timers.clear(timer.value);
        // onExit cannot interleave synchronous JavaScript, but an injected
        // timer is allowed to fire immediately. Re-read the shared evidence so
        // neither kind of implementation can lose a proven exit.
        if (observed !== null) settle(observed);
      });
    };
    const waitForDeadlineExit = (): Promise<ExitStatus | null> => {
      if (observed !== null) return Promise.resolve(observed);
      if (deadlineReached || this.#now() >= options.deadline) return Promise.resolve(null);
      return new Promise<ExitStatus | null>((resolve) => {
        const settle = (status: ExitStatus | null): void => {
          if (activeExitWaiter === settle) activeExitWaiter = undefined;
          resolve(status);
        };
        activeExitWaiter = settle;
        if (observed !== null) settle(observed);
        else if (deadlineReached) settle(null);
      });
    };
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
        // Windows cannot deliver POSIX graceful signals through ConPTY. The
        // native backend owns a Job Object and exposes its termination as this
        // deliberately separate hard-kill path.
        if (this.#pty.hardKillTree === undefined) {
          failures.push(
            new ProcessLifecycleError(
              'cleanup-failed',
              `ConPTY backend for process ${this.#pty.pid} cannot prove complete tree termination`,
            ),
          );
          this.#trySignal('KILL', failures);
        } else {
          try {
            hardKillController = new AbortController();
            if (deadlineReached) hardKillController.abort();
            await this.#pty.hardKillTree(hardKillController.signal);
          } catch (error) {
            failures.push(error);
            this.#trySignal('KILL', failures);
          }
        }
      } else if (lifecycle?.tree === 'delegated') {
        if (this.#pty.terminate === undefined) {
          failures.push(
            new ProcessLifecycleError(
              'cleanup-failed',
              `delegated PTY backend for process ${this.#pty.pid} exposes no graceful terminate operation`,
            ),
          );
          this.#trySignal('KILL', failures);
        } else {
          try {
            this.#pty.terminate();
          } catch (error) {
            failures.push(error);
          }
          const graceDeadline = Math.min(options.deadline, this.#now() + options.gracefulMs);
          if (observed === null) observed = await waitForExit(graceDeadline);
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
        if (observed === null) observed = await waitForExit(graceDeadline);
        if (observed === null) this.#trySignal('KILL', failures);
      }

      if (canObserveExit && observed === null) observed = await waitForDeadlineExit();
      if (canObserveExit && observed === null) {
        failures.push(
          new ProcessLifecycleError(
            'cleanup-failed',
            `process ${this.#pty.pid} did not report a real exit before the shutdown deadline`,
          ),
        );
      }

      const exitTreeFailures = this.#exitTreeFailures ?? [];
      if (observed !== null && this.#exitTreeNeedsConfirmation) {
        if (deadlineReached) this.#cancelExitTreeConfirmation?.();
        const gone = await this.waitForOwnedTreeExit();
        this.#exitTreeConfirmedGone = gone;
        if (!gone)
          exitTreeFailures.push(
            new ProcessLifecycleError(
              'cleanup-failed',
              `process group ${this.#pty.pid} was not confirmed gone after root exit and hard kill before the shutdown deadline`,
            ),
          );
      }
      failures.push(...exitTreeFailures);
      if (observed !== null && this.#exitTreeConfirmedGone) {
        // An EPERM from a numeric PGID followed by real root-exit evidence and
        // a `gone` snapshot at that exact boundary means the number was reused
        // by a foreign process before a backend delivered its callback. Keeping
        // the error would be false failure; retrying the signal would be worse
        // because it would target a process Termwright does not own.
        for (let index = failures.length - 1; index >= 0; index -= 1) {
          if (failures[index] instanceof ProcessSignalPermissionError) failures.splice(index, 1);
        }
      }
    } finally {
      activeExitWaiter = undefined;
      hardKillController?.abort();
      if (deadlineTimer.assigned) this.#timers.clear(deadlineTimer.value);
      else deadlineTimer.clearAfterAssign = true;
      unsubscribe();
      try {
        options.beforeDispose?.();
      } catch (error) {
        failures.push(error);
      }
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
      failures.push(
        isErrno(error, 'EPERM') ? new ProcessSignalPermissionError(signal, error) : error,
      );
    }
  }

  #startExitTreeConfirmation(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      let timer: unknown;
      let timerAssigned = false;
      let clearAfterAssign = false;
      const clearTimer = (): void => {
        if (timerAssigned) this.#timers.clear(timer);
        else clearAfterAssign = true;
      };
      const settle = (gone: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimer();
        this.#cancelExitTreeConfirmation = null;
        resolve(gone);
      };
      const poll = (): void => {
        if (settled) return;
        timerAssigned = false;
        clearAfterAssign = false;
        let state: ReturnType<NonNullable<PtyProcess['treeState']>>;
        try {
          state = this.#pty.treeState?.() ?? 'unsupported';
        } catch (error) {
          this.#exitTreeFailures?.push(error);
          settle(false);
          return;
        }
        if (state === 'gone') {
          settle(true);
          return;
        }
        if (state === 'unsupported') {
          settle(false);
          return;
        }
        timer = this.#timers.set(poll, 10);
        timerAssigned = true;
        if (clearAfterAssign) this.#timers.clear(timer);
      };
      this.#cancelExitTreeConfirmation = () => settle(false);
      poll();
    });
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
