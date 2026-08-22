/**
 * The `logs` passthrough.
 *
 * Neither harness collects anything itself — following a file is the driver's
 * job and reading the events is `@termwright/test`'s. What is ours is that the
 * option reaches `launchTerminal` from both entry points, which is exactly the
 * kind of one-line wiring that is easy to forget and invisible until someone's
 * log assertion silently never matches.
 *
 * The assertions are deliberately "a line arrives", not "these lines arrived in
 * this order": the driver's file follower currently re-emits the previous line
 * on the next append (reported, fix pending), and pinning the exact sequence
 * here would fail this package for a bug that is not its own.
 */

import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import type { AppLogEvent, TerminalHarness } from '@termwright/driver';
import { launchInkFixture } from './fixture.js';
import { mountInk } from './mount.js';
import CounterApp from './testing/counter-app.mjs';

const COMPONENT = new URL('./testing/counter-app.mjs', import.meta.url);
const SIZE = { columns: 40, rows: 10 } as const;

const open: TerminalHarness[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const harness of open.splice(0)) await harness.close();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

/** A log file that exists before the session starts, as a real one would. */
async function logFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'termwright-logs-'));
  directories.push(directory);
  const path = join(directory, 'app.log');
  await writeFile(path, '');
  return path;
}

/** Resolves with the first log entry whose line matches, or rejects on timeout. */
function nextMatchingLine(harness: TerminalHarness, needle: string, timeoutMs = 10_000): Promise<AppLogEvent> {
  return new Promise<AppLogEvent>((resolve, reject) => {
    const seen: string[] = [];
    const finish = (settle: () => void): void => {
      clearTimeout(timer);
      unsubscribe();
      settle();
    };
    const timer = setTimeout(() => {
      finish(() =>
        reject(
          new Error(
            `no log line containing ${JSON.stringify(needle)} arrived within ${timeoutMs} ms` +
              (seen.length === 0 ? ' (no lines at all)' : `; saw: ${JSON.stringify(seen)}`),
          ),
        ),
      );
    }, timeoutMs);
    timer.unref?.();
    const unsubscribe = harness.events.on('app-log', (entry) => {
      if (entry.line !== undefined) seen.push(entry.line);
      if (entry.line?.includes(needle) === true) finish(() => resolve(entry));
    });
  });
}

describe('logs passthrough', () => {
  it('follows a file for a mounted component', async () => {
    const path = await logFile();

    const harness = await mountInk(createElement(CounterApp, {}), {
      ...SIZE,
      logs: [{ path, label: 'app' }],
    });
    open.push(harness);

    const arrived = nextMatchingLine(harness, 'mounted component logged this');
    await appendFile(path, 'mounted component logged this\n');

    const entry = await arrived;
    expect(entry.source).toBe('file');
    expect(entry.label).toBe('app');
  });

  it('follows a file for a fixture process', async () => {
    const path = await logFile();

    const harness = await launchInkFixture({
      component: COMPONENT,
      ...SIZE,
      logs: [{ path, label: 'app' }],
    });
    open.push(harness);

    const arrived = nextMatchingLine(harness, 'fixture logged this');
    await appendFile(path, 'fixture logged this\n');

    const entry = await arrived;
    expect(entry.source).toBe('file');
    expect(entry.label).toBe('app');
  });

  it('does not let a mount capture the runner console by default', async () => {
    // A mount must not patch the process-wide console: it belongs to Vitest and
    // every other test in the file, not to this component session.
    const before = console.log;

    const harness = await mountInk(createElement(CounterApp, {}), SIZE);
    open.push(harness);

    expect(console.log).toBe(before);
  });

  it('leaves the option out when nobody asked for it', async () => {
    // The passthrough is conditional — a session that was given no `logs` must
    // not be handed an empty array, which the driver would read as "follow
    // nothing, but set the machinery up anyway".
    const harness = await mountInk(createElement(CounterApp, {}), SIZE);
    open.push(harness);

    const entries: AppLogEvent[] = [];
    harness.events.on('app-log', (entry) => entries.push(entry));
    await harness.press('Tab');
    await harness.waitForQuiet();

    expect(entries).toEqual([]);
  });
});
