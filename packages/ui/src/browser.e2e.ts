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
 * Four things this view does that have each cost someone an afternoon:
 *
 * - **Assert terminal content mid-recording, never at the end.** An Ink archive
 *   replayed to its last byte leaves the alternate screen, so the final frame
 *   is blank and an assertion there is asserting on nothing.
 * - **Seeking is asynchronous.** The position lands on the next frame, so read
 *   it through `expect.poll`, never with a single read after the click.
 * - **A seek loads a log window, which appends marks to the track.** A
 *   `.marker` locator can therefore resolve to a different element when you
 *   click than when you measured; bind to one `elementHandle()` if both matter.
 * - **The last marker in DOM order is not the last in time** — log marks render
 *   after the trace's own. To reach the end of a recording, click the track's
 *   right edge (`x + width - 1`; `x + width` is a pixel outside it and lands on
 *   the neighbouring control).
 *
 * Run: `pnpm --filter @termwright/ui run test:browser`
 */

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { buildCrashedFixtureTrace, buildFixtureTrace } from './__fixtures__/build-trace.js';
import { RUN_MANIFEST_VERSION, writeRunManifest, type RunManifest } from './runs.js';
import { writeInlineReport } from './inline-report.js';
import { startUiServer, type UiServer } from './server.js';

const APP_DIR = fileURLToPath(new URL('../dist/app', import.meta.url));

let browser: Browser;
const servers: UiServer[] = [];
const pages: Page[] = [];

/** Starts a server with the given options and returns a page pointed at it. */
async function serve(
  options: Parameters<typeof startUiServer>[0],
): Promise<{ server: UiServer; page: Page }> {
  const server = await startUiServer(options);
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
  return { server, page };
}

