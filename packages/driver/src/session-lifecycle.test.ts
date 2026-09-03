import { existsSync } from 'node:fs';
import { connect } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LIMITS, encodeFrame, ENV_ENDPOINT, ENV_TOKEN } from '@termwright/protocol';
import { it as resourceAwareIt } from '@termwright/test-provider-internal';
import type { ExitStatus, OwnedProcessResourceUsage } from './api.js';
import type { PtyBackend, PtyProcess, PtySignal, PtySpawnOptions, PtyUnsubscribe } from './pty.js';
import { installTerminalLaunchResourceProvider } from './launch-resources.js';
import { SemanticChannel } from './semantic.js';
import { CLOSE_GRACE_MS, launchTerminalWithBackend } from './session.js';
import { VtScreen } from './vt.js';

class ControlledPty implements PtyProcess {
  readonly pid = 42;
  readonly lifecycle: NonNullable<PtyProcess['lifecycle']>;
  disposeCount = 0;
  readonly resizeCalls: Array<{ columns: number; rows: number }> = [];
  readonly signalCalls: PtySignal[] = [];
  readonly writeCalls: Uint8Array[] = [];
  readonly terminalResponseWriteCalls: Uint8Array[] = [];
  readonly inputOrder: Array<{
    readonly kind: 'application' | 'terminal-response';
    readonly data: Uint8Array;
  }> = [];
  terminateCount = 0;
  readonly #failExitRegistration: boolean;
  readonly #failDispose: boolean;
  readonly #failWrite: boolean;
  readonly #emitExitOnDispose: boolean;
  readonly #failSignal: PtySignal | undefined;
  readonly #status: ExitStatus;
  readonly #neverAttach: boolean;
  readonly #treeState: 'gone' | 'unsupported' | 'throw';
  readonly #onAttach: (() => void) | undefined;
  readonly #onDispose: (() => void) | undefined;
  readonly #initialData: Uint8Array | undefined;
  readonly #ownedProcessResources: OwnedProcessResourceUsage | null;
  readonly #dataListeners = new Set<(data: Uint8Array) => void>();
  readonly #exitListeners = new Set<(status: ExitStatus) => void>();
  readonly #writeErrorListeners = new Set<(error: Error) => void>();

  constructor(
    options: {
      readonly failExitRegistration?: boolean;
      readonly failDispose?: boolean;
      readonly failWrite?: boolean;
      readonly emitExitOnDispose?: boolean;
      readonly failSignal?: PtySignal;
      readonly status?: ExitStatus;
      readonly neverAttach?: boolean;
      readonly lifecycle?: PtyProcess['lifecycle'];
      readonly treeState?: 'gone' | 'unsupported' | 'throw';
      readonly onAttach?: () => void;
      readonly onDispose?: () => void;
      readonly initialData?: Uint8Array;
      readonly ownedProcessResources?: OwnedProcessResourceUsage | null;
    } = {},
  ) {
    this.#failExitRegistration = options.failExitRegistration ?? false;
    this.#failDispose = options.failDispose ?? false;
    this.#failWrite = options.failWrite ?? false;
    this.#emitExitOnDispose = options.emitExitOnDispose ?? true;
    this.#failSignal = options.failSignal;
    this.#status = options.status ?? { code: 0, signal: null };
    this.#neverAttach = options.neverAttach ?? false;
    this.lifecycle = options.lifecycle ?? { tree: 'posix-process-group', outputDrain: 'eof' };
    this.#treeState = options.treeState ?? 'gone';
    this.#onAttach = options.onAttach;
    this.#onDispose = options.onDispose;
    this.#initialData = options.initialData;
    this.#ownedProcessResources = options.ownedProcessResources ?? null;
  }

