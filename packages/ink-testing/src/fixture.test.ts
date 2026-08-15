/**
 * `launchInkFixture` against a real pseudo-terminal: a separate process, a real
 * line discipline, real raw mode.
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { TerminalHarness } from '@termwright/driver';
import { launchInkFixture } from './fixture.js';
import type { JsonProps } from './payload.js';

const COMPONENT = new URL('./testing/counter-app.mjs', import.meta.url);

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

    expect(harness.capabilities().semanticTree).toBe(true);
    expect(harness.capabilities().adapter?.name).toBe('@termwright/ink');
    expect(harness.screen().buffer).toBe('alternate');
    expect(await harness.getByRole('button', { name: 'Approve' }).count()).toBe(1);
  });

  it('passes props as JSON', async () => {
    const harness = await launch({ label: 'Reject', greeting: 'from a fixture' });

    expect(harness.screen().text()).toContain('from a fixture');
    expect(await harness.getByRole('button', { name: 'Reject' }).count()).toBe(1);
  });

  it('reacts to a click delivered through the pty', async () => {
    const harness = await launch();

    await harness.getByRole('button', { name: 'Approve' }).click();
    await harness.waitForText('pressed 1');

    expect(harness.screen().text()).toContain('pressed 1');
  });

  it('reacts to keyboard input in raw mode', async () => {
    const harness = await launch();

    await harness.press('Tab');
    await harness.waitForStable();
    await harness.type('ok');
    await harness.waitForText('> ok');

    expect(harness.screen().text()).toContain('> ok');
  });

  it('exits on a real signal', async () => {
    const harness = await launch();

    await harness.signal('INT');

    expect(await harness.waitForExit()).toMatchObject({ signal: 'SIGINT' });
  });

  it('refuses a component export that does not exist', async () => {
    await expect(
      launchInkFixture({ component: COMPONENT, exportName: 'Missing', columns: 20, rows: 5 }),
    ).rejects.toThrowError();
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
    ).rejects.toMatchObject({ code: 'unsupported-action' });
  });
});
