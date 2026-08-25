/**
 * Races a promise against an absolute deadline shared by a whole startup
 * sequence, so an earlier phase that runs long shortens every later one.
 *
 * When the budget is already spent this rejects without ever awaiting
 * `promise`. That promise is still live and may still reject later — a child
 * process that exits after its launcher gave up, for instance — so it is
 * marked handled here. Skipping that turns an expected late failure into an
 * unhandled rejection in whatever process embedded the caller, at a moment
 * when the real error has already been reported.
 */
export async function withinDeadline<T>(
  promise: Promise<T>,
  deadline: number,
  detail: string | (() => string),
): Promise<T> {
  const describe = (): string => (typeof detail === 'function' ? detail() : detail);
  const remaining = deadline - performance.now();
  if (remaining <= 0) {
    void promise.catch(() => undefined);
    throw new Error(describe());
  }
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(describe())), remaining);
    timer.unref?.();
  });
  try {
    // Racing attaches a permanent handler to `promise`, so a rejection that
    // arrives after the deadline won is observed even though it is discarded.
    return await Promise.race([promise, expired]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