  write(data: Uint8Array): void {
    if (this.#failWrite) throw new Error('write failed');
    const owned = Uint8Array.from(data);
    this.writeCalls.push(owned);
    this.inputOrder.push({ kind: 'application', data: owned });
  }
  writeTerminalResponse(data: Uint8Array): 'application-direct' {
    if (this.#failWrite) throw new Error('write failed');
    const owned = Uint8Array.from(data);
    this.terminalResponseWriteCalls.push(owned);
    this.inputOrder.push({ kind: 'terminal-response', data: owned });
    return 'application-direct';
  }
  resize(columns: number, rows: number): void {
    this.resizeCalls.push({ columns, rows });
  }
  treeState(): 'gone' | 'unsupported' {
    if (this.#treeState === 'throw') throw new Error('tree confirmation failed');
    return this.#treeState;
  }
  ownedProcessResources(): OwnedProcessResourceUsage | null {
    return this.#ownedProcessResources;
  }
  signal(sig: PtySignal): void {
    this.signalCalls.push(sig);
    if (sig === this.#failSignal) throw new Error(`${sig} is unsupported`);
    if (this.#emitExitOnDispose) {
      for (const listener of [...this.#exitListeners]) listener(this.#status);
    }
  }
  onData(cb: (data: Uint8Array) => void): PtyUnsubscribe {
    if (this.#initialData !== undefined) cb(this.#initialData);
    this.#dataListeners.add(cb);
    return () => this.#dataListeners.delete(cb);
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
  attachCancelCount = 0;
  async attach(signal: AbortSignal): Promise<void> {
    this.#onAttach?.();
    if (!this.#neverAttach) return;
    await new Promise<void>((_resolve, reject) => {
      const onAbort = (): void => {
        signal.removeEventListener('abort', onAbort);
        this.attachCancelCount += 1;
        reject(signal.reason);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
  }
  terminate(): void {
    this.terminateCount += 1;
    for (const listener of [...this.#exitListeners]) listener(this.#status);
  }
  dispose(): void {
    this.disposeCount += 1;
    this.#onDispose?.();
    if (this.#emitExitOnDispose) {
      for (const listener of [...this.#exitListeners]) listener(this.#status);
    }
    if (this.#failDispose) throw new Error('pty disposal failed');
  }
  emitExit(): void {
    for (const listener of [...this.#exitListeners]) listener(this.#status);
  }
  emitData(data: Uint8Array): void {
    for (const listener of [...this.#dataListeners]) listener(data);
  }
  emitWriteError(error: Error): void {
    for (const listener of [...this.#writeErrorListeners]) listener(error);
  }
}

function backendFor(
  pty: ControlledPty,
  endpoint: { value: string | undefined; token?: string },
  onSpawn?: () => void,
): PtyBackend {
  return {
    name: 'controlled',
    spawn(options: PtySpawnOptions): PtyProcess {
      endpoint.value = options.env[ENV_ENDPOINT];
      const token = options.env[ENV_TOKEN];
      if (token !== undefined) endpoint.token = token;
      onSpawn?.();
      return pty;
    },
  };
}

function expectEndpointRemoved(endpoint: string): void {
  // Unix-domain sockets have a filesystem artifact to verify. Windows named
  // pipes do not: opening a missing pipe is an unbounded operation in libuv,
  // so a negative connect is not a valid teardown oracle. SemanticChannel's
  // own tests verify the causal server.close() barrier on every platform.
  if (process.platform !== 'win32') expect(existsSync(endpoint)).toBe(false);
}

const terminalIt = resourceAwareIt.resources({ terminals: 1, traceWriters: 0 });

afterEach(() => vi.restoreAllMocks());

describe('terminal session resource lifecycle', () => {
  terminalIt('captures owned-tree accounting immediately before PTY disposal', async () => {
    const resources = {
      source: 'windows-job-object',
      userTime100ns: 10,
      kernelTime100ns: 20,
      peakJobMemoryBytes: 30,
      readOperationCount: 1,
      writeOperationCount: 2,
      otherOperationCount: 3,
      readTransferBytes: 40,
      writeTransferBytes: 50,
      otherTransferBytes: 60,
      totalProcesses: 4,
      activeProcesses: 0,
      totalTerminatedProcesses: 4,
    } as const;
    const endpoint: { value: string | undefined } = { value: undefined };
    const terminal = await launchTerminalWithBackend({
      command: ['controlled-app'],
      backend: backendFor(new ControlledPty({ ownedProcessResources: resources }), endpoint),
    });

    expect(terminal.ownedProcessResources()).toBeNull();
    await terminal.close();
    expect(terminal.ownedProcessResources()).toEqual(resources);
  });

  terminalIt('disconnects delayed terminal replies before closing PTY input', async () => {
    const teardown: string[] = [];
    let responseListener: Parameters<VtScreen['onResponse']>[0] | undefined;
    const originalOnResponse = VtScreen.prototype.onResponse;
    const responseSpy = vi.spyOn(VtScreen.prototype, 'onResponse').mockImplementation(function (
      this: VtScreen,
      listener,
    ) {
      responseListener = listener;
      const unsubscribe = originalOnResponse.call(this, listener);
      return () => {
        teardown.push('terminal-response');
        unsubscribe();
      };
    });
    const endpoint: { value: string | undefined } = { value: undefined };
    const pty = new ControlledPty({
      onDispose: () => {
        teardown.push('pty');
        responseListener?.({ data: '\u001b[1;1R', kind: 'emulator' });
      },
    });
    const terminal = await launchTerminalWithBackend({
      command: ['controlled-app'],
      backend: backendFor(pty, endpoint),
    });

    await terminal.close();

    expect(teardown).toEqual(['terminal-response', 'pty']);
    expect(pty.writeCalls).toEqual([]);
    expect(
      terminal
        .diagnostics()
        .filter((entry) => entry.code === 'terminal-response-after-input-close'),
    ).toHaveLength(1);
    responseSpy.mockRestore();
  });

  terminalIt('surfaces a terminal reply write failure through session lifecycle', async () => {
    let responseListener: Parameters<VtScreen['onResponse']>[0] | undefined;
    const originalOnResponse = VtScreen.prototype.onResponse;
    const responseSpy = vi.spyOn(VtScreen.prototype, 'onResponse').mockImplementation(function (
      this: VtScreen,
      listener,
    ) {
      responseListener = listener;
      return originalOnResponse.call(this, listener);
    });
    const endpoint: { value: string | undefined } = { value: undefined };
    const terminal = await launchTerminalWithBackend({
      command: ['controlled-app'],
      backend: backendFor(new ControlledPty({ failWrite: true }), endpoint),
    });

    responseListener?.({ data: '\u001b[1;1R', kind: 'emulator' });

    await expect(terminal.waitForText('never')).rejects.toMatchObject({
      code: 'pty-backend-failed',
    });
    await expect(terminal.close()).rejects.toMatchObject({ code: 'pty-backend-failed' });
    responseSpy.mockRestore();
  });

  terminalIt('routes emulator replies through the dedicated PTY response transport', async () => {
    let responseListener: Parameters<VtScreen['onResponse']>[0] | undefined;
    const originalOnResponse = VtScreen.prototype.onResponse;
    const responseSpy = vi.spyOn(VtScreen.prototype, 'onResponse').mockImplementation(function (
      this: VtScreen,
      listener,
    ) {
      responseListener = listener;
      return originalOnResponse.call(this, listener);
    });
    const endpoint: { value: string | undefined } = { value: undefined };
    const pty = new ControlledPty();
    const terminal = await launchTerminalWithBackend({
      command: ['controlled-app'],
      backend: backendFor(pty, endpoint),
    });

    responseListener?.({ data: '\u001b[?2026;2$y', kind: 'emulator' });

    expect(pty.writeCalls).toEqual([]);
    expect(
      pty.terminalResponseWriteCalls.map((data) => Buffer.from(data).toString('ascii')),
    ).toEqual(['\u001b[?2026;2$y']);
    await terminal.close();
    responseSpy.mockRestore();
  });

  terminalIt('commits pending terminal replies before admitting later user input', async () => {
    const endpoint: { value: string | undefined } = { value: undefined };
    const pty = new ControlledPty();
    const terminal = await launchTerminalWithBackend({
      command: ['controlled-app'],
      backend: backendFor(pty, endpoint),
    });

    // Do not await the PTY output callback: this is the real race between a
    // query still queued in xterm's parser and an immediately following user
    // action. DSR is used because its response is deterministic at 1,1.
    pty.emitData(Buffer.from('\u001b[6n', 'ascii'));
    await terminal.type('a');

    expect(
      pty.inputOrder.map(({ kind, data }) => ({
        kind,
        data: Buffer.from(data).toString('ascii'),
      })),
    ).toEqual([
      { kind: 'terminal-response', data: '\u001b[1;1R' },
      { kind: 'application', data: 'a' },
    ]);
    await terminal.close();
  });

  terminalIt('negotiates the configured semantic frame queue capacity', async () => {
    const originalListen = SemanticChannel.listen.bind(SemanticChannel);
    let negotiatedCapacity: number | undefined;
    const listenSpy = vi
      .spyOn(SemanticChannel, 'listen')
      .mockImplementation((options, dependencies) => {
        negotiatedCapacity = options.limits.maxQueuedFrames;
        return originalListen(options, dependencies);
      });
    const endpoint: { value: string | undefined } = { value: undefined };
    let terminal: Awaited<ReturnType<typeof launchTerminalWithBackend>> | undefined;
    try {
      terminal = await launchTerminalWithBackend({
        command: ['controlled-app'],
        backend: backendFor(new ControlledPty(), endpoint),
        semanticFrameQueueCapacity: 64,
      });
      expect(negotiatedCapacity).toBe(64);
    } finally {
      await terminal?.close();
      listenSpy.mockRestore();
    }
  });

  it.each([0, 1.5, 257])(
    'rejects invalid semantic frame queue capacity %s before spawning',
    async (capacity) => {
      const endpoint: { value: string | undefined } = { value: undefined };
      const pty = new ControlledPty();
      await expect(
        launchTerminalWithBackend({
          command: ['controlled-app'],
          backend: backendFor(pty, endpoint),
          semanticFrameQueueCapacity: capacity,
        }),
      ).rejects.toThrow('semanticFrameQueueCapacity must be an integer from 1 to 256');
      expect(endpoint.value).toBeUndefined();
    },
  );

  terminalIt('keeps an admitted handshake pending after discovery closes', async () => {
    vi.useFakeTimers();
    const originalListen = SemanticChannel.listen.bind(SemanticChannel);
    let markHandshakeAdmitted!: () => void;
    const handshakeAdmitted = new Promise<void>((resolve) => {
      markHandshakeAdmitted = resolve;
    });
    const listenSpy = vi
      .spyOn(SemanticChannel, 'listen')
      .mockImplementation((options, dependencies) =>
        originalListen(
          {
            ...options,
            hooks: {
              ...options.hooks,
              onNegotiationStateChange: (state) => {
                options.hooks.onNegotiationStateChange?.(state);
                if (state.admissionOpen && state.pendingHandshakes === 1) markHandshakeAdmitted();
              },
            },
          },
          dependencies,
        ),
      );
    let terminal: Awaited<ReturnType<typeof launchTerminalWithBackend>> | undefined;
    let socket: ReturnType<typeof connect> | undefined;
    try {
      const endpoint: { value: string | undefined; token?: string } = { value: undefined };
      const pty = new ControlledPty();
      terminal = await launchTerminalWithBackend({
        command: ['controlled-app'],
        backend: backendFor(pty, endpoint),
        semanticNegotiationMs: 50,
      });

      // Its independent hello deadline starts midway through discovery and
      // therefore remains open when discovery itself closes. Wait for the
      // server-side admission event: a client-side pipe connection can become
      // observable first, especially under ConPTY runners.
      await vi.advanceTimersByTimeAsync(25);
      socket = connect(endpoint.value!);
      await new Promise<void>((resolve, reject) => {
        socket!.once('connect', resolve);
        socket!.once('error', reject);
      });
      await handshakeAdmitted;
      await vi.advanceTimersByTimeAsync(25);
      expect(terminal.contract()).toBeNull();

      socket.write(
        encodeFrame(
          {
            type: 'hello',
            protocol: 'termwright/3',
            token: endpoint.token,
            adapter: { name: 'controlled-adapter', version: '1.0.0' },
            capabilities: ['tree', 'render-revisions'],
          },
          DEFAULT_LIMITS.maxFrameBytes,
        ),
      );
      await new Promise<void>((resolve, reject) => {
        socket!.once('data', () => resolve());
        socket!.once('error', reject);
      });

      expect(terminal.contract()?.capabilities['semantic-tree'].status).toBe('supported');
      expect(terminal.diagnostics().some((entry) => entry.code === 'negotiation-timeout')).toBe(
        false,
      );
    } finally {
      socket?.destroy();
      vi.useRealTimers();
      try {
        await terminal?.close();
      } finally {
        listenSpy.mockRestore();
      }
    }
  });

  terminalIt(
    'makes PowerShell publish readiness from its launch command without bootstrap input',
    async () => {
      const semanticClose = vi.spyOn(SemanticChannel.prototype, 'close');
      const endpoint: { value: string | undefined } = { value: undefined };
      const pty = new ControlledPty({
        initialData: Buffer.from('\u001b]133;A\u0007\u001b]133;B\u0007'),
      });
      let spawned: PtySpawnOptions | undefined;
      const backend: PtyBackend = {
        name: 'controlled',
        spawn(options): PtyProcess {
          spawned = options;
          endpoint.value = options.env[ENV_ENDPOINT];
          return pty;
        },
      };

      const terminal = await launchTerminalWithBackend({
        command: ['pwsh.exe', '-NoLogo', '-NoProfile'],
        backend,
        shellIntegration: 'termwright-powershell',
      });
      expect(spawned?.command).toEqual([
        'pwsh.exe',
        '-NoLogo',
        '-NoProfile',
        '-NoExit',
        '-Command',
        '[Console]::Write("`e]133;A`a`e]133;B`a")',
      ]);
      expect(pty.writeCalls).toEqual([]);
      expect(terminal.shell.status()).toMatchObject({ supported: true, ready: true });
      await terminal.close();
      expect(semanticClose).toHaveBeenCalledOnce();
      expectEndpointRemoved(endpoint.value!);
      semanticClose.mockRestore();
    },
  );

  terminalIt('surfaces an asynchronous backend write failure and still tears down', async () => {
    const endpoint: { value: string | undefined } = { value: undefined };
    const pty = new ControlledPty();
    const terminal = await launchTerminalWithBackend({
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
    expectEndpointRemoved(endpoint.value!);
  });

  terminalIt(
    'uses one total ready deadline for startup and required semantic negotiation',
    async () => {
      vi.useFakeTimers();
      let releaseAdmission!: () => void;
      const admissionRelease = new Promise<void>((resolve) => {
        releaseAdmission = resolve;
      });
      let markAdmissionStarted!: () => void;
      const admissionStarted = new Promise<void>((resolve) => {
        markAdmissionStarted = resolve;
      });
      let releaseCount = 0;
      const restoreProvider = installTerminalLaunchResourceProvider(async () => {
        markAdmissionStarted();
        await admissionRelease;
        return {
          async attach(): Promise<void> {},
          async release(): Promise<void> {
            releaseCount += 1;
          },
        };
      });
      let launched: ReturnType<typeof launchTerminalWithBackend> | undefined;
      try {
        const endpoint: { value: string | undefined } = { value: undefined };
        const pty = new ControlledPty();
        launched = launchTerminalWithBackend({
          command: ['controlled-app'],
          backend: backendFor(pty, endpoint),
          requiredCapabilities: ['semantic-tree'],
          semanticNegotiationMs: 100,
          timeouts: { ready: 40 },
        });
        let settled = false;
        void launched.then(
          () => {
            settled = true;
          },
          () => {
            settled = true;
          },
        );

        await admissionStarted;
        await vi.advanceTimersByTimeAsync(39);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        releaseAdmission();
        await expect(launched).rejects.toMatchObject({ code: 'timeout' });

        // Resource admission consumed the budget. Expiry is checked
        // before spawning, so no scarce process is created after the deadline.
        expect(pty.disposeCount).toBe(0);
        expect(endpoint.value).toBeUndefined();
        expect(releaseCount).toBe(1);
      } finally {
        releaseAdmission();
        // A failing intermediate assertion must not strand the admitted launch
        // under a virtual clock. Drive the same deadline to expiry and await its
        // rollback before restoring the worker-global provider and real timers.
        await vi.advanceTimersByTimeAsync(40);
        const unexpectedTerminal = await launched?.catch(() => undefined);
        await unexpectedTerminal?.close().catch(() => undefined);
        restoreProvider();
        vi.useRealTimers();
      }
    },
  );

  terminalIt(
    'keeps required semantic negotiation open past the ordinary discovery window',
    async () => {
      vi.useFakeTimers();
      let markSpawned!: () => void;
      const spawned = new Promise<void>((resolve) => {
        markSpawned = resolve;
      });
      const endpoint: { value: string | undefined; token?: string } = { value: undefined };
      let completeAttach!: () => void;
      let discoveryState: { admissionOpen: boolean; pendingHandshakes: number } | undefined;
      const listenSpy = vi.spyOn(SemanticChannel, 'listen').mockImplementation(async (options) => {
        const channel = {
          endpoint: 'controlled-semantic-endpoint',
          closeAdmission: () => {
            discoveryState = {
              admissionOpen: false,
              pendingHandshakes: 1,
            };
            options.hooks.onNegotiationStateChange?.(discoveryState);
          },
          close: async () => undefined,
        } as unknown as SemanticChannel;
        completeAttach = () =>
          options.hooks.onAttach({
            protocol: 'termwright/3',
            adapter: { name: 'controlled-adapter', version: '1.0.0' },
            capabilities: ['tree', 'render-revisions'],
            markerEnabled: true,
            logsEnabled: false,
            probe: null,
            providers: [],
          });
        return channel;
      });
      let launched: ReturnType<typeof launchTerminalWithBackend> | undefined;
      const pty = new ControlledPty({
        // This test owns a synthetic backend, not a POSIX process group. A
        // delegated lifecycle closes synchronously under the fake clock on
        // every host, while still exercising the real session cleanup path.
        lifecycle: { tree: 'delegated', outputDrain: 'eof' },
      });
      try {
        launched = launchTerminalWithBackend({
          command: ['controlled-app'],
          backend: backendFor(pty, endpoint, markSpawned),
          requiredCapabilities: ['semantic-tree'],
          semanticNegotiationMs: 2_000,
          timeouts: { ready: 3_000 },
        });
        await spawned;

        // SemanticChannel's real-socket suite owns transport admission and
        // hello-deadline behavior. This lifecycle test supplies the resulting
        // admitted state directly, so a Windows named pipe is never coupled to
        // Vitest's virtual clock.
        await vi.advanceTimersByTimeAsync(2_100);
        expect(discoveryState).toEqual({ admissionOpen: false, pendingHandshakes: 1 });
        completeAttach();

        // Launch resolution is the causal assertion under test: onAttach
        // settled the required contract and woke the launch change journal.
        // A protocol ACK is covered by SemanticChannel's transport tests and
        // is not part of required-capability readiness.
        const terminal = await launched;
        expect(terminal.contract()?.capabilities['semantic-tree'].status).toBe('supported');
        expect(terminal.diagnostics().some((entry) => entry.code === 'negotiation-timeout')).toBe(
          false,
        );
        vi.useRealTimers();
        await terminal.close();
        expect(pty.terminateCount).toBe(1);
        expect(pty.disposeCount).toBe(1);
      } finally {
        vi.useRealTimers();
        const terminal = await launched?.catch(() => undefined);
        await terminal?.close().catch(() => undefined);
        listenSpy.mockRestore();
      }
    },
  );

  terminalIt('rolls back the endpoint and PTY when startup fails after spawn', async () => {
    const endpoint: { value: string | undefined } = { value: undefined };
    const pty = new ControlledPty({ failExitRegistration: true });

    await expect(
      launchTerminalWithBackend({
        command: ['controlled-app'],
        backend: backendFor(pty, endpoint),
      }),
    ).rejects.toThrow('terminal startup and rollback failed');

    expect(pty.disposeCount).toBe(1);
    expect(endpoint.value).toBeDefined();
    expectEndpointRemoved(endpoint.value!);
  });

  it.each([
    ['unsupported', 'could not confirm its declared process tree'],
    ['throw', 'tree confirmation failed'],
  ] as const)(
    'propagates %s tree confirmation failure to current and future exit waiters',
    async (treeState, detail) => {
      let releaseCount = 0;
      const restoreProvider = installTerminalLaunchResourceProvider(async () => ({
        async attach(): Promise<void> {},
        async release(): Promise<void> {
          releaseCount += 1;
        },
      }));
      try {
        const endpoint: { value: string | undefined } = { value: undefined };
        const pty = new ControlledPty({
          lifecycle: { tree: 'posix-process-group', outputDrain: 'eof' },
          treeState,
        });
        const terminal = await launchTerminalWithBackend({
          command: ['controlled-app'],
          backend: backendFor(pty, endpoint),
        });
        const currentExit = expect(terminal.exit).rejects.toMatchObject({
          name: 'ProcessLifecycleError',
          code: 'cleanup-failed',
          message: expect.stringContaining(detail),
        });

        pty.emitExit();
        await currentExit;
        await expect(terminal.exit).rejects.toMatchObject({
          name: 'ProcessLifecycleError',
          message: expect.stringContaining(detail),
        });
        await expect(terminal.waitForExit()).rejects.toMatchObject({
          name: 'ProcessLifecycleError',
          message: expect.stringContaining(detail),
        });
        await expect(terminal.write('input after failed tree confirmation')).rejects.toMatchObject({
          name: 'ProcessLifecycleError',
          message: expect.stringContaining(detail),
        });
        await expect(terminal.press('Enter')).rejects.toMatchObject({
          name: 'ProcessLifecycleError',
          message: expect.stringContaining(detail),
        });
        const retainedFailure = await terminal.exit.catch((error: unknown) => error);
        const dimensions = terminal.terminalState.snapshot().dimensions;
        const checkpoint = terminal.checkpoint();
        await expect(terminal.signal('TERM')).rejects.toBe(retainedFailure);
        await expect(terminal.resize({ columns: 80, rows: 24 })).rejects.toBe(retainedFailure);
        expect(pty.signalCalls).toEqual([]);
        expect(pty.resizeCalls).toEqual([]);
        expect(terminal.terminalState.snapshot().dimensions).toEqual(dimensions);

        const liveWaits = [
          () => terminal.waitForText(''),
          () => terminal.waitForTitle(''),
          () => terminal.waitForRender({ after: -1 }),
          () => terminal.waitForQuiet({ quietMs: 0 }),
          () => terminal.settled(),
          () => terminal.waitForCheckpointChange({ after: checkpoint }),
          () => terminal.waitForCommittedObservation(),
          () => terminal.waitForShellPrompt(),
        ];
        for (const wait of liveWaits) await expect(wait()).rejects.toBe(retainedFailure);

        // Post-exit diagnostics and frozen observations remain available.
        expect(terminal.screen()).toBeDefined();
        expect(terminal.diagnostics()).toBeDefined();
        await expect(terminal.close()).rejects.toMatchObject({ name: 'ResourceCleanupError' });
        expect(pty.disposeCount).toBe(1);
        expect(releaseCount).toBe(0);
        expectEndpointRemoved(endpoint.value!);
      } finally {
        restoreProvider();
      }
    },
  );

  it('cancels a never-attaching PTY at the shared launch deadline and rolls it back', async () => {
    vi.useFakeTimers();
    let releaseCount = 0;
    const restoreProvider = installTerminalLaunchResourceProvider(async () => ({
      async attach(): Promise<void> {},
      async release(): Promise<void> {
        releaseCount += 1;
      },
    }));
    try {
      const endpoint: { value: string | undefined } = { value: undefined };
      let markAttachStarted!: () => void;
      const attachStarted = new Promise<void>((resolve) => {
        markAttachStarted = resolve;
      });
      const pty = new ControlledPty({
        neverAttach: true,
        lifecycle: { tree: 'delegated', outputDrain: 'eof' },
        onAttach: markAttachStarted,
      });
      let markSpawned!: () => void;
      const spawned = new Promise<void>((resolve) => {
        markSpawned = resolve;
      });
      const launched = launchTerminalWithBackend({
        command: ['controlled-app'],
        backend: backendFor(pty, endpoint, markSpawned),
        timeouts: { ready: 40 },
      });
      const outcome = launched.then(
        () => ({ error: undefined }),
        (error: unknown) => ({ error }),
      );

      await spawned;
      await attachStarted;
      expect(endpoint.value).toBeDefined();
      await vi.advanceTimersByTimeAsync(40);
      expect(pty.attachCancelCount).toBe(1);
      await expect(outcome).resolves.toMatchObject({ error: { code: 'timeout' } });

      expect(pty.disposeCount).toBe(1);
      expect(pty.terminateCount).toBe(1);
      expect(releaseCount).toBe(1);
      // The virtual-clock deadline assertion is complete. Restore the real
      // scheduler before checking the Unix socket artifact.
      vi.useRealTimers();
      expectEndpointRemoved(endpoint.value!);
    } finally {
      restoreProvider();
      vi.useRealTimers();
    }
  });

  terminalIt('shares concurrent close and preserves only the backend exit status', async () => {
    const endpoint: { value: string | undefined } = { value: undefined };
    const pty = new ControlledPty({ status: { code: 17, signal: null } });
    const terminal = await launchTerminalWithBackend({
      command: ['controlled-app'],
      backend: backendFor(pty, endpoint),
    });

    const first = terminal.close();
    const second = terminal.close();
    expect(second).toBe(first);
    await first;

    expect(pty.disposeCount).toBe(1);
    expect(await terminal.exit).toEqual({ code: 17, signal: null });
    expectEndpointRemoved(endpoint.value!);
  });

  terminalIt('attempts later cleanup after a PTY disposer fails', async () => {
    const semanticClose = vi.spyOn(SemanticChannel.prototype, 'close');
    const endpoint: { value: string | undefined } = { value: undefined };
    const pty = new ControlledPty({ failDispose: true });
    const terminal = await launchTerminalWithBackend({
      command: ['controlled-app'],
      backend: backendFor(pty, endpoint),
    });

    const first = terminal.close();
    const second = terminal.close();
    expect(second).toBe(first);
    await expect(first).rejects.toMatchObject({ name: 'ResourceCleanupError' });

    expect(pty.disposeCount).toBe(1);
    expect(semanticClose).toHaveBeenCalledOnce();
    expectEndpointRemoved(endpoint.value!);
    semanticClose.mockRestore();
  });

  terminalIt('does not invent an exit status when the backend never reports one', async () => {
    vi.useFakeTimers();
    try {
      const endpoint: { value: string | undefined } = { value: undefined };
      const pty = new ControlledPty({ emitExitOnDispose: false });
      const terminal = await launchTerminalWithBackend({
        command: ['controlled-app'],
        backend: backendFor(pty, endpoint),
      });
      const exited = expect(terminal.exit).rejects.toMatchObject({ name: 'ResourceCleanupError' });
      // Assert before advancing, not after. close() rejects somewhere inside
      // the timer advancement below, and a rejection with no handler attached
      // yet is an unhandled rejection — Node reports it the moment it happens
      // and only warns later that a handler arrived. Building the assertion
      // first attaches that handler up front, which is what the sibling test
      // above does with `void launched.then(...)`.
      const closed = expect(terminal.close()).rejects.toMatchObject({
        name: 'ResourceCleanupError',
      });
      // ResourceScope starts disposers in a microtask. Arm the supervisor's
      // absolute deadline before advancing the manual clock to that boundary.
      await vi.advanceTimersByTimeAsync(0);
      // The close deadline is what this test drives to, so it advances by
      // that budget rather than a copy of it — the budget is larger on
      // Windows, where a pseudoconsole teardown is confirmed asynchronously.
      await vi.advanceTimersByTimeAsync(CLOSE_GRACE_MS);
      await closed;
      await exited;
      expect(pty.disposeCount).toBe(1);
      expectEndpointRemoved(endpoint.value!);
    } finally {
      vi.useRealTimers();
    }
  });

  terminalIt('does not mark teardown requested when a signal was rejected', async () => {
    const endpoint: { value: string | undefined } = { value: undefined };
    const pty = new ControlledPty({ failSignal: 'TERM', status: { code: 17, signal: null } });
    const terminal = await launchTerminalWithBackend({
      command: ['controlled-app'],
      backend: backendFor(pty, endpoint),
    });

    await expect(terminal.signal('TERM')).rejects.toThrow('TERM is unsupported');
    pty.emitExit();
    await expect(terminal.exit).resolves.toEqual({ code: 17, signal: null });
    expect(terminal.crashReport()).not.toBeNull();
    await terminal.close();
  });
});
