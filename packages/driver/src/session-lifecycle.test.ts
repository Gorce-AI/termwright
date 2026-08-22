import { existsSync } from 'node:fs';
import { connect } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { ENV_ENDPOINT } from '@termwright/protocol';
import type { ExitStatus } from './api.js';
import type { PtyBackend, PtyProcess, PtySignal, PtySpawnOptions, PtyUnsubscribe } from './pty.js';
import { launchTerminal } from './session.js';

class ControlledPty implements PtyProcess {
  readonly pid = 42;
  disposeCount = 0;
  readonly #failExitRegistration: boolean;
  readonly #failDispose: boolean;
  readonly #emitExitOnDispose: boolean;
  readonly #failSignal: PtySignal | undefined;
  readonly #status: ExitStatus;
  readonly #exitListeners = new Set<(status: ExitStatus) => void>();
  readonly #writeErrorListeners = new Set<(error: Error) => void>();

  constructor(options: {
    readonly failExitRegistration?: boolean;
    readonly failDispose?: boolean;
    readonly emitExitOnDispose?: boolean;
    readonly failSignal?: PtySignal;
    readonly status?: ExitStatus;
  } = {}) {
    this.#failExitRegistration = options.failExitRegistration ?? false;
    this.#failDispose = options.failDispose ?? false;
    this.#emitExitOnDispose = options.emitExitOnDispose ?? true;
    this.#failSignal = options.failSignal;
    this.#status = options.status ?? { code: 0, signal: null };
  }

