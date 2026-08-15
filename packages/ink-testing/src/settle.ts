/**
 * Settlement waits.
 *
 * React commits asynchronously, Ink throttles frames, and the adapter publishes
 * its tree one macrotask after the frame it describes. None of that is exposed
 * to test authors as a timing problem: every helper here waits for a *revision*
 * — a fact the session observed — and the package never sleeps.
 */

import { ProcessExitedError, TimeoutError, type TerminalHarness } from '@termwright/driver';

/** How long a settlement wait may take before it fails. */
export interface SettleOptions {
  /** Milliseconds. Default 5000. */
  readonly timeout?: number;
}

const DEFAULT_SETTLE_TIMEOUT_MS = 5_000;

/**
 * Runs `mutate` and resolves once the application has committed the frame it
 * caused — semantically when the session has a tree, otherwise by screen
 * revision.
 *
 * Listeners are attached before `mutate` runs, so a frame committed
 * synchronously cannot be missed.
 *
 * @throws TimeoutError when no frame arrives in time
 * @throws ProcessExitedError when the application exits while waiting
 */
export async function commitFrame(
  harness: TerminalHarness,
  mutate: () => void,
  opts?: SettleOptions,
): Promise<void> {
  const semanticBefore = harness.semanticTree()?.revision ?? -1;
  const screenBefore = harness.screen().revision;
  const wait = nextFrame(harness, semanticBefore, screenBefore, opts);
  mutate();
  await wait;
  await quiesce(harness, opts);
}

/**
 * Resolves once the application has committed its first frame, so that locators
 * can run without a preliminary wait in every test.
 *
 * A mount that produces no output at all — a component rendering `null` before
 * any state arrives — still settles: the adapter publishes a tree for the empty
 * frame.
 */
export async function waitForFirstFrame(
  harness: TerminalHarness,
  opts?: SettleOptions,
): Promise<void> {
  if ((harness.semanticTree()?.revision ?? -1) < 0) {
    await nextFrame(harness, -1, harness.screen().revision, opts);
  }
  await quiesce(harness, opts);
}

/**
 * Waits until nothing more is in flight.
 *
 * The first revision is not the end of a mount. The adapter publishes a tree as
 * soon as its handshake completes — before Ink has necessarily written a single
 * byte — and a mounted component's effects then produce output of their own:
 * entering the alternate screen, enabling mouse reporting, a first state
 * update. A test that ran between those would see a component that is on screen
 * but cannot yet be clicked. `waitForStable` is the driver's own answer to
 * "nothing is in flight", and it is revision-driven, not a sleep.
 */
async function quiesce(harness: TerminalHarness, opts?: SettleOptions): Promise<void> {
  await harness.waitForStable({
    frames: 2,
    ...(opts?.timeout === undefined ? {} : { timeout: opts.timeout }),
  });
}

/**
 * The shared primitive: resolve on the first revision beyond the given
 * watermarks.
 *
 * A semantic revision is preferred because it is the only signal that survives
 * a frame whose bytes did not change — a state update that alters a node's
 * `focused` flag without moving a single cell still advances it.
 */
function nextFrame(
  harness: TerminalHarness,
  semanticAfter: number,
  screenAfter: number,
  opts?: SettleOptions,
): Promise<void> {
  const timeout = opts?.timeout ?? DEFAULT_SETTLE_TIMEOUT_MS;
  return new Promise<void>((resolve, reject) => {
    const unsubscribes: (() => void)[] = [];
    const done = (settle: () => void): void => {
      clearTimeout(timer);
      for (const unsubscribe of unsubscribes) unsubscribe();
      settle();
    };

    const timer = setTimeout(() => {
      done(() =>
        reject(
          new TimeoutError(
            `the application committed no frame within ${timeout} ms`,
            {
              semanticTree: harness.capabilities().semanticTree,
              screenExcerpt: harness.screen().text(),
              suggestion:
                'the component rendered nothing new; check that the update reaches React state, ' +
                'or raise the settle timeout',
            },
          ),
        ),
      );
    }, timeout);
    timer.unref?.();

    unsubscribes.push(
      harness.events.on('semantic-revision', ({ revision }) => {
        if (revision > semanticAfter) done(resolve);
      }),
      harness.events.on('screen-revision', ({ revision }) => {
        // Only a fallback: in a semantic session the tree is the authority, and
        // waiting for it avoids acting on a frame whose tree is still in flight.
        if (!harness.capabilities().semanticTree && revision > screenAfter) done(resolve);
      }),
      harness.events.on('exit', (status) => {
        done(() =>
          reject(
            new ProcessExitedError(
              `the application exited (code ${String(status.code)}, signal ${String(status.signal)}) ` +
                'before committing the awaited frame',
              { semanticTree: harness.capabilities().semanticTree },
            ),
          ),
        );
      }),
    );
  });
}
