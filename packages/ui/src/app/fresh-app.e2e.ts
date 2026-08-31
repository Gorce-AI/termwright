import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import {
  buildCrashedFixtureTrace,
  buildFixtureTrace,
  FIXTURE_TREES,
} from '../__fixtures__/build-trace.js';
import { writeNativeRunFixture } from '../__fixtures__/native-run.js';
import { writeInlineReport } from '../inline-report.js';
import { startUiServer, type UiServer } from '../server.js';
import { FakeSession, frameworkContract, node, snapshot } from '../__fixtures__/fake-session.js';
import { createRunId } from '@termwright/protocol';

const APP_DIR = fileURLToPath(new URL('../../dist/app', import.meta.url));
let browser: Browser;
const servers: UiServer[] = [];
const pages: Page[] = [];
const temporaryDirectories: string[] = [];

beforeAll(async () => {
  if (!existsSync(APP_DIR)) throw new Error(`${APP_DIR} is missing; build the fresh app first`);
  browser = await chromium.launch();
});

afterEach(async () => {
  for (const page of pages.splice(0)) await page.close();
});

afterAll(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const directory of temporaryDirectories.splice(0))
    await rm(directory, { recursive: true, force: true });
  await browser.close();
});

async function tracePage(trace: string): Promise<Page> {
  const server = await startUiServer({ trace });
  servers.push(server);
  const page = await checkedPage();
  await page.goto(server.url, { waitUntil: 'domcontentloaded' });
  return page;
}

async function checkedPage(): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('requestfailed', (request) =>
    errors.push(`${request.failure()?.errorText ?? 'request failed'} ${request.url()}`),
  );
  pages.push(page);
  Object.assign(page, { __errors: errors });
  return page;
}

it('renders a canonical partial-skip verdict as yellow without relying on skipped attempt events', async () => {
  const server = await startUiServer();
  servers.push(server);
  const page = await checkedPage();
  await page.goto(server.url, { waitUntil: 'domcontentloaded' });
  server.hub.publish({
    v: 1,
    type: 'run-start',
    runId: 'run:yellow',
    mode: 'live',
    startedAt: Date.now(),
  });
  server.hub.publish({
    v: 1,
    type: 'run-end',
    summary: {
      verdict: 'passed-with-skips',
      total: 2,
      passed: 1,
      failed: 0,
      skipped: 0,
      flaky: 0,
      durationMs: 1,
    },
  });

  await expect
    .poll(() => page.locator('.tw-run-skip-warning').textContent())
    .toContain('not plain-green certification');
  expect(
    await page
      .locator('.tw-run-skip-warning')
      .evaluate((element) => getComputedStyle(element).color),
  ).not.toBe('rgb(88, 230, 176)');
});

