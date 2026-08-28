import type { ExitStatus } from '@termwright/driver';
import type { PtyProcess } from '@termwright/driver/experimental';

const DEFAULT_WATCHDOG_MS = 10_000;

export interface ProbeProcessShutdownResources {
  readonly pty: PtyProcess;
  readonly closeAdmission: () => Promise<void>;
  readonly drainParser: () => Promise<void>;
  readonly disposeParser: () => void;
  readonly removeArtifacts: () => Promise<void>;
  readonly watchdogMs?: number;
}

/**
 * Owns the causal boundary between a probe fixture and its teardown artifacts.
 *
 * Root exit is not output EOF on ConPTY. Conversely, disposing a PTY settles
 * `outputEnded` so teardown cannot hang, but that settlement is explicitly not
 * proof that the reader reached its source. This coordinator therefore waits
 * for both the already-armed exit observer and authoritative EOF, then drains
 * the terminal parser, before it disposes either parser or PTY and before it
 * unlinks files the child may still have open.
 */
export class ProbeProcessShutdown {
  readonly #resources: ProbeProcessShutdownResources;
  readonly #exit: Promise<ExitStatus>;
  readonly #resolveExit: (status: ExitStatus) => void;
  #exitStatus: ExitStatus | null = null;
  #stopPromise: Promise<void> | null = null;

  constructor(resources: ProbeProcessShutdownResources) {
    this.#resources = resources;
    let resolveExit!: (status: ExitStatus) => void;
    this.#exit = new Promise<ExitStatus>((resolve) => {
      resolveExit = resolve;
    });
    this.#resolveExit = resolveExit;
  }

  observeExit(status: ExitStatus): void {
    if (this.#exitStatus !== null) return;
    this.#exitStatus = Object.freeze({ ...status });
    this.#resolveExit(this.#exitStatus);
  }

  stop(): Promise<void> {
    this.#stopPromise ??= this.#stop();
    return this.#stopPromise;
  }

  async #stop(): Promise<void> {
    const failures: unknown[] = [];
    let admissionClosedSuccessfully = false;
    let admissionClosed: Promise<void>;
    try {
      admissionClosed = this.#resources.closeAdmission().then(
        () => {
          admissionClosedSuccessfully = true;
        },
        (error: unknown) => {
          failures.push(error);
        },
      );
    } catch (error) {
      failures.push(error);
      admissionClosed = Promise.resolve();
    }

    const controller = new AbortController();
    let causalBoundaryReached = false;
    try {
      await this.#withWatchdog(this.#reachCausalBoundary(controller.signal), controller);
      causalBoundaryReached = true;
    } catch (error) {
      failures.push(error);
    }

    for (const dispose of [
      () => this.#resources.pty.dispose(),
      () => this.#resources.disposeParser(),
    ]) {
      try {
        dispose();
      } catch (error) {
        failures.push(error);
      }
    }

    try {
      await admissionClosed;
    } catch (error) {
      failures.push(error);
    }

    // A failed process/output/parser boundary leaves the artifact in place as
    // evidence. Retrying its deletion would replace a causal contract with a
    // timing heuristic and can hide the handle owner that broke teardown.
    if (admissionClosedSuccessfully && causalBoundaryReached) {
      try {
        await this.#resources.removeArtifacts();
      } catch (error) {
        failures.push(error);
      }
    }

    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, 'adapter probe cleanup failed');
  }

  async #reachCausalBoundary(signal: AbortSignal): Promise<void> {
    const { pty } = this.#resources;
    const initialTree = pty.treeState?.() ?? 'unsupported';
    if (initialTree === 'alive') {
      if (pty.hardKillTree === undefined) {
        throw new Error(
          `adapter probe cannot prove teardown of process ${String(pty.pid)}: ` +
            'the PTY exposes no owned-tree kill operation',
        );
      }
      await pty.hardKillTree(signal);
    } else if (initialTree === 'unsupported') {
      throw new Error(
        `adapter probe cannot prove teardown of process ${String(pty.pid)}: ` +
          'the PTY exposes no authoritative owned-tree state',
      );
    }

    const outputEnded = pty.outputEnded;
    if (outputEnded === undefined) {
      throw new Error(
        `adapter probe cannot prove teardown of process ${String(pty.pid)}: ` +
          'the PTY exposes no output EOF barrier',
      );
    }

    await this.#awaitOrAbort(
      Promise.all([this.#exit, outputEnded]).then(() => undefined),
      signal,
    );
    signal.throwIfAborted();
    if (pty.sawOutputEnd?.() !== true) {
      throw new Error(
        `adapter probe cannot prove teardown of process ${String(pty.pid)}: ` +
          'the PTY output ended without authoritative EOF',
      );
    }
    if (pty.treeState?.() !== 'gone') {
      throw new Error(
        `adapter probe cannot prove teardown of process ${String(pty.pid)}: ` +
          'the owned process tree was not confirmed gone at EOF',
      );
    }
    await this.#awaitOrAbort(this.#resources.drainParser(), signal);
    signal.throwIfAborted();
  }

  async #awaitOrAbort(operation: Promise<void>, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    let removeAbortListener = (): void => undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      const onAbort = (): void => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
      removeAbortListener = () => signal.removeEventListener('abort', onAbort);
    });
    try {
      await Promise.race([operation, aborted]);
    } finally {
      removeAbortListener();
    }
  }

  async #withWatchdog(operation: Promise<void>, controller: AbortController): Promise<void> {
    const watchdogMs = this.#resources.watchdogMs ?? DEFAULT_WATCHDOG_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(
          new Error(
            `adapter probe teardown did not reach exit, authoritative EOF, and parser drain ` +
              `within its ${String(watchdogMs)} ms watchdog`,
          ),
        );
        controller.abort();
      }, watchdogMs);
    });
    try {
      await Promise.race([operation, expired]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      controller.abort();
    }
  }
}
