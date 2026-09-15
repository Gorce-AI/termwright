import { spawn, type ChildProcess } from 'node:child_process';

export interface SidecarOutput {
  readonly stream: 'stdout' | 'stderr';
  readonly text: string;
  readonly stdout: string;
  readonly stderr: string;
}

export type SidecarReadiness =
  | {
      readonly output: string | RegExp;
      readonly stream?: 'stdout' | 'stderr' | 'either';
    }
  | ((output: SidecarOutput) => boolean);

export interface LaunchSidecarOptions {
  readonly command: readonly [string, ...string[]];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Output-driven readiness. Omit when successful spawn itself means ready. */
  readonly ready?: SidecarReadiness;
  readonly readyTimeout?: number;
  readonly shutdownTimeout?: number;
  /** Per-stream tail retained for diagnostics. Defaults to 256 KiB. */
  readonly maxOutputBytes?: number;
}

export interface SidecarProcess {
  readonly pid: number;
  /**
   * Authoritative process termination. `reason` is portable; `code` and
   * `signal` preserve the platform's raw child-process result.
   */
  readonly exit: Promise<SidecarExit>;
  stdout(): string;
  stderr(): string;
  close(): Promise<void>;
}

export interface SidecarExit {
  readonly reason: 'exited' | 'closed' | 'spawn-error';
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface SidecarLauncher {
  launch(options: LaunchSidecarOptions): Promise<SidecarProcess>;
}

interface SidecarLaunchContext {
  readonly signal?: AbortSignal;
}

function positive(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new TypeError(`${name} must be a positive finite number`);
  }
  return resolved;
}

function appendTail(current: string, chunk: Uint8Array, maximum: number): string {
  const next = current + Buffer.from(chunk).toString('utf8');
  if (Buffer.byteLength(next) <= maximum) return next;
  // Decode a bounded suffix again so a cut inside a UTF-8 sequence becomes a
  // replacement character instead of corrupting all following diagnostics.
  return Buffer.from(next).subarray(-maximum).toString('utf8');
}

function matches(readiness: SidecarReadiness, output: SidecarOutput): boolean {
  if (typeof readiness === 'function') return readiness(output);
  const stream = readiness.stream ?? 'either';
  const value =
    stream === 'stdout'
      ? output.stdout
      : stream === 'stderr'
        ? output.stderr
        : `${output.stdout}\n${output.stderr}`;
  if (typeof readiness.output === 'string') return value.includes(readiness.output);
  const expression = new RegExp(
    readiness.output.source,
    readiness.output.flags.replace(/[gy]/gu, ''),
  );
  return expression.test(value);
}

function outputFailure(prefix: string, stdout: string, stderr: string): Error {
  return new Error(
    `${prefix}` +
      (stdout === '' ? '' : `\nstdout:\n${stdout}`) +
      (stderr === '' ? '' : `\nstderr:\n${stderr}`),
  );
}

function signalTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

async function killWindowsTree(child: ChildProcess): Promise<void> {
  if (child.pid === undefined) return;
  await new Promise<void>((resolve, reject) => {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.once('error', reject);
    killer.once('exit', (code) => {
      // 128/255 are commonly returned when the process disappeared between
      // the exit observation and taskkill's lookup.
      if (code === 0 || code === 128 || code === 255) resolve();
      else
        reject(new Error(`taskkill failed for sidecar tree ${child.pid} with exit code ${code}`));
    });
  });
}

