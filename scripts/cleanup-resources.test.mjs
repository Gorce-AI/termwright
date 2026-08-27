import { describe, expect, it, vi } from 'vitest';
import { finishWithCleanups } from './cleanup-resources.mjs';

describe('resource cleanup error preservation', () => {
  it('preserves a primary failure after successful cleanup', async () => {
    const primary = new Error('primary');
    await expect(
      finishWithCleanups({
        hasPrimary: true,
        primaryError: primary,
        cleanups: [async () => {}],
        message: 'failed',
      }),
    ).rejects.toBe(primary);
  });

  it('attempts every cleanup and reports it together with the primary failure', async () => {
    const attempts = [
      vi.fn(() => {
        throw new Error('cleanup one');
      }),
      vi.fn(async () => {
        throw new Error('cleanup two');
      }),
    ];
    const primary = new Error('primary');
    let failure;
    try {
      await finishWithCleanups({
        hasPrimary: true,
        primaryError: primary,
        cleanups: attempts,
        message: 'operation and cleanup failed',
      });
    } catch (error) {
      failure = error;
    }
    expect(attempts.every((attempt) => attempt.mock.calls.length === 1)).toBe(true);
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors).toEqual([
      primary,
      expect.objectContaining({ message: 'cleanup one' }),
      expect.objectContaining({ message: 'cleanup two' }),
    ]);
    expect(failure.cause).toBe(primary);
  });

  it('rethrows one cleanup failure without wrapping it', async () => {
    const cleanup = new Error('cleanup');
    await expect(
      finishWithCleanups({
        hasPrimary: false,
        primaryError: undefined,
        cleanups: [
          async () => {
            throw cleanup;
          },
        ],
        message: 'failed',
      }),
    ).rejects.toBe(cleanup);
  });

  it('preserves an explicitly thrown undefined value', async () => {
    let rejected = false;
    try {
      await finishWithCleanups({
        hasPrimary: true,
        primaryError: undefined,
        cleanups: [],
        message: 'failed',
      });
    } catch (error) {
      rejected = true;
      expect(error).toBeUndefined();
    }
    expect(rejected).toBe(true);
  });
});
