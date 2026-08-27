import { existsSync } from 'node:fs';
import { chmod, cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import {
  buildCrashedFixtureTrace,
  buildFixtureTrace,
  FIXTURE_TREES,
} from '../__fixtures__/build-trace.js';
import { frameworkContract } from '../__fixtures__/fake-session.js';
import { writeNativeRunFixture } from '../__fixtures__/native-run.js';
import { writeInlineReport } from '../inline-report.js';
import { startUiServer, type UiServer } from '../server.js';

const CAPTURE = process.env['TERMWRIGHT_CAPTURE_DOCS'] === '1';
const OUTPUT_DIR = fileURLToPath(
  new URL('../../../../website/public/images/runner/', import.meta.url),
);
const APP_DIR = fileURLToPath(new URL('../../dist/app/', import.meta.url));
const VIEWPORT = { width: 1440, height: 900 } as const;

let browser: Browser;
const servers: UiServer[] = [];
const pages: Page[] = [];
const temporaryDirectories: string[] = [];

describe.skipIf(!CAPTURE)('Runner documentation screenshots', () => {
  beforeAll(async () => {
    await mkdir(OUTPUT_DIR, { recursive: true });
    browser = await chromium.launch();
  });

  afterAll(async () => {
    for (const page of pages.splice(0)) await page.close();
    for (const server of servers.splice(0)) await server.close();
    for (const directory of temporaryDirectories.splice(0)) {
      await rm(directory, { recursive: true, force: true });
    }
    await browser.close();
  });

  it('captures the current documented Runner workflows', async () => {
    await captureCatalogueAndExecution();
    await captureReplayAndSemantics();
    await captureRunHistory();
    await captureRecorder();
    await captureSettings();
    await captureInlineReport();
  });
});

async function captureCatalogueAndExecution(): Promise<void> {
  const server = await openServer();
  const page = await openPage(server);
  const tests = [
    descriptor('/workspace/permission-demo/tests/auth/login.test.ts', 'accepts valid credentials'),
    descriptor(
      '/workspace/permission-demo/tests/auth/login.test.ts',
      'shows an invalid-password error',
    ),
    descriptor(
      '/workspace/permission-demo/tests/permissions.feature',
      'Permission approval > approves a pending request',
      'gherkin-scenario',
    ),
    descriptor(
      '/workspace/permission-demo/tests/permissions.feature',
      'Permission approval > rejects a pending request',
      'gherkin-scenario',
    ),
  ];

  server.hub.publish({ v: 1, type: 'tests-discovered', tests });
  await page.getByRole('button', { name: 'Specs', exact: true }).click();
  await expect.poll(() => page.getByText('4 total', { exact: true }).count()).toBe(1);
  await expandCatalogue(page);
  await expect.poll(() => page.locator('.tw-spec-case').count()).toBe(4);
  await screenshot(page, 'spec-catalog.png');

  const startedAt = Date.UTC(2026, 7, 21, 10, 30, 0);
  server.hub.publish({ v: 1, type: 'run-start', runId: 'run:test', mode: 'live', startedAt });
  server.hub.publish({
    v: 1,
    type: 'test-start',
    id: 'login-pass',
    title: 'accepts valid credentials',
    file: '/workspace/permission-demo/tests/auth/login.test.ts',
    startedAt,
  });
  server.hub.publish({
    v: 1,
    type: 'test-end',
    id: 'login-pass',
    status: 'passed',
    durationMs: 184,
    flaky: false,
    lostLogRecords: 0,
  });
  server.hub.publish({
    v: 1,
    type: 'test-start',
    id: 'approval-live',
    title: 'Permission approval > approves a pending request',
    file: '/workspace/permission-demo/tests/permissions.feature',
    startedAt: startedAt + 200,
  });
  server.hub.publish({
    v: 1,
    type: 'test-start',
    id: 'waiting',
    title: 'Permission approval > rejects a pending request',
    file: '/workspace/permission-demo/tests/permissions.feature',
    startedAt: startedAt + 201,
  });
  server.hub.publish({
    v: 1,
    type: 'session',
    sessionId: 'permission-terminal',
    testId: 'approval-live',
    terminalProfile: 'default',
    contract: frameworkContract('permission-terminal', 'Ink', '1.0.0'),
    adapterStatus: 'attached',
    columns: 80,
    rows: 24,
  });
  server.hub.publish({
    v: 1,
    type: 'output',
    sessionId: 'permission-terminal',
    dataB64: Buffer.from(
      'Permission required\r\n  [Approve]    Reject\r\n  Reviewer: Ada\r\n',
    ).toString('base64'),
    t: 1,
  });
  server.hub.publish({
    v: 1,
    type: 'semantic',
    sessionId: 'permission-terminal',
    revision: 1,
    snapshot: {
      ...(FIXTURE_TREES[0] as NonNullable<(typeof FIXTURE_TREES)[number]>),
      sessionId: 'permission-terminal',
    },
  });
  const given = {
    keyword: 'Given',
    text: 'a pending permission request',
    source: { file: '/workspace/permission-demo/tests/permissions.feature', line: 4, column: 3 },
  } as const;
  const when = {
    keyword: 'When',
    text: 'I approve the request',
    source: { file: '/workspace/permission-demo/tests/permissions.feature', line: 5, column: 3 },
  } as const;
  server.hub.publish({
    v: 1,
    type: 'step',
    testId: 'approval-live',
    title: 'fixture',
    phase: 'start',
    stepId: 'given',
    t: 4,
    gherkin: given,
  });
  server.hub.publish({
    v: 1,
    type: 'action',
    actionId: 'open',
    kind: 'action',
    api: 'launch',
    t: 8,
    ok: true,
    testId: 'approval-live',
    sessionId: 'permission-terminal',
    stepId: 'given',
  });
  server.hub.publish({
    v: 1,
    type: 'step',
    testId: 'approval-live',
    title: 'fixture',
    phase: 'end',
    stepId: 'given',
    t: 10,
    status: 'passed',
    gherkin: given,
  });
  server.hub.publish({
    v: 1,
    type: 'step',
    testId: 'approval-live',
    title: 'fixture',
    phase: 'start',
    stepId: 'when',
    t: 12,
    gherkin: when,
  });
  server.hub.publish({
    v: 1,
    type: 'action-start',
    actionId: 'approve',
    api: 'click',
    t: 16,
    testId: 'approval-live',
    sessionId: 'permission-terminal',
    stepId: 'when',
    selector: "getByRole('button', { name: 'Approve' })",
  });

  await expect.poll(() => page.locator('.tw-case').count()).toBeGreaterThanOrEqual(3);
  await expect.poll(() => page.locator('.tw-command-row[data-status="running"]').count()).toBe(1);
  await screenshot(page, 'active-run.png');

  server.hub.publish({
    v: 1,
    type: 'action',
    actionId: 'approve',
    kind: 'assert',
    api: 'toHaveText',
    t: 82,
    ok: false,
    error: 'Expected status to contain "approved"\nReceived: "pending"',
    testId: 'approval-live',
    sessionId: 'permission-terminal',
    stepId: 'when',
    selector: "getByRole('status')",
    ref: 'semantic:b1@1',
  });
  server.hub.publish({
    v: 1,
    type: 'step',
    testId: 'approval-live',
    title: 'fixture',
    phase: 'end',
    stepId: 'when',
    t: 84,
    status: 'failed',
    gherkin: when,
  });
  server.hub.publish({
    v: 1,
    type: 'test-end',
    id: 'approval-live',
    status: 'failed',
    durationMs: 84,
    flaky: false,
    lostLogRecords: 0,
    attempt: 2,
    error: 'Expected status to contain "approved"',
    priorFailures: [{ attempt: 1, errors: ['Timed out waiting for the status'] }],
  });
  server.hub.publish({
    v: 1,
    type: 'test-end',
    id: 'waiting',
    status: 'passed',
    durationMs: 86,
    flaky: false,
    lostLogRecords: 0,
  });
  server.hub.publish({
    v: 1,
    type: 'run-end',
    summary: {
      verdict: 'failed',
      total: 3,
      passed: 2,
      failed: 1,
      skipped: 0,
      flaky: 0,
      durationMs: 86,
    },
  });
  await expect.poll(() => page.locator('.tw-case[data-status="failed"]').count()).toBe(1);
  await page.getByText('1 earlier attempt failed', { exact: true }).click();
  await screenshot(page, 'failure-inspection.png');
}

async function captureReplayAndSemantics(): Promise<void> {
  const trace = await stableFixtureTrace();
  const server = await openServer({ trace });
  const page = await openPage(server);
  await page.locator('.tw-replay-controls').waitFor({ timeout: 15_000 });
  const position = page.getByLabel('Replay position');
  const maximum = Number((await position.getAttribute('max')) ?? '0');
  await position.fill(String(Math.round(maximum / 2)));
  await screenshot(page, 'replay-player.png');

  await position.fill('0');
  const expand = page.getByRole('button', { name: 'Expand inspector' });
  if ((await expand.count()) > 0) await expand.click();
  await page.getByRole('tab', { name: 'Tree' }).click();
  await expect.poll(() => page.locator('.tw-semantic-node-row').count()).toBeGreaterThan(0);
  await screenshot(page, 'semantics-inspector.png');
}

async function captureRunHistory(): Promise<void> {
  const runsDir = await mkdtemp(join(tmpdir(), 'termwright-doc-runs-'));
  temporaryDirectories.push(runsDir);
  const startedAt = Date.UTC(2026, 7, 21, 9, 15, 0);
  await writeNativeRunFixture(runsDir, {
    startedAt,
    status: 'flaky',
    tests: [
      {
        title: 'approves a pending request',
        file: '/workspace/permission-demo/tests/permissions.feature',
        status: 'passed',
        durationMs: 1_340,
        retries: ['failed', 'passed'],
      },
      {
        title: 'reports a terminal crash',
        file: '/workspace/permission-demo/tests/crash.test.ts',
        status: 'failed',
        durationMs: 940,
      },
      {
        title: 'rejects a pending request',
        file: '/workspace/permission-demo/tests/permissions.feature',
        status: 'passed',
        durationMs: 200,
      },
    ],
  });
  const server = await openServer({ runsDir });
  const page = await openPage(server);
  await page.getByRole('button', { name: 'Runs', exact: true }).click();
  await page.getByRole('button', { name: /Local test run/u }).click();
  await expect.poll(() => page.getByText('Passed after a retry', { exact: true }).count()).toBe(1);
  await page.getByText('1 earlier attempt failed', { exact: true }).click();
  await screenshot(page, 'run-history.png');
}

async function captureRecorder(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'termwright-doc-recorder-'));
  temporaryDirectories.push(directory);
  const program = join(directory, 'permission-demo');
  await writeFile(
    program,
    [
      '#!/usr/bin/env node',
      'process.stdin.setEncoding("utf8");',
      'process.stdout.write("Permission required\\n  [Approve]    Reject\\n");',
      'process.stdin.on("data", (data) => process.stdout.write(`received ${data}`));',
      'setInterval(() => undefined, 1_000);',
    ].join('\n'),
    'utf8',
  );
  await chmod(program, 0o755);
  const originalPath = process.env['PATH'];
  process.env['PATH'] = `${directory}:${originalPath ?? ''}`;
  try {
    const server = await openServer();
    const page = await openPage(server);
    await page.getByRole('button', { name: 'Specs', exact: true }).click();
    await page.getByRole('button', { name: /New test/u }).click();
    await page.getByRole('menuitem', { name: 'Record test' }).click();
    await page.getByRole('dialog', { name: 'Record a terminal test' }).waitFor();
    await page.getByLabel('Command').fill('permission-demo');
    await page.getByLabel('Save destination').fill('tests/permission-dialog.test.ts');
    await screenshot(page, 'recorder.png');
    await page.getByRole('button', { name: 'Start recording' }).click();
    const stop = page.getByRole('button', { name: 'Stop recording' });
    await stop.waitFor({ timeout: 15_000 });
    await expect
      .poll(() => page.locator('.tw-terminal-viewport').innerText())
      .toContain('Permission required');
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.press('Enter');
    await page.getByPlaceholder('Name the next step').fill('approve the command');
    await page.getByRole('button', { name: 'Add step' }).click();
    await screenshot(page, 'recorder-active.png');
    await stop.click();
    const review = page.getByRole('dialog', { name: 'Generated test' });
    await review.waitFor();
    await expect.poll(() => review.innerText()).toContain('approve the command');
    await screenshot(page, 'recorder-review.png');
  } finally {
    if (originalPath === undefined) delete process.env['PATH'];
    else process.env['PATH'] = originalPath;
  }
}

