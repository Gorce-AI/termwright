import { describe, expect, it, vi } from 'vitest';
import type { ExitStatus } from '@termwright/driver';
import type { PtyProcess } from '@termwright/driver/experimental';
import { ProbeProcessShutdown } from './probe-process-shutdown.js';

function deferred<T = void>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function controlledProcess(
  events: string[],
  outputEnded: Promise<void>,
  sawOutputEnd: () => boolean,
): PtyProcess {
  return {
    pid: 4242,
    lifecycle: { tree: 'conpty-console', outputDrain: 'eof' },
    write: vi.fn(),
    resize: vi.fn(),
    signal: vi.fn(),
    hardKillTree: vi.fn(async () => {
      events.push('kill');
    }),
    onData: vi.fn(() => () => undefined),
    onExit: vi.fn(() => () => undefined),
    outputEnded,
    sawOutputEnd,
    treeState: vi.fn(() => (sawOutputEnd() ? 'gone' : 'alive')),
    dispose: vi.fn(() => events.push('dispose-pty')),
  };
}

function shutdownFor(
  pty: PtyProcess,
  events: string[],
  options: {
    readonly parser?: Promise<void>;
    readonly parserStarted?: () => void;
    readonly removeFailure?: Error;
    readonly admissionFailure?: Error;
    readonly watchdogMs?: number;
  } = {},
): ProbeProcessShutdown {
  return new ProbeProcessShutdown({
    pty,
    closeAdmission: async () => {
      events.push('close-admission');
      if (options.admissionFailure !== undefined) throw options.admissionFailure;
    },
    drainParser: async () => {
      events.push('drain-parser');
      options.parserStarted?.();
      await options.parser;
    },
    disposeParser: () => events.push('dispose-parser'),
    removeArtifacts: async () => {
      events.push('remove-artifacts');
      if (options.removeFailure !== undefined) throw options.removeFailure;
    },
    watchdogMs: options.watchdogMs ?? 1_000,
  });
}

describe('causal AdapterProbe process shutdown', () => {
  it('waits for exit, authoritative EOF, and parser drain before disposal and unlink', async () => {
    const events: string[] = [];
    const eof = deferred();
    const parser = deferred();
    const parserStarted = deferred();
    let realEof = false;
    const pty = controlledProcess(events, eof.promise, () => realEof);
    const shutdown = shutdownFor(pty, events, {
      parser: parser.promise,
      parserStarted: () => parserStarted.resolve(),
    });

    const stopped = shutdown.stop();
    expect(events).toEqual(['close-admission', 'kill']);
    shutdown.observeExit({ code: 1, signal: null });
    await Promise.resolve();
    expect(events).not.toContain('dispose-pty');

    realEof = true;
    eof.resolve();
    await parserStarted.promise;
    expect(events).not.toContain('dispose-pty');
    expect(events).not.toContain('remove-artifacts');

    parser.resolve();
    await stopped;
    expect(events).toEqual([
      'close-admission',
      'kill',
      'drain-parser',
      'dispose-pty',
      'dispose-parser',
      'remove-artifacts',
    ]);
  });

  it('fails closed when output settles without real EOF and preserves the artifact', async () => {
    const events: string[] = [];
    const pty = controlledProcess(events, Promise.resolve(), () => false);
    const shutdown = shutdownFor(pty, events);
    shutdown.observeExit({ code: 0, signal: null });

    await expect(shutdown.stop()).rejects.toThrow(/without authoritative EOF/u);
    expect(events).toEqual(['close-admission', 'kill', 'dispose-pty', 'dispose-parser']);
  });

  it('uses one watchdog as a diagnostic and shares one idempotent stop operation', async () => {
    vi.useFakeTimers();
    try {
      const events: string[] = [];
      const never = deferred();
      const pty = controlledProcess(events, never.promise, () => false);
      const shutdown = shutdownFor(pty, events, { watchdogMs: 25 });
      const first = shutdown.stop();
      const concurrent = shutdown.stop();
      expect(concurrent).toBe(first);
      const rejected = expect(first).rejects.toThrow(/within its 25 ms watchdog/u);

      await vi.advanceTimersByTimeAsync(25);
      await rejected;
      expect(pty.hardKillTree).toHaveBeenCalledOnce();
      expect(pty.dispose).toHaveBeenCalledOnce();
      expect(events).toEqual(['close-admission', 'kill', 'dispose-pty', 'dispose-parser']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not kill a process whose real exit and empty tree were already observed', async () => {
    const events: string[] = [];
    const pty = controlledProcess(events, Promise.resolve(), () => true);
    const shutdown = shutdownFor(pty, events);
    const status: ExitStatus = { code: 0, signal: null };
    shutdown.observeExit(status);
    await shutdown.stop();

    expect(pty.hardKillTree).not.toHaveBeenCalled();
    expect(events).toEqual([
      'close-admission',
      'drain-parser',
      'dispose-pty',
      'dispose-parser',
      'remove-artifacts',
    ]);
  });

  it('reports an artifact unlink failure after every causal boundary passed', async () => {
    const events: string[] = [];
    const busy = Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' });
    const pty = controlledProcess(events, Promise.resolve(), () => true);
    const shutdown = shutdownFor(pty, events, { removeFailure: busy });
    shutdown.observeExit({ code: 0, signal: null });

    await expect(shutdown.stop()).rejects.toBe(busy);
    expect(events).toEqual([
      'close-admission',
      'drain-parser',
      'dispose-pty',
      'dispose-parser',
      'remove-artifacts',
    ]);
  });

  it('preserves artifacts when endpoint admission did not close', async () => {
    const events: string[] = [];
    const admissionFailure = new Error('listener still owns admission');
    const pty = controlledProcess(events, Promise.resolve(), () => true);
    const shutdown = shutdownFor(pty, events, { admissionFailure });
    shutdown.observeExit({ code: 0, signal: null });

    await expect(shutdown.stop()).rejects.toBe(admissionFailure);
    expect(events).toEqual(['close-admission', 'drain-parser', 'dispose-pty', 'dispose-parser']);
  });
});