/** Opens an archive in post-mortem mode and returns a page pointed at it. */
async function open(trace: string): Promise<Page> {
  return (await serve({ trace })).page;
}

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

    // A page opened on an archive lands in the runner; the list of specs is
    // its own place now, and this is the walk to it.
    await page.locator(testId('nav-specs')).click();
    expect(await textOf(page, testId('test-counts'))).not.toBe('');
    expect(await page.locator(testId('specs')).isVisible()).toBe(true);
    // Specs lists files; the tests inside one appear when it is opened.
    await page.locator(testId('spec-file')).first().click();
    await expect.poll(() => page.locator(testId('test')).count()).toBeGreaterThan(0);
  });

  it('travels in time from the timeline', async () => {
    const page = await open(await buildFixtureTrace());

    const before = await textOf(page, testId('clock'));

    // The strip carries a marker per step, semantic revision and notable log,
    // and the earliest of those sits at 0ms — jump to the last one, which is
    // the only click guaranteed to move the clock.
    // The markers moved onto the track itself when the strip and the slider
    // were merged; a separate strip is what made them drift.
    const markers = page.locator(`${testId('scrub')} .marker`);
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

    // Move to the end of the recording. The last marker in DOM order is not
    // the last in time (log marks render after the trace's own), so this asks
    // the track for its right edge instead.
    const track = await page.locator(testId('scrub')).boundingBox();
    if (track === null) throw new Error('the track has no layout');
    await page.mouse.click(track.x + track.width - 1, track.y + track.height / 2);

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

    // Wait for the archive to be open — the crash panel, if there were one,
    // renders with the rest of the runner.
    await page.locator(testId('scrub')).waitFor({ state: 'attached', timeout: 15_000 });
    expect(await page.locator(testId('crash')).count()).toBe(0);
  });

  it('lists the commands the session ran', async () => {
    const page = await open(await buildFixtureTrace());

    // The command log is a pane of the runner now, not a tab beside the tree.

    await expect.poll(() => page.locator(testId('command')).count(), { timeout: 15_000 }).toBeGreaterThan(0);
    // The log names the test it belongs to and counts how the run went, the
    // way a runner heads the thing it is running.
    expect(await page.locator(testId('log-title')).isVisible()).toBe(true);
    expect(await textOf(page, testId('log-counts'))).toMatch(/\d/);
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

    // The run reports a test in `src/login.test.ts`, so the spec appears.
    await expect
      .poll(() => textOf(page, testId('specs')), { timeout: 15_000 })
      .toContain('login.test.ts');

    server.hub.publish({
      v: 1,
      type: 'test-end',
      id: 't1',
      status: 'failed',
      durationMs: 12,
      flaky: false,
      lostLogRecords: 0,
      error: 'button stayed disabled',
    });

    await expect.poll(() => textOf(page, testId('test-counts')), { timeout: 15_000 }).toMatch(/\d/);

    // Rerun one test, then the whole run, then stop.
    await page.locator(testId('spec-file')).first().click();
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

/**
 * Discovery lists a project's tests before anything has run, so the runner is
 * useful the moment it opens. The listing is injected rather than shelling out
 * to Vitest: this suite is about the browser, not about a subprocess.
 */
describe('the runner UI with discovered tests', () => {
  const listing = JSON.stringify([
    { name: 'approves the command', file: '/repo/permission.test.ts' },
    { name: 'rejects the command', file: '/repo/permission.test.ts' },
  ]);

  it('shows tests that have not run, and reruns one on click', async () => {
    const reruns: (readonly string[] | undefined)[] = [];

    const { page } = await serve({
      discovery: { cwd: '/repo', run: async () => listing },
      onRerun: (testIds) => reruns.push(testIds),
    });

    // Specs lists files; a file shows its tests when opened.
    await page.locator(testId('spec-file')).first().waitFor({ timeout: 15_000 });
    await page.locator(testId('spec-file')).first().click();
    await expect.poll(() => page.locator(testId('test')).count(), { timeout: 15_000 }).toBe(2);
    expect(await textOf(page, testId('specs'))).toContain('approves the command');

    // A discovered row is explicitly *not* a result, and says so.
    await expect.poll(() => page.locator('.badge.not-run').count()).toBeGreaterThan(0);

    await page.locator(testId('test')).first().click();
    await expect.poll(() => reruns.length, { timeout: 15_000 }).toBe(1);
    expect(reruns[0]).toEqual(['/repo/permission.test.ts::approves the command']);
  });

  it('reconciles a discovered row with the result that follows it', async () => {
    const { server, page } = await serve({
      discovery: { cwd: '/repo', run: async () => listing },
    });

    await page.locator(testId('spec-file')).first().waitFor({ timeout: 15_000 });
    await page.locator(testId('spec-file')).first().click();
    await expect.poll(() => page.locator(testId('test')).count(), { timeout: 15_000 }).toBe(2);

    // A run resets results, not the project: the discovered rows survive
    // `run-start` and go back to "not run yet", because those tests still exist
    // and the user still wants to click them while the run goes.
    server.hub.publish({ v: 1, type: 'run-start', mode: 'live', startedAt: Date.now() });

    await expect.poll(() => page.locator(testId('test')).count(), { timeout: 15_000 }).toBe(2);
    expect(await page.locator('.badge.not-run').count()).toBe(2);

    // Same file and title as a discovered row: this is that test running, not a
    // third one. Two rows for one test is the bug this asserts against.
    server.hub.publish({
      v: 1,
      type: 'test-start',
      id: 't1',
      title: 'approves the command',
      file: '/repo/permission.test.ts',
      startedAt: Date.now(),
    });

    await expect
      .poll(() => page.locator('.badge.not-run').count(), { timeout: 15_000 })
      .toBe(1);
    expect(await page.locator(testId('test')).count()).toBe(2);
  });

  it('keeps the listing for a tab that connects mid-run', async () => {
    const { server } = await serve({
      discovery: { cwd: '/repo', run: async () => listing },
    });

    // The listing has to survive the backlog reset a run performs, or a tab
    // opened after the run started sees an empty project.
    server.hub.publish({ v: 1, type: 'run-start', mode: 'live', startedAt: Date.now() });

    const late = await browser.newPage();
    pages.push(late);
    Object.assign(late, { __errors: [] });
    await late.goto(server.url, { waitUntil: 'domcontentloaded' });

    // The listing is the file the tab can see; opening it shows both tests.
    await late.locator(testId('spec-file')).first().waitFor({ timeout: 15_000 });
    await late.locator(testId('spec-file')).first().click();
    await expect.poll(() => late.locator(testId('test')).count(), { timeout: 15_000 }).toBe(2);
  });
});

/**
 * Run history: finished runs are read back from disk, and a test in one of them
 * can put its own archive on screen.
 */
describe('the runner UI showing run history', () => {
  async function writeRuns(traceRef: string): Promise<string> {
    const runsDir = await mkdtemp(join(tmpdir(), 'termwright-ui-runs-'));
    const base = {
      v: RUN_MANIFEST_VERSION,
      summary: { total: 1, passed: 0, failed: 1, skipped: 0, flaky: 0, durationMs: 3_000 },
    } as const;

    await writeRunManifest(runsDir, {
      ...base,
      id: '2026-08-16T10-00-00',
      startedAt: Date.parse('2026-08-16T10:00:00Z'),
      finishedAt: Date.parse('2026-08-16T10:00:04Z'),
      tests: [
        {
          id: 't1',
          title: 'approves the command',
          file: 'permission.test.ts',
          status: 'failed',
          durationMs: 120,
          flaky: false,
          // This run's log was lossy, which the row warns about without
          // pretending the failure above was caused by it.
          lostLogRecords: 7,
          traceRef,
          error: 'button stayed disabled',
        },
      ],
    } satisfies RunManifest);

    await writeRunManifest(runsDir, {
      ...base,
      id: '2026-08-16T11-00-00',
      startedAt: Date.parse('2026-08-16T11:00:00Z'),
      finishedAt: Date.parse('2026-08-16T11:00:03Z'),
      summary: { total: 1, passed: 1, failed: 0, skipped: 0, flaky: 0, durationMs: 3_000 },
      tests: [
        {
          id: 't1',
          title: 'approves the command',
          file: 'permission.test.ts',
          status: 'passed',
          durationMs: 98,
          flaky: false,
          lostLogRecords: 0,
        },
      ],
    } satisfies RunManifest);

    return runsDir;
  }

  it('lists past runs and opens the archive a failed test left', async () => {
    const crashed = await buildCrashedFixtureTrace();
    const { page } = await serve({ runsDir: await writeRuns(crashed) });

    await page.locator(testId('nav-runs')).click();
    await expect.poll(() => page.locator(testId('run')).count(), { timeout: 15_000 }).toBe(2);

    // History is newest first, and it is the *older* run whose test failed and
    // kept an archive — so this is `.last()`, not `.first()`.
    await page.locator(testId('run')).last().click();
    await expect
      .poll(() => page.locator(testId('run-test')).count(), { timeout: 15_000 })
      .toBeGreaterThan(0);
    expect(await textOf(page, testId('run-detail'))).toContain('approves the command');

    // Clicking the test that kept an archive puts that recording on screen,
    // which is the entire point of keeping the reference.
    await page.locator(testId('run-test')).first().click();

    await expect.poll(() => page.locator(testId('crash')).count(), { timeout: 20_000 }).toBe(1);

    await page.locator(testId('runs-back')).click();
    await expect.poll(() => page.locator(testId('run')).count(), { timeout: 15_000 }).toBe(2);
  });

  it('warns on a test whose log lost records, without restating its result', async () => {
    const { page } = await serve({ runsDir: await writeRuns(await buildFixtureTrace()) });

    await page.locator(testId('nav-runs')).click();
    await page.locator(testId('run')).last().click();
    const row = page.locator(testId('run-test')).first();
    await row.waitFor();

    // The warning is about the evidence, so it sits beside the status rather
    // than replacing it: this test failed, and its log is also incomplete.
    await expect.poll(async () => (await row.innerText()).trim()).toContain('logs incomplete');
    expect(await row.locator('.badge.lost-logs').getAttribute('title')).toContain('7 application log records');
    expect(await row.locator('.dot.failed').count()).toBe(1);

    // The other run lost nothing and says nothing.
    await page.locator(testId('runs-back')).click();
    await page.locator(testId('run')).first().click();
    const clean = page.locator(testId('run-test')).first();
    await clean.waitFor();
    expect(await clean.locator('.badge.lost-logs').count()).toBe(0);
  });
});

/** Theme, the shortcuts sheet, and the draggable splitters. */
describe('the runner UI chrome', () => {
  it('cycles the theme and remembers nothing the terminal should own', async () => {
    const page = await open(await buildFixtureTrace());

    const themeOf = async (): Promise<string | undefined> =>
      page.evaluate(() => document.documentElement.dataset['theme']);

    const before = await themeOf();
    await page.locator(testId('theme-toggle')).click();
    await expect.poll(themeOf).not.toBe(before);

    await page.locator(testId('theme-toggle')).click();
    await page.locator(testId('theme-toggle')).click();
    await expect.poll(themeOf).toBe(before); // system -> dark -> light -> system

    // The terminal stays dark in every theme on purpose: those colours belong
    // to the recorded program, not to the viewer's preference.
    expect(await page.locator('#terminal').count()).toBe(1);
  });

  it('opens the shortcuts sheet from the button and from `?`', async () => {
    const page = await open(await buildFixtureTrace());

    const visible = async (): Promise<boolean> => page.locator('#shortcuts').isVisible();

    await page.locator(testId('shortcuts-toggle')).click();
    await expect.poll(visible, { timeout: 15_000 }).toBe(true);

    await page.locator(testId('shortcuts-toggle')).click();
    await expect.poll(visible).toBe(false);

    await page.keyboard.press('?');
    await expect.poll(visible, { timeout: 15_000 }).toBe(true);
  });

  it('remembers a dragged splitter', async () => {
    const page = await open(await buildFixtureTrace());

    // localStorage survives between pages on one origin, so a test asserting a
    // default has to start from a known one.
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'domcontentloaded' });

    const splitOf = async (): Promise<string> =>
      page.evaluate(() => {
        const layout = document.querySelector<HTMLElement>('.layout');
        return layout === null ? '' : getComputedStyle(layout).getPropertyValue('--split-main').trim();
      });

    const before = await splitOf();

    const handle = page.locator('#split-main');
    const box = await handle.boundingBox();
    if (box === null) throw new Error('#split-main has no box — the layout did not render');

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();

    await expect.poll(splitOf, { timeout: 15_000 }).not.toBe(before);
    const dragged = await splitOf();

    // The point of persisting it: the layout survives a reload.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect.poll(splitOf, { timeout: 15_000 }).toBe(dragged);
  });
});

