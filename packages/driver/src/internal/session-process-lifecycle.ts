import type { ExitStatus } from "../api.js";

/** Side effect performed atomically while the terminal exit becomes visible. */
export type ExitPublisher = (status: ExitStatus, unexpected: boolean) => void;

/**
 * Owns one terminal process's exit identity and teardown intent.
 * PTY adapters may report an exit before output drains; `observeBackendExit`
 * records that evidence without publishing the public terminal state.
 */
export class SessionProcessLifecycle {
  #exit: Promise<ExitStatus> | null = null;
  #resolveExit: ((status: ExitStatus) => void) | null = null;
  #rejectExit: ((error: unknown) => void) | null = null;
  #status: ExitStatus | null = null;
  #failed = false;
  #failure: unknown;
  #backendStatus: ExitStatus | null = null;
  #teardownRequested = false;

  get exit(): Promise<ExitStatus> {
    if (this.#status !== null) return Promise.resolve(this.#status);
    if (this.#failed) {
      const failed = Promise.reject<ExitStatus>(this.#failure);
      void failed.catch(() => undefined);
      return failed;
    }
    this.#exit ??= new Promise<ExitStatus>((resolve, reject) => {
      this.#resolveExit = resolve;
      this.#rejectExit = reject;
    });
    void this.#exit.catch(() => undefined);
    return this.#exit;
  }

  get status(): ExitStatus | null {
    return this.#status;
  }

  get backendStatus(): ExitStatus | null {
    return this.#backendStatus;
  }

  get failed(): boolean {
    return this.#failed;
  }

  get failure(): unknown {
    return this.#failure;
  }

  /** Throws the retained terminal lifecycle failure, if one was recorded. */
  throwIfFailed(): void {
    if (this.#failed) throw this.#failure;
  }

  get teardownRequested(): boolean {
    return this.#teardownRequested;
  }

  requestTeardown(): void {
    this.#teardownRequested = true;
  }

  observeBackendExit(status: ExitStatus): void {
    this.#backendStatus ??= Object.freeze({ ...status });
  }

  complete(status: ExitStatus, publish: ExitPublisher): boolean {
    if (this.#status !== null || this.#failed) return false;
    const retained = Object.freeze(status);
    this.#status = retained;
    try {
      publish(retained, this.#unexpected(retained));
    } finally {
      this.#resolveExit?.(retained);
      this.#clearExitWaiter();
    }
    return true;
  }

  /** Terminates a public exit waiter when teardown cannot produce exit evidence. */
  fail(error: unknown): boolean {
    if (this.#status !== null || this.#failed) return false;
    this.#failed = true;
    this.#failure = error;
    this.#rejectExit?.(error);
    this.#clearExitWaiter();
    return true;
  }

  #clearExitWaiter(): void {
    this.#resolveExit = null;
    this.#rejectExit = null;
    this.#exit = null;
  }

  #unexpected(status: ExitStatus): boolean {
    if (this.#teardownRequested) return false;
    if (status.signal !== null) return true;
    return status.code !== null && status.code !== 0;
  }
}
