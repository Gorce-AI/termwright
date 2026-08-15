/**
 * `@termwright/test` driving a mounted component — the preset without a pty.
 *
 * Every other preset test needs a real pseudo-terminal, which rules out
 * environments that have none: a sandboxed CI container, a Windows runner
 * without ConPTY, a machine where the native pty binding failed to build. An
 * in-process mount is the only path that reaches the matchers there, so this
 * file is where the preset's coverage stops depending on the platform.
 *
 * It also exercises the seam between the two packages: `mountInk` returns the
 * driver's `TerminalHarness`, and the matchers accept it because that is the
 * only thing they ever depended on.
 */

import { createElement } from 'react';
import { afterEach, expect, test } from '@termwright/test';
import type { InkHarness } from './mount.js';
import { mountInk } from './mount.js';
import CounterApp from './testing/counter-app.mjs';

const SIZE = { columns: 44, rows: 10 } as const;

const open: InkHarness[] = [];

afterEach(async () => {
  for (const harness of open.splice(0)) await harness.close();
});

async function mount(props: Parameters<typeof CounterApp>[0] = {}): Promise<InkHarness> {
  const harness = await mountInk(createElement(CounterApp, props), SIZE);
  open.push(harness);
  return harness;
}

test('matches a semantic snapshot written by hand', async () => {
  const harness = await mount({ label: 'Approve' });

  // Partial by contract: unlisted siblings are allowed and omitted children are
  // don't-care, so this asserts the interface without pinning the layout.
  await expect(harness).toMatchSemanticSnapshot(`
    - application:
        - text "ready"
        - button "Approve" [focused]
        - textbox "Message"
        - text /pressed 0/
  `);
});

test('stores and compares the whole tree', async () => {
  const harness = await mount({ label: 'Approve', greeting: 'stored' });

  // No argument: the serialized tree goes to
  // `__snapshots__/preset.test.tsx.tw-semantic.yaml` on the first run and is
  // compared against it afterwards.
  await expect(harness).toMatchSemanticSnapshot();
});

test('reports focus and state after physical input', async () => {
  const harness = await mount({ label: 'Approve' });
  const button = harness.getByRole('button', { name: 'Approve' });
  const message = harness.getByRole('textbox', { name: 'Message' });

  await expect(button).toHaveState({ focused: true });

  // A real Tab byte on stdin, not a call into the component.
  await harness.press('Tab');

  // The matchers poll, so no wait is needed between the keystroke and the
  // assertion on the tree it eventually produces.
  await expect(message).toBeFocused();
  await expect(button).toHaveState({ focused: false });
});

test('sees the result of a click through the matchers', async () => {
  const harness = await mount({ label: 'Approve' });

  await harness.getByRole('button', { name: 'Approve' }).click();

  await expect(harness).toHaveText('pressed 1');
});

test('types into the textbox and reads the value back', async () => {
  const harness = await mount({ label: 'Approve' });
  const message = harness.getByRole('textbox', { name: 'Message' });

  await harness.press('Tab');
  // Polling makes the wait an assertion: typing before the component has moved
  // focus would lose the keystrokes, in a real terminal just as much as here.
  await expect(message).toBeFocused();
  await harness.type('hi');

  await expect(message).toHaveText('hi');
  await expect(harness).toHaveText('> hi');
});

test('stores a cell snapshot of the painted screen', async () => {
  const harness = await mount({ label: 'Approve', greeting: 'cells' });

  // The second oracle: a semantic snapshot passes on a blank screen, because
  // the adapter publishes a tree nobody painted. This one cannot.
  await expect(harness).toMatchCellSnapshot();
});

test('fails a semantic snapshot that does not describe the component', async () => {
  const harness = await mount({ label: 'Approve' });

  await expect(
    expect(harness).toMatchSemanticSnapshot(
      `
      - application:
          - button "Publish"
    `,
      { timeout: 500 },
    ),
  ).rejects.toThrowError(/Publish/u);
});
