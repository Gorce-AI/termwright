import { describe, expect, it } from 'vitest';
import { createDeadlineDeferred, withinDeadline } from './deadline.js';

/**
 * Collects the rejections Node considers unobserved while `body` runs.
 *
 * Node decides that only after the microtask queue drains, so the turns below
 * are the detection mechanism, not a wait for something to happen.
 */
async function unhandledDuring(body: () => Promise<void>): Promise<readonly unknown[]> {
  const seen: unknown[] = [];
  const record = (reason: unknown): void => void seen.push(reason);
  process.on('unhandledRejection', record);
  try {
    await body();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    return seen;
  } finally {
    process.off('unhandledRejection', record);
  }
}

describe('withinDeadline', () => {
  it('cancels an operation when the shared budget is already spent', async () => {
    // The startup sequences that use this share one deadline across phases, so
    // a slow earlier phase routinely leaves nothing for a later one. The
    // later operation must still be cancelled even though it receives no
    // execution budget, and cancellation must stay owned by the caller.
    const seen = await unhandledDuring(async () => {
      const abandoned = createDeadlineDeferred<never>();
      await expect(
        withinDeadline(abandoned, performance.now() - 1, 'budget already spent'),
      ).rejects.toThrow('budget already spent');
    });
    expect(seen).toEqual([]);
  });

  it('settles a never-finishing operation when the deadline wins', async () => {
    const seen = await unhandledDuring(async () => {
      const slow = createDeadlineDeferred<never>();
      await expect(
        withinDeadline(slow, performance.now() + 5, 'deadline won the race'),
      ).rejects.toThrow('deadline won the race');
      await expect(slow.result).rejects.toMatchObject({ name: 'DeadlineOperationCancelledError' });
    });
    expect(seen).toEqual([]);
  });

  it('returns the value when the promise settles first', async () => {
    const operation = createDeadlineDeferred<string>();
    operation.resolve('ready');
    await expect(withinDeadline(operation, performance.now() + 1_000, 'unused')).resolves.toBe(
      'ready',
    );
  });

  it('reports the failure the promise produced, not the deadline', async () => {
    const operation = createDeadlineDeferred<never>();
    operation.reject(new Error('bind refused'));
    await expect(withinDeadline(operation, performance.now() + 1_000, 'unused')).rejects.toThrow(
      'bind refused',
    );
  });

  it('builds its detail lazily so it can name the phase reached', async () => {
    let phase = 'connecting';
    const pending = createDeadlineDeferred<never>();
    const raced = withinDeadline(pending, performance.now() + 5, () => `stalled while ${phase}`);
    phase = 'loading the runner';
    await expect(raced).rejects.toThrow('stalled while loading the runner');
  });
});
