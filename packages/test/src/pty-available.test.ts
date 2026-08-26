import { afterEach, describe, expect, it } from 'vitest';
import { ptyAvailable, ptyUnavailableReason, resetPtyProbe } from './pty-available.js';

/**
 * A machine that opted out of PTY suites and a machine that cannot open a
 * pseudo-terminal both answer `false`, and only one of them is fine. Telling
 * them apart is what stops a run whose PTY suites all skipped — because the
 * machine was broken — from finishing green with nothing to show it.
 */
describe('pseudo-terminal probing', () => {
  const previous = process.env['TERMWRIGHT_SKIP_PTY'];

  afterEach(() => {
    if (previous === undefined) delete process.env['TERMWRIGHT_SKIP_PTY'];
    else process.env['TERMWRIGHT_SKIP_PTY'] = previous;
    resetPtyProbe();
  });

  it('names the deliberate opt-out as a choice, not a fault', async () => {
    process.env['TERMWRIGHT_SKIP_PTY'] = '1';
    resetPtyProbe();
    expect(await ptyAvailable()).toBe(false);
    expect(ptyUnavailableReason()).toEqual({ kind: 'opted-out', detail: 'TERMWRIGHT_SKIP_PTY=1' });
  });

  it('reports no reason when the native pseudo-terminal backend loads', async () => {
    delete process.env['TERMWRIGHT_SKIP_PTY'];
    resetPtyProbe();
    const available = await ptyAvailable();
    // The machine running this decides the answer; what is pinned is that a
    // yes carries no complaint and a no always carries one.
    if (available) expect(ptyUnavailableReason()).toBeUndefined();
    else expect(ptyUnavailableReason()?.kind).toBe('probe-failed');
  });

  it('answers the same way twice without probing again', async () => {
    process.env['TERMWRIGHT_SKIP_PTY'] = '1';
    resetPtyProbe();
    const first = await ptyAvailable();
    const second = await ptyAvailable();
    expect(second).toBe(first);
    expect(ptyUnavailableReason()?.kind).toBe('opted-out');
  });
});
