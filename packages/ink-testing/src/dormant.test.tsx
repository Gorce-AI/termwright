/**
 * A mount must be invisible to the process hosting it.
 *
 * The adapter's dormant rule (design §4.1) says an uninstrumented process opens
 * nothing and emits nothing. `mountInk` instruments an application *inside* a
 * test runner, which makes the rule sharper rather than looser: the
 * instrumentation must reach the mounted component and stop there. A leaked
 * `TERMWRIGHT_ENDPOINT` would silently instrument every other process the suite
 * spawns; a patched console or a raw-moded `process.stdin` would leak into the
 * next test file.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { Box, Text } from 'ink';
import type { InkHarness } from './mount.js';
import { mountInk } from './mount.js';
import CounterApp from './testing/counter-app.mjs';

const open: InkHarness[] = [];

afterEach(async () => {
  for (const harness of open.splice(0)) await harness.close();
});

describe('process hygiene', () => {
  it('leaves no instrumentation in process.env', async () => {
    const before = { ...process.env };

    const harness = await mountInk(createElement(CounterApp, {}), { columns: 30, rows: 8 });
    open.push(harness);

    expect(harness.capabilities().semanticTree).toBe(true);
    for (const key of Object.keys(process.env)) {
      expect(key.startsWith('TERMWRIGHT_')).toBe(false);
    }
    expect({ ...process.env }).toEqual(before);

    await harness.close();
    open.length = 0;
    expect({ ...process.env }).toEqual(before);
  });

  it('does not touch the runner streams or the global console', async () => {
    const console_ = { log: console.log, error: console.error, warn: console.warn };
    const stdoutListeners = process.stdout.listenerCount('resize');
    const stdinRaw = process.stdin.isRaw;

    const harness = await mountInk(createElement(CounterApp, {}), { columns: 30, rows: 8 });
    open.push(harness);
    await harness.press('Tab');
    await harness.waitForStable();

    expect(console.log).toBe(console_.log);
    expect(console.error).toBe(console_.error);
    expect(console.warn).toBe(console_.warn);
    expect(process.stdout.listenerCount('resize')).toBe(stdoutListeners);
    expect(process.stdin.isRaw).toBe(stdinRaw);
  });

  it('gives each mount its own session, with no cross-talk', async () => {
    const first = await mountInk(createElement(CounterApp, { label: 'First' }), { columns: 30, rows: 8 });
    open.push(first);
    const second = await mountInk(createElement(CounterApp, { label: 'Second' }), { columns: 30, rows: 8 });
    open.push(second);

    expect(first.sessionId).not.toBe(second.sessionId);
    expect(first.screen().text()).toContain('First');
    expect(first.screen().text()).not.toContain('Second');

    await second.press('Enter');
    await second.waitForText('pressed 1');
    expect(first.screen().text()).toContain('pressed 0');
  });

  it('closes the semantic endpoint it opened', async () => {
    // The endpoint is a unix socket pair: a server and a connection, both held
    // by the process. Leaving either behind makes a whole suite hang at exit,
    // which is the hardest kind of leak to attribute later.
    const pipes = (): number =>
      process.getActiveResourcesInfo().filter((resource) => resource === 'PipeWrap').length;
    const before = pipes();

    const harness = await mountInk(
      createElement(Box, null, createElement(Text, null, 'transient')),
      { columns: 20, rows: 5 },
    );
    expect(pipes()).toBeGreaterThan(before);

    await harness.close();
    await new Promise((resolve) => setImmediate(resolve));

    expect(pipes()).toBe(before);
    await expect(harness.exit).resolves.toEqual({ code: 0, signal: null });
  });
});
