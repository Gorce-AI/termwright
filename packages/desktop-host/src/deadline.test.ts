import { describe, expect, it } from 'vitest';
import { withinDeadline } from './deadline.js';

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
  it('abandons a promise for a spent budget without leaving it unobserved', async () => {
    // The startup sequences that use this share one deadline across phases, so
    // a slow earlier phase routinely leaves nothing for a later one. The
    // abandoned work still settles — a child process that exits after its
    // launcher gave up — and that rejection must not escape as an unhandled
    // rejection in the embedding process.
    const seen = await unhandledDuring(async () => {
      let rejectLate: ((error: Error) => void) | undefined;
      const abandoned = new Promise<never>((_resolve, reject) => { rejectLate = reject; });
      await expect(withinDeadline(abandoned, performance.now() - 1, 'budget already spent'))
        .rejects.toThrow('budget already spent');
      rejectLate?.(new Error('the child exited after the launcher gave up'));
    });
    expect(seen).toEqual([]);
  });

  it('keeps observing a promise that loses the race and rejects afterwards', async () => {
    const seen = await unhandledDuring(async () => {
      let rejectLate: ((error: Error) => void) | undefined;
      const slow = new Promise<never>((_resolve, reject) => { rejectLate = reject; });
      await expect(withinDeadline(slow, performance.now() + 5, 'deadline won the race'))
        .rejects.toThrow('deadline won the race');
      rejectLate?.(new Error('the child exited after the deadline'));
    });
    expect(seen).toEqual([]);
  });

  it('returns the value when the promise settles first', async () => {
    await expect(withinDeadline(Promise.resolve('ready'), performance.now() + 1_000, 'unused')).resolves.toBe('ready');
  });

  it('reports the failure the promise produced, not the deadline', async () => {
    await expect(withinDeadline(Promise.reject(new Error('bind refused')), performance.now() + 1_000, 'unused'))
      .rejects.toThrow('bind refused');
  });

  it('builds its detail lazily so it can name the phase reached', async () => {
    let phase = 'connecting';
    const pending = new Promise<never>(() => undefined);
    const raced = withinDeadline(pending, performance.now() + 5, () => `stalled while ${phase}`);
    phase = 'loading the runner';
    await expect(raced).rejects.toThrow('stalled while loading the runner');
  });
});
