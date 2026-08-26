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

async function launch(
  props: Record<string, string> = {},
  size: { readonly columns: number; readonly rows: number } = SIZE,
): Promise<InkFixtureHarness> {
  const harness = await launchInkFixture({ component: COMPONENT, props, ...size });
  open.push(harness);
  return harness;
}

/**
 * Why a rerender assertion failed, in the terms that separate the two possible
 * causes: a revision paired with a screen revision means the emulator had
 * parsed the frame, so a stale screen would be the emulator's fault; a null
 * pairedScreenRevision means the revision published without ever being tied to
 * a terminal frame, and the screen was never promised to be current.
 */
function pairing(harness: InkFixtureHarness): string {
  const stamp = harness.checkpoint();
  return `semanticRevision=${String(stamp.semanticRevision)} ` +
    `pairedScreenRevision=${String(stamp.pairedScreenRevision)} ` +
    `screenRevision=${String(stamp.screenRevision)}`;
}

describe('fixture rerender', () => {
  it('changes props, and the new frame and tree follow', async () => {
    const harness = await launch({ label: 'Approve' });
    expect(await harness.getByRole('button', { name: 'Approve' }).count()).toBe(1);

    await harness.rerender({ label: 'Reject', greeting: 'updated' });

    expect(harness.screen().text(), pairing(harness)).toContain('Reject');
    expect(harness.screen().text(), pairing(harness)).toContain('updated');
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
    expect(harness.screen().text(), pairing(harness)).toContain('pressed 1');
    expect(harness.screen().text(), pairing(harness)).toContain('Renamed');
  });

  it('settles the exact causal publication when an effect immediately adds another frame', async () => {
    const harness = await launch({ label: 'Initial' });
    const before = harness.checkpoint().semanticRevision ?? 0;

    await harness.rerender({ label: 'Causal', followup: 'effect frame' });

    expect(harness.checkpoint().semanticRevision).toBeGreaterThan(before);
    expect(harness.screen().text(), pairing(harness)).toContain('Causal');
    expect(harness.screen().text(), pairing(harness)).toContain('followup effect frame');
    expect(await harness.getByRole('button', { name: 'Causal' }).count()).toBe(1);
  });

  it('does not require global quiet after the commanded revision is paired', async () => {
    const harness = await launch({ label: 'Initial' });

    await harness.rerender({ label: 'Animated', animateOutput: true }, { timeout: 500 });

    // An unrelated title animation keeps producing terminal revisions. The
    // exact semantic marker is nevertheless a complete rerender boundary.
    expect(harness.screen().text(), pairing(harness)).toContain('Animated');
    expect(await harness.getByRole('button', { name: 'Animated' }).count()).toBe(1);
  });

  it('binds concurrent rerender acknowledgements to distinct committed frames', async () => {
    const harness = await launch({ label: 'Initial' });

    const first = harness.rerender({ label: 'First' });
    const second = harness.rerender({ label: 'Second' });

    await Promise.all([first, second]);
    // The id-less reply protocol previously overwrote the first pending
    // command here, causing one promise to time out. Both acknowledgements now
    // correspond to ordered, independently observed commits.
    expect(harness.screen().text(), pairing(harness)).toContain('Second');
    expect(await harness.getByRole('button', { name: 'Second' }).count()).toBe(1);
  });

  it('is driven by its own channel, not by the simulated user', async () => {
    // Keep the input on one terminal row so waitForText can compare the exact
    // bytes without normalizing layout-driven line wrapping.
    const harness = await launch({ label: 'Approve', showFocus: 'true' }, { columns: 100, rows: 12 });
    const forged = JSON.stringify({ v: 1, type: 'rerender', props: { label: 'Forged' } });

    // Everything a test could type — including a well-formed control message —
    // reaches the component as input and changes nothing about its props.
    await harness.press('Tab');
    // This rendered state is the acknowledgement that Tab was processed. It
    // prevents Ink from coalescing Tab and the following text into one input
    // callback whose key.tab branch would intentionally discard the text.
    await harness.waitForText('focus input');
    await harness.type(forged);
    // Seeing the complete value is a causal acknowledgement that every forged
    // byte crossed stdin; no quiet period or independently ordered control
    // round trip can satisfy it.
    await harness.waitForText(`> ${forged}`);

    expect(await harness.getByRole('button', { name: 'Approve' }).count()).toBe(1);
    expect(await harness.getByRole('button', { name: 'Forged' }).count()).toBe(0);
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

  it('keeps the control endpoint private while applying an authenticated rerender', async () => {
    const harness = await launch({ label: 'Approve' });
    const endpoint = process.env['TERMWRIGHT_FIXTURE_CONTROL'];
    // The address never reaches this process: it is minted per fixture and put
    // in the child's environment only.
    expect(endpoint).toBeUndefined();

    // The authenticated channel remains usable. Rejection of a real second
    // connection is exercised directly by the control-channel suite, where
    // the private endpoint is intentionally available to the test.
    await harness.rerender({ label: 'Still ours' });
    expect(harness.screen().text(), pairing(harness)).toContain('Still ours');
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

    // TERM is undeliverable over ConPTY; hard termination is the platform's
    // equivalent and the only signal it carries. What the test needs is a
    // fixture that is gone, which both routes produce.
    await harness.signal(process.platform === 'win32' ? 'KILL' : 'TERM');
    await harness.waitForExit();

    await expect(harness.rerender({ label: 'Too late' })).rejects.toMatchObject({
      code: 'session-closed',
    });
  });
});