describe('fresh React runner', () => {
  it('distinguishes initialization failure from a valid empty project', async () => {
    const failedServer = await startUiServer();
    servers.push(failedServer);
    const failed = await checkedPage();
    await failed.route('**/api/state?**', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{"error":"state unavailable"}',
      }),
    );
    await failed.goto(failedServer.url, { waitUntil: 'domcontentloaded' });
    const alert = failed.getByRole('alert');
    await alert.waitFor();
    expect(await alert.innerText()).toContain('Termwright could not initialize');
    expect(await alert.innerText()).toContain('state unavailable');
    expect(await failed.locator('.tw-shell').count()).toBe(0);

    const emptyServer = await startUiServer();
    servers.push(emptyServer);
    const empty = await checkedPage();
    await empty.goto(emptyServer.url, { waitUntil: 'domcontentloaded' });
    await expect
      .poll(() => empty.locator('.tw-connection-dot').getAttribute('data-connected'))
      .toBe('true');
    await empty.getByRole('button', { name: 'Specs', exact: true }).click();
    expect(await empty.getByText('No matching owned tests', { exact: true }).count()).toBe(1);
    expect(await empty.getByText('0 total', { exact: true }).count()).toBe(1);
    expect(await empty.getByRole('button', { name: /Run all 0 cases/u }).isDisabled()).toBe(true);
    expect(
      (failed as unknown as { __errors: string[] }).__errors.filter(
        (error) => !error.includes('500'),
      ),
    ).toEqual([]);
    expect((empty as unknown as { __errors: string[] }).__errors).toEqual([]);
  });

  it('keeps contextual replays exact and independent across browser tabs', async () => {
    const normal = await buildFixtureTrace();
    const crashed = await buildCrashedFixtureTrace();
    const server = await startUiServer();
    servers.push(server);
    const first = await checkedPage();
    const second = await checkedPage();
    await Promise.all([
      first.goto(server.url, { waitUntil: 'domcontentloaded' }),
      second.goto(server.url, { waitUntil: 'domcontentloaded' }),
    ]);
    const startedAt = Date.now();
    server.hub.publish({ v: 1, type: 'run-start', runId: 'run:test', mode: 'live', startedAt });
    for (const [id, title, traceRef, status] of [
      ['normal-case', 'normal historical flow', normal, 'passed'],
      ['crash-case', 'crashed historical flow', crashed, 'failed'],
    ] as const) {
      server.hub.publish({
        v: 1,
        type: 'test-start',
        id,
        title,
        file: `/repo/${id}.test.ts`,
        startedAt,
      });
      server.hub.publish({
        v: 1,
        type: 'test-end',
        id,
        status,
        durationMs: 20,
        flaky: false,
        lostLogRecords: 0,
        traceRef,
      });
    }
    server.hub.publish({
      v: 1,
      type: 'run-end',
      summary: {
        verdict: 'failed',
        total: 2,
        passed: 1,
        failed: 1,
        skipped: 0,
        flaky: 0,
        durationMs: 20,
      },
    });
    await expect.poll(() => first.locator('.tw-case-button').count()).toBe(2);
    await expect.poll(() => second.locator('.tw-case-button').count()).toBe(2);
    await first.locator('.tw-case-button').filter({ hasText: 'normal historical flow' }).click();
    await second.locator('.tw-case-button').filter({ hasText: 'crashed historical flow' }).click();
    await Promise.all([
      first.locator('.tw-replay-controls').waitFor({ timeout: 15_000 }),
      second.locator('.tw-replay-controls').waitFor({ timeout: 15_000 }),
    ]);
    expect(
      await first.locator('.tw-terminal-viewport').getAttribute('data-terminal-identity'),
    ).toBe(`replay:${normal}`);
    expect(
      await second.locator('.tw-terminal-viewport').getAttribute('data-terminal-identity'),
    ).toBe(`replay:${crashed}`);
    await second
      .getByLabel('Replay position')
      .fill((await second.getByLabel('Replay position').getAttribute('max')) ?? '0');
    await expect.poll(() => second.locator('.tw-terminal-viewport').innerText()).toContain('panic');
    expect(await first.locator('.tw-terminal-viewport').innerText()).toContain(
      'Permission required',
    );

    const liveStartedAt = startedAt + 100;
    server.hub.publish({
      v: 1,
      type: 'run-start',
      runId: 'run:test',
      mode: 'live',
      startedAt: liveStartedAt,
    });
    server.hub.publish({
      v: 1,
      type: 'test-start',
      id: 'live-case',
      title: 'new live flow',
      file: '/repo/live.test.ts',
      startedAt: liveStartedAt,
      sessionId: 'live-session',
    });
    server.hub.publish({
      v: 1,
      type: 'session',
      sessionId: 'live-session',
      testId: 'live-case',
      terminalProfile: 'default',
      columns: 80,
      rows: 24,
    });
    server.hub.publish({
      v: 1,
      type: 'output',
      sessionId: 'live-session',
      dataB64: Buffer.from('LIVE ONLY\r\n').toString('base64'),
      t: 1,
    });
    await first.locator('.tw-case-button').filter({ hasText: 'new live flow' }).click();
    await expect
      .poll(() => first.locator('.tw-terminal-viewport').getAttribute('data-terminal-identity'))
      .toContain('live:');
    await expect
      .poll(() => first.locator('.tw-terminal-viewport').innerText())
      .toContain('LIVE ONLY');
    expect(
      await second.locator('.tw-terminal-viewport').getAttribute('data-terminal-identity'),
    ).toBe(`replay:${crashed}`);
    expect(await second.locator('.tw-terminal-viewport').innerText()).toContain('panic');
    expect((first as unknown as { __errors: string[] }).__errors).toEqual([]);
    expect((second as unknown as { __errors: string[] }).__errors).toEqual([]);
  });

  it('switches a multi-session terminal and inspector together with descriptive labels', async () => {
    const server = await startUiServer();
    servers.push(server);
    const page = await checkedPage();
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await expect
      .poll(() => page.locator('.tw-connection-dot').getAttribute('data-connected'))
      .toBe('true');
    const startedAt = Date.now();
    server.hub.publish({ v: 1, type: 'run-start', runId: 'run:test', mode: 'live', startedAt });
    server.hub.publish({
      v: 1,
      type: 'test-start',
      id: 'multi',
      title: 'launches two terminals',
      file: '/repo/multi.test.ts',
      startedAt,
    });
    const publishSession = (
      sessionId: string,
      framework: string,
      profile: string,
      columns: number,
      rows: number,
      text: string,
      nodeName: string,
    ) => {
      server.hub.publish({
        v: 1,
        type: 'session',
        sessionId,
        testId: 'multi',
        terminalProfile: profile,
        contract: frameworkContract(sessionId, framework, '1.0.0', profile),
        adapterStatus: 'attached',
        columns,
        rows,
      });
      server.hub.publish({
        v: 1,
        type: 'output',
        sessionId,
        dataB64: Buffer.from(`${text}\r\n`).toString('base64'),
        t: 1,
      });
      server.hub.publish({
        v: 1,
        type: 'semantic',
        sessionId,
        revision: 1,
        snapshot: {
          v: 2,
          sessionId,
          revision: 1,
          columns,
          rows,
          rootIds: ['root'],
          nodes: [
            {
              id: 'root',
              role: 'status',
              name: nodeName,
              geometry: {
                displayed: {
                  status: 'known',
                  value: true,
                  evidence: {
                    source: 'framework',
                    method: 'native',
                    strength: 'authoritative',
                    providerId: 'ui-e2e',
                  },
                },
                intendedRect: {
                  status: 'known',
                  value: { row: 0, column: 0, width: 10, height: 1 },
                  evidence: {
                    source: 'framework',
                    method: 'native',
                    strength: 'authoritative',
                    providerId: 'ui-e2e',
                  },
                },
                visibleRect: {
                  status: 'known',
                  value: { row: 0, column: 0, width: 10, height: 1 },
                  evidence: {
                    source: 'framework',
                    method: 'native',
                    strength: 'authoritative',
                    providerId: 'ui-e2e',
                  },
                },
              },
            },
          ],
          coordinateSpace: {
            status: 'known',
            value: 'viewport-cells',
            evidence: {
              source: 'framework',
              method: 'native',
              strength: 'authoritative',
              providerId: 'ui-e2e',
            },
          },
          hitGrid: {
            status: 'unsupported',
            capability: 'pointer-hit-grid',
            reason: 'framework-unobservable',
          },
        },
      });
    };
    publishSession('opaque-a', 'Ink', 'unicode', 80, 24, 'FIRST SCREEN', 'First inspector');
    publishSession('opaque-b', 'OpenTUI', 'wide', 100, 30, 'SECOND SCREEN', 'Second inspector');
    const selector = page.getByLabel('Terminal session');
    await expect.poll(() => selector.locator('option').count()).toBe(2);
    expect(await selector.locator('option').allTextContents()).toEqual([
      'Ink · unicode · 80×24 · #1',
      'OpenTUI · wide · 100×30 · #2',
    ]);
    expect((await selector.locator('option').allTextContents()).join(' ')).not.toContain('opaque-');
    await page.getByRole('button', { name: 'Expand inspector' }).click();
    await expect
      .poll(() => page.locator('.tw-terminal-viewport').innerText())
      .toContain('SECOND SCREEN');
    await expect
      .poll(() => page.getByRole('treeitem', { name: /Second inspector/u }).count())
      .toBe(1);
    await selector.selectOption(
      (await selector.locator('option').first().getAttribute('value')) ?? '',
    );
    await expect
      .poll(() => page.locator('.tw-terminal-viewport').innerText())
      .toContain('FIRST SCREEN');
    expect(await page.locator('.tw-terminal-viewport').innerText()).not.toContain('SECOND SCREEN');
    await expect
      .poll(() => page.getByRole('treeitem', { name: /First inspector/u }).count())
      .toBe(1);
    expect(await page.getByRole('treeitem', { name: /Second inspector/u }).count()).toBe(0);
    expect((page as unknown as { __errors: string[] }).__errors).toEqual([]);
  });

  it('uses one roving tab stop and the complete ARIA key map in the semantic tree', async () => {
    const server = await startUiServer();
    servers.push(server);
    const page = await checkedPage();
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    const startedAt = Date.now();
    server.hub.publish({ v: 1, type: 'run-start', runId: 'run:tree', mode: 'live', startedAt });
    server.hub.publish({
      v: 1,
      type: 'test-start',
      id: 'tree-case',
      title: 'tree navigation',
      file: '/repo/tree.test.ts',
      startedAt,
      sessionId: 'tree-session',
    });
    const session = new FakeSession('tree-session');
    server.attach({ source: session });
    const nodes = [
      node({ id: 'root', role: 'dialog', name: 'Root' }),
      node({ id: 'first', parentId: 'root', role: 'button', name: 'First child' }),
      node({ id: 'last', parentId: 'root', role: 'button', name: 'Last child' }),
    ];
    session.semantic(snapshot(1, nodes, session.sessionId));
    await page.getByRole('button', { name: 'Expand inspector' }).click();
    const tree = page.getByRole('tree', { name: 'Semantic tree' });
    await expect.poll(() => tree.getByRole('treeitem').count()).toBe(3);
    expect(await tree.locator('[role="treeitem"][tabindex="0"]').count()).toBe(1);
    expect(
      await tree
        .locator('button:not([disabled]), [role="treeitem"]')
        .evaluateAll((items) => items.filter((item) => (item as HTMLElement).tabIndex >= 0).length),
    ).toBe(1);
    await tree.getByRole('treeitem', { name: /Root/u }).focus();
    await page.keyboard.press('ArrowDown');
    expect(
      await tree.getByRole('treeitem', { name: /First child/u }).getAttribute('aria-selected'),
    ).toBe('true');
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.textContent))
      .toContain('First child');
    await page.keyboard.press('End');
    expect(
      await tree.getByRole('treeitem', { name: /Last child/u }).getAttribute('aria-selected'),
    ).toBe('true');
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.textContent))
      .toContain('Last child');
    await page.keyboard.press('Home');
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.textContent))
      .toContain('Root');
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => tree.getByRole('treeitem').count()).toBe(1);
    await expect
      .poll(() => tree.getByRole('treeitem', { name: /Root/u }).getAttribute('aria-expanded'))
      .toBe('false');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => tree.getByRole('treeitem').count()).toBe(3);
    session.semantic(snapshot(2, nodes, session.sessionId));
    await expect.poll(() => tree.locator('[role="treeitem"][tabindex="0"]').count()).toBe(1);
    expect(await tree.getByRole('treeitem', { name: /Root/u }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect((page as unknown as { __errors: string[] }).__errors).toEqual([]);
  });

  it('shows live Can click/hover/focus/type answers from the production planner', async () => {
    const server = await startUiServer();
    servers.push(server);
    const page = await checkedPage();
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    const startedAt = Date.now();
    server.hub.publish({ v: 1, type: 'run-start', runId: 'run:test', mode: 'live', startedAt });
    server.hub.publish({
      v: 1,
      type: 'test-start',
      id: 'planner-case',
      title: 'planner inspector',
      file: '/repo/planner.test.ts',
      startedAt,
      sessionId: 'planner-session',
    });
    const session = new FakeSession('planner-session');
    session.actionabilityPlanner = async (action, ref) => ({
      actionable: action !== 'hover',
      intent: { kind: action, targetRef: ref },
      checkpoint: {
        sessionId: session.sessionId,
        contractId: 'planner-session:0',
        epoch: 0,
        sequence: 12,
        screenRevision: 11,
        semanticRevision: 7,
        pairedScreenRevision: 11,
      },
      requirements: [],
      ...(action === 'hover'
        ? {
            reason: {
              code: 'input-mode-disabled',
              message: 'motion reporting is disabled',
              targetRef: ref,
            },
          }
        : { strategy: action === 'type' ? 'focused-keyboard-type' : 'production-plan' }),
    });
    server.attach({ source: session });
    session.semantic(
      snapshot(7, [node({ id: 'save', role: 'button', name: 'Save' })], session.sessionId),
    );
    await page.getByRole('button', { name: 'Expand inspector' }).click();
    await page.getByRole('tab', { name: 'Semantic' }).click();
    const actionability = page.getByRole('region', { name: 'Live actionability' });
    // The live semantic stream can replace the selected-node projection while
    // the four planner RPCs complete. Poll one coherent DOM projection instead
    // of mixing one awaited sentinel with three immediate reads from a later
    // render.
    await expect
      .poll(() => actionability.locator('li[data-actionable] header strong').allTextContents())
      .toEqual(['Can click?', 'Can hover?', 'Can focus?', 'Can type?']);
    await expect
      .poll(() =>
        actionability.getByText(/input-mode-disabled: motion reporting is disabled/u).count(),
      )
      .toBe(1);
    await expect
      .poll(() => actionability.getByText('revision 12', { exact: true }).count())
      .toBe(4);
    expect((page as unknown as { __errors: string[] }).__errors).toEqual([]);
  });

  it('lists canonical native runs with exact attempts and honest recording availability', async () => {
    const runsDir = await mkdtemp(join(tmpdir(), 'tw-fresh-runs-'));
    const startedAt = Date.now() - 5_000;
    const nativeRunId = await writeNativeRunFixture(runsDir, {
      startedAt,
      status: 'flaky',
      tests: [
        {
          title: 'passes after retry',
          file: '/repo/retried.test.ts',
          status: 'passed',
          durationMs: 600,
          retries: ['failed', 'passed'],
        },
        {
          title: 'missing recording',
          file: '/repo/missing.test.ts',
          status: 'failed',
          durationMs: 300,
        },
      ],
    });
    const server = await startUiServer({ runsDir });
    servers.push(server);
    const page = await checkedPage();
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Runs', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(escapeRegExp(nativeRunId), 'u') }).click();
    await expect
      .poll(() => page.getByText('Passed after a retry', { exact: true }).count())
      .toBe(1);
    expect(
      await page
        .locator('.tw-history-tests article')
        .filter({ hasText: 'missing recording' })
        .locator('small')
        .filter({ hasText: /1 attempt$/u })
        .count(),
    ).toBe(1);
    await page.getByText('2 exact attempts', { exact: true }).click();
    expect(await page.getByText(/retry 0/u).count()).toBe(1);
    expect(await page.getByText(/retry 1/u).count()).toBe(1);
    expect(
      await page.getByText('Recording not retained in native manifest', { exact: true }).count(),
    ).toBe(2);
    expect(await page.getByRole('button', { name: 'Replay', exact: true }).count()).toBe(0);
    expect((page as unknown as { __errors: string[] }).__errors).toEqual([]);
  });

  it('records live input, reviews before writing, and saves or discards explicitly', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'termwright-recorder-ui-'));
    temporaryDirectories.push(directory);
    const program = join(directory, 'recorder-fixture.mjs');
    const saved = join(directory, 'saved.test.ts');
    const discarded = join(directory, 'discarded.test.ts');
    await writeFile(
      program,
      [
        'process.stdin.setEncoding("utf8");',
        'process.stdout.write("recorder ready\\n");',
        'process.stdin.on("data", (data) => process.stdout.write(`received ${data}`));',
        'setInterval(() => undefined, 1_000);',
      ].join('\n'),
      'utf8',
    );

    const server = await startUiServer();
    servers.push(server);
    const page = await checkedPage();
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await expect
      .poll(() => page.locator('.tw-connection-dot').getAttribute('data-connected'))
      .toBe('true');
    await page.getByRole('button', { name: 'Specs', exact: true }).click();

    const openRecorder = async () => {
      await page.getByRole('button', { name: /New test/u }).click();
      await page.getByRole('menuitem', { name: 'Record test' }).click();
      await page.getByRole('dialog', { name: 'Record a terminal test' }).waitFor();
    };
    await openRecorder();
    const startDialog = page.getByRole('dialog', { name: 'Record a terminal test' });
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute('placeholder')))
      .toContain('node');
    await startDialog.getByRole('button', { name: 'Close recorder' }).focus();
    await page.keyboard.press('Shift+Tab');
    // Start is disabled until a command exists, so Cancel is the last
    // keyboard-reachable control in this state.
    expect(await page.evaluate(() => document.activeElement?.textContent)).toContain('Cancel');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe(
      'Close recorder',
    );
    await page.keyboard.press('Escape');
    await expect.poll(() => startDialog.count()).toBe(0);

    const record = async (outFile: string) => {
      await openRecorder();
      await page
        .getByLabel('Command')
        .fill(`${JSON.stringify(process.execPath)} ${JSON.stringify(program)}`);
      await page.getByLabel('Save destination').fill(outFile);
      await page.getByRole('button', { name: 'Start recording' }).click();
      const stop = page.getByRole('button', { name: 'Stop recording' });
      await stop.waitFor({ timeout: 15_000 });
      await expect.poll(() => stop.isEnabled()).toBe(true);
      await expect
        .poll(() => page.locator('.tw-terminal-viewport').innerText())
        .toContain('recorder ready');
      await page.locator('.xterm-helper-textarea').focus();
      await page.keyboard.type('hello');
      await page.keyboard.press('Enter');
      await expect
        .poll(() => page.locator('.tw-terminal-viewport').innerText())
        .toContain('received hello');
      await page.getByPlaceholder('Name the next step').fill('submit permission');
      await page.getByRole('button', { name: 'Add step' }).click();
      await page.getByRole('button', { name: 'Assert snapshot' }).click();
      await stop.click();
      const review = page.getByRole('dialog', { name: 'Generated test' });
      await review.waitFor();
      await expect.poll(() => review.innerText()).toContain('submit permission');
      return review;
    };

    const review = await record(saved);
    expect(existsSync(saved)).toBe(false);
    expect(await page.evaluate(() => document.activeElement?.textContent)).toContain('Save');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.textContent)).toContain('Discard');
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => document.activeElement?.textContent)).toContain('Save');
    await review.getByRole('button', { name: /Save to/u }).click();
    await expect.poll(() => existsSync(saved)).toBe(true);
    const generated = await readFile(saved, 'utf8');
    expect(generated).toContain('submit permission');
    expect(generated).toContain('type input withheld by recorder policy');
    expect(generated).not.toContain('hello');
    expect(generated).toContain('await expect(app).toMatchSemanticSnapshot();');

    await record(discarded);
    expect(existsSync(discarded)).toBe(false);
    await page.keyboard.press('Escape');
    await expect.poll(() => page.getByRole('dialog', { name: 'Generated test' }).count()).toBe(0);
    expect(existsSync(discarded)).toBe(false);
    await expect
      .poll(() => page.getByText('Recording discarded; no file was written.').count())
      .toBe(1);
    expect((page as unknown as { __errors: string[] }).__errors).toEqual([]);
  });

  it('opens an initial trace exactly once and reaches replay', async () => {
    const page = await tracePage(await buildFixtureTrace());
    await page.locator('.tw-replay-controls').waitFor({ timeout: 15_000 });
    expect(await page.locator('.tw-case').count()).toBe(1);
    expect(await page.locator('.tw-terminal-viewport').getAttribute('data-terminal-columns')).toBe(
      '80',
    );
    const position = page.getByLabel('Replay position');
    const maximum = (await position.getAttribute('max')) ?? '0';
    await position.fill(maximum);
    await page.getByRole('button', { name: 'Replay from start' }).click();
    await expect
      .poll(async () => Number(await position.inputValue()))
      .toBeLessThan(Number(maximum));
    const runsNav = page.getByRole('button', { name: 'Runs', exact: true });
    await runsNav.hover();
    await page.getByRole('tooltip', { name: 'Runs' }).waitFor();
    await runsNav.focus();
    expect(await page.getByRole('tooltip', { name: 'Runs' }).count()).toBe(1);
    await page.keyboard.press('Escape');
    expect(await page.getByRole('tooltip', { name: 'Runs' }).count()).toBe(0);
    expect(
      await page.locator('.tw-toast').filter({ hasText: 'Opening retained recording' }).count(),
    ).toBe(0);
    expect((page as unknown as { __errors: string[] }).__errors).toEqual([]);
  });

  it('previews and pins exact semantic target bounds without reflow', async () => {
    const page = await tracePage(await buildFixtureTrace());
    await page.locator('.tw-replay-controls').waitFor({ timeout: 15_000 });
    const command = page
      .locator('.tw-command-row[data-kind="action"]')
      .filter({ hasText: 'click' });
    await command.hover();
    const overlay = page.locator('.tw-terminal-highlight[data-target-ref="semantic:b1@1"]');
    await overlay.waitFor();
    const geometry = await page.evaluate(() => {
      const screen = document.querySelector<HTMLElement>('.xterm-screen')?.getBoundingClientRect();
      const target = document
        .querySelector<HTMLElement>('.tw-terminal-highlight')
        ?.getBoundingClientRect();
      const viewport = document
        .querySelector<HTMLElement>('.tw-terminal-viewport')
        ?.getBoundingClientRect();
      return {
        widthDelta:
          screen === undefined || target === undefined
            ? 999
            : Math.abs(target.width - (screen.width * 9) / 80),
        heightDelta:
          screen === undefined || target === undefined
            ? 999
            : Math.abs(target.height - screen.height / 24),
        contained:
          target !== undefined &&
          viewport !== undefined &&
          target.left >= viewport.left &&
          target.right <= viewport.right &&
          target.top >= viewport.top &&
          target.bottom <= viewport.bottom,
      };
    });
    expect(geometry.widthDelta).toBeLessThan(2);
    expect(geometry.heightDelta).toBeLessThan(2);
    expect(geometry.contained).toBe(true);
    await page.locator('.tw-machine-bar').hover();
    expect(await overlay.count()).toBe(0);

    await command.click();
    await page.locator('.tw-machine-bar').hover();
    expect(
      await page
        .locator('.tw-terminal-highlight[data-pinned="true"][data-target-ref="semantic:b1@1"]')
        .count(),
    ).toBe(1);
    await page.keyboard.press('Escape');
    expect(await page.locator('.tw-terminal-highlight-layer').count()).toBe(0);

    await page.getByRole('button', { name: 'Expand inspector' }).click();
    const semanticButton = page.getByRole('treeitem', { name: /Approve/u });
    await semanticButton.hover();
    expect(
      await page.locator('.tw-terminal-highlight[data-target-ref="semantic:b1@1"]').count(),
    ).toBe(1);
    await semanticButton.click();
    await page.locator('.tw-machine-bar').hover();
    expect(await page.locator('.tw-terminal-highlight[data-pinned="true"]').count()).toBe(1);
    const replayPosition = page.getByLabel('Replay position');
    await replayPosition.fill((await replayPosition.getAttribute('max')) ?? '2000');
    await expect.poll(() => page.locator('.tw-terminal-highlight-layer').count()).toBe(0);
    expect((page as unknown as { __errors: string[] }).__errors).toEqual([]);
  });

  it('atomically switches a finished case from another replay and keeps its player visible', async () => {
    const firstTrace = await buildFixtureTrace();
    const secondTrace = await buildFixtureTrace();
    const page = await tracePage(firstTrace);
    await page.locator('.tw-replay-controls').waitFor({ timeout: 15_000 });
    const server = servers.at(-1) as UiServer;
    const startedAt = Date.now();
    server.hub.publish({ v: 1, type: 'run-start', runId: 'run:test', mode: 'live', startedAt });
    server.hub.publish({
      v: 1,
      type: 'test-start',
      id: 'finished-b',
      title: 'suite > finished B',
      file: '/tmp/finished-b.test.ts',
      startedAt,
    });
    server.hub.publish({
      v: 1,
      type: 'test-end',
      id: 'finished-b',
      status: 'passed',
      durationMs: 20,
      flaky: false,
      lostLogRecords: 0,
      traceRef: secondTrace,
    });
    server.hub.publish({
      v: 1,
      type: 'run-end',
      summary: {
        verdict: 'passed',
        total: 1,
        passed: 1,
        failed: 0,
        skipped: 0,
        flaky: 0,
        durationMs: 20,
      },
    });

    const second = page.locator('.tw-case-button').filter({ hasText: 'finished B' });
    await second.click();
    await page.locator('.tw-replay-controls').waitFor({ timeout: 15_000 });
    expect(await page.locator('.tw-terminal-viewport').getAttribute('data-terminal-identity')).toBe(
      `replay:${secondTrace}`,
    );
    expect(await page.locator('select[aria-label="Active execution"]').count()).toBe(0);
    expect(await page.locator('.tw-section-row').filter({ hasText: 'approve' }).count()).toBe(1);

    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 800, height: 800 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      if (viewport.width < 1100) await page.getByRole('tab', { name: 'Screen' }).click();
      const geometry = await page.evaluate(() => {
        const evidence = document
          .querySelector<HTMLElement>('.tw-evidence')
          ?.getBoundingClientRect();
        const player = document
          .querySelector<HTMLElement>('.tw-replay-controls')
          ?.getBoundingClientRect();
        return {
          insideEvidence:
            player !== undefined &&
            evidence !== undefined &&
            player.top >= evidence.top &&
            player.bottom <= evidence.bottom + 1,
          insideViewport:
            player !== undefined &&
            player.top >= 0 &&
            player.left >= 0 &&
            player.bottom <= window.innerHeight &&
            player.right <= window.innerWidth,
        };
      });
      expect(geometry.insideEvidence).toBe(true);
      expect(geometry.insideViewport).toBe(true);
    }
    expect((page as unknown as { __errors: string[] }).__errors).toEqual([]);
  });

  it('distinguishes actionless, missing and crashed retained evidence', async () => {
    const server = await startUiServer();
    servers.push(server);
    const page = await checkedPage();
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await expect
      .poll(() => page.locator('.tw-connection-dot').getAttribute('data-connected'))
      .toBe('true');
    const startedAt = Date.now();
    server.hub.publish({ v: 1, type: 'run-start', runId: 'run:test', mode: 'live', startedAt });
    server.hub.publish({
      v: 1,
      type: 'test-start',
      id: 'no-actions',
      title: 'suite > no actions',
      file: '/tmp/no-actions.test.ts',
      startedAt,
    });
    await expect
      .poll(() => page.getByRole('button', { name: 'Stop', exact: true }).count())
      .toBe(1);
    expect(await page.getByRole('button', { name: /Rerun no actions/ }).count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Record test' }).count()).toBe(0);
    server.hub.publish({
      v: 1,
      type: 'test-end',
      id: 'no-actions',
      status: 'passed',
      durationMs: 5,
      flaky: false,
      lostLogRecords: 0,
    });
    server.hub.publish({
      v: 1,
      type: 'run-end',
      summary: {
        verdict: 'passed',
        total: 1,
        passed: 1,
        failed: 0,
        skipped: 0,
        flaky: 0,
        durationMs: 5,
      },
    });
    await expect
      .poll(() =>
        page.getByText('No driver actions were recorded for this case.', { exact: false }).count(),
      )
      .toBe(1);
    expect(await page.getByRole('button', { name: /Rerun .*no actions/ }).count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Stop', exact: true }).count()).toBe(0);

    const missingStartedAt = startedAt + 10;
    server.hub.publish({
      v: 1,
      type: 'run-start',
      runId: 'run:test',
      mode: 'live',
      startedAt: missingStartedAt,
    });
    server.hub.publish({
      v: 1,
      type: 'test-start',
      id: 'missing',
      title: 'suite > missing trace',
      file: '/tmp/missing.test.ts',
      startedAt: missingStartedAt,
    });
    server.hub.publish({
      v: 1,
      type: 'test-end',
      id: 'missing',
      status: 'failed',
      durationMs: 4,
      flaky: false,
      lostLogRecords: 0,
      traceRef: '/tmp/does-not-exist.twtrace',
      error: 'test failed',
    });
    server.hub.publish({
      v: 1,
      type: 'run-end',
      summary: {
        verdict: 'failed',
        total: 1,
        passed: 0,
        failed: 1,
        skipped: 0,
        flaky: 0,
        durationMs: 4,
      },
    });
    const missing = page.locator('.tw-case-button').filter({ hasText: 'missing trace' });
    await missing.waitFor();
    if ((await missing.getAttribute('aria-expanded')) !== 'true') await missing.click();
    await expect
      .poll(() => page.getByText('Recording unavailable:', { exact: false }).count())
      .toBe(1);

    const crash = await buildCrashedFixtureTrace();
    const crashPage = await tracePage(crash);
    await crashPage.locator('.tw-replay-controls').waitFor({ timeout: 15_000 });
    await crashPage.getByText('Recorded process crashed', { exact: true }).waitFor();
    expect(await crashPage.getByText('signal SIGSEGV', { exact: true }).count()).toBe(1);
    const crashMarker = crashPage.locator('.tw-replay-marker[data-kind="crash"]');
    await crashMarker.click();
    const crashTime =
      Number((await crashMarker.getAttribute('aria-label'))?.match(/at ([0-9.]+)s/u)?.[1] ?? 0) *
      1_000;
    await expect
      .poll(async () => Number(await crashPage.getByLabel('Replay position').inputValue()))
      .toBeCloseTo(crashTime, -1);
    await expect
      .poll(() =>
        crashPage
          .getByText('No driver actions were recorded in this recording.', { exact: false })
          .count(),
      )
      .toBe(1);
    expect(await crashPage.locator('.tw-case-button').filter({ hasText: 'FAILED' }).count()).toBe(
      1,
    );
    await crashPage.getByRole('button', { name: 'Restart replay' }).click();
    await crashPage.getByRole('button', { name: 'Play replay' }).click();
    await expect
      .poll(() => crashPage.locator('.tw-terminal-viewport').innerText(), { timeout: 3_000 })
      .toContain('panic: runtime error');
    expect((crashPage as unknown as { __errors: string[] }).__errors).toEqual([]);
  });

  it('uses the whole desktop workspace and keeps evidence controls reachable', async () => {
    const page = await tracePage(await buildFixtureTrace());
    await page.locator('.tw-replay-controls').waitFor({ timeout: 15_000 });
    const metrics = await page.evaluate(() => {
      const box = (selector: string) =>
        document.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
      const terminal = document.querySelector<HTMLElement>('.tw-terminal-viewport');
      return {
        bodyOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        workspace: box('.tw-workspace')?.height ?? 0,
        evidence: box('.tw-evidence')?.height ?? 0,
        rail: box('.tw-execution-rail')?.height ?? 0,
        inspector: box('.tw-inspector')?.height ?? 0,
        scale: Number.parseFloat(terminal?.dataset['terminalScale'] ?? '0'),
        columns: terminal?.dataset['terminalColumns'],
        rows: terminal?.dataset['terminalRows'],
      };
    });
    expect(metrics.bodyOverflow).toBeLessThanOrEqual(0);
    expect(Math.min(metrics.evidence, metrics.rail)).toBeGreaterThan(metrics.workspace * 0.9);
    expect(metrics.inspector).toBe(0);
    expect(metrics.scale).toBeGreaterThan(0);
    const collapsedGeometry = await page.evaluate(() => {
      const workspace = document
        .querySelector<HTMLElement>('.tw-workspace')
        ?.getBoundingClientRect();
      const evidence = document.querySelector<HTMLElement>('.tw-evidence')?.getBoundingClientRect();
      const actions = document
        .querySelector<HTMLElement>('.tw-selected-outcome')
        ?.getBoundingClientRect();
      return {
        workspaceWidth: workspace?.width ?? 0,
        evidenceWidth: evidence?.width ?? 0,
        controlsInside:
          actions !== undefined &&
          evidence !== undefined &&
          actions.right <= evidence.right &&
          actions.left >= evidence.left,
      };
    });
    expect(collapsedGeometry.evidenceWidth).toBeGreaterThan(
      collapsedGeometry.workspaceWidth * 0.65,
    );
    expect(collapsedGeometry.controlsInside).toBe(true);

    await page.screenshot({ path: '/tmp/termwright-fresh-1440-collapsed.png', fullPage: false });
    await page.getByRole('button', { name: 'Expand navigation' }).click();
    await page.screenshot({ path: '/tmp/termwright-fresh-1440-nav-expanded.png', fullPage: false });
    await page.getByRole('button', { name: 'Collapse navigation' }).click();
    expect(await scrollEndIsReachable(page, '.tw-case-list', '.tw-scroll-end')).toBe(true);
    await page.getByRole('button', { name: 'Expand inspector' }).click();
    await expect.poll(() => page.locator('.tw-inspector').isVisible()).toBe(true);
    expect(
      await scrollEndIsReachable(page, '.tw-inspector-body', '.tw-inspector-body > :last-child'),
    ).toBe(true);
    await page.evaluate(async () => {
      await Promise.all(
        document.getAnimations().map(async (animation) => {
          await animation.finished.catch(() => undefined);
        }),
      );
    });
    const railDivider = page.locator('.tw-workspace-splitter');
    const beforeRailDrag = await railDivider.boundingBox();
    if (beforeRailDrag === null) throw new Error('rail divider missing');
    await page.mouse.move(beforeRailDrag.x + beforeRailDrag.width / 2, beforeRailDrag.y + 100);
    await page.mouse.down();
    await page.mouse.move(beforeRailDrag.x + beforeRailDrag.width / 2 + 10, beforeRailDrag.y + 100);
    await page.mouse.up();
    const afterRailDrag = await railDivider.boundingBox();
    expect(afterRailDrag?.x ?? 0).toBeGreaterThanOrEqual(beforeRailDrag.x + 8);
    expect(afterRailDrag?.x ?? 0).toBeLessThanOrEqual(beforeRailDrag.x + 12);

    const inspectorDivider = page.locator('.tw-inspector-splitter');
    const beforeInspectorDrag = await inspectorDivider.boundingBox();
    if (beforeInspectorDrag === null) throw new Error('inspector divider missing');
    await page.mouse.move(
      beforeInspectorDrag.x + beforeInspectorDrag.width / 2,
      beforeInspectorDrag.y + 100,
    );
    await page.mouse.down();
    await page.mouse.move(
      beforeInspectorDrag.x + beforeInspectorDrag.width / 2 + 10,
      beforeInspectorDrag.y + 100,
    );
    await page.mouse.up();
    const afterInspectorDrag = await inspectorDivider.boundingBox();
    expect(afterInspectorDrag?.x ?? 0).toBeGreaterThanOrEqual(beforeInspectorDrag.x + 8);
    expect(afterInspectorDrag?.x ?? 0).toBeLessThanOrEqual(beforeInspectorDrag.x + 12);
    await page.screenshot({ path: '/tmp/termwright-fresh-1440-three-pane.png', fullPage: false });
    await page.getByRole('button', { name: 'Collapse inspector' }).click();

    await page.getByRole('button', { name: 'Maximize' }).click();
    await expect.poll(() => page.locator('.tw-inspector').isVisible()).toBe(false);
    expect(await page.locator('.tw-replay-controls').isVisible()).toBe(true);
    expect(await page.locator('.tw-terminal-viewport').getAttribute('data-terminal-columns')).toBe(
      metrics.columns,
    );
    expect(await page.locator('.tw-terminal-viewport').getAttribute('data-terminal-rows')).toBe(
      metrics.rows,
    );
    await page.getByRole('button', { name: 'Restore' }).click();

    for (const viewport of [
      { width: 800, height: 800 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await expect.poll(() => page.locator('.tw-compact-tabs').isVisible()).toBe(true);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      await page.getByRole('tab', { name: 'Steps' }).click();
      expect(await scrollEndIsReachable(page, '.tw-case-list', '.tw-scroll-end')).toBe(true);
      await page.getByRole('tab', { name: 'Inspect' }).click();
      expect(
        await scrollEndIsReachable(page, '.tw-inspector-body', '.tw-inspector-body > :last-child'),
      ).toBe(true);
      await page.getByRole('tab', { name: 'Screen' }).click();
      expect(await page.locator('.tw-replay-controls').isVisible()).toBe(true);
      await page.screenshot({
        path: `/tmp/termwright-fresh-${viewport.width}.png`,
        fullPage: false,
      });
    }
    expect((page as unknown as { __errors: string[] }).__errors).toEqual([]);
  });

  it('fills the evidence stage with a fitted 60x10 terminal and keeps replay controls immediately visible', async () => {
    const page = await tracePage(await buildFixtureTrace({ columns: 60, rows: 10 }));
    await page.setViewportSize({ width: 1440, height: 1024 });
    await page.locator('.tw-replay-controls').waitFor({ timeout: 15_000 });
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const viewport = document
            .querySelector<HTMLElement>('.tw-terminal-viewport')
            ?.getBoundingClientRect();
          const screen = document
            .querySelector<HTMLElement>('.xterm-screen')
            ?.getBoundingClientRect();
          return viewport === undefined || screen === undefined
            ? 999
            : Math.min(viewport.width - screen.width, viewport.height - screen.height);
        }),
      )
      .toBeLessThan(45);
    const metrics = await page.evaluate(() => {
      const box = (selector: string) =>
        document.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
      const evidence = box('.tw-evidence');
      const machine = box('.tw-terminal-machine');
      const viewport = box('.tw-terminal-viewport');
      const screen = box('.xterm-screen');
      const player = box('.tw-replay-controls');
      const heading = box('.tw-evidence-heading');
      return {
        machineShare:
          evidence === undefined || machine === undefined ? 1 : machine.height / evidence.height,
        limitingGap:
          viewport === undefined || screen === undefined
            ? 999
            : Math.min(viewport.width - screen.width, viewport.height - screen.height),
        playerGap:
          machine === undefined || player === undefined ? 999 : player.top - machine.bottom,
        playerVisible:
          evidence !== undefined &&
          player !== undefined &&
          player.top >= evidence.top &&
          player.bottom <= evidence.bottom,
        fillsEvidence:
          evidence !== undefined &&
          player !== undefined &&
          Math.abs(evidence.bottom - player.bottom) < 2,
        fillsReservedRow:
          heading !== undefined &&
          machine !== undefined &&
          player !== undefined &&
          machine.top >= heading.bottom &&
          machine.bottom <= player.top,
        scale:
          document.querySelector<HTMLElement>('.tw-terminal-viewport')?.dataset['terminalScale'],
        measuredScale:
          screen === undefined
            ? 0
            : screen.width /
              (document.querySelector<HTMLElement>('.xterm-screen')?.offsetWidth ?? 1),
      };
    });
    expect(metrics.machineShare).toBeGreaterThan(0.75);
    expect(metrics.limitingGap).toBeLessThan(45);
    expect(Math.abs(metrics.playerGap)).toBeLessThan(12);
    expect(metrics.playerVisible).toBe(true);
    expect(metrics.fillsEvidence).toBe(true);
    expect(metrics.fillsReservedRow).toBe(true);
    expect(Number(metrics.scale)).toBeGreaterThan(0);
    expect(Math.abs(Number(metrics.scale) - metrics.measuredScale)).toBeLessThan(0.01);
    expect(await page.locator('.tw-fit-button').innerText()).toMatch(/^Fit · \d+%$/u);
    await page.screenshot({ path: '/tmp/termwright-fresh-60x10-1440.png', fullPage: false });
    for (const viewport of [
      { width: 800, height: 800 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.getByRole('tab', { name: 'Screen' }).click();
      expect(await page.locator('.tw-replay-controls').isVisible()).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
    }
    expect((page as unknown as { __errors: string[] }).__errors).toEqual([]);
  });

  it('moves an explicitly rerun settled case through LIVE session evidence into replay', async () => {
    const trace = await buildFixtureTrace();
    let requested: readonly string[] | undefined;
    let selectedTitle = '';
    const server = await startUiServer({
      trace,
      onRun: (ids) => {
        requested = ids;
        const startedAt = Date.now();
        server.hub.publish({ v: 1, type: 'run-start', runId: 'run:test', mode: 'live', startedAt });
        server.hub.publish({
          v: 1,
          type: 'test-start',
          id: 'rerun-runtime',
          title: selectedTitle,
          file: trace,
          startedAt,
        });
        setTimeout(() => {
          server.hub.publish({
            v: 1,
            type: 'session',
            sessionId: 'rerun-session',
            testId: 'rerun-runtime',
            terminalProfile: 'default',
            columns: 80,
            rows: 24,
          });
          server.hub.publish({
            v: 1,
            type: 'output',
            sessionId: 'rerun-session',
            dataB64: Buffer.from('LIVE rerun evidence\r\n').toString('base64'),
            t: 10,
          });
          server.hub.publish({
            v: 1,
            type: 'semantic',
            sessionId: 'rerun-session',
            revision: 1,
            snapshot: {
              ...(FIXTURE_TREES[0] as NonNullable<(typeof FIXTURE_TREES)[number]>),
              sessionId: 'rerun-session',
            },
          });
          server.hub.publish({
            v: 1,
            type: 'action-start',
            actionId: 'a-live',
            api: 'press',
            t: 12,
            testId: 'rerun-runtime',
            sessionId: 'rerun-session',
          });
        }, 40);
        setTimeout(() => {
          server.hub.publish({
            v: 1,
            type: 'action',
            actionId: 'a-live',
            kind: 'action',
            api: 'press',
            t: 80,
            ok: true,
            testId: 'rerun-runtime',
            sessionId: 'rerun-session',
            ref: 'semantic:b1@1',
          });
        }, 500);
        setTimeout(() => {
          server.hub.publish({
            v: 1,
            type: 'test-end',
            id: 'rerun-runtime',
            status: 'passed',
            durationMs: 100,
            flaky: false,
            lostLogRecords: 0,
            traceRef: trace,
          });
          server.hub.publish({
            v: 1,
            type: 'run-end',
            summary: {
              verdict: 'passed',
              total: 1,
              passed: 1,
              failed: 0,
              skipped: 0,
              flaky: 0,
              durationMs: 100,
            },
          });
        }, 1_200);
        return { runId: createRunId('run'), completed: Promise.resolve() };
      },
    });
    servers.push(server);
    const page = await checkedPage();
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await page.locator('.tw-replay-controls').waitFor({ timeout: 15_000 });
    selectedTitle = (await page.locator('.tw-case-title strong').innerText()).trim();
    await page
      .getByRole('button', { name: new RegExp(`^Rerun ${escapeRegExp(selectedTitle)}$`, 'u') })
      .click();

    await expect.poll(() => page.locator('.tw-evidence-pill').innerText()).toContain('LIVE');
    expect(requested).toEqual(['trace:trace-session']);
    await expect
      .poll(() => page.locator('.tw-terminal-viewport').innerText())
      .toContain('LIVE rerun evidence');
    await expect
      .poll(() => page.locator('[data-node-id="action:rerun-session:a-live"]').count())
      .toBe(1);
    await page.getByRole('button', { name: 'Expand inspector' }).click();
    await expect.poll(() => page.locator('.tw-semantic-node-row').count()).toBeGreaterThan(0);
    const liveCommand = page.locator('[data-node-id="action:rerun-session:a-live"]');
    await expect.poll(() => liveCommand.getAttribute('data-status')).toBe('passed');
    await liveCommand.hover();
    await expect
      .poll(() => page.locator('.tw-terminal-highlight[data-target-ref="semantic:b1@1"]').count())
      .toBe(1);
    await liveCommand.click();
    await page.locator('.tw-machine-bar').hover();
    expect(await page.locator('.tw-terminal-highlight[data-pinned="true"]').count()).toBe(1);

    await page.locator('.tw-replay-controls').waitFor({ timeout: 5_000 });
    expect(await page.locator('.tw-case[data-selected="true"]').count()).toBe(1);
    expect((page as unknown as { __errors: string[] }).__errors).toEqual([]);
  });

  it('keeps per-case collapse state through live updates and independent selection', async () => {
    const server = await startUiServer();
    servers.push(server);
    const page = await checkedPage();
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await expect
      .poll(() => page.locator('.tw-connection-dot').getAttribute('data-connected'))
      .toBe('true');
    const startedAt = Date.now();
    server.hub.publish({ v: 1, type: 'run-start', runId: 'run:test', mode: 'live', startedAt });
    server.hub.publish({
      v: 1,
      type: 'test-start',
      id: 'alpha',
      title: 'suite > alpha case',
      file: '/tmp/alpha.test.ts',
      startedAt,
    });
    server.hub.publish({
      v: 1,
      type: 'test-start',
      id: 'beta',
      title: 'suite > beta case',
      file: '/tmp/beta.test.ts',
      startedAt: startedAt + 1,
    });
    const alpha = page.locator('.tw-case-button').filter({ hasText: 'alpha case' });
    const beta = page.locator('.tw-case-button').filter({ hasText: 'beta case' });
    await alpha.waitFor();

    expect(await alpha.getAttribute('aria-expanded')).toBe('true');
    await alpha.click();
    expect(await alpha.getAttribute('aria-expanded')).toBe('false');
    server.hub.publish({
      v: 1,
      type: 'action-start',
      actionId: 'live-a1',
      api: 'press',
      t: 20,
      testId: 'alpha',
    });

    // A collapsed case renders no command rows, so alpha's own update is not
    // observable while it stays collapsed — waiting on one would wait forever.
    // Beta is expanded and the stream is ordered, so beta's row is proof that
    // alpha's update was applied before it, and alpha is still collapsed.
    await beta.click();
    expect(await beta.getAttribute('aria-expanded')).toBe('true');
    server.hub.publish({
      v: 1,
      type: 'action-start',
      actionId: 'live-b1',
      api: 'press',
      t: 21,
      testId: 'beta',
    });
    await expect.poll(() => page.locator('.tw-command-row').count()).toBe(1);
    expect(await alpha.getAttribute('aria-expanded')).toBe('false');
    await alpha.click();
    expect(await alpha.getAttribute('aria-expanded')).toBe('true');
    expect(await beta.getAttribute('aria-expanded')).toBe('true');
    expect((page as unknown as { __errors: string[] }).__errors).toEqual([]);
  });

  it('keeps running evidence steel-blue until authoritative pass', async () => {
    const server = await startUiServer();
    servers.push(server);
    const page = await checkedPage();
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await expect
      .poll(() => page.locator('.tw-connection-dot').getAttribute('data-connected'))
      .toBe('true');
    const startedAt = Date.now();
    server.hub.publish({ v: 1, type: 'run-start', runId: 'run:test', mode: 'live', startedAt });
    server.hub.publish({
      v: 1,
      type: 'test-start',
      id: 'status-live',
      title: 'status suite > stays running',
      file: '/tmp/status.test.ts',
      startedAt,
    });
    server.hub.publish({
      v: 1,
      type: 'action-start',
      actionId: 'a1',
      api: 'press',
      t: 10,
      testId: 'status-live',
    });
    const runningCase = page.locator('.tw-case[data-status="running"]');
    await runningCase.waitFor();
    expect(
      await runningCase.locator('.tw-status[data-status="running"] .lucide-loader-circle').count(),
    ).toBe(1);
    expect(
      await runningCase
        .locator('.tw-status')
        .evaluate((element) => getComputedStyle(element).color),
    ).toBe('rgb(103, 183, 209)');
    expect(
      await runningCase
        .locator('.tw-command-row[data-status="running"]')
        .evaluate((element) => getComputedStyle(element).boxShadow),
    ).toContain('rgb(103, 183, 209)');
    expect(await runningCase.locator('.lucide-check').count()).toBe(0);

    server.hub.publish({
      v: 1,
      type: 'action',
      actionId: 'a1',
      kind: 'action',
      api: 'press',
      t: 20,
      ok: true,
      testId: 'status-live',
    });
    server.hub.publish({
      v: 1,
      type: 'test-end',
      id: 'status-live',
      status: 'passed',
      durationMs: 30,
      flaky: false,
      lostLogRecords: 0,
    });
    server.hub.publish({
      v: 1,
      type: 'run-end',
      summary: {
        verdict: 'passed',
        total: 1,
        passed: 1,
        failed: 0,
        skipped: 0,
        flaky: 0,
        durationMs: 30,
      },
    });
    const passedCase = page.locator('.tw-case[data-status="passed"]');
    await passedCase.waitFor();
    expect(await passedCase.locator('.tw-status[data-status="passed"] .lucide-check').count()).toBe(
      1,
    );
    expect(
      await passedCase.locator('.tw-status').evaluate((element) => getComputedStyle(element).color),
    ).toBe('rgb(88, 230, 176)');
    expect((page as unknown as { __errors: string[] }).__errors).toEqual([]);
  });

  it('preserves an actionless Gherkin narrative without a session, action or trace', async () => {
    const server = await startUiServer();
    servers.push(server);
    const page = await checkedPage();
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await expect
      .poll(() => page.locator('.tw-connection-dot').getAttribute('data-connected'))
      .toBe('true');
    const feature = '/repo/features/rules.feature';
    const actionlessTitle = 'Permission workflow > records an actionless business rule';
    server.hub.publish({
      v: 1,
      type: 'tests-discovered',
      tests: [ownedDescriptor(feature, actionlessTitle)],
    });
    const startedAt = Date.now();
    server.hub.publish({ v: 1, type: 'run-start', runId: 'run:test', mode: 'live', startedAt });
    const actionlessId = `${feature}::${actionlessTitle}`;
    server.hub.publish({
      v: 1,
      type: 'test-start',
      id: actionlessId,
      runnerTaskId: actionlessId,
      title: actionlessTitle,
      file: feature,
      startedAt,
    });
    const authored = {
      keyword: 'Given',
      text: 'the policy already permits the request',
      source: { file: feature, line: 8, column: 5 },
    } as const;
    server.hub.publish({
      v: 1,
      type: 'step',
      testId: actionlessId,
      title: 'provider wrapper',
      phase: 'start',
      stepId: 'tw-step-1',
      t: 1,
      gherkin: authored,
    });
    server.hub.publish({
      v: 1,
      type: 'step',
      testId: actionlessId,
      title: 'provider wrapper',
      phase: 'end',
      stepId: 'tw-step-1',
      t: 2,
      status: 'passed',
      gherkin: authored,
    });
    server.hub.publish({
      v: 1,
      type: 'test-end',
      id: actionlessId,
      status: 'passed',
      durationMs: 3,
      flaky: false,
      lostLogRecords: 0,
    });
    server.hub.publish({
      v: 1,
      type: 'run-end',
      summary: {
        verdict: 'passed',
        total: 1,
        passed: 1,
        failed: 0,
        skipped: 0,
        flaky: 0,
        durationMs: 3,
      },
    });

    const actionlessCase = page
      .locator('.tw-case[data-status="passed"]')
      .filter({ hasText: 'records an actionless business rule' });
    await actionlessCase.waitFor();
    const actionless = actionlessCase.locator('.tw-case-button');
    expect(await actionless.getAttribute('data-execution-id')).toBe(`run:test:${actionlessId}:1`);
    if ((await actionless.getAttribute('aria-selected')) !== 'true') {
      await actionless.click();
      await expect.poll(() => actionless.getAttribute('aria-selected')).toBe('true');
    }
    if ((await actionless.getAttribute('aria-expanded')) !== 'true') {
      await actionless.click();
      await expect.poll(() => actionless.getAttribute('aria-expanded')).toBe('true');
    }
    await expect
      .poll(() => page.locator('.tw-section-row').filter({ hasText: 'Test body' }).count())
      .toBe(1);
    await expect
      .poll(() =>
        page
          .locator('.tw-section-row')
          .filter({ hasText: 'Given the policy already permits the request' })
          .count(),
      )
      .toBe(1);
    expect(await page.locator('.tw-command-row').count()).toBe(0);
    expect(
      await page
        .getByText('No driver actions were recorded for this case.', { exact: false })
        .count(),
    ).toBe(0);
    const expandInspector = page.getByRole('button', { name: 'Expand inspector' });
    if ((await expandInspector.count()) > 0) await expandInspector.click();
    await page.locator('.tw-inspector').waitFor();
    const absentGeometry = await paneWidths(page);
    expect(await page.getByText('No semantic tree at this moment', { exact: true }).count()).toBe(
      1,
    );
    server.hub.publish({
      v: 1,
      type: 'session',
      sessionId: 'late-semantic',
      testId: actionlessId,
      terminalProfile: 'default',
      columns: 60,
      rows: 10,
    });
    server.hub.publish({
      v: 1,
      type: 'semantic',
      sessionId: 'late-semantic',
      revision: 1,
      snapshot: {
        ...(FIXTURE_TREES[0] as NonNullable<(typeof FIXTURE_TREES)[number]>),
        sessionId: 'late-semantic',
        columns: 60,
        rows: 10,
      },
    });
    await page.locator('.tw-semantic-node-row').first().waitFor();
    const presentGeometry = await paneWidths(page);
    expect(Math.abs(absentGeometry.evidence - presentGeometry.evidence)).toBeLessThan(2);
    expect(Math.abs(absentGeometry.inspector - presentGeometry.inspector)).toBeLessThan(2);
    expect((page as unknown as { __errors: string[] }).__errors).toEqual([]);
  });

  it('renders a dense mixed-provider execution narrative with failure and live progress', async () => {
    const server = await startUiServer();
    servers.push(server);
    const page = await checkedPage();
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await expect
      .poll(() => page.locator('.tw-connection-dot').getAttribute('data-connected'))
      .toBe('true');
    const file = '/tmp/features/checkout.feature';
    const title = 'completes a purchase';
    const caseId = `${file}::${title}`;
    server.hub.publish({
      v: 1,
      type: 'tests-discovered',
      tests: [
        {
          id: caseId,
          title,
          file,
          provider: { id: '@termwright/test', version: 1 },
          kind: 'gherkin-scenario',
          ancestors: [
            { kind: 'feature', title: 'Checkout' },
            { kind: 'rule', title: 'Approval' },
          ],
          tags: ['@smoke', '@checkout'],
          source: { file, line: 12, column: 3 },
        },
      ],
    });
    const startedAt = Date.now();
    server.hub.publish({ v: 1, type: 'run-start', runId: 'run:test', mode: 'live', startedAt });
    server.hub.publish({
      v: 1,
      type: 'test-start',
      id: caseId,
      runnerTaskId: caseId,
      title,
      file,
      startedAt,
    });
    const backgroundStep = {
      keyword: 'Given',
      text: 'the application is open',
      source: { file, line: 13, column: 5 },
      background: true,
    } as const;
    const approvalStep = {
      keyword: 'When',
      text: 'I approve the purchase',
      source: { file, line: 16, column: 5 },
    } as const;
    server.hub.publish({
      v: 1,
      type: 'step',
      testId: caseId,
      title: 'generic wrapper title',
      phase: 'start',
      stepId: 'before',
      t: 5,
      gherkin: backgroundStep,
    });
    server.hub.publish({
      v: 1,
      type: 'action',
      actionId: 'setup',
      kind: 'action',
      api: 'open application',
      t: 18,
      ok: true,
      testId: caseId,
      stepId: 'before',
    });
    server.hub.publish({
      v: 1,
      type: 'step',
      testId: caseId,
      title: 'generic wrapper title',
      phase: 'end',
      stepId: 'before',
      t: 25,
      status: 'passed',
      gherkin: backgroundStep,
    });
    server.hub.publish({
      v: 1,
      type: 'step',
      testId: caseId,
      title: 'duplicate retained annotation',
      phase: 'start',
      stepId: 'before',
      t: 5,
      gherkin: backgroundStep,
    });
    server.hub.publish({
      v: 1,
      type: 'step',
      testId: caseId,
      title: 'generic wrapper title',
      phase: 'start',
      stepId: 'approve',
      t: 30,
      gherkin: approvalStep,
    });
    for (let index = 0; index < 20; index += 1) {
      server.hub.publish({
        v: 1,
        type: 'action',
        actionId: `a${index}`,
        kind: 'action',
        api: index === 0 ? 'locator.click' : 'locator.press',
        t: 40 + index * 12,
        ok: true,
        testId: caseId,
        sessionId: 'scenario-session',
        stepId: 'approve',
        selector:
          index === 0
            ? "getByRole('button', { name: 'Approve purchase with an intentionally descriptive label' })"
            : `[data-key="${index}"]`,
      });
    }
    server.hub.publish({
      v: 1,
      type: 'action',
      actionId: 'failed-assert',
      kind: 'assert',
      api: 'toHaveText',
      t: 155,
      ok: false,
      error: 'expected status to be approved\nReceived: pending',
      testId: caseId,
      sessionId: 'scenario-session',
      stepId: 'approve',
      selector: '[role="status"]',
      ref: 'semantic:status@7',
    });
    server.hub.publish({
      v: 1,
      type: 'action-start',
      actionId: 'still-running',
      api: 'waitForQuietScreen',
      t: 170,
      testId: caseId,
      sessionId: 'scenario-session',
      stepId: 'approve',
      selector: 'screen',
    });

    await expect.poll(() => page.locator('.tw-command-row').count()).toBe(23);
    expect(await page.locator('.tw-section-row').count()).toBeGreaterThanOrEqual(3);
    expect(await page.locator('.tw-section-row').filter({ hasText: 'Background' }).count()).toBe(1);
    expect(
      await page
        .locator('.tw-section-row')
        .filter({ hasText: 'Given the application is open' })
        .count(),
    ).toBe(1);
    expect(
      await page
        .locator('.tw-section-row')
        .filter({ hasText: 'When I approve the purchase' })
        .count(),
    ).toBe(1);
    expect(await page.locator('.tw-section-row').filter({ hasText: 'L16' }).count()).toBe(1);
    expect(await page.getByText('scenario', { exact: true }).count()).toBeGreaterThan(0);
    expect(await page.getByText('@smoke', { exact: true }).count()).toBeGreaterThan(0);
    expect(
      (
        await page.locator('.tw-command-row[data-status="running"] .tw-row-status').innerText()
      ).toLowerCase(),
    ).toContain('running');
    expect(await page.locator('.tw-command-failure').innerText()).toContain(
      'expected status to be approved',
    );
    expect(await page.locator('.tw-run-counts').count()).toBe(0);
    expect(await page.locator('.tw-run-toolbar').count()).toBe(0);
    expect(await page.locator('.tw-rail-heading').innerText()).not.toMatch(/following/iu);
    expect(await page.getByLabel('1 running').count()).toBe(1);
    expect(await page.getByRole('button', { name: 'Stop', exact: true }).count()).toBe(1);
    expect(
      await page.getByRole('button', { name: /Run all|Rerun completes a purchase/u }).count(),
    ).toBe(0);
    await page.setViewportSize({ width: 1440, height: 700 });
    await page.locator('.tw-case-list').evaluate((scroller) => {
      scroller.scrollTop = 0;
    });
    await page.getByRole('button', { name: 'Scroll to the current running step' }).waitFor();
    await page.getByRole('button', { name: 'Scroll to the current running step' }).click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const scroller = document
            .querySelector<HTMLElement>('.tw-case-list')
            ?.getBoundingClientRect();
          const current = document
            .querySelector<HTMLElement>('.tw-command-row[data-status="running"]')
            ?.getBoundingClientRect();
          return (
            scroller !== undefined &&
            current !== undefined &&
            current.top >= scroller.top &&
            current.bottom <= scroller.bottom
          );
        }),
      )
      .toBe(true);
    await page.setViewportSize({ width: 1440, height: 900 });
    const visibleRows = await page.evaluate(() => {
      const viewport = document
        .querySelector<HTMLElement>('.tw-case-list')
        ?.getBoundingClientRect();
      if (viewport === undefined) return 0;
      return [...document.querySelectorAll<HTMLElement>('.tw-section-row, .tw-command-row')].filter(
        (row) => {
          const box = row.getBoundingClientRect();
          return box.top >= viewport.top && box.bottom <= viewport.bottom;
        },
      ).length;
    });
    expect(visibleRows).toBeGreaterThanOrEqual(14);
    const bottom = await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>('.tw-case-list');
      if (scroller === null) return { reachable: false };
      scroller.scrollTop = scroller.scrollHeight;
      const end = scroller.querySelector<HTMLElement>('.tw-scroll-end')?.getBoundingClientRect();
      const box = scroller.getBoundingClientRect();
      return { reachable: end !== undefined && end.bottom <= box.bottom + 1 };
    });
    expect(bottom.reachable).toBe(true);
    await page.screenshot({ path: '/tmp/termwright-fresh-dense-timeline.png', fullPage: false });
    server.hub.publish({
      v: 1,
      type: 'test-end',
      id: caseId,
      status: 'failed',
      durationMs: 220,
      flaky: false,
      lostLogRecords: 0,
      attempt: 3,
      error: 'final provider failure',
      priorFailures: [
        { attempt: 1, errors: ['first provider failure'] },
        { attempt: 2, errors: ['second provider failure'] },
      ],
    });
    server.hub.publish({
      v: 1,
      type: 'run-end',
      summary: {
        verdict: 'failed',
        total: 1,
        passed: 0,
        failed: 1,
        skipped: 0,
        flaky: 0,
        durationMs: 220,
      },
    });
    await expect.poll(() => page.getByText('attempt 3', { exact: true }).count()).toBe(1);
    await page.getByText('2 earlier attempts failed', { exact: true }).click();
    expect(await page.getByText('first provider failure', { exact: true }).count()).toBe(1);
    expect(await page.locator('.tw-case').count()).toBe(1);
    expect(await page.getByRole('button', { name: 'Stop', exact: true }).count()).toBe(0);
    expect(
      await page.getByRole('button', { name: 'Rerun completes a purchase', exact: true }).count(),
    ).toBe(0);
    expect((page as unknown as { __errors: string[] }).__errors).toEqual([]);
  });

  it('reuses roving tree navigation for the Specs catalogue and retains selection', async () => {
    const projectRoot = process.cwd();
    const descriptors = [
      ownedDescriptor(join(projectRoot, 'specs/a.test.ts'), 'case A'),
      ownedDescriptor(join(projectRoot, 'specs/a.test.ts'), 'case B'),
    ];
    const server = await startUiServer();
    servers.push(server);
    const page = await checkedPage();
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    server.hub.publish({ v: 1, type: 'tests-discovered', tests: descriptors });
    await page.getByRole('button', { name: 'Specs', exact: true }).click();
    const tree = page.getByRole('tree', { name: 'Test catalog hierarchy' });
    const directory = tree.getByRole('treeitem', { name: 'Directory specs' });
    await directory.focus();
    expect(await tree.locator('[role="treeitem"][tabindex="0"]').count()).toBe(1);
    expect(
      await tree
        .locator('button:not([disabled]), [role="treeitem"]')
        .evaluateAll((items) => items.filter((item) => (item as HTMLElement).tabIndex >= 0).length),
    ).toBe(1);
    await page.keyboard.press('ArrowDown');
    const file = tree.getByRole('treeitem', { name: 'File a.test.ts' });
    expect(await file.getAttribute('aria-selected')).toBe('true');
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label')))
      .toBe('File a.test.ts');
    await page.keyboard.press('Enter');
    await expect.poll(() => file.getAttribute('aria-expanded')).toBe('true');
    expect(await directory.getAttribute('aria-expanded')).toBe('true');
    await page.keyboard.press('ArrowRight');
    expect(
      await tree.getByRole('treeitem', { name: /case A/u }).getAttribute('aria-selected'),
    ).toBe('true');
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.textContent))
      .toContain('case A');
    await page.keyboard.press('End');
    expect(
      await tree.getByRole('treeitem', { name: /case B/u }).getAttribute('aria-selected'),
    ).toBe('true');
    server.hub.publish({ v: 1, type: 'tests-discovered', tests: descriptors });
    await expect.poll(() => tree.locator('[role="treeitem"][tabindex="0"]').count()).toBe(1);
    expect(
      await tree.getByRole('treeitem', { name: /case B/u }).getAttribute('aria-selected'),
    ).toBe('true');
    expect((page as unknown as { __errors: string[] }).__errors).toEqual([]);
  });

  it('runs canonical file and nested directory scopes independent of search and preserves expansion', async () => {
    const requests: readonly string[][] = [];
    const mutableRequests = requests as string[][];
    const projectRoot = process.cwd();
    const descriptors = [
      ownedDescriptor(join(projectRoot, 'specs/nested/a.test.ts'), 'case A'),
      ownedDescriptor(join(projectRoot, 'specs/nested/a.test.ts'), 'case B'),
      ownedDescriptor(join(projectRoot, 'specs/nested/b.test.ts'), 'case C'),
      ownedDescriptor(join(projectRoot, 'other/outside.test.ts'), 'outside case'),
    ];
    const server = await startUiServer({
      onRun: (targets) => {
        const selectedTargets = targets ?? [];
        mutableRequests.push([...selectedTargets]);
        const selected =
          descriptors.find((test) => selectedTargets.includes(test.id)) ?? descriptors[0];
        if (selected === undefined)
          return { runId: createRunId('run'), completed: Promise.resolve() };
        const startedAt = Date.now();
        server.hub.publish({ v: 1, type: 'run-start', runId: 'run:test', mode: 'live', startedAt });
        server.hub.publish({
          v: 1,
          type: 'test-start',
          id: selected.id,
          runnerTaskId: selected.id,
          title: selected.title,
          file: selected.file,
          startedAt,
        });
        server.hub.publish({
          v: 1,
          type: 'test-end',
          id: selected.id,
          status: 'passed',
          durationMs: 1,
          flaky: false,
          lostLogRecords: 0,
        });
        if (mutableRequests.length === 2) {
          const outside = descriptors[3];
          if (outside !== undefined) {
            server.hub.publish({
              v: 1,
              type: 'test-start',
              id: outside.id,
              runnerTaskId: outside.id,
              title: outside.title,
              file: outside.file,
              startedAt,
            });
            server.hub.publish({
              v: 1,
              type: 'test-end',
              id: outside.id,
              status: 'passed',
              durationMs: 1,
              flaky: false,
              lostLogRecords: 0,
            });
          }
        }
        const total = mutableRequests.length === 2 ? 2 : 1;
        server.hub.publish({
          v: 1,
          type: 'run-end',
          summary: {
            verdict: 'passed',
            total,
            passed: total,
            failed: 0,
            skipped: 0,
            flaky: 0,
            durationMs: 1,
          },
        });
        return { runId: createRunId('run'), completed: Promise.resolve() };
      },
    });
    servers.push(server);
    const page = await checkedPage();
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await expect
      .poll(() => page.locator('.tw-connection-dot').getAttribute('data-connected'))
      .toBe('true');
    server.hub.publish({ v: 1, type: 'tests-discovered', tests: descriptors });
    await page.getByRole('button', { name: 'Specs', exact: true }).click();
    const nested = page.locator('.tw-spec-directory[aria-label="Directory nested"]');
    await nested.waitFor();
    await nested.getByRole('button', { name: 'Expand directory nested' }).click();
    await page.getByLabel('Search specs').fill('case A');
    const forcedOpen = nested.getByRole('button', { name: 'Collapse directory nested' });
    expect(await forcedOpen.isDisabled()).toBe(true);
    await forcedOpen.hover();
    await page
      .getByRole('tooltip', { name: 'Clear search to restore directory expansion controls.' })
      .waitFor();
    const file = page.locator('.tw-spec-file[aria-label="File a.test.ts"]');
    await file.getByRole('button', { name: 'Run file a.test.ts (2 cases)' }).click();
    await expect.poll(() => mutableRequests.length).toBe(1);
    expect(mutableRequests[0]).toEqual([descriptors[0]?.id, descriptors[1]?.id]);

    await page.locator('.tw-execution-rail').waitFor();
    await expect
      .poll(() => page.getByRole('button', { name: 'Stop', exact: true }).count())
      .toBe(0);
    expect(await page.locator('.tw-case').count()).toBe(2);
    expect(await page.locator('.tw-case').filter({ hasText: 'case A' }).count()).toBe(1);
    expect(await page.locator('.tw-case').filter({ hasText: 'case B' }).count()).toBe(1);
    expect(await page.locator('.tw-case').filter({ hasText: 'case C' }).count()).toBe(0);
    expect(
      await page.getByRole('button', { name: 'Run all 4 cases in the current CLI scope' }).count(),
    ).toBe(1);
    await page.getByRole('button', { name: 'Specs', exact: true }).click();
    await page.getByLabel('Search specs').fill('');
    await nested.getByRole('button', { name: 'Collapse directory nested' }).click();
    expect(await nested.getAttribute('aria-expanded')).toBe('false');
    await nested.getByRole('button', { name: 'Run directory nested (3 cases)' }).click();
    await expect.poll(() => mutableRequests.length).toBe(2);
    expect(mutableRequests[1]).toEqual([
      descriptors[0]?.id,
      descriptors[1]?.id,
      descriptors[2]?.id,
    ]);
    expect(mutableRequests[1]).not.toContain(descriptors[3]?.id);
    await page.locator('.tw-execution-rail').waitFor();
    await expect
      .poll(() => page.getByRole('button', { name: 'Stop', exact: true }).count())
      .toBe(0);
    const mismatch = page.locator('.tw-case[data-scope-mismatch="true"]');
    expect(await mismatch.count()).toBe(1);
    expect(await mismatch.getByLabel('Execution reported outside requested scope').count()).toBe(1);
    await page.getByRole('button', { name: 'Specs', exact: true }).click();
    expect(await page.getByText('4 total', { exact: true }).count()).toBe(1);
    expect(await nested.getAttribute('aria-expanded')).toBe('false');
    await page.getByLabel('Search specs').fill('case C');
    await page.locator('.tw-spec-case').filter({ hasText: 'case C' }).waitFor();
    expect(await nested.getAttribute('aria-expanded')).toBe('true');
    await page.getByLabel('Search specs').fill('');
    expect(await nested.getAttribute('aria-expanded')).toBe('false');

    await nested.getByRole('button', { name: 'Expand directory nested' }).click();
    const fileExpanded = (await file.getAttribute('aria-expanded')) === 'true';
    if (!fileExpanded) await file.getByRole('button', { name: 'Expand file a.test.ts' }).click();
    const alignedRunEdges = await page
      .locator('.tw-spec-group-run')
      .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().right));
    expect(Math.max(...alignedRunEdges) - Math.min(...alignedRunEdges)).toBeLessThan(2);

    await page.setViewportSize({ width: 390, height: 500 });
    const fileToggle = file.getByRole('button', { name: 'Collapse file a.test.ts' });
    expect(await fileToggle.isVisible()).toBe(true);
    expect((await fileToggle.boundingBox())?.width ?? 0).toBeGreaterThan(80);
    const scroller = page.locator('.tw-spec-files');
    await scroller.hover();
    await page.mouse.wheel(0, 10_000);
    await expect
      .poll(() => scroller.evaluate((element) => Math.round(element.scrollTop)))
      .toBe(
        await scroller.evaluate((element) =>
          Math.round(element.scrollHeight - element.clientHeight),
        ),
      );
    const lastRowClearance = await page
      .locator('.tw-spec-case')
      .last()
      .evaluate((row) => {
        const rowRect = row.getBoundingClientRect();
        const scrollerRect = row.closest('.tw-spec-files')?.getBoundingClientRect();
        return scrollerRect === undefined ? -1 : scrollerRect.bottom - rowRect.bottom;
      });
    expect(lastRowClearance).toBeGreaterThanOrEqual(30);
    expect((page as unknown as { __errors: string[] }).__errors).toEqual([]);
  });

  it('opens existing source with the configured editor and copy-path fallback', async () => {
    const server = await startUiServer();
    servers.push(server);
    const page = await checkedPage();
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await expect
      .poll(() => page.locator('.tw-connection-dot').getAttribute('data-connected'))
      .toBe('true');
    const sourceFile = join(process.cwd(), 'specs/open-me.test.ts');
    server.hub.publish({
      v: 1,
      type: 'tests-discovered',
      tests: [ownedDescriptor(sourceFile, 'opens its source')],
    });
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByLabel('Source editor').selectOption('none');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: new URL(server.url).origin,
    });
    await page.getByRole('button', { name: 'Specs', exact: true }).click();
    const file = page.locator('.tw-spec-file[aria-label="File open-me.test.ts"]');
    await file.getByRole('button', { name: 'Expand file open-me.test.ts' }).click();
    await page.getByRole('button', { name: 'Open opens its source source' }).click();
    await expect
      .poll(() => page.locator('.tw-toast').innerText())
      .toContain(`Copied ${sourceFile}`);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(sourceFile);
    expect(new URL(page.url()).origin).toBe(new URL(server.url).origin);
    expect(new URL(page.url()).searchParams.get('token')).toBeNull();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Settings' }).click();
    expect(await page.getByLabel('Source editor').inputValue()).toBe('none');
    expect((page as unknown as { __errors: string[] }).__errors).toEqual([]);
  });

  it('applies, persists and separately resets real workspace preferences', async () => {
    const page = await tracePage(await buildFixtureTrace());
    await page.locator('.tw-replay-controls').waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByLabel('Expanded navigation').check();
    expect(await page.locator('.tw-shell').getAttribute('data-navigation-expanded')).toBe('true');
    await page.getByLabel('Timeline density').selectOption('comfortable');
    await page.getByLabel('Follow current action').uncheck();
    await page.getByLabel('Inspector starts open').check();
    await page.getByLabel('Preferred inspector view').selectOption('logs');
    await page.getByLabel('Motion').selectOption('reduce');
    await page.getByLabel('Default replay speed').selectOption('2');
    await page.getByLabel('Source editor').selectOption('cursor');
    expect(await page.locator('html').getAttribute('data-motion')).toBe('reduce');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByLabel('Timeline density').waitFor();
    expect(new URL(page.url()).searchParams.get('view')).toBe('settings');
    await page.getByRole('button', { name: 'Runner' }).click();
    await page.locator('.tw-replay-controls').waitFor({ timeout: 15_000 });
    expect(await page.locator('.tw-shell').getAttribute('data-navigation-expanded')).toBe('true');
    expect(await page.locator('.tw-inspector').isVisible()).toBe(true);
    expect(await page.getByRole('tab', { name: 'Logs' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(await page.locator('.tw-speed-button').innerText()).toContain('2×');
    await page.getByRole('button', { name: 'Settings' }).click();
    expect(await page.getByLabel('Timeline density').inputValue()).toBe('comfortable');
    expect(await page.getByLabel('Follow current action').isChecked()).toBe(false);
    expect(await page.getByLabel('Source editor').inputValue()).toBe('cursor');
    await page.screenshot({ path: '/tmp/termwright-fresh-settings-1440.png', fullPage: false });

    await page.getByRole('button', { name: 'Reset layout' }).click();
    await page.getByRole('button', { name: 'Confirm reset' }).click();
    expect(await page.locator('.tw-shell').getAttribute('data-navigation-expanded')).toBe('false');
    expect(await page.getByLabel('Timeline density').inputValue()).toBe('comfortable');
    expect(await page.getByLabel('Preferred inspector view').inputValue()).toBe('logs');
    expect(await page.getByLabel('Source editor').inputValue()).toBe('cursor');
    await page.getByRole('button', { name: 'Reset all preferences' }).click();
    await page.getByRole('button', { name: 'Confirm reset' }).click();
    expect(await page.getByLabel('Timeline density').inputValue()).toBe('compact');
    expect(await page.getByLabel('Follow current action').isChecked()).toBe(true);
    expect(await page.getByLabel('Motion').inputValue()).toBe('system');
    expect(await page.getByLabel('Source editor').inputValue()).toBe('vscode');
    expect(await page.locator('html').getAttribute('data-motion')).toBeNull();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: '/tmp/termwright-fresh-settings-390.png', fullPage: false });
    const bottomReachable = await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>('.tw-settings-page');
      const last = document.querySelector<HTMLElement>('.tw-danger-button');
      if (scroller === null || last === null) return false;
      scroller.scrollTop = scroller.scrollHeight;
      return last.getBoundingClientRect().bottom <= scroller.getBoundingClientRect().bottom + 1;
    });
    expect(bottomReachable).toBe(true);
    await page.screenshot({
      path: '/tmp/termwright-fresh-settings-390-bottom.png',
      fullPage: false,
    });
    expect((page as unknown as { __errors: string[] }).__errors).toEqual([]);
  });

  it('does not load preferences from pre-release storage keys', async () => {
    const server = await startUiServer({ trace: await buildFixtureTrace() });
    servers.push(server);
    const page = await checkedPage();
    await page.addInitScript(() => {
      localStorage.setItem(
        'termwright:preferences',
        JSON.stringify({
          version: 1,
          navigationExpanded: true,
          timelineDensity: 'comfortable',
        }),
      );
      localStorage.setItem('termwright:navigation-expanded', 'true');
      localStorage.setItem('termwright:rail-share', '.4');
      localStorage.setItem('termwright:inspector-share', '.3');
    });
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Settings' }).click();

    expect(await page.locator('.tw-shell').getAttribute('data-navigation-expanded')).toBe('false');
    expect(await page.getByLabel('Timeline density').inputValue()).toBe('compact');
    expect((page as unknown as { __errors: string[] }).__errors).toEqual([]);
  });

  it('renders a generated standalone report as replay without live-only navigation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tw-fresh-inline-'));
    const report = join(directory, 'report.html');
    await writeInlineReport(await buildFixtureTrace(), report, { appDir: APP_DIR });
    const page = await checkedPage();
    await page.goto(pathToFileURL(report).href, { waitUntil: 'domcontentloaded' });
    await page.locator('.tw-replay-controls').waitFor({ timeout: 15_000 });
    expect(await page.getByRole('button', { name: 'Specs' }).count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Runs' }).count()).toBe(0);
    expect(await page.getByText('Recording loaded').count()).toBeGreaterThan(0);
    expect((page as unknown as { __errors: string[] }).__errors).toEqual([]);
  });
});