describe('the two-pane runner', () => {
  it('shows the meta bar the terminal is measured by', async () => {
    const page = await open(await buildFixtureTrace());
    // The size is the analogue of a browser's viewport control: a terminal
    // program's layout is a function of its columns, so this is the single
    // most useful fact about what is on screen.
    await expect.poll(() => textOf(page, testId('meta-size')), { timeout: 15_000 }).toMatch(/\d+×\d+/);
    // The revision is the analogue of the URL: it arrives with the tree, so
    // this waits for it rather than reading the bar the instant it exists.
    await expect
      .poll(() => textOf(page, testId('meta-bar')), { timeout: 15_000 })
      .toContain('revision');
  });

  it('points at what a command touched, without moving the replay', async () => {
    const page = await open(await buildFixtureTrace());
    const command = page.locator(`${testId('command')}`).last();
    await command.waitFor({ timeout: 15_000 });

    const clockBefore = await textOf(page, testId('clock'));
    await command.hover();

    // A highlight appears over the terminal, and the moment on screen does not
    // move: hovering asks a question, clicking makes a decision.
    await expect
      .poll(() => page.locator('.terminal .highlight, .terminal-highlight').count(), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(0);
    expect(await textOf(page, testId('clock'))).toBe(clockBefore);
  });

});

describe('the Specs view', () => {
  /** A project on disk with three specs and three runs behind them. */
  async function project(): Promise<{ cwd: string; runsDir: string; files: string[] }> {
    const cwd = await mkdtemp(join(tmpdir(), 'termwright-specs-'));
    const runsDir = join(cwd, '.termwright', 'runs');
    await mkdir(join(cwd, 'src', 'checkout'), { recursive: true });
    const files = ['src/login.test.ts', 'src/checkout/pay.test.ts', 'src/checkout/cart.test.ts'];
    for (const file of files) await writeFile(join(cwd, file), 'test', 'utf8');

    const tests = files.map((file, index) => ({
      id: `${file}::signs in`,
      title: 'signs in',
      file: join(cwd, file),
      status: index === 1 ? ('failed' as const) : ('passed' as const),
      durationMs: 100 + index * 100,
      flaky: false,
      lostLogRecords: 0,
    }));
    for (const [index, id] of ['2026-08-16T09-00-00', '2026-08-16T10-00-00'].entries()) {
      await writeRunManifest(runsDir, {
        v: RUN_MANIFEST_VERSION,
        id,
        startedAt: Date.parse('2026-08-16T09:00:00Z') + index * 3_600_000,
        finishedAt: Date.parse('2026-08-16T09:00:30Z') + index * 3_600_000,
        summary: { total: 3, passed: 2, failed: 1, skipped: 0, flaky: 0, durationMs: 3_000 },
        tests,
      });
    }
    return { cwd, runsDir, files };
  }

  it('groups specs by directory and says what the history knows about them', async () => {
    const { cwd, runsDir, files } = await project();
    const { page } = await serve({
      runsDir,
      discovery: {
        cwd,
        run: async () =>
          JSON.stringify(files.map((file) => ({ file: join(cwd, file), name: 'signs in' }))),
      },
    });

    await page.locator(testId('nav-specs')).click();
    // Directories, not a flat list of paths: `src` holds `checkout`.
    await expect
      .poll(() => page.locator(testId('spec-dir')).count(), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(2);
    const tree = await textOf(page, '.spec-tree');
    expect(tree).toContain('checkout');
    expect(tree).toContain('login.test.ts');
    // The prefix every path shares is not information.
    expect(tree).not.toContain(cwd);

    // A dot per past run, and a duration averaged from them.
    await expect
      .poll(() => page.locator(testId('spec-dot')).count(), { timeout: 20_000 })
      .toBeGreaterThan(0);
    expect(await textOf(page, '.spec-tree')).toMatch(/\d+ms|\d+\.\d+s/);
  });

  it('counts what a search matches', async () => {
    const { cwd, runsDir, files } = await project();
    const { page } = await serve({
      runsDir,
      discovery: {
        cwd,
        run: async () =>
          JSON.stringify(files.map((file) => ({ file: join(cwd, file), name: 'signs in' }))),
      },
    });

    await page.locator(testId('nav-specs')).click();
    await page.locator(testId('spec-file')).first().waitFor({ timeout: 20_000 });
    await page.locator(testId('spec-filter')).fill('checkout');

    await expect.poll(() => textOf(page, testId('spec-matches'))).toBe('2 matches');
    expect(await textOf(page, '.spec-tree')).not.toContain('login.test.ts');
  });
});

describe('recording a session from the panel', () => {
  it('records, shows what it wrote, and writes nothing until asked', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'termwright-rec-'));
    const { page } = await serve({
      discovery: { cwd, run: async () => JSON.stringify([]) },
    });

    await page.locator(testId('new-spec')).click();
    // A command with no spaces to quote: the point is the flow, not the shell.
    await page.locator(testId('record-command')).fill('node -e process.stdin.resume()');
    await page.locator(testId('record-out')).fill(join(cwd, 'recorded.test.ts'));
    await page.locator(testId('record-start')).click();

    // Recording is a state you cannot miss, and it says so in a word rather
    // than only in a colour.
    await expect.poll(() => page.locator(testId('recording')).count(), { timeout: 20_000 }).toBe(1);
    expect(await textOf(page, testId('recording'))).toContain('REC');

    await page.locator(testId('stop-recording')).click();

    // The test it wrote is shown before anything happens to it.
    await page.locator(testId('record-result')).waitFor({ timeout: 20_000 });
    const source = await textOf(page, testId('record-source'));
    expect(source).toContain("import { test } from '@termwright/test'");
    expect(source).toContain('terminal.launch');

    // Nothing is on disk yet: stopping is not saving.
    await expect(readFile(join(cwd, 'recorded.test.ts'), 'utf8')).rejects.toThrow();

    await page.locator(testId('record-save')).click();
    await expect
      .poll(async () => readFile(join(cwd, 'recorded.test.ts'), 'utf8').catch(() => ''), {
        timeout: 20_000,
      })
      .toContain('@termwright/test');
  });
});

