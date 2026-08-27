/**
 * `mountInk` against the shared component: physical input, semantic reads,
 * prop updates, crashes and cleanup.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { Box, Text } from 'ink';
import type { SemanticLocator } from '@termwright/driver';
import type { Rect } from '@termwright/protocol';
import type { InkHarness } from './mount.js';
import { mountInk } from './mount.js';
import CounterApp from './testing/counter-app.mjs';

const open: InkHarness[] = [];

async function intendedRect(locator: SemanticLocator): Promise<Rect | null> {
  const observation = (await locator.geometry()).intendedRect;
  return observation.status === 'known' ? observation.value : null;
}

async function mount(props: Parameters<typeof CounterApp>[0] = {}): Promise<InkHarness> {
  const harness = await mountInk(createElement(CounterApp, props), { columns: 40, rows: 12 });
  open.push(harness);
  return harness;
}

afterEach(async () => {
  for (const harness of open.splice(0)) await harness.close();
});

describe('mountInk', () => {
  it('publishes a semantic tree the driver can address by role', async () => {
    const harness = await mount();

    expect(harness.contract()?.capabilities['semantic-tree'].status).toBe('supported');
    expect(harness.contract()?.framework?.name).toBe('ink');
    expect(harness.contract()?.capabilities['intended-geometry'].status).toBe('supported');

    const button = harness.getByRole('button', { name: 'Approve' });
    expect(await button.count()).toBe(1);
    const box = await intendedRect(button);
    expect(box).not.toBeNull();
    expect(box?.width).toBeGreaterThan('Approve'.length);
  });

  it('renders into the alternate screen so bounds are viewport-absolute', async () => {
    const harness = await mount();
    const screen = harness.screen();

    expect(screen.buffer).toBe('alternate');
    expect(screen.columns).toBe(40);
    expect(screen.text()).toContain('Approve');

    const box = await intendedRect(harness.getByRole('button', { name: 'Approve' }));
    expect(box).not.toBeNull();
    // The greeting occupies row 0, so the button's border starts on row 1.
    expect(box?.row).toBe(1);
    expect(harness.screen().line(box?.row ?? 0)).toContain('╭');
  });

  it('drives activation through real terminal input', async () => {
    const onPress = vi.fn();
    const harness = await mount({ onPress });

    await expect(harness.getByRole('button', { name: 'Approve' }).click()).rejects.toMatchObject({
      code: 'capability-unavailable',
    });
    await harness.press('Enter');
    await harness.waitForText('pressed 1');

    expect(onPress).toHaveBeenCalledOnce();
  });

  it('refuses to click a node the component cannot receive a mouse event for', async () => {
    // A component that never enables mouse tracking has no way to observe a
    // click, so the driver reports it instead of sending bytes into the void.
    const harness = await mountInk(createElement(Box, null, createElement(Text, null, 'plain')), {
      columns: 20,
      rows: 5,
    });
    open.push(harness);

    await expect(harness.getByText('plain').click()).rejects.toMatchObject({
      code: 'input-mode-disabled',
    });
  });

  it('types into the focused textbox after a physical focus change', async () => {
    const harness = await mount();

    await harness.press('Tab');
    await harness.waitForQuiet();
    await harness.type('hi');
    await harness.waitForText('> hi');
    // `waitForText` is satisfied by the screen; the tree describing that frame
    // is published immediately afterwards.
    await harness.waitForQuiet();

    expect(harness.screen().text()).toContain('> hi');
  });

  it('applies a wrapper around the tree', async () => {
    const harness = await mountInk(createElement(CounterApp, {}), {
      columns: 40,
      rows: 12,
      wrapper: ({ children }) =>
        createElement(
          Box,
          { flexDirection: 'column' },
          createElement(Text, null, 'wrapped'),
          children,
        ),
    });
    open.push(harness);

    expect(harness.screen().text()).toContain('wrapped');
    expect(await harness.getByRole('button', { name: 'Approve' }).count()).toBe(1);
  });

  it('updates props through rerender and settles on the new frame', async () => {
    const harness = await mount({ label: 'Approve' });

    await harness.rerender(createElement(CounterApp, { label: 'Reject' }));

    expect(harness.screen().text()).toContain('Reject');
    expect(await harness.getByRole('button', { name: 'Reject' }).count()).toBe(1);
    expect(await harness.getByRole('button', { name: 'Approve' }).count()).toBe(0);
  });

  it('captures a component that throws, and recovers on the next rerender', async () => {
    const Boom = (): never => {
      throw new Error('component exploded');
    };
    // React reports caught errors on the console; the crash is the assertion.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const harness = await mount();
      await harness.rerender(createElement(Boom));

      expect(harness.renderError()?.message).toBe('component exploded');
      expect(harness.screen().text().trim()).toBe('');

      await harness.rerender(createElement(CounterApp, { label: 'Recovered' }));
      expect(harness.renderError()).toBeNull();
      expect(await harness.getByRole('button', { name: 'Recovered' }).count()).toBe(1);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('resizes the component the way a terminal does', async () => {
    const harness = await mount();

    const receipt = await harness.resize({ columns: 60, rows: 20 });

    expect(harness.screen().columns).toBe(60);
    expect(harness.screen().text()).toContain('Approve');
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

  it('unmounts on close, and refuses further observation', async () => {
    const harness = await mount();
    const exit = harness.exit;

    await harness.close();
    open.length = 0;

    expect(await exit).toEqual({ code: 0, signal: null });
    expect(() => harness.screen()).toThrowError(/closed/u);
  });

  it('rebuilds a locator from a ref', async () => {
    const harness = await mount();

    const target = await harness.getByRole('button', { name: 'Approve' }).resolve();
    const rebuilt = harness.locatorForRef(target.ref);

    expect(await rebuilt.textContent()).toBe('Approve');
    expect((await rebuilt.resolve()).ref).toBe(target.ref);
  });

  it('reports the negotiated capabilities from settled()', async () => {
    const harness = await mount();

    const capabilities = await harness.settled();

    expect(capabilities.capabilities['semantic-tree'].status).toBe('supported');
    expect(capabilities.framework?.name).toBe('ink');
    expect(capabilities.capabilities['intended-geometry'].status).toBe('supported');
    // Settling is a fact about the session, not a one-shot: asking again is
    // the same answer, not a second negotiation.
    expect(await harness.settled()).toEqual(capabilities);
  });

  it('offers an explicitly heuristic quiet wait for a TUI without shell markers', async () => {
    const harness = await mount();

    await harness.waitForQuiet({ quietMs: 100 });

    expect(harness.diagnostics().every((entry) => typeof entry.code === 'string')).toBe(true);
  });

  it('reports a signal as the reason the application stopped', async () => {
    const harness = await mount();

    await harness.signal('INT');

    expect(await harness.waitForExit()).toEqual({ code: null, signal: 'SIGINT' });
  });
});