async function scrollEndIsReachable(
  page: Page,
  scrollerSelector: string,
  endSelector: string,
): Promise<boolean> {
  return page.evaluate(
    ({ scrollerSelector: scrollerQuery, endSelector: endQuery }) => {
      const scroller = document.querySelector<HTMLElement>(scrollerQuery);
      const end = document.querySelector<HTMLElement>(endQuery);
      if (scroller === null || end === null) return false;
      scroller.scrollTop = scroller.scrollHeight;
      const viewport = scroller.getBoundingClientRect();
      const last = end.getBoundingClientRect();
      return last.bottom <= viewport.bottom + 1 && last.top >= viewport.top - 1;
    },
    { scrollerSelector, endSelector },
  );
}

async function paneWidths(
  page: Page,
): Promise<{ readonly evidence: number; readonly inspector: number }> {
  return page.evaluate(() => ({
    evidence:
      document.querySelector<HTMLElement>('.tw-evidence')?.getBoundingClientRect().width ?? 0,
    inspector:
      document.querySelector<HTMLElement>('.tw-inspector')?.getBoundingClientRect().width ?? 0,
  }));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function ownedDescriptor(file: string, title: string) {
  return {
    id: `${file}::${title}`,
    title,
    file,
    provider: { id: '@termwright/test', version: 1 },
    kind: 'test' as const,
    source: { file, line: 1, column: 1 },
  };
}