describe('the Runs view', () => {
  it('names a run by the commit it was made at, and says so when there was none', async () => {
    const runsDir = await mkdtemp(join(tmpdir(), 'termwright-cards-'));
    const tests = [
      {
        id: 't1',
        title: 'pays',
        file: '/repo/src/pay.test.ts',
        status: 'failed' as const,
        durationMs: 300,
        flaky: false,
        lostLogRecords: 0,
      },
    ];
    await writeRunManifest(runsDir, {
      v: RUN_MANIFEST_VERSION,
      id: '2026-08-16T10-00-00',
      startedAt: Date.parse('2026-08-16T10:00:00Z'),
      finishedAt: Date.parse('2026-08-16T10:00:12Z'),
      summary: { total: 1, passed: 0, failed: 1, skipped: 0, flaky: 1, durationMs: 12_000 },
      tests,
      git: {
        commit: '9f2b1c4e8a7d6f5b3c2a1e0d9f8b7a6c5d4e3f21',
        message: 'checkout: retry a flaky payment step',
        author: 'Ada Lovelace',
        branch: 'feature/checkout',
      },
    });
    await writeRunManifest(runsDir, {
      v: RUN_MANIFEST_VERSION,
      id: '2026-08-16T09-00-00',
      startedAt: Date.parse('2026-08-16T09:00:00Z'),
      finishedAt: Date.parse('2026-08-16T09:00:09Z'),
      summary: { total: 1, passed: 1, failed: 0, skipped: 0, flaky: 0, durationMs: 9_000 },
      tests: tests.map((test) => ({ ...test, status: 'passed' as const })),
    });

    const { page } = await serve({ runsDir });
    await page.locator(testId('nav-runs')).click();
    await expect.poll(() => page.locator(testId('run')).count(), { timeout: 20_000 }).toBe(2);

    // A run is remembered by what you were working on, not by a timestamp.
    const cards = await textOf(page, testId('runs'));
    expect(cards).toContain('checkout: retry a flaky payment step');
    expect(cards).toContain('9f2b1c4');
    expect(cards).toContain('feature/checkout');
    expect(cards).toContain('Ada Lovelace');
    expect(await textOf(page, testId('run-flaky'))).toContain('flaky');

    // A checkout with no repository says that, rather than showing blanks.
    expect(cards).toContain('no commit recorded');
  });
});

