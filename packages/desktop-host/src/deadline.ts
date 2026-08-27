export interface DeadlineOperation<T> {
  readonly result: Promise<T>;
  cancel(): void;
}

export interface DeadlineDeferred<T> extends DeadlineOperation<T> {
  resolve(value: T): void;
  reject(error: unknown): void;
}

class DeadlineOperationCancelledError extends Error {
  constructor() {
    super('deadline operation was cancelled');
    this.name = 'DeadlineOperationCancelledError';
  }
}

/** Creates a waiter whose owner can settle it during deadline teardown. */
export function createDeadlineDeferred<T>(): DeadlineDeferred<T> {
  let settled = false;
  let resolveResult!: (value: T) => void;
  let rejectResult!: (error: unknown) => void;
  const result = new Promise<T>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  // Ownership may be cancelled before its consumer starts awaiting (for
  // example when a synchronous setup step throws). Preserve the rejection for
  // that consumer while ensuring the owner never emits it as unhandled.
  void result.catch(() => undefined);
  return {
    result,
    resolve(value): void {
      if (settled) return;
      settled = true;
      resolveResult(value);
    },
    reject(error): void {
      if (settled) return;
      settled = true;
      rejectResult(error);
    },
    cancel(): void {
      if (settled) return;
      settled = true;
      rejectResult(new DeadlineOperationCancelledError());
    },
  };
}

/**
 * Runs one owned operation within an absolute deadline shared by a startup or
 * shutdown sequence. Expiry asks the owner to detach its producers and settle
 * its result, so no losing promise remains attached after this returns.
 */
export async function withinDeadline<T>(
  operation: DeadlineOperation<T>,
  deadline: number,
  detail: string | (() => string),
): Promise<T> {
  const describe = (): string => (typeof detail === 'function' ? detail() : detail);
  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const remaining = deadline - performance.now();
    const finish = (settle: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      settle();
    };
    const expire = (): void => {
      const deadlineError = new Error(describe());
      let cancellationError: unknown;
      try {
        operation.cancel();
      } catch (error) {
        cancellationError = error;
      }
      finish(() =>
        reject(
          cancellationError === undefined
            ? deadlineError
            : new AggregateError(
                [deadlineError, cancellationError],
                'deadline expiry and operation cancellation failed',
                {
                  cause: deadlineError,
                },
              ),
        ),
      );
    };
    const timer = remaining > 0 ? setTimeout(expire, remaining) : undefined;
    timer?.unref?.();

    // Observe before checking the budget: synchronous cancellation may reject
    // the operation immediately and must already belong to this waiter.
    void operation.result.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
    if (remaining <= 0) {
      expire();
    }
  });
}