async function captureSettings(): Promise<void> {
  const server = await openServer();
  const page = await openPage(server);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Timeline density').selectOption('comfortable');
  await page.getByLabel('Motion').selectOption('reduce');
  await screenshot(page, 'settings.png');
}

async function captureInlineReport(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'termwright-doc-report-'));
  temporaryDirectories.push(directory);
  const sourceTrace = await buildCrashedFixtureTrace();
  temporaryDirectories.push(dirname(sourceTrace));
  const trace = join(directory, 'crashed.twtrace');
  await cp(sourceTrace, trace, { recursive: true });
  const report = join(directory, 'report.html');
  const originalCwd = process.cwd();
  process.chdir(directory);
  try {
    await writeInlineReport('crashed.twtrace', report, {
      appDir: APP_DIR,
      cwd: '/workspace/permission-demo',
    });
  } finally {
    process.chdir(originalCwd);
  }
  const page = await browser.newPage({
    viewport: VIEWPORT,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  });
  pages.push(page);
  await page.goto(pathToFileURL(report).href, { waitUntil: 'domcontentloaded' });
  await page.locator('.tw-replay-controls').waitFor({ timeout: 15_000 });
  await screenshot(page, 'html-report.png');
}

async function openServer(options: Parameters<typeof startUiServer>[0] = {}): Promise<UiServer> {
  const server = await startUiServer(options);
  servers.push(server);
  return server;
}

