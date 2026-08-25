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
  readonly #preparing = new Set<RenderBoundary>();
  #stopped = false;

  take(): RenderBoundary | undefined {
    return this.#pending.shift();
  }

  afterCurrentRender(
    waitForCurrentRender: () => Promise<void>,
    mutate: () => void,
  ): Promise<number> {
    if (this.#stopped) return Promise.reject(stoppedError());
    return new Promise<number>((resolve, reject) => {
      const boundary = { resolve, reject };
      this.#preparing.add(boundary);
      let flush: Promise<void>;
      try {
        flush = waitForCurrentRender();
      } catch (error) {
        this.#preparing.delete(boundary);
        reject(asError(error));
        return;
      }
      // Ink exposes no cancellation API. Keep the uncancellable flush owned
      // and observed until it settles, while `stop()` rejects the public
      // operation immediately so teardown cannot hang on an upstream flush.
      void flush.then(() => {
        this.#preparing.delete(boundary);
        if (this.#stopped) return;
        this.#pending.push(boundary);
        try {
          mutate();
        } catch (error) {
          const index = this.#pending.indexOf(boundary);
          if (index !== -1) this.#pending.splice(index, 1);
          reject(asError(error));
        }
      }, (error: unknown) => {
        this.#preparing.delete(boundary);
        reject(asError(error));
      });
    });
  }

  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    for (const boundary of this.#preparing) boundary.reject(stoppedError());
    // Do not erase ownership of an upstream flush that has not settled. Ink's
    // certified waitUntilRenderFlush() settles when the instance renders or
    // exits; retaining the record until its reaction runs makes a regression
    // in that contract visible to --detectAsyncLeaks instead of hiding it.
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
