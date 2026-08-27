/**
 * `crashReport()` through both modes.
 *
 * A crash report answers "what did the session know when the program died
 * unexpectedly". Only one of the two modes can ever have one: a fixture is a
 * process and can die, while a mount shares the runner's process and its
 * "exits" are all requested by the harness. Asserting the null case is not
 * padding — it is the documented difference, and the thing a test author will
 * otherwise assume works the same in both.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { it as resourceAwareIt } from '@termwright/resource-broker/vitest';
import type { TerminalHarness } from '@termwright/driver';
import { launchInkFixture } from './fixture.js';
import { mountInk } from './mount.js';
import CounterApp from './testing/counter-app.mjs';

const CRASH_COMPONENT = new URL('./testing/crash-app.mjs', import.meta.url);
const SIZE = { columns: 44, rows: 10 } as const;
const fixtureIt = resourceAwareIt.resources({ terminals: 1, traceWriters: 0 });

const open: TerminalHarness[] = [];

afterEach(async () => {
  for (const harness of open.splice(0)) await harness.close();
});

describe('mountInk', () => {
  it('has no crash report while it is running', async () => {
    const harness = await mountInk(createElement(CounterApp, {}), SIZE);
    open.push(harness);

    expect(harness.crashReport()).toBeNull();
  });

  it('has none after a clean unmount either', async () => {
    const harness = await mountInk(createElement(CounterApp, {}), SIZE);

    await harness.close();

    expect(await harness.exit).toEqual({ code: 0, signal: null });
    expect(harness.crashReport()).toBeNull();
  });

  it('has none after a signal, which the harness asked for', async () => {
    const harness = await mountInk(createElement(CounterApp, {}), SIZE);
    open.push(harness);

    await harness.signal('INT');
    await harness.waitForExit();

    // A requested death is not a crash, however it is spelled.
    expect(harness.crashReport()).toBeNull();
  });
});

describe('launchInkFixture', () => {
  fixtureIt('reports what the session knew when the fixture died', async () => {
    const harness = await launchInkFixture({ component: CRASH_COMPONENT, ...SIZE });
    open.push(harness);

    expect(harness.crashReport()).toBeNull();

    // A real keystroke, and the fixture throws out of a timer where nothing
    // catches it — an exit the harness never asked for.
    await harness.press('a');
    const status = await harness.waitForExit();
    expect(status.code).not.toBe(0);

    const report = harness.crashReport();
    expect(report).not.toBeNull();
    expect(report?.exit).toEqual(status);
    // stderr shares the tty, so the stack is on screen.
    expect(report?.screenTail.join('\n')).toContain('boom from the fixture');
    // And the input that preceded it is remembered.
    expect(report?.recentInputs.at(-1)).toMatchObject({ kind: 'key' });
  });

  fixtureIt('has no report when the harness closed the fixture itself', async () => {
    const harness = await launchInkFixture({ component: CRASH_COMPONENT, ...SIZE });

    await harness.close();

    expect(harness.crashReport()).toBeNull();
  });
});
