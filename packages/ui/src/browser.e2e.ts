/**
 * The runner UI, in a real browser.
 *
 * Everything else in this package tests the server, the view models and the
 * panes as modules. This suite is the only thing that proves the built bundle
 * actually renders in a browser, against a real server serving a real
 * `.twtrace` archive — which is what this package's notes said was missing.
 *
 * It needs `dist/app` (`pnpm build`) and a Chromium (`playwright install
 * chromium`). Both absences throw rather than skip: a browser lane that quietly
 * passes having opened no browser is worse than no lane at all.
 *
 * Plain `playwright` with vitest's own assertions, deliberately — a second test
 * runner in this package would be a bigger cost than the matchers are worth.
 *
 * Run: `pnpm --filter @termwright/ui run test:browser`
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { buildCrashedFixtureTrace, buildFixtureTrace } from './__fixtures__/build-trace.js';
import { startUiServer, type UiServer } from './server.js';

const APP_DIR = fileURLToPath(new URL('../dist/app', import.meta.url));

let browser: Browser;
const servers: UiServer[] = [];
const pages: Page[] = [];

/** Opens an archive in post-mortem mode and returns a page pointed at it. */
async function open(trace: string): Promise<Page> {
  const server = await startUiServer({ trace });
  servers.push(server);

  const page = await browser.newPage();
  pages.push(page);

  // A page that throws while rendering can still satisfy a wait, so an error
  // here fails the test that caused it rather than a later, unrelated one.
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  Object.assign(page, { __errors: errors });

  await page.goto(server.url, { waitUntil: 'domcontentloaded' });
  return page;
}

/**
 * Assert terminal *content* against a moment inside the recording, never at the
 * end of one: an Ink archive replayed to its last byte leaves the alternate
 * buffer, so the final frame is a blank screen. A test that asserts there is
 * asserting on nothing.
 */

/** Text of an element, once it exists. */
async function textOf(page: Page, selector: string): Promise<string> {
  const element = page.locator(selector).first();
  await element.waitFor({ state: 'attached', timeout: 15_000 });
  return (await element.innerText()).trim();
}

const testId = (id: string): string => `[data-testid="${id}"]`;

beforeAll(async () => {
  if (!existsSync(APP_DIR)) {
    throw new Error(`${APP_DIR} is missing — run \`pnpm --filter @termwright/ui run build\` first.`);
  }
  browser = await chromium.launch();
}, 120_000);

afterEach(() => {
  for (const page of pages) {
    const errors = (page as unknown as { __errors?: string[] }).__errors ?? [];
    if (errors.length > 0) throw new Error(`browser reported errors:\n${errors.join('\n')}`);
  }
});

afterAll(async () => {
  for (const server of servers.splice(0)) await server.close();
  await browser?.close();
});

