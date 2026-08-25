export interface RenderBoundary {
  readonly resolve: (revision: number) => void;
  readonly reject: (error: Error) => void;
}

/**
 * Associates an explicit mutation with the renderer commit it causes.
 *
 * Ink can still have an onRender callback queued after a caller has observed
 * the first semantic frame. Drain that existing work before arming the next
 * boundary, otherwise the trailing callback can acknowledge the new mutation.
 */
export class RenderBoundaryQueue {
  readonly #pending: RenderBoundary[] = [];
  readonly #stopWaiters = new Set<() => void>();
  #stopped = false;

  take(): RenderBoundary | undefined {
    return this.#pending.shift();
  }

  async afterCurrentRender(
    waitForCurrentRender: () => Promise<void>,
    mutate: () => void,
  ): Promise<number> {
    if (this.#stopped) throw stoppedError();
    let signalStop: () => void = () => undefined;
    const stopped = new Promise<void>((resolve) => {
      signalStop = resolve;
      this.#stopWaiters.add(signalStop);
    });
    try {
      await Promise.race([waitForCurrentRender(), stopped]);
    } finally {
      this.#stopWaiters.delete(signalStop);
    }
    if (this.#stopped) throw stoppedError();
    return new Promise<number>((resolve, reject) => {
      const boundary = { resolve, reject };
      this.#pending.push(boundary);
      try {
        mutate();
      } catch (error) {
        const index = this.#pending.indexOf(boundary);
        if (index !== -1) this.#pending.splice(index, 1);
        reject(asError(error));
      }
    });
  }

  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    for (const signal of this.#stopWaiters) signal();
    this.#stopWaiters.clear();
    for (const boundary of this.#pending.splice(0)) {
      boundary.reject(stoppedError());
    }
  }
}

function stoppedError(): Error {
  return new Error('Ink probe stopped before the render boundary');
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