describe('Settings', () => {
  it('says what it resolved and where each value came from', async () => {
    const page = await open(await buildFixtureTrace());
    await page.locator(testId('nav-settings')).click();

    const settings = await textOf(page, testId('settings'));
    // The point of the page is answering "why is it behaving like this".
    expect(settings).toContain('Project');
    expect(settings).toContain('package.json');
    expect(settings).toContain('Branch');
    expect(await page.locator(testId('editor-choice')).isVisible()).toBe(true);
  });
});

describe('the viewer emitted as a self-contained report', () => {
  /**
   * The point of the inline source: the same bundle, the same components, one
   * file, no server. Opened over `file://` so nothing can quietly answer a
   * request the report is supposed to carry with it.
   */
  it('replays an archive from a file:// page with no server behind it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'termwright-report-'));
    const out = join(directory, 'report.html');
    await writeInlineReport(await buildFixtureTrace(), out);

    const page = await browser.newPage();
    pages.push(page);
    const failed: string[] = [];
    page.on('requestfailed', (request) => failed.push(request.url()));
    await page.goto(`file://${out}`);

    await expect
      .poll(() => page.locator('#terminal').innerText(), { timeout: 15_000 })
      .toContain('Permission required');

    // The archive is there to scrub, not merely to render once.
    const markers = page.locator(`${testId('scrub')} .marker`);
    await expect.poll(() => markers.count(), { timeout: 15_000 }).toBeGreaterThan(0);
    const before = await textOf(page, testId('clock'));
    await markers.last().click();
    await expect.poll(() => textOf(page, testId('clock'))).not.toBe(before);

    // A report holds one recording, so it must not offer a history tab that
    // could only ever fail.
    // A report holds one recording, so the history is not a place it can go.
    expect(await page.locator(testId('nav-runs')).count()).toBe(0);
    expect(failed).toEqual([]);
  });
});