describe('the runner UI in a browser', () => {
  it('renders the three panes', async () => {
    const page = await open(await buildFixtureTrace());

    // xterm.js creates its own DOM once attached; the other two are ours.
    await expect
      .poll(() => page.locator('#terminal .xterm, #terminal canvas').count(), { timeout: 15_000 })
      .toBeGreaterThan(0);
    expect(await page.locator('#inspector').isVisible()).toBe(true);
    expect(await page.locator('#timeline').isVisible()).toBe(true);

    // The recording has to reach the terminal, not merely the DOM.
    await expect
      .poll(() => page.locator('#terminal').innerText(), { timeout: 15_000 })
      .toContain('Permission required');
  });

  it('lists the tests and their counts', async () => {
    const page = await open(await buildFixtureTrace());

    expect(await textOf(page, testId('test-counts'))).not.toBe('');
    expect(await page.locator(testId('tests')).isVisible()).toBe(true);
    await expect.poll(() => page.locator(testId('test')).count()).toBeGreaterThan(0);
  });

  it('travels in time from the timeline', async () => {
    const page = await open(await buildFixtureTrace());

    const before = await textOf(page, testId('clock'));

    // The strip carries a marker per step, semantic revision and notable log,
    // and the earliest of those sits at 0ms — jump to the last one, which is
    // the only click guaranteed to move the clock.
    const markers = page.locator(`${testId('markers')} button`);
    await expect.poll(() => markers.count(), { timeout: 15_000 }).toBeGreaterThan(0);
    await markers.last().click();

    await expect.poll(() => textOf(page, testId('clock'))).not.toBe(before);

    // Time travel reconstructs the screen: this line only exists after the step.
    await expect
      .poll(() => page.locator('#terminal').innerText(), { timeout: 15_000 })
      .toContain('running: ls -la');
  });

  it('shows the log panel, with both log sources, bounded by the current moment', async () => {
    const page = await open(await buildFixtureTrace());

    await page.locator(testId('tab-logs')).click();
    await expect.poll(() => page.locator(testId('log')).count(), { timeout: 15_000 }).toBeGreaterThan(0);

    expect(await page.locator(testId('log-count')).isVisible()).toBe(true);
    expect(await page.locator(testId('log-filter')).isVisible()).toBe(true);

    // The panel is on the same timeline as everything else: at 0ms only the
    // line recorded at 0ms is in scope.
    const atStart = await textOf(page, testId('logs'));
    expect(atStart).toContain('listening on 3000'); // tailed file, t=0
    expect(atStart).not.toContain('pool exhausted'); // adapter record, t=1050

    // Move to the end of the recording, and the later record appears.
    await page.locator(`${testId('markers')} button`).last().click();

    await expect
      .poll(() => textOf(page, testId('logs')), { timeout: 15_000 })
      .toContain('pool exhausted');
  });

  it('shows the crash panel for a session that died on its own', async () => {
    const page = await open(await buildCrashedFixtureTrace());

    const crash = await textOf(page, testId('crash'));
    expect(crash).toContain('died on its own');
    expect(crash).toContain('SIGSEGV');

    // The panel's whole point is getting to the moment it happened.
    await page.locator(testId('crash-seek')).click();
    await expect
      .poll(() => page.locator('#terminal').innerText(), { timeout: 15_000 })
      .toContain('panic:');
  });

  it('shows no crash panel for a session that exited cleanly', async () => {
    const page = await open(await buildFixtureTrace());

    await page.locator(testId('tests')).waitFor({ state: 'attached', timeout: 15_000 });
    expect(await page.locator(testId('crash')).count()).toBe(0);
  });

  it('lists the commands the session ran', async () => {
    const page = await open(await buildFixtureTrace());

    await page.locator(testId('tab-commands')).click();

    await expect.poll(() => page.locator(testId('command')).count(), { timeout: 15_000 }).toBeGreaterThan(0);
    expect(await page.locator(testId('command-count')).isVisible()).toBe(true);
  });

  it('plays the recording back and cycles the speed', async () => {
    const page = await open(await buildFixtureTrace());

    const play = page.locator(testId('play'));
    const speed = page.locator(testId('speed'));

    const speedBefore = await speed.innerText();
    await speed.click();
    await expect.poll(() => speed.innerText()).not.toBe(speedBefore);

    // Playback advances the same clock time travel moves; that shared clock is
    // the point, so assert on it rather than on the button's own label.
    const clockBefore = await textOf(page, testId('clock'));
    await play.click();
    await expect.poll(() => textOf(page, testId('clock')), { timeout: 15_000 }).not.toBe(clockBefore);

    await play.click(); // pause, so the page stops moving under the next assertion
  });
});

/**
 * Live mode, without a pty and without Vitest: the server is told about a run
 * through the same hub a reporter would publish into, and the browser's rerun
 * and stop buttons come back as `onRerun` / `onStop`. That round trip is the
 * whole contract between the page and whatever is driving it.
 */
describe('the runner UI against a live run', () => {
  it('renders a published run and sends the controls back', async () => {
    const reruns: (readonly string[] | undefined)[] = [];
    let stopped = 0;

    const server = await startUiServer({
      onRerun: (testIds) => reruns.push(testIds),
      onStop: () => {
        stopped += 1;
      },
    });
    servers.push(server);

    const page = await browser.newPage();
    pages.push(page);
    Object.assign(page, { __errors: [] });
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });

    server.hub.publish({ v: 1, type: 'run-start', mode: 'live', startedAt: Date.now() });
    server.hub.publish({
      v: 1,
      type: 'test-start',
      id: 't1',
      title: 'approves the command',
      file: 'src/login.test.ts',
      startedAt: Date.now(),
    });

    await expect
      .poll(() => textOf(page, testId('tests')), { timeout: 15_000 })
      .toContain('approves the command');

    server.hub.publish({
      v: 1,
      type: 'test-end',
      id: 't1',
      status: 'failed',
      durationMs: 12,
      flaky: false,
      error: 'button stayed disabled',
    });

    await expect.poll(() => textOf(page, testId('test-counts')), { timeout: 15_000 }).toMatch(/\d/);

    // Rerun one test, then the whole run, then stop.
    await page.locator(testId('rerun-one')).first().click();
    await expect.poll(() => reruns.length, { timeout: 15_000 }).toBe(1);
    expect(reruns[0]).toEqual(['t1']);

    await page.locator(testId('rerun')).click();
    await expect.poll(() => reruns.length, { timeout: 15_000 }).toBe(2);
    expect(reruns[1]).toBeUndefined(); // no ids = the whole run

    await page.locator(testId('stop')).click();
    await expect.poll(() => stopped, { timeout: 15_000 }).toBe(1);
  });
});
