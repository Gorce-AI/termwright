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
import { Box, Text } from 'ink';
import { Semantic } from '@termwright/ink';
import { afterEach, describe, expect, test } from '@termwright/test';
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
        - generic:
            - text "ready"
            - button "Approve"
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

test('moves application focus through physical input', async () => {
  const harness = await mount({ label: 'Approve' });
  // A real Tab byte on stdin, not a call into the component.
  await harness.press('Tab');
  await harness.waitForQuiet();

  await harness.type('x');
  await expect(harness).toHaveText('> x');
});

test('sees activation through the matchers', async () => {
  const harness = await mount({ label: 'Approve' });

  await harness.press('Enter');

  await expect(harness).toHaveText('pressed 1');
});

test('types into the textbox and reads the value back', async () => {
  const harness = await mount({ label: 'Approve' });
  await harness.press('Tab');
  await harness.waitForQuiet();
  await harness.type('hi');

  await expect(harness).toHaveText('> hi');
});

test('stores a cell snapshot of the painted screen', async () => {
  const harness = await mount({ label: 'Approve', greeting: 'cells' });

  // The second oracle: a semantic snapshot passes on a blank screen, because
  // the adapter publishes a tree nobody painted. This one cannot.
  await expect(harness).toMatchCellSnapshot();
});

test('publishes explicit interactive roles and accessible names without guessing', async () => {
  const harness = await mountInk(
    <Semantic role="dialog" name="Permission">
      <Box flexDirection="column">
        <Semantic role="textbox" name="Command"><Box><Text>deploy</Text></Box></Semantic>
        <Semantic role="button" name="Approve"><Box><Text>Approve</Text></Box></Semantic>
        <Semantic role="list" name="Targets">
          <Box>
            <Semantic role="listitem" name="Production"><Box><Text>Production</Text></Box></Semantic>
          </Box>
        </Semantic>
        <Semantic role="status" name="Ready"><Box><Text>Ready</Text></Box></Semantic>
        <Semantic role="alert" name="Review required"><Box><Text>Review required</Text></Box></Semantic>
      </Box>
    </Semantic>,
    SIZE,
  );
  open.push(harness);
  await harness.settled();

  for (const [role, name] of [
    ['dialog', 'Permission'],
    ['textbox', 'Command'],
    ['button', 'Approve'],
    ['list', 'Targets'],
    ['listitem', 'Production'],
    ['status', 'Ready'],
    ['alert', 'Review required'],
  ] as const) {
    await expect(harness.getByRole(role, { name })).toBeAttached();
  }
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

describe.sequential('test-scoped component harness ownership', () => {
  let adopted: InkHarness | undefined;

  test('attaches an existing component harness to the standard fixture', async ({ terminal }) => {
    adopted = await terminal.attach(
      await mountInk(createElement(CounterApp, { label: 'Attached' }), SIZE),
      { trace: 'off', command: ['<mountInk>'] },
    );

    expect(terminal.sessions).toEqual([adopted]);
    await expect(adopted).toHaveText('Attached');
  });

  test('closes an attached component harness when the preceding test ends', () => {
    expect(() => adopted?.screen()).toThrow(/closed/u);
  });
});