async function openPage(server: UiServer): Promise<Page> {
  const page = await browser.newPage({
    viewport: VIEWPORT,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  });
  pages.push(page);
  await page.goto(server.url, { waitUntil: 'domcontentloaded' });
  await expect
    .poll(() => page.locator('.tw-connection-dot').getAttribute('data-connected'))
    .toBe('true');
  return page;
}

async function screenshot(page: Page, name: string): Promise<void> {
  const closeToast = page.locator('.tw-toast button');
  while ((await closeToast.count()) > 0) await closeToast.first().click();
  await page.mouse.move(720, 880);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document.getAnimations().map(async (animation) => {
        await animation.finished.catch(() => undefined);
      }),
    );
  });
  const visibleText = await page.locator('body').innerText();
  const home = process.env['HOME'];
  if (home !== undefined) expect(visibleText).not.toContain(home);
  expect(visibleText).not.toMatch(/\/(?:Users|home|var\/folders|opt\/homebrew)\//u);
  expect(visibleText).not.toMatch(/[?&]token=/u);
  const target = join(OUTPUT_DIR, name);
  await page.screenshot({ path: target, fullPage: false, animations: 'disabled' });
  expect(existsSync(target)).toBe(true);
}

async function expandCatalogue(page: Page): Promise<void> {
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const collapsedDirectory = page.locator('button[aria-label^="Expand directory "]');
    if ((await collapsedDirectory.count()) === 0) break;
    await collapsedDirectory.first().click();
  }
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const collapsedFile = page.locator('button[aria-label^="Expand file "]');
    if ((await collapsedFile.count()) === 0) break;
    await collapsedFile.first().click();
  }
}

async function stableFixtureTrace(): Promise<string> {
  const source = await buildFixtureTrace();
  const root = join(tmpdir(), 'termwright-docs-replay');
  const target = join(root, 'session.twtrace');
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  await cp(source, target, { recursive: true });
  await rm(dirname(source), { recursive: true, force: true });
  temporaryDirectories.push(root);
  return target;
}

function descriptor(file: string, title: string, kind: 'test' | 'gherkin-scenario' = 'test') {
  return {
    id: `${file}::${title}`,
    title,
    file,
    provider: { id: '@termwright/test', version: 1 },
    kind,
    ...(kind === 'gherkin-scenario'
      ? {
          ancestors: [{ kind: 'feature' as const, title: 'Permission approval' }],
          tags: ['@permission'],
        }
      : {}),
    source: { file, line: 4, column: 1 },
  };
}
