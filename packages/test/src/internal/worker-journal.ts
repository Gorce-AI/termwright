import type { RunJournalClient } from '@termwright/run-journal-transport';

/** Drain acknowledged worker events and close the underlying transport on every path. */
export async function flushAndCloseWorkerJournal(
  client: Pick<RunJournalClient, 'flush' | 'close'>,
  deadline: number,
): Promise<void> {
  let flushFailed = false;
  let flushFailure: unknown;
  try {
    await client.flush(deadline);
  } catch (error) {
    flushFailed = true;
    flushFailure = error;
  }

  try {
    await client.close();
  } catch (closeFailure) {
    if (flushFailed) {
      throw new AggregateError(
        [flushFailure, closeFailure],
        'worker journal flush and close failed',
      );
    }
    throw closeFailure;
  }

  if (flushFailed) throw flushFailure;
}

/** Close both worker-local transports even when either cleanup path rejects. */
export async function closeWorkerTransports(
  closeJournal: () => Promise<void>,
  closeBroker: () => Promise<void>,
): Promise<void> {
  const [journal, broker] = await Promise.allSettled([
    Promise.resolve().then(closeJournal),
    Promise.resolve().then(closeBroker),
  ]);
  const failures = [journal, broker]
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason as unknown);
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, 'worker journal and broker cleanup failed');
  }
}
