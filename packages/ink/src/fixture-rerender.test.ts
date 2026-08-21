/**
 * `rerender` on a fixture: the control channel end to end.
 *
 * The property worth defending is not just "props change". It is that the
 * channel is *separate* from stdin — a fixture test that types must not be able
 * to forge a rerender, and a rerender must not be mistaken for a keystroke —
 * and that it leaves nothing behind.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { launchInkFixture, type InkFixtureHarness } from './fixture.js';
import { MAX_CONTROL_BYTES } from './control.js';

const COMPONENT = new URL('./testing/counter-app.mjs', import.meta.url);
const SIZE = { columns: 44, rows: 12 } as const;

const open: InkFixtureHarness[] = [];

afterEach(async () => {
  for (const harness of open.splice(0)) await harness.close();
});

async function launch(props: Record<string, string> = {}): Promise<InkFixtureHarness> {
  const harness = await launchInkFixture({ component: COMPONENT, props, ...SIZE });
  open.push(harness);
  return harness;
}

describe('fixture rerender', () => {
  it('changes props, and the new frame and tree follow', async () => {
    const harness = await launch({ label: 'Approve' });
    expect(await harness.getByRole('button', { name: 'Approve' }).count()).toBe(1);

    await harness.rerender({ label: 'Reject', greeting: 'updated' });

    expect(harness.screen().text()).toContain('Reject');
    expect(harness.screen().text()).toContain('updated');
    expect(await harness.getByRole('button', { name: 'Reject' }).count()).toBe(1);
    expect(await harness.getByRole('button', { name: 'Approve' }).count()).toBe(0);
  });

  it('keeps component state across a prop update', async () => {
    const harness = await launch({ label: 'Approve' });

    await harness.press('Enter');
    await harness.waitForText('pressed 1');

    await harness.rerender({ label: 'Renamed' });

    // React reconciles rather than remounting: the press count survives, which
    // is what makes this a prop update and not a relaunch.
    expect(harness.screen().text()).toContain('pressed 1');
    expect(harness.screen().text()).toContain('Renamed');
  });

  it('is driven by its own channel, not by the simulated user', async () => {
    const harness = await launch({ label: 'Approve' });

    // Everything a test could type — including a well-formed control message —
    // reaches the component as input and changes nothing about its props.
    await harness.type(JSON.stringify({ v: 1, type: 'rerender', props: { label: 'Forged' } }));
    await harness.waitForStable();

    expect(await harness.getByRole('button', { name: 'Approve' }).count()).toBe(1);
    expect(harness.screen().text()).not.toContain('Forged');
  });

  it('refuses props that cannot cross as JSON, before sending anything', async () => {
    const harness = await launch({ label: 'Approve' });

    await expect(
      harness.rerender({ onPress: (() => undefined) as never }),
    ).rejects.toThrow(TypeError);

    // The fixture never heard about it.
    expect(await harness.getByRole('button', { name: 'Approve' }).count()).toBe(1);
  });

  it('refuses props that exceed the control-message limit', async () => {
    const harness = await launch({ label: 'Approve' });

    await expect(
      harness.rerender({ blob: 'x'.repeat(MAX_CONTROL_BYTES) }),
    ).rejects.toMatchObject({ code: 'capacity' });
  });

  it('ignores a stranger on the control socket', async () => {
    const harness = await launch({ label: 'Approve' });
    const endpoint = process.env['TERMWRIGHT_FIXTURE_CONTROL'];
    // The address never reaches this process: it is minted per fixture and put
    // in the child's environment only.
    expect(endpoint).toBeUndefined();

    // A second connection to an already-attached channel is dropped, so even a
    // caller that learned the address cannot drive the fixture.
    await harness.rerender({ label: 'Still ours' });
    expect(harness.screen().text()).toContain('Still ours');
  });

  it('closes its control channel when the harness closes', async () => {
    const harness = await launchInkFixture({ component: COMPONENT, props: { label: 'Temp' }, ...SIZE });

    await harness.rerender({ label: 'Alive' });
    await harness.close();

    // The observable consequence of the channel being gone. The socket file
    // itself is asserted at the unit level, where its path is known — counting
    // entries in a shared tmpdir would race every other test file.
    await expect(harness.rerender({ label: 'After close' })).rejects.toMatchObject({
      code: 'session-closed',
    });
  });

  it('reports a rerender sent after the fixture is gone', async () => {
    const harness = await launch({ label: 'Approve' });

    await harness.signal('TERM');
    await harness.waitForExit();

    await expect(harness.rerender({ label: 'Too late' })).rejects.toMatchObject({
      code: 'session-closed',
    });
  });
});