/** Launches one owned background process and waits for output-defined readiness. */
export async function launchSidecar(
  options: LaunchSidecarOptions,
  context: SidecarLaunchContext = {},
): Promise<SidecarProcess> {
  if (!Array.isArray(options.command) || options.command.length === 0) {
    throw new TypeError('sidecars.launch() needs a non-empty command');
  }
  const readyTimeout = positive(options.readyTimeout, 10_000, 'sidecar readyTimeout');
  const shutdownTimeout = positive(options.shutdownTimeout, 2_000, 'sidecar shutdownTimeout');
  const maximum = positive(options.maxOutputBytes, 256 * 1024, 'sidecar maxOutputBytes');
  const [file, ...arguments_] = options.command;
  const child = spawn(file, arguments_, {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    env: { ...process.env, ...options.env },
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  let closePromise: Promise<void> | undefined;
  let closeRequested = false;
  let resolveExit!: (status: SidecarExit) => void;
  const exit = new Promise<SidecarExit>((resolve) => {
    resolveExit = resolve;
  });
  let exited = false;
  child.once('exit', (code, signal) => {
    exited = true;
    resolveExit({ reason: closeRequested ? 'closed' : 'exited', code, signal });
  });
  child.once('error', () => {
    if (exited) return;
    exited = true;
    resolveExit({ reason: 'spawn-error', code: null, signal: null });
  });

  const sidecar: SidecarProcess = Object.freeze({
    get pid(): number {
      if (child.pid === undefined) throw new Error('sidecar process has no pid');
      return child.pid;
    },
    exit,
    stdout: () => stdout,
    stderr: () => stderr,
    close(): Promise<void> {
      closePromise ??= (async () => {
        closeRequested = true;
        if (process.platform === 'win32') {
          await killWindowsTree(child);
          await exit;
          return;
        }
        if (!exited) signalTree(child, 'SIGTERM');
        let timer: NodeJS.Timeout | undefined;
        const grace = new Promise<'timeout'>((resolve) => {
          timer = setTimeout(() => resolve('timeout'), shutdownTimeout);
          timer.unref?.();
        });
        const outcome = exited
          ? 'exit'
          : await Promise.race([exit.then(() => 'exit' as const), grace]);
        if (timer !== undefined) clearTimeout(timer);
        // Kill the group even when its leader exited: descendants may have
        // inherited the group and kept ports/files alive.
        signalTree(child, 'SIGKILL');
        if (outcome === 'timeout') await exit;
      })();
      return closePromise;
    },
  });

  const onAbort = (): void => {
    void sidecar.close().catch(() => undefined);
  };
  context.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (failure?: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.off('error', onError);
        child.off('exit', onEarlyExit);
        context.signal?.removeEventListener('abort', onReadyAbort);
        if (failure === undefined) resolve();
        else reject(failure);
      };
      const inspect = (stream: SidecarOutput['stream'], chunk: Buffer): void => {
        if (stream === 'stdout') stdout = appendTail(stdout, chunk, maximum);
        else stderr = appendTail(stderr, chunk, maximum);
        if (
          options.ready !== undefined &&
          matches(options.ready, { stream, text: chunk.toString('utf8'), stdout, stderr })
        ) {
          finish();
        }
      };
      child.stdout?.on('data', (chunk: Buffer) => inspect('stdout', chunk));
      child.stderr?.on('data', (chunk: Buffer) => inspect('stderr', chunk));
      const onError = (error: Error): void => finish(error);
      const onEarlyExit = (code: number | null, signal: NodeJS.Signals | null): void =>
        finish(
          outputFailure(
            `sidecar exited before readiness (code=${code}, signal=${signal})`,
            stdout,
            stderr,
          ),
        );
      const onReadyAbort = (): void => finish(context.signal?.reason);
      child.once('error', onError);
      child.once('exit', onEarlyExit);
      context.signal?.addEventListener('abort', onReadyAbort, { once: true });
      const timer = setTimeout(
        () =>
          finish(
            outputFailure(`sidecar did not become ready within ${readyTimeout} ms`, stdout, stderr),
          ),
        readyTimeout,
      );
      timer.unref?.();
      if (context.signal?.aborted === true) finish(context.signal.reason);
      else if (options.ready === undefined) queueMicrotask(() => finish());
    });
    return sidecar;
  } catch (error) {
    await sidecar.close().catch(() => undefined);
    throw error;
  } finally {
    context.signal?.removeEventListener('abort', onAbort);
  }
}
