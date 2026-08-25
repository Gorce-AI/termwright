import type { ExitStatus } from "../api.js";

/** Side effect performed atomically while the terminal exit becomes visible. */
export type ExitPublisher = (status: ExitStatus, unexpected: boolean) => void;

/**
 * Owns one terminal process's exit identity and teardown intent.
 * PTY adapters may report an exit before output drains; `observeBackendExit`
 * records that evidence without publishing the public terminal state.
 */
export class SessionProcessLifecycle {
  readonly exit: Promise<ExitStatus>;
  #resolveExit!: (status: ExitStatus) => void;
  #status: ExitStatus | null = null;
  #backendStatus: ExitStatus | null = null;
  #teardownRequested = false;

  constructor() {
    this.exit = new Promise<ExitStatus>((resolve) => {
      this.#resolveExit = resolve;
    });
  }

  get status(): ExitStatus | null {
    return this.#status;
  }

  get backendStatus(): ExitStatus | null {
    return this.#backendStatus;
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
    if (this.#status !== null) return false;
    const retained = Object.freeze(status);
    this.#status = retained;
    publish(retained, this.#unexpected(retained));
    this.#resolveExit(retained);
    return true;
  }

  #unexpected(status: ExitStatus): boolean {
    if (this.#teardownRequested) return false;
    if (status.signal !== null) return true;
    return status.code !== null && status.code !== 0;
  }
}
