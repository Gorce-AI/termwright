import { describe, expect, it } from 'vitest';
import type { ExitStatus } from '../api.js';
import type { PtyProcess, PtySignal, PtyUnsubscribe } from '../pty.js';
import { ProcessSupervisor } from './process-supervisor.js';

class ManualClock {
  now = 1_000;
  #next = 0;
  readonly #timers = new Map<number, { at: number; callback: () => void }>();
  readonly timers = {
    set: (callback: () => void, delay: number): number => {
      const id = ++this.#next;
      this.#timers.set(id, { at: this.now + delay, callback });
      return id;
    },
    clear: (timer: unknown): void => { this.#timers.delete(timer as number); },
  };

  advance(ms: number): void {
    this.now += ms;
    for (;;) {
      const due = [...this.#timers.entries()]
        .filter(([, timer]) => timer.at <= this.now)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (due === undefined) return;
      this.#timers.delete(due[0]);
      due[1].callback();
    }
  }
}

class FakePty implements PtyProcess {
  readonly pid = 42;
  readonly signals: PtySignal[] = [];
  readonly #listeners = new Set<(status: ExitStatus) => void>();
  disposeCount = 0;
  tree: 'alive' | 'gone' | 'unsupported' = 'gone';
  readonly lifecycle: NonNullable<PtyProcess['lifecycle']>;
  readonly #exitOn: PtySignal | undefined;
  hardKillCount = 0;

  constructor(options: { lifecycle?: PtyProcess['lifecycle']; exitOn?: PtySignal } = {}) {
    this.lifecycle = options.lifecycle ?? { tree: 'delegated', outputDrain: 'bounded-fallback' };
    this.#exitOn = options.exitOn;
  }

  write(): void {}
  resize(): void {}
  signal(signal: PtySignal): void {
    this.signals.push(signal);
    if (signal === this.#exitOn) this.emit({ code: null, signal: `SIG${signal}` });
  }
  onData(): PtyUnsubscribe { return () => undefined; }
  onExit(callback: (status: ExitStatus) => void): PtyUnsubscribe {
    this.#listeners.add(callback);
    return () => this.#listeners.delete(callback);
  }
  treeState(): 'alive' | 'gone' | 'unsupported' { return this.tree; }
  dispose(): void { this.disposeCount += 1; }
  terminate(): void { this.emit({ code: 0, signal: null }); }
  async hardKillTree(): Promise<void> {
    this.hardKillCount += 1;
    this.signals.push('KILL');
    if (this.#exitOn === 'KILL') this.emit({ code: null, signal: 'SIGKILL' });
  }
  emit(status: ExitStatus): void {
    for (const listener of [...this.#listeners]) listener(status);
  }
}

function supervisor(pty: FakePty, clock: ManualClock): ProcessSupervisor {
  return new ProcessSupervisor(pty, { monotonicNow: () => clock.now, timers: clock.timers });
}

describe('ProcessSupervisor', () => {
  it('uses a delegated backend lifecycle request instead of inventing a signal', async () => {
    const clock = new ManualClock();
    const pty = new FakePty();
    await expect(supervisor(pty, clock).shutdown({ deadline: clock.now + 1_000, gracefulMs: 100 }))
      .resolves.toEqual({ code: 0, signal: null });
    expect(pty.signals).toEqual([]);
    expect(pty.disposeCount).toBe(1);
  });

  it('uses real exit evidence captured before its one-shot subscription', async () => {
    const clock = new ManualClock();
    const pty = new FakePty({
      lifecycle: { tree: 'posix-process-group', outputDrain: 'bounded-fallback' },
    });
    const observedExit = { code: 0, signal: null } as const;
    await expect(supervisor(pty, clock).shutdown({
      deadline: clock.now + 1_000,
      gracefulMs: 100,
      observedExit,
    })).resolves.toEqual(observedExit);
    expect(pty.signals).toEqual([]);
    expect(pty.disposeCount).toBe(1);
  });

  it('never re-probes a numeric process group after the exit boundary', async () => {
    const clock = new ManualClock();
    const pty = new FakePty({
      lifecycle: { tree: 'posix-process-group', outputDrain: 'bounded-fallback' },
    });
    const process = supervisor(pty, clock);
    const observedExit = { code: 0, signal: null } as const;
    process.observeExit(observedExit);
    // A later process may reuse the old numeric PGID. It is not ours and must
    // neither be treated as a leak nor receive a signal.
    pty.tree = 'alive';
    await expect(process.shutdown({
      deadline: clock.now + 1_000,
      gracefulMs: 100,
      observedExit,
    })).resolves.toEqual(observedExit);
    expect(pty.signals).toEqual([]);
  });

  it('accepts a real graceful exit without issuing a hard kill', async () => {
    const clock = new ManualClock();
    const pty = new FakePty({
      lifecycle: { tree: 'posix-process-group', outputDrain: 'eof' },
      exitOn: 'HUP',
    });
    const process = supervisor(pty, clock);
    const shutdown = process.shutdown({ deadline: clock.now + 1_000, gracefulMs: 100 });
    expect(process.shutdown({ deadline: clock.now + 2_000, gracefulMs: 500 })).toBe(shutdown);
    await expect(shutdown).resolves.toEqual({ code: null, signal: 'SIGHUP' });
    expect(pty.signals).toEqual(['HUP']);
    expect(pty.disposeCount).toBe(1);
  });

  it('treats EPERM as stale PGID only after real exit proves the owned group gone', async () => {
    const clock = new ManualClock();
    const pty = new FakePty({
      lifecycle: { tree: 'posix-process-group', outputDrain: 'eof' },
    });
    pty.signal = (signal): void => {
      pty.signals.push(signal);
      if (signal !== 'HUP') return;
      queueMicrotask(() => pty.emit({ code: 0, signal: null }));
      throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' });
    };
    await expect(supervisor(pty, clock).shutdown({ deadline: clock.now + 1_000, gracefulMs: 100 }))
      .resolves.toEqual({ code: 0, signal: null });
    expect(pty.signals).toEqual(['HUP']);
  });

  it('does not forgive EPERM when no real exit follows', async () => {
    const clock = new ManualClock();
    const pty = new FakePty({
      lifecycle: { tree: 'posix-process-group', outputDrain: 'eof' },
    });
    pty.signal = (signal): void => {
      pty.signals.push(signal);
      throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' });
    };
    const shutdown = supervisor(pty, clock).shutdown({ deadline: clock.now + 100, gracefulMs: 10 });
    clock.advance(100);
    await expect(shutdown).rejects.toMatchObject({ code: 'cleanup-failed', exitObserved: false });
  });

  it('escalates an ignored graceful request within the same absolute deadline', async () => {
    const clock = new ManualClock();
    const pty = new FakePty({
      lifecycle: { tree: 'posix-process-group', outputDrain: 'eof' },
      exitOn: 'KILL',
    });
    const shutdown = supervisor(pty, clock).shutdown({ deadline: clock.now + 1_000, gracefulMs: 100 });
    expect(pty.signals).toEqual(['HUP']);
    clock.advance(100);
    await expect(shutdown).resolves.toEqual({ code: null, signal: 'SIGKILL' });
    expect(pty.signals).toEqual(['HUP', 'KILL']);
  });

  it('uses only ConPTY hard kill and fails when no real exit is observed', async () => {
    const clock = new ManualClock();
    const pty = new FakePty({ lifecycle: { tree: 'conpty-console', outputDrain: 'eof' } });
    const shutdown = supervisor(pty, clock).shutdown({ deadline: clock.now + 200, gracefulMs: 100 });
    expect(pty.signals).toEqual(['KILL']);
    expect(pty.hardKillCount).toBe(1);
    clock.advance(200);
    await expect(shutdown).rejects.toMatchObject({ code: 'cleanup-failed' });
    expect(pty.disposeCount).toBe(1);
  });

  it('hard-kills a POSIX group still alive after the leader exit and verifies it', async () => {
    const clock = new ManualClock();
    const pty = new FakePty({
      lifecycle: { tree: 'posix-process-group', outputDrain: 'eof' },
      exitOn: 'HUP',
    });
    pty.tree = 'alive';
    const originalSignal = pty.signal.bind(pty);
    pty.signal = (signal): void => {
      originalSignal(signal);
      if (signal === 'KILL') pty.tree = 'gone';
    };
    await supervisor(pty, clock).shutdown({ deadline: clock.now + 1_000, gracefulMs: 100 });
    expect(pty.signals).toEqual(['HUP', 'KILL']);
  });

  it('waits within the same deadline for a killed process group to disappear', async () => {
    const clock = new ManualClock();
    const pty = new FakePty({
      lifecycle: { tree: 'posix-process-group', outputDrain: 'eof' },
      exitOn: 'HUP',
    });
    pty.tree = 'alive';
    const originalSignal = pty.signal.bind(pty);
    pty.signal = (signal): void => {
      originalSignal(signal);
      if (signal === 'KILL') clock.timers.set(() => { pty.tree = 'gone'; }, 25);
    };
    const shutdown = supervisor(pty, clock).shutdown({ deadline: clock.now + 100, gracefulMs: 10 });
    for (let elapsed = 0; elapsed < 30; elapsed += 10) {
      await Promise.resolve();
      clock.advance(10);
    }
    await expect(shutdown).resolves.toEqual({ code: null, signal: 'SIGHUP' });
    expect(pty.disposeCount).toBe(1);
  });
});