describe('the playback track', () => {
  /**
   * Added by impl-ui with the fix for the drift the owner reported: the marker
   * strip and the native range thumb were positioned by different geometries,
   * so a marker and the thumb agreed at the left edge and drifted apart towards
   * the right. They now share one element and one time→position function, and
   * this pins that at both edges and the middle, where the old bug was largest.
   */
  const thumbCentre = (page: Page): Promise<number> =>
    page.evaluate(() => {
      const thumb = document.querySelector('.track .thumb');
      if (thumb === null) return Number.NaN;
      const rect = thumb.getBoundingClientRect();
      return rect.left + rect.width / 2;
    });

  it('puts the thumb exactly where the pointer went down, at both edges and the middle', async () => {
    const page = await open(await buildFixtureTrace());
    const track = page.locator(testId('scrub'));
    // Wait for the archive: until the overview arrives there is no duration to
    // seek within, and the drift measured would be measuring the wrong thing.
    await page.locator(`${testId('scrub')} .marker`).first().waitFor();

    for (const fraction of [0, 0.5, 1]) {
      const box = await track.boundingBox();
      if (box === null) throw new Error('the track has no layout');
      // `x + width` is one pixel *outside* the element and lands on the button
      // beside it, which seeks somewhere else entirely. Stay inside.
      const x = Math.min(box.x + box.width * fraction, box.x + box.width - 1);
      await page.mouse.click(x, box.y + box.height / 2);

      // Seeking is asynchronous — the position lands on the next frame, so this
      // waits for it rather than reading a thumb that has not moved yet.
      await expect.poll(async () => Math.abs((await thumbCentre(page)) - x) <= 1).toBe(true);
    }
  });

  it('lands the thumb on the marker that was clicked', async () => {
    const page = await open(await buildFixtureTrace());
    await page.locator('.track .marker').last().waitFor();
    // Bind to one element, not to a locator. Seeking loads the log window around
    // the new moment, which appends log marks to the track, so a re-resolved
    // `.last()` is a different marker after the click than the one measured
    // before it — the comparison would then be between two unrelated positions.
    const marker = await page.locator('.track .marker').last().elementHandle();
    if (marker === null) throw new Error('the track has no markers');
    const box = await marker.boundingBox();
    if (box === null) throw new Error('the marker has no layout');
    const centre = box.x + box.width / 2;
    await marker.click();

    await expect.poll(async () => Math.abs(centre - (await thumbCentre(page))) <= 1).toBe(true);
  });
});
