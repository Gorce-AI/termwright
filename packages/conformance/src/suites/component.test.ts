/**
 * Component-harness conformance — origin spec §20.2a, process-mode half.
 *
 * The same component (`src/fixtures/component.mjs`) is meant to be mounted
 * twice: in-process by a component harness such as `@termwright/ink-testing`,
 * and here as a real child process under a pseudo-terminal. What this file
 * pins is the process-mode outcome, so the two can be compared.
 *
 * Documented process-mode differences, which a harness comparison must allow:
 *   - the `onChange` callback cannot be observed directly; the host renders its
 *     argument as `changed: <n>` instead;
 *   - props are fixed at launch (`--step=`), so prop-driven rerender is proven
 *     by relaunching rather than by calling `rerender`;
 *   - unmount is requested over the PTY (Ctrl+C) rather than by `unmount()`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { TerminalHarness } from '@termwright/driver';
import { TermwrightError } from '@termwright/driver';
import {
  CONFORMANCE_FIXTURES,
  createSessionPool,
  mouseModeHidden,
  ptyAvailable,
  rejection,
} from '../support/pty.js';

const sessions = createSessionPool();

interface Mounted {
  readonly terminal: TerminalHarness;
  /** Everything the child wrote since launch, escape sequences included. */
  output(): string;
}

async function mount(args: readonly string[] = []): Promise<Mounted> {
  const terminal = await sessions.launch(CONFORMANCE_FIXTURES.component(), {
    columns: 60,
    rows: 16,
    semanticNegotiationMs: 5_000,
    args,
  });
  let output = '';
  terminal.events.on('output', ({ data }) => {
    output += Buffer.from(data).toString('utf8');
  });
  await terminal.waitForText('count: 0');
  await terminal.getByTestId('probe').resolve();
  return { terminal, output: () => output };
}

afterEach(sessions.closeAll);

describe.skipIf(!ptyAvailable())('a component mounted in a real terminal', () => {
  it('mounts inside its wrapper context', async () => {
    const { terminal } = await mount();

    // The label comes from the context the host provides, not from the
    // component: mounting without the wrapper would read `probe probe`.
    expect(await terminal.getByRole('region').textContent()).toBe('wrapped probe');
    expect(await terminal.getByRole('button').count()).toBe(2);
    expect(await terminal.getByTestId('count').textContent()).toBe('0');
  });

  it('settles asynchronous state after the first frame', async () => {
    const { terminal, output } = await mount();

    await expect.poll(async () => terminal.getByTestId('phase').textContent()).toBe('ready');
    // The first frame really did render the pre-settlement state: an assertion
    // that only checked the end state would pass on a component with no async
    // phase at all.
    expect(output()).toContain('phase: loading');
  });

  it('fires its callback on physical input and reflects it in the tree', async () => {
    const { terminal } = await mount();

    await terminal.press('+');
    await terminal.waitForText('count: 1');
    await terminal.waitForText('changed: 1');
    await expect.poll(async () => terminal.getByTestId('count').textContent()).toBe('1');

    await terminal.press('-');
    await terminal.waitForText('count: 0');
  });

  it('takes its step from a prop', async () => {
    const { terminal } = await mount(['--step=5']);

    await terminal.press('+');
    await terminal.waitForText('count: 5');
    await expect.poll(async () => terminal.getByTestId('count').textContent()).toBe('5');
  });

  it('transfers focus between widgets', async () => {
    const { terminal } = await mount();
    expect(await terminal.getByTestId('increment').semanticState()).toMatchObject({ focused: true });

    await terminal.press('Tab');
    await expect
      .poll(async () => (await terminal.getByTestId('decrement').semanticState())?.focused)
      .toBe(true);
    expect(await terminal.getByTestId('increment').semanticState()).toMatchObject({ focused: false });
    expect(await terminal.locator('button:focused').textContent()).toBe('Decrement');
  });

  it('replaces a crashed subtree with an alert', async () => {
    const { terminal } = await mount();

    await terminal.press('e');
    await terminal.getByRole('alert').waitFor();

    expect(await terminal.getByRole('alert').textContent()).toBe('Component crashed');

    // The tree can arrive before the frame it describes has been parsed, so
    // the screen is polled rather than read once — this failed on Windows
    // showing the *first* frame, which is what an un-polled read catches.
    await expect.poll(() => terminal.screen().text()).toContain('Component crashed');
    expect(await terminal.getByRole('button').count()).toBe(0);
  });

  it('reflows on resize and republishes bounds', async () => {
    const { terminal } = await mount();
    const before = await terminal.getByTestId('increment').boundingBox();

    await terminal.resize({ columns: 100, rows: 30 });

    // The layout is the reliable witness, not the component's own `size:` line:
    // Ink re-renders on SIGWINCH before Node has updated
    // `process.stdout.columns`, so a component that prints its size can publish
    // correct bounds while still showing the old numbers. Measured: bounds
    // updated in 6 of 6 resizes, the text in 4 of 6.
    await expect
      .poll(async () => (await terminal.getByTestId('increment').boundingBox())?.width ?? 0)
      .toBeGreaterThan(before?.width ?? 0);

    const after = await terminal.getByTestId('increment').boundingBox();
    expect(after?.row).toBe(before?.row);
  });

  it('publishes bounds a harness could hit-test, and refuses a mouse it never got', async () => {
    const { terminal } = await mount();
    const box = await terminal.getByTestId('decrement').boundingBox();

    expect(box).toMatchObject({ height: 1 });
    expect(box?.row).toBeGreaterThan(0);

    // The component never enabled mouse reporting, so a click has nowhere to
    // go; refusing is the honest outcome, not synthesising an event. That
    // refusal is a claim about the child, and only a platform that shows the
    // mode can make it — where ConPTY hides it the driver sends the report
    // instead and records why, which is the other half of the same honesty.
    if (mouseModeHidden(terminal)) {
      await terminal.getByTestId('decrement').click();
      const unverified = terminal
        .diagnostics()
        .filter((entry) => entry.code === 'mode-unverifiable' && entry.mode === 'mouse');
      expect(unverified).toHaveLength(1);
      return;
    }
    const refused = (await rejection(terminal.getByTestId('decrement').click())) as TermwrightError;
    expect(refused.code).toBe('unsupported-action');
  });

  it('unmounts and cleans up', async () => {
    const { terminal } = await mount();
    expect(terminal.screen().buffer).toBe('alternate');

    await terminal.write('\x03'); // Ctrl+C: Ink unmounts the tree
    const status = await terminal.waitForExit();

    expect(status.code).toBe(0);
    expect(terminal.screen().buffer).toBe('normal');
    expect(terminal.screen().text()).toContain('BYE');
  });
});
