import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

interface ConsoleListMessage {
  readonly consoleProcessList: readonly number[];
}

interface ConsoleListHelper {
  readonly pid?: number | undefined;
  on(event: 'message', listener: (message: unknown) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  removeListener(event: 'message', listener: (message: unknown) => void): this;
  removeListener(event: 'error', listener: (error: Error) => void): this;
  removeListener(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  kill(): boolean;
}

export type ConsoleListHelperFactory = (innerPid: number) => ConsoleListHelper;

/**
 * Enumerates one ConPTY console through an owned helper process.
 *
 * The pinned node-pty implementation hides this operation behind a Promise
 * with an independent five-second timer. Cancellation abandons that Promise,
 * and agent.kill() starts a second helper. Termwright instead owns the helper,
 * kills it on abort, and settles only after its exit has been observed.
 */
export function enumerateConptyProcesses(
  innerPid: number,
  signal: AbortSignal,
  spawnHelper: ConsoleListHelperFactory = spawnConsoleListHelper,
): Promise<readonly number[]> {
  signal.throwIfAborted();
  if (innerPid <= 0) return Promise.resolve([]);

  return new Promise<readonly number[]>((resolve, reject) => {
    let result: readonly number[] | undefined;
    let cancellation: unknown;
    let settled = false;
    let helper: ConsoleListHelper;
    let observerPid = 0;
    const release = (): void => {
      signal.removeEventListener('abort', onAbort);
      helper.removeListener('message', onMessage);
      helper.removeListener('error', onError);
      helper.removeListener('exit', onExit);
    };
    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      release();
      callback();
    };
    const onMessage = (message: unknown): void => {
      if (!isConsoleListMessage(message)) {
        cancellation = new Error('ConPTY console-list helper returned an invalid message');
        if (!helper.kill()) onExit(null, null);
        return;
      }
      // AttachConsole makes the enumerating helper a temporary member of the
      // target console. Its PID is evidence about the observer, not the owned
      // application tree; retaining it would later target a dead or reused PID.
      result = Object.freeze(message.consoleProcessList.filter((pid) => pid !== observerPid));
    };
    const onError = (error: Error): void => {
      cancellation = error;
      try {
        if (!helper.kill()) onExit(null, null);
      } catch (killError) {
        settle(() => reject(new AggregateError(
          [error, killError],
          'ConPTY console-list helper failed and could not be killed',
          { cause: error },
        )));
      }
    };
    const onExit = (code: number | null, exitSignal: NodeJS.Signals | null): void => {
      if (cancellation !== undefined) {
        settle(() => reject(cancellation));
        return;
      }
      if (result !== undefined) {
        const evidence = result;
        settle(() => resolve(evidence));
        return;
      }
      settle(() => reject(new Error(
        `ConPTY console-list helper exited without evidence (code ${String(code)}, signal ${String(exitSignal)})`,
      )));
    };
    const onAbort = (): void => {
      cancellation = signal.reason;
      try {
        if (!helper.kill()) onExit(null, null);
      } catch (error) {
        settle(() => reject(error));
      }
    };

    try {
      helper = spawnHelper(innerPid);
    } catch (error) {
      reject(error);
      return;
    }
    helper.on('message', onMessage);
    helper.on('error', onError);
    helper.on('exit', onExit);
    signal.addEventListener('abort', onAbort, { once: true });
    if (!Number.isInteger(helper.pid) || (helper.pid ?? 0) <= 0) {
      cancellation = new Error('ConPTY console-list helper did not expose its observer PID');
      if (!helper.kill()) onExit(null, null);
      return;
    }
    observerPid = helper.pid!;
    if (signal.aborted) onAbort();
  });
}

function spawnConsoleListHelper(innerPid: number): ConsoleListHelper {
  const require = createRequire(import.meta.url);
  const requireFromWrapper = createRequire(require.resolve('@lydell/node-pty'));
  const packageEntry = requireFromWrapper.resolve(`@lydell/node-pty-win32-${process.arch}`);
  const helperEntry = join(dirname(packageEntry), 'conpty_console_list_agent.js');
  return fork(helperEntry, [String(innerPid)], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
}

function isConsoleListMessage(value: unknown): value is ConsoleListMessage {
  return typeof value === 'object' && value !== null && 'consoleProcessList' in value &&
    Array.isArray(value.consoleProcessList) && value.consoleProcessList.every(Number.isInteger);
}
