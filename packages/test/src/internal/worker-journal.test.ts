import { describe, expect, it, vi } from 'vitest';
import { closeWorkerTransports, flushAndCloseWorkerJournal } from './worker-journal.js';

describe('worker journal cleanup', () => {
  it('closes the transport even when the flush barrier fails', async () => {
    const flushFailure = new Error('journal flush failed');
    const close = vi.fn(async () => undefined);

    await expect(
      flushAndCloseWorkerJournal(
        {
          flush: vi.fn(async () => {
            throw flushFailure;
          }),
          close,
        },
        123,
      ),
    ).rejects.toBe(flushFailure);

    expect(close).toHaveBeenCalledOnce();
  });

  it('retains both failures when flush and close fail', async () => {
    const flushFailure = new Error('journal flush failed');
    const closeFailure = new Error('journal close failed');

    const failure = await flushAndCloseWorkerJournal(
      {
        flush: vi.fn(async () => {
          throw flushFailure;
        }),
        close: vi.fn(async () => {
          throw closeFailure;
        }),
      },
      123,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([flushFailure, closeFailure]);
  });

  it('does not mistake an undefined rejection reason for a successful flush', async () => {
    const close = vi.fn(async () => undefined);
    const failure = await flushAndCloseWorkerJournal(
      {
        flush: vi.fn(() => Promise.reject(undefined)),
        close,
      },
      123,
    ).then(
      () => 'resolved',
      (error: unknown) => error,
    );

    expect(failure).toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
  });
});

describe('worker transport cleanup', () => {
  it('closes the broker even when journal cleanup fails', async () => {
    const journalFailure = new Error('journal cleanup failed');
    const closeBroker = vi.fn(async () => undefined);

    await expect(
      closeWorkerTransports(
        vi.fn(async () => {
          throw journalFailure;
        }),
        closeBroker,
      ),
    ).rejects.toBe(journalFailure);

    expect(closeBroker).toHaveBeenCalledOnce();
  });

  it('starts broker cleanup even when journal cleanup throws synchronously', async () => {
    const journalFailure = new Error('synchronous journal cleanup failure');
    const closeBroker = vi.fn(async () => undefined);

    await expect(
      closeWorkerTransports(() => {
        throw journalFailure;
      }, closeBroker),
    ).rejects.toBe(journalFailure);

    expect(closeBroker).toHaveBeenCalledOnce();
  });

  it('retains deterministic journal-before-broker cleanup failures', async () => {
    const journalFailure = new Error('journal cleanup failed');
    const brokerFailure = new Error('broker cleanup failed');

    const failure = await closeWorkerTransports(
      async () => {
        throw journalFailure;
      },
      async () => {
        throw brokerFailure;
      },
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([journalFailure, brokerFailure]);
  });
});