  write(_data: Uint8Array): void {}
  resize(_columns: number, _rows: number): void {}
  treeState(): 'gone' { return 'gone'; }
  signal(sig: PtySignal): void {
    if (sig === this.#failSignal) throw new Error(`${sig} is unsupported`);
    if (this.#emitExitOnDispose) {
      for (const listener of [...this.#exitListeners]) listener(this.#status);
    }
  }
  onData(_cb: (data: Uint8Array) => void): PtyUnsubscribe {
    return () => undefined;
  }
  onExit(cb: (status: ExitStatus) => void): PtyUnsubscribe {
    if (this.#failExitRegistration) throw new Error('exit listener registration failed');
    this.#exitListeners.add(cb);
    return () => this.#exitListeners.delete(cb);
  }
  onWriteError(cb: (error: Error) => void): PtyUnsubscribe {
    this.#writeErrorListeners.add(cb);
    return () => this.#writeErrorListeners.delete(cb);
  }
  dispose(): void {
    this.disposeCount += 1;
    if (this.#emitExitOnDispose) {
      for (const listener of [...this.#exitListeners]) listener(this.#status);
    }
    if (this.#failDispose) throw new Error('pty disposal failed');
  }
  emitExit(): void {
    for (const listener of [...this.#exitListeners]) listener(this.#status);
  }
  emitWriteError(error: Error): void {
    for (const listener of [...this.#writeErrorListeners]) listener(error);
  }
}

function backendFor(pty: ControlledPty, endpoint: { value: string | undefined }): PtyBackend {
  return {
    name: 'controlled',
    spawn(options: PtySpawnOptions): PtyProcess {
      endpoint.value = options.env[ENV_ENDPOINT];
      return pty;
    },
  };
}

async function expectEndpointClosed(endpoint: string): Promise<void> {
  if (process.platform !== 'win32') {
    expect(existsSync(endpoint)).toBe(false);
    return;
  }
  const socket = connect(endpoint);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => {
      socket.destroy();
      reject(new Error(`semantic endpoint ${endpoint} still accepts connections`));
    });
    socket.once('error', () => resolve());
  });
}

describe('terminal session resource lifecycle', () => {
  it('surfaces an asynchronous backend write failure and still tears down', async () => {
    const endpoint: { value: string | undefined } = { value: undefined };
    const pty = new ControlledPty();
    const terminal = await launchTerminal({
      command: ['controlled-app'],
      backend: backendFor(pty, endpoint),
    });

    pty.emitWriteError(Object.assign(new Error('write EIO'), { code: 'EIO' }));
    await expect(terminal.waitForText('never')).rejects.toMatchObject({
      code: 'pty-backend-failed',
    });
    await expect(terminal.close()).rejects.toMatchObject({
      code: 'pty-backend-failed',
    });

    expect(pty.disposeCount).toBe(1);
    await expectEndpointClosed(endpoint.value!);
  });

  it('uses one total ready deadline for startup and required semantic negotiation', async () => {
    vi.useFakeTimers();
    try {
      const endpoint: { value: string | undefined } = { value: undefined };
      const pty = new ControlledPty();
      const launched = launchTerminal({
        command: ['controlled-app'],
        backend: backendFor(pty, endpoint),
        requiredCapabilities: ['semantic-tree'],
        semanticNegotiationMs: 100,
        timeouts: { ready: 40 },
      });
      let settled = false;
      void launched.then(
        () => { settled = true; },
        () => { settled = true; },
      );

      await vi.advanceTimersByTimeAsync(39);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(launched).rejects.toMatchObject({ code: 'timeout' });

      // The endpoint acquisition consumed the budget. Expiry is checked
      // before spawning, so no scarce process is created after the deadline.
      expect(pty.disposeCount).toBe(0);
      expect(endpoint.value).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rolls back the endpoint and PTY when startup fails after spawn', async () => {
    const endpoint: { value: string | undefined } = { value: undefined };
    const pty = new ControlledPty({ failExitRegistration: true });

    await expect(launchTerminal({
      command: ['controlled-app'],
      backend: backendFor(pty, endpoint),
    })).rejects.toThrow('terminal startup and rollback failed');

    expect(pty.disposeCount).toBe(1);
    expect(endpoint.value).toBeDefined();
    await expectEndpointClosed(endpoint.value!);
  });

  it('shares concurrent close and preserves only the backend exit status', async () => {
    const endpoint: { value: string | undefined } = { value: undefined };
    const pty = new ControlledPty({ status: { code: 17, signal: null } });
    const terminal = await launchTerminal({
      command: ['controlled-app'],
      backend: backendFor(pty, endpoint),
    });

    const first = terminal.close();
    const second = terminal.close();
    expect(second).toBe(first);
    await first;

    expect(pty.disposeCount).toBe(1);
    expect(await terminal.exit).toEqual({ code: 17, signal: null });
    await expectEndpointClosed(endpoint.value!);
  });

  it('attempts later cleanup after a PTY disposer fails', async () => {
    const endpoint: { value: string | undefined } = { value: undefined };
    const pty = new ControlledPty({ failDispose: true });
    const terminal = await launchTerminal({
      command: ['controlled-app'],
      backend: backendFor(pty, endpoint),
    });

    const first = terminal.close();
    const second = terminal.close();
    expect(second).toBe(first);
    await expect(first).rejects.toMatchObject({ name: 'ResourceCleanupError' });

    expect(pty.disposeCount).toBe(1);
    await expectEndpointClosed(endpoint.value!);
  });

  it('does not invent an exit status when the backend never reports one', async () => {
    vi.useFakeTimers();
    try {
      const endpoint: { value: string | undefined } = { value: undefined };
      const pty = new ControlledPty({ emitExitOnDispose: false });
      const terminal = await launchTerminal({
        command: ['controlled-app'],
        backend: backendFor(pty, endpoint),
      });
      let exitSettled = false;
      void terminal.exit.then(() => {
        exitSettled = true;
      });

      const closing = terminal.close();
      // ResourceScope starts disposers in a microtask. Arm the supervisor's
      // absolute deadline before advancing the manual clock to that boundary.
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(closing).rejects.toMatchObject({ name: 'ResourceCleanupError' });
      await Promise.resolve();

      expect(exitSettled).toBe(false);
      expect(pty.disposeCount).toBe(1);
      await expectEndpointClosed(endpoint.value!);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not mark teardown requested when a signal was rejected', async () => {
    const endpoint: { value: string | undefined } = { value: undefined };
    const pty = new ControlledPty({ failSignal: 'TERM', status: { code: 17, signal: null } });
    const terminal = await launchTerminal({ command: ['controlled-app'], backend: backendFor(pty, endpoint) });

    await expect(terminal.signal('TERM')).rejects.toThrow('TERM is unsupported');
    pty.emitExit();
    await expect(terminal.exit).resolves.toEqual({ code: 17, signal: null });
    expect(terminal.crashReport()).not.toBeNull();
    await terminal.close();
  });
});
