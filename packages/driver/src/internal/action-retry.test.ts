import { describe, expect, it, vi } from 'vitest';
import type { ObservationStamp } from '@termwright/protocol';
import {
  AmbiguousLocatorError,
  CapabilityUnavailableError,
  NotActionableError,
  PendingObservationError,
  StaleSnapshotError,
} from '../errors.js';
import { ActionRetryController, assertBeforeActionInput } from './action-retry.js';

const diagnostics = { semanticTree: true } as const;
const stamp = (sequence: number): ObservationStamp =>
  Object.freeze({
    sessionId: 's',
    contractId: 's:0',
    epoch: 0,
    sequence,
    screenRevision: sequence,
    semanticRevision: sequence,
    pairedScreenRevision: sequence,
  });

function transient(
  reason: 'target-state' | 'pointer-region' | 'covered',
  sequence: number,
): NotActionableError {
  return new NotActionableError('not yet', diagnostics, reason).withActionability(
    Object.freeze({
      actionable: false,
      intent: Object.freeze({ kind: 'click', targetRef: `semantic:save@${sequence}` as const }),
      checkpoint: stamp(sequence),
      requirements: Object.freeze([]),
      reason: Object.freeze({ code: 'not-actionable', message: 'not yet' }),
    }),
  );
}

describe('locator action retry policy', () => {
  it('retries the first pre-input stale race immediately', async () => {
    const waitForChange = vi.fn(async (_deadline: number) => undefined);
    await new ActionRetryController(1_000).retry(new StaleSnapshotError('race', diagnostics), {
      checkpoint: () => stamp(2),
      waitForChange,
    });
    expect(waitForChange).not.toHaveBeenCalled();
  });

  it.each(['target-state', 'pointer-region', 'covered'] as const)(
    'retries transient %s only after a new committed observation',
    async (reason) => {
      let current = stamp(4);
      const waitForChange = vi.fn(async () => {
        current = stamp(5);
      });
      await new ActionRetryController(1_000).retry(transient(reason, 4), {
        checkpoint: () => current,
        waitForChange,
      });
      expect(waitForChange).toHaveBeenCalledOnce();
    },
  );

  it('does not re-plan for unrelated status wakeups', async () => {
    let current = stamp(8);
    let wake = 0;
    const waitForChange = vi.fn(async () => {
      wake += 1;
      current =
        wake === 4
          ? stamp(9)
          : Object.freeze({ ...stamp(8), sequence: 8 + wake, screenRevision: 8 + wake });
    });
    await new ActionRetryController(1_000).retry(transient('covered', 8), {
      checkpoint: () => current,
      waitForChange,
    });
    expect(waitForChange).toHaveBeenCalledTimes(4);
  });

  it('wakes when pending parser evidence settles without changing visible cells', async () => {
    const controller = new ActionRetryController(1_000);
    const stale = new StaleSnapshotError('parser pending', diagnostics);
    let state: 'parser-in-flight' | 'settled' = 'parser-in-flight';
    const ctx = {
      checkpoint: () => stamp(12),
      actionObservationState: () => state,
      actionObservationWait: vi.fn(),
      waitForChange: vi.fn(async () => {
        state = 'settled';
      }),
    };
    await controller.retry(stale, ctx);
    await controller.retry(stale, ctx, 'action:pending');
    expect(ctx.waitForChange).toHaveBeenCalledOnce();
    expect(ctx.actionObservationWait).toHaveBeenCalledOnce();
    expect(ctx.actionObservationWait).toHaveBeenCalledWith('action:pending', 'parser-in-flight');
  });

  it('arms before reading state so a frame-close wake cannot be lost', async () => {
    const controller = new ActionRetryController(1_000);
    const stale = new PendingObservationError('frame pending', diagnostics, 'semantic-frame-open');

    let state: 'semantic-frame-open' | 'settled' = 'semantic-frame-open';
    let armed = false;
    let wake: (() => void) | undefined;
    const wait = new Promise<void>((resolve) => {
      wake = resolve;
    });
    const ctx = {
      checkpoint: () => stamp(12),
      actionObservationState: () => {
        expect(armed).toBe(true);
        state = 'settled';
        wake?.();
        return state;
      },
      waitForChange: vi.fn(async () => undefined),
      armChange: vi.fn(() => {
        armed = true;
        return { wait: () => wait, cancel: vi.fn() };
      }),
    };

    await controller.retry(stale, ctx, 'action:frame');
    expect(ctx.armChange).toHaveBeenCalledOnce();
    expect(ctx.waitForChange).not.toHaveBeenCalled();
  });

  it('does not re-plan on a marker revision while its semantic frame remains open', async () => {
    const controller = new ActionRetryController(1_000);
    const stale = new StaleSnapshotError('frame pending', diagnostics);
    await controller.retry(stale, { checkpoint: () => stamp(1), waitForChange: vi.fn() });

    let state: 'semantic-frame-open' | 'settled' = 'semantic-frame-open';
    let waits = 0;
    await controller.retry(
      stale,
      {
        checkpoint: () => stamp(2),
        actionObservationState: () => state,
        waitForChange: async () => {
          waits += 1;
          state = 'settled';
        },
      },
      'action:frame',
    );
    expect(waits).toBe(1);
  });

  it('checks the monotonic deadline immediately after a wait', async () => {
    let now = 10;
    const bytes: number[] = [];
    const controller = new ActionRetryController(5, () => now);
    await expect(
      controller.retry(transient('target-state', 1), {
        checkpoint: () => stamp(1),
        waitForChange: async () => {
          now = 15;
        },
      }),
    ).rejects.toMatchObject({ code: 'not-actionable' });
    if (!controller.expired()) bytes.push(1);
    expect(bytes).toEqual([]);
  });

  it('guards the first device operation with the same monotonic budget', () => {
    let now = 20;
    const controller = new ActionRetryController(5, () => now);
    const bytes: number[] = [];
    now = 25;
    expect(() => {
      assertBeforeActionInput(controller.deadline, diagnostics, () => now);
      bytes.push(0x0d);
    }).toThrowError(expect.objectContaining({ code: 'timeout' }));
    expect(bytes).toEqual([]);
  });

  it.each([
    new CapabilityUnavailableError('unsupported', diagnostics),
    new AmbiguousLocatorError(
      'ambiguous',
      Object.freeze([
        Object.freeze({
          ref: 'semantic:n1@1',
          revision: 1,
          identity: 'stable' as const,
          semantic: true,
          rect: null,
        }),
      ]),
      diagnostics,
    ),
    new NotActionableError('wrong role', diagnostics),
    new TypeError('bad options'),
    new Error('write failed'),
  ])('fails fast for non-recoverable errors', async (failure) => {
    const waitForChange = vi.fn(async () => undefined);
    await expect(
      new ActionRetryController(1_000).retry(failure, {
        checkpoint: () => stamp(1),
        waitForChange,
      }),
    ).rejects.toBe(failure);
    expect(waitForChange).not.toHaveBeenCalled();
  });
});
