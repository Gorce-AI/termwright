import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { buildFixtureTrace } from '../test/fixtures/build-trace.js';
import { startUiServer, type UiServer } from '../server.js';

const APP_DIR = fileURLToPath(new URL('../../dist/app', import.meta.url));
let browser: Browser;
const servers: UiServer[] = [];

beforeAll(async () => {
  if (!existsSync(APP_DIR)) throw new Error(`${APP_DIR} is missing; build the fresh app first`);
  browser = await chromium.launch();
});

afterAll(async () => {
  for (const server of servers.splice(0)) await server.close();
  await browser.close();
});

describe('URL navigation', () => {
  it('round-trips replay identity and position through refresh and Back/Forward', async () => {
    const trace = await buildFixtureTrace();
    const server = await startUiServer({ trace });
    servers.push(server);
    const page = await browser.newPage({ viewport: { width: 1_440, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await page.locator('.tw-replay-controls').waitFor();

    const slider = page.getByLabel('Replay position');
    const maximum = Number(await slider.getAttribute('max'));
    const desired = Math.max(1, Math.floor(maximum * 0.6));
    await slider.fill(String(desired));
    await expect.poll(() => new URL(page.url()).searchParams.get('timeMs')).toBe(String(desired));

    const replayUrl = new URL(page.url());
    expect(replayUrl.searchParams.get('view')).toBe('runner');
    expect(replayUrl.searchParams.get('runId')).not.toBeNull();
    expect(replayUrl.searchParams.get('executionId')).not.toBeNull();
    expect(replayUrl.searchParams.get('traceRef')).toBe(trace);
    expect(replayUrl.searchParams.get('token')).toBeNull();
    expect(await page.evaluate(() => JSON.stringify(history.state))).not.toContain(server.token);

    await page.getByRole('button', { name: 'Settings' }).click();
    expect(new URL(page.url()).searchParams.get('view')).toBe('settings');
    await page.goBack();
    await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('runner');
    await page.locator('.tw-replay-controls').waitFor();
    await expect.poll(() => slider.inputValue()).toBe(String(desired));
    expect(new URL(page.url()).searchParams.get('executionId')).toBe(
      replayUrl.searchParams.get('executionId'),
    );

    await page.goForward();
    await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('settings');
    await page.goBack();
    await expect.poll(() => slider.inputValue()).toBe(String(desired));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.tw-replay-controls').waitFor();
    await expect.poll(() => page.getByLabel('Replay position').inputValue()).toBe(String(desired));
    await expect
      .poll(() => page.locator('.tw-connection-dot').getAttribute('data-connected'))
      .toBe('true');
    expect(new URL(page.url()).searchParams.get('token')).toBeNull();
    expect(errors).toEqual([]);
    await page.close();
  });
});
