import type { DeadlineOperation } from './deadline.js';
import { createDeadlineDeferred } from './deadline.js';

interface BindableServer {
  once(event: 'error', listener: (error: Error) => void): this;
  removeListener(event: 'error', listener: (error: Error) => void): this;
  listen(address: string, callback: () => void): this;
  close(callback: (error?: Error) => void): this;
}

export interface ControlServerBind extends DeadlineOperation<void> {
  /** Cancels the bind and resolves only after no late listener can survive. */
  rollback(): Promise<void>;
}

function isNotRunning(error: Error): boolean {
  return (error as NodeJS.ErrnoException).code === 'ERR_SERVER_NOT_RUNNING';
}

/** Owns both the initial listen and every close needed to cancel a pending bind. */
export function bindControlServer(server: BindableServer, address: string): ControlServerBind {
  const bound = createDeadlineDeferred<void>();
  let listenPending = true;
  let rollbackRequested = false;
  let closeInFlight = false;
  let rollbackSettled = false;
  let rollbackError: unknown;
  let resolveRollback!: () => void;
  const rollbackResult = new Promise<void>((resolve) => {
    resolveRollback = resolve;
  });

  const detachBindError = (): void => {
    server.removeListener('error', onBindError);
  };
  const finishRollback = (error?: unknown): void => {
    if (rollbackSettled) return;
    rollbackSettled = true;
    detachBindError();
    rollbackError = error;
    resolveRollback();
  };
  const closeOwnedServer = (): void => {
    if (closeInFlight || rollbackSettled) return;
    closeInFlight = true;
    try {
      server.close((error) => {
        closeInFlight = false;
        if (error === undefined) {
          finishRollback();
        } else if (isNotRunning(error)) {
          // A listen callback may still be queued even though `listening` is not
          // observable yet. Keep ownership until that callback or its error,
          // then close again from the now-established state.
          if (!listenPending) finishRollback();
        } else {
          finishRollback(error);
        }
      });
    } catch (error) {
      closeInFlight = false;
      finishRollback(error);
    }
  };
  function onBindError(error: Error): void {
    listenPending = false;
    if (rollbackRequested) {
      finishRollback();
    } else {
      detachBindError();
      bound.reject(error);
    }
  }
  const onListening = (): void => {
    listenPending = false;
    if (rollbackRequested) {
      closeOwnedServer();
    } else {
      detachBindError();
      bound.resolve();
    }
  };
  const requestRollback = (): void => {
    if (rollbackRequested) return;
    rollbackRequested = true;
    bound.cancel();
    closeOwnedServer();
  };

  server.once('error', onBindError);
  try {
    server.listen(address, onListening);
  } catch (error) {
    onBindError(error instanceof Error ? error : new Error(String(error)));
  }
  return {
    result: bound.result,
    cancel: requestRollback,
    async rollback(): Promise<void> {
      requestRollback();
      await rollbackResult;
      if (rollbackError !== undefined) throw rollbackError;
    },
  };
}
