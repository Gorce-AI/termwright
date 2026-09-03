/**
 * `launchInkFixture` against a real pseudo-terminal: a separate process, a real
 * line discipline, real raw mode.
 */

import { afterEach, describe, expect, vi } from 'vitest';
import { it as resourceAwareIt } from '@termwright/test';
import type { TerminalHarness } from '@termwright/driver';
import { ControlChannel } from './control.js';
import { launchInkFixture } from './fixture.js';
import type { JsonProps } from './payload.js';

const COMPONENT = new URL('./testing/counter-app.mjs', import.meta.url);
const it = resourceAwareIt.resources({ terminals: 1, traceWriters: 0 });

const open: TerminalHarness[] = [];

afterEach(async () => {
  for (const harness of open.splice(0)) await harness.close();
});

async function launch(props: JsonProps = {}): Promise<TerminalHarness> {
  const harness = await launchInkFixture({ component: COMPONENT, props, columns: 40, rows: 12 });
  open.push(harness);
  return harness;
}

describe('launchInkFixture', () => {
  it('renders the component in a child process and publishes a tree', async () => {
    const harness = await launch({ label: 'Approve' });

    expect(harness.contract()?.capabilities['semantic-tree'].status).toBe('supported');
    expect(harness.contract()?.framework?.name).toBe('ink');
    expect(harness.screen().buffer).toBe('alternate');
    expect(await harness.getByRole('button', { name: 'Approve' }).count()).toBe(1);
  });

  it('has a tree the moment it resolves, with no wait by the caller', async () => {
    // The guarantee the whole package rests on: after `launchInkFixture`
    // resolves, a locator works. It is asserted here rather than defended by a
    // wait in each test, because a test that forgets the wait fails somewhere
    // else entirely — as a component that "rendered nothing".
    const harness = await launch();
    const ready = harness.checkpoint();

    expect(harness.semanticTree()).not.toBeNull();
    expect(harness.screen().text()).toContain('Approve');
    expect(ready.semanticRevision).toBeGreaterThan(0);
    expect(ready.pairedScreenRevision).not.toBeNull();
    expect(ready.pairedScreenRevision).toBeLessThanOrEqual(ready.screenRevision);
  });

  it('reports the negotiated capabilities from settled()', async () => {
    const harness = await launch();

    const capabilities = await harness.settled();

    expect(capabilities.capabilities['semantic-tree'].status).toBe('supported');
    expect(capabilities.framework?.name).toBe('ink');
    expect(capabilities.capabilities['intended-geometry'].status).toBe('supported');
  });

  it('passes props as JSON', async () => {
    const harness = await launch({ label: 'Reject', greeting: 'from a fixture' });

    expect(harness.screen().text()).toContain('from a fixture');
    expect(await harness.getByRole('button', { name: 'Reject' }).count()).toBe(1);
  });

  it('reacts to activation input delivered through the pty', async () => {
    const harness = await launch();

    await harness.press('Enter');
    await harness.waitForText('pressed 1');

    expect(harness.screen().text()).toContain('pressed 1');
  });

  it('reacts to keyboard input in raw mode', async () => {
    const harness = await launch({ showFocus: true });

    await harness.waitForText('focus button');
    await harness.press('Tab');
    await harness.waitForText('focus input');
    await harness.type('ok');
    await harness.waitForText('> ok');

    expect(harness.screen().text()).toContain('> ok');
  });

  it('returns the driver resize receipt after the child repaints', async () => {
    const harness = await launch();

    const receipt = await harness.resize({ columns: 60, rows: 20 });

    expect(harness.screen().columns).toBe(60);
    expect(receipt.requested).toEqual({ columns: 60, rows: 20 });
    expect(receipt.before.sessionId).toBe(harness.sessionId);
    expect(receipt.after.sessionId).toBe(harness.sessionId);
    expect(receipt.after.screenRevision).toBeGreaterThan(receipt.before.screenRevision);
    expect(receipt.pairedRender).toEqual({
      status: 'known',
      value: receipt.after.screenRevision,
      evidence: {
        source: 'terminal',
        method: 'native',
        strength: 'authoritative',
        providerId: 'termwright-vt',
      },
    });
  });

  it('exits on a real interrupt', async () => {
    const harness = await launch();

    // ConPTY carries no interrupt signal, and the driver says so rather than
    // pretending otherwise. Windows still has the capability — it is delivered
    // through terminal input, which is exactly what the driver's own error
    // points at — so both platforms interrupt the program for real here
    // instead of one of them skipping the case.
    if (process.platform === 'win32') await harness.write('\u0003');
    else await harness.signal('INT');

    // How a signalled child is *reported* is the platform's business: POSIX
    // fills in the signal, ConPTY has no signals at all and gives back a plain
    // exit. What the session owes is the same everywhere — it notices the death
    // and stops pretending the program can still be driven.
    await harness.waitForExit();
    await expect
      .poll(async () => {
        try {
          await harness.press('a');
          return undefined;
        } catch (error) {
          return (error as { code?: string }).code;
        }
      })
      .toBe('process-exited');
  });

  it('refuses a component export that does not exist', async () => {
    await expect(
      launchInkFixture({ component: COMPONENT, exportName: 'Missing', columns: 20, rows: 5 }),
    ).rejects.toThrowError();
  });

  it('rolls the pre-spawn control endpoint back when terminal launch fails', async () => {
    const listen = ControlChannel.listen.bind(ControlChannel);
    let close: ReturnType<typeof vi.spyOn> | undefined;
    const listenSpy = vi.spyOn(ControlChannel, 'listen').mockImplementation(async () => {
      const channel = await listen();
      close = vi.spyOn(channel, 'close');
      return channel;
    });
    try {
      await expect(
        launchInkFixture({
          component: COMPONENT,
          cwd: `/termwright-does-not-exist-${process.pid}`,
          columns: 20,
          rows: 5,
        }),
      ).rejects.toThrow();
      expect(close).toHaveBeenCalledOnce();
    } finally {
      listenSpy.mockRestore();
    }
  });

  it('closes the PTY even when control-channel cleanup fails', async () => {
    const listen = ControlChannel.listen.bind(ControlChannel);
    let channel: ControlChannel | undefined;
    const listenSpy = vi.spyOn(ControlChannel, 'listen').mockImplementation(async () => {
      channel = await listen();
      return channel;
    });
    try {
      const harness = await launchInkFixture({ component: COMPONENT, columns: 20, rows: 5 });
      if (channel === undefined) throw new Error('fixture did not acquire its control channel');
      vi.spyOn(channel, 'close').mockRejectedValueOnce(
        new Error('injected control cleanup failure'),
      );

      const first = harness.close();
      const second = harness.close();
      expect(second).toBe(first);
      await expect(first).rejects.toThrow('failed to close all Ink fixture resources');
      const status = await harness.waitForExit();
      expect(status.code !== null || status.signal !== null).toBe(true);
    } finally {
      await channel?.close().catch(() => undefined);
      listenSpy.mockRestore();
    }
  });

  it('waits for an instrumented fixture whose imports exceed the generic negotiation window', async () => {
    const slowStart = new URL('./testing/slow-start.mjs', import.meta.url);
    const harness = await launchInkFixture({
      component: COMPONENT,
      nodeArgs: ['--import', slowStart.href],
      columns: 20,
      rows: 5,
    });

    try {
      expect(harness.contract()?.capabilities['semantic-tree'].status).toBe('supported');
      expect(harness.semanticTree()).not.toBeNull();
      expect(harness.screen().text()).not.toBe('');
    } finally {
      await harness.close();
    }
  });

  it('refuses props that cannot cross a process boundary', async () => {
    await expect(
      launchInkFixture({
        component: COMPONENT,
        // A callback is exactly what a fixture cannot take: there is no
        // channel that could carry it, and dropping it silently would make a
        // test pass for the wrong reason.
        props: { onPress: (() => undefined) as never },
        columns: 20,
        rows: 5,
      }),
    ).rejects.toThrow(TypeError);
  });
});
