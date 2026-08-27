import { describe, expect, it, vi } from 'vitest';
import { SessionProcessLifecycle } from './session-process-lifecycle.js';

describe('SessionProcessLifecycle', () => {
  it('separates backend exit evidence from the public drained exit', async () => {
    const lifecycle = new SessionProcessLifecycle();
    const backend = { code: 1, signal: null } as const;
    lifecycle.observeBackendExit(backend);
    expect(lifecycle.backendStatus).toEqual(backend);
    expect(lifecycle.status).toBeNull();

    const publish = vi.fn();
    expect(lifecycle.complete(backend, publish)).toBe(true);
    expect(publish).toHaveBeenCalledWith(backend, true);
    await expect(lifecycle.exit).resolves.toBe(backend);
    expect(Object.isFrozen(backend)).toBe(true);
    expect(lifecycle.complete({ code: 0, signal: null }, publish)).toBe(false);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('does not classify an exit requested by teardown as a crash', () => {
    const lifecycle = new SessionProcessLifecycle();
    lifecycle.requestTeardown();
    const publish = vi.fn();
    lifecycle.complete({ code: null, signal: 'SIGHUP' }, publish);
    expect(publish).toHaveBeenCalledWith({ code: null, signal: 'SIGHUP' }, false);
  });

  it('retains only the first backend observation', () => {
    const lifecycle = new SessionProcessLifecycle();
    lifecycle.observeBackendExit({ code: 2, signal: null });
    lifecycle.observeBackendExit({ code: 3, signal: null });
    expect(lifecycle.backendStatus).toEqual({ code: 2, signal: null });
  });

  it('settles an existing exit waiter even when publication throws', async () => {
    const lifecycle = new SessionProcessLifecycle();
    const exit = lifecycle.exit;
    const status = { code: 9, signal: null } as const;

    expect(() =>
      lifecycle.complete(status, () => {
        throw new Error('publisher failed');
      }),
    ).toThrow('publisher failed');
    await expect(exit).resolves.toBe(status);
    expect(lifecycle.status).toBe(status);
  });

  it('rejects current and future exit waiters when teardown cannot produce a status', async () => {
    const lifecycle = new SessionProcessLifecycle();
    const current = lifecycle.exit;
    const failure = new Error('cleanup ended without exit evidence');

    expect(lifecycle.fail(failure)).toBe(true);
    await expect(current).rejects.toBe(failure);
    await expect(lifecycle.exit).rejects.toBe(failure);
    expect(() => lifecycle.throwIfFailed()).toThrow(failure);
    expect(lifecycle.fail(new Error('later'))).toBe(false);
    expect(lifecycle.complete({ code: 0, signal: null }, vi.fn())).toBe(false);
  });
});
