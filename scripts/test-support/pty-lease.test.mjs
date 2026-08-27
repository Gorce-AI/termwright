import { describe, expect, it } from 'vitest';
import { createPtyLeasePool } from '../../quality/experiments/pty-lease.mjs';

describe('PTY lease ownership', () => {
  it('removes a cancelled waiter without consuming the next lease', async () => {
    const pool = createPtyLeasePool(1);
    const first = (await pool.request().promise).claim();
    const cancelled = pool.request();
    cancelled.cancel();
    await expect(cancelled.promise).rejects.toThrow('outlived its test');

    const next = pool.request();
    first();
    const releaseNext = (await next.promise).claim();
    releaseNext();
  });

  it('revokes a granted lease that is cancelled before its owner can claim it', async () => {
    const pool = createPtyLeasePool(1);
    const first = (await pool.request().promise).claim();
    const raced = pool.request();
    first();
    raced.cancel();
    await expect(raced.promise.then((lease) => lease.claim())).rejects.toThrow(
      'cancelled before claim',
    );

    const next = pool.request();
    const releaseNext = (await next.promise).claim();
    releaseNext();
  });

  it('leaves a claimed lease with its owner and releases it only once', async () => {
    const pool = createPtyLeasePool(1);
    const request = pool.request();
    const release = (await request.promise).claim();
    request.cancel();
    const next = pool.request();
    let granted = false;
    void next.promise.then(() => {
      granted = true;
    });
    await Promise.resolve();
    expect(granted).toBe(false);

    release();
    release();
    const releaseNext = (await next.promise).claim();
    releaseNext();
  });
});
