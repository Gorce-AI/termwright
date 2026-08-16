import { describe, expect, it } from 'vitest';
import { waitForQuiet } from './quiet.js';

/**
 * A hand-driven clock. Time only moves when the test moves it, so "the stream
 * kept talking" and "the stream stopped" are decisions the test makes rather
 * than races it hopes for.
 */
function clock() {
  let now = 0;
  let lastOutputAt = 0;
  const sleepers: { readonly until: number; readonly wake: () => void }[] = [];
  return {
    options: {
      now: () => now,
      lastOutputAt: () => lastOutputAt,
      quietMs: 1_000,
      sleep: (ms: number) =>
        new Promise<void>((resolve) => {
          sleepers.push({ until: now + ms, wake: resolve });
        }),
    },
    output(): void {
      lastOutputAt = now;
    },
    /** Advances time and wakes whatever was due, then yields to the waiter. */
    async advance(ms: number): Promise<void> {
      now += ms;
      for (const sleeper of sleepers.splice(0)) {
        if (sleeper.until <= now) sleeper.wake();
        else sleepers.push(sleeper);
      }
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe('waiting for the output stream to stop', () => {
  it('returns at once when nothing has arrived for the whole window', async () => {
    const c = clock();
    await c.advance(1_000);
    await expect(waitForQuiet(c.options)).resolves.toBeUndefined();
  });

  it('does not finish while output keeps arriving', async () => {
    const c = clock();
    let settled = false;
    void waitForQuiet(c.options).then(() => {
      settled = true;
    });

    // Output every 900 ms: each one moves the deadline before it is reached.
    for (let round = 0; round < 5; round += 1) {
      await c.advance(900);
      c.output();
      expect(settled).toBe(false);
    }
    // Five rounds is 4.5 s — more than four windows — and still not "missing".
    expect(settled).toBe(false);
  });

  it('finishes once the stream falls silent for a full window', async () => {
    const c = clock();
    let settled = false;
    void waitForQuiet(c.options).then(() => {
      settled = true;
    });

    await c.advance(900);
    c.output();
    await c.advance(999);
    expect(settled).toBe(false);

    await c.advance(1);
    expect(settled).toBe(true);
  });

  it('gives up when the session is gone rather than spinning', async () => {
    const c = clock();
    let closed = false;
    const promise = waitForQuiet({ ...c.options, cancelled: () => closed });

    await c.advance(500);
    closed = true;
    c.output();
    await c.advance(1_000);

    await expect(promise).resolves.toBeUndefined();
  });
});
