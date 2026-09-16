/// <reference lib="dom" />
import { afterEach, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import type { CellSnapshot, ScreenSnapshot } from '@termwright/driver';
import type { SessionStores, TerminalEntry } from './sessions.js';
import { createMonitorLifecycle, startMonitor, type MonitorHandle } from './monitor.js';

const DEFAULT_CELL: CellSnapshot = {
  char: ' ',
  width: 1,
  fg: { kind: 'default' },
  bg: { kind: 'default' },
  attributes: {
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    inverse: false,
    strikethrough: false,
  },
};

let browser: Browser | undefined;
let monitor: MonitorHandle | undefined;

afterEach(async () => {
  await monitor?.close();
  await browser?.close();
  monitor = undefined;
  browser = undefined;
});

function fixture(): {
  stores: SessionStores;
  setText(value: string): void;
  setOpen(value: boolean): void;
  setSecondOpen(value: boolean): void;
  setSecondText(value: string): void;
} {
  const states = [
    { revision: 1, text: 'RED ready', colour: 1 },
    { revision: 1, text: 'BLUE second live', colour: 4 },
  ];
  let open = true;
  let secondOpen = false;
  const entry = (index: number): TerminalEntry => {
    const screen = (): ScreenSnapshot => {
      const current = states[index] as (typeof states)[number];
      return {
        revision: current.revision,
        columns: 80,
        rows: 40,
        buffer: 'alternate',
        cursor: { row: 2, column: 4, visible: true, shape: 'block' },
        modes: {} as ScreenSnapshot['modes'],
        text: () => current.text,
        line: (row) => (row === 0 ? current.text : ''),
        cell: (row, column) => {
          const char = row === 0 ? (current.text[column] ?? ' ') : ' ';
          if (row === 0 && column < 3) {
            return {
              ...DEFAULT_CELL,
              char,
              fg: { kind: 'palette', index: current.colour },
              attributes: { ...DEFAULT_CELL.attributes, bold: true },
            };
          }
          return { ...DEFAULT_CELL, char };
        },
        ansi: () => current.text,
        html: () => current.text,
      };
    };
    return {
      id: `t${index + 1}`,
      harness: { screen, semanticTree: () => null },
      exit: null,
      writer: undefined,
    } as unknown as TerminalEntry;
  };
  const entries = [entry(0), entry(1)];
  const stores = {
    terminals: { list: () => (open ? entries.slice(0, secondOpen ? 2 : 1) : []) },
    watchers: { list: () => [] },
    traces: {},
  } as unknown as SessionStores;
  return {
    stores,
    setText(value) {
      states[0]!.text = value;
      states[0]!.revision += 1;
    },
    setOpen(value) {
      open = value;
    },
    setSecondOpen(value) {
      secondOpen = value;
    },
    setSecondText(value) {
      states[1]!.text = value;
      states[1]!.revision += 1;
    },
  };
}

async function startBrowserMonitor(stores: SessionStores): Promise<Page> {
  let page: Page | undefined;
  monitor = await startMonitor(stores, {
    browserLauncher: async (url) => {
      browser = await chromium.launch();
      page = await browser.newPage({ viewport: { width: 900, height: 600 } });
      await page.goto(url);
      return { close: () => browser?.close() };
    },
  });
  if (page === undefined) throw new Error('browser launcher did not create a monitor page');
  return page;
}

describe('MCP monitor browser', () => {
  it('renders live styled cells, cursor and a complete fitted terminal', async () => {
    const state = fixture();
    const monitorPage = await startBrowserMonitor(state.stores);

    await monitorPage.waitForFunction(
      () => document.querySelector('#screen')?.textContent?.includes('RED ready') === true,
    );
    await monitorPage.waitForFunction(
      () =>
        getComputedStyle(document.querySelector('#screen .screen-row span')!).color ===
        'rgb(205, 49, 49)',
    );
    await monitorPage.waitForFunction(
      () =>
        getComputedStyle(document.querySelector('#screen .screen-row span')!).fontWeight === '700',
    );
    expect(
      await monitorPage.locator('#cursor').evaluate((node) => getComputedStyle(node).display),
    ).toBe('block');
    const fitted = await monitorPage.evaluate(() => {
      const host = document.querySelector('.terminal')?.getBoundingClientRect();
      const screen = document.querySelector('#screen')?.getBoundingClientRect();
      return host !== undefined && screen !== undefined
        ? screen.right <= host.right + 1 && screen.bottom <= host.bottom + 1
        : false;
    });
    expect(fitted).toBe(true);
    expect(await monitorPage.locator('#scale-status').textContent()).toMatch(/% · fitted 80×40$/u);

    const autoSize = Number.parseFloat(
      await monitorPage.locator('.viewport').evaluate((node) => getComputedStyle(node).fontSize),
    );
    await monitorPage.getByRole('button', { name: 'Increase terminal scale' }).click();
    expect(await monitorPage.locator('#scale-status').textContent()).toMatch(/% · manual$/u);
    const manualSize = Number.parseFloat(
      await monitorPage.locator('.viewport').evaluate((node) => getComputedStyle(node).fontSize),
    );
    expect(manualSize).toBeGreaterThan(autoSize);
    await monitorPage.getByRole('button', { name: 'Auto' }).click();
    expect(await monitorPage.locator('#scale-status').textContent()).toMatch(/% · fitted 80×40$/u);

    await monitorPage.getByRole('button', { name: 'Fullscreen' }).click();
    await monitorPage.waitForFunction(
      () => document.fullscreenElement?.classList.contains('terminal') === true,
    );
    await monitorPage.getByRole('button', { name: 'Exit fullscreen' }).click();
    await monitorPage.waitForFunction(() => document.fullscreenElement === null);

    state.setText('RED updated live');
    await monitorPage.waitForFunction(
      () => document.querySelector('#screen')?.textContent?.includes('RED updated live') === true,
    );

    const closedPage = monitorPage.waitForEvent('close');
    const activeMonitor = monitor;
    if (activeMonitor === undefined) throw new Error('monitor closed before the lifecycle check');
    await activeMonitor.close();
    monitor = undefined;
    await closedPage;
    expect(monitorPage.isClosed()).toBe(true);
  });

  it('switches between two live terminals without losing either live state', async () => {
    const state = fixture();
    state.setSecondOpen(true);
    const page = await startBrowserMonitor(state.stores);

    await page.waitForFunction(
      () => document.querySelector('#screen')?.textContent?.includes('RED ready') === true,
    );
    await page.getByRole('button', { name: 't2' }).click();
    await page.waitForFunction(
      () => document.querySelector('#screen')?.textContent?.includes('BLUE second live') === true,
    );
    expect(await page.getByRole('button', { name: 't2' }).getAttribute('class')).toContain(
      'active',
    );

    state.setText('RED updated while hidden');
    state.setSecondText('BLUE updated while selected');
    await page.waitForFunction(
      () =>
        document.querySelector('#screen')?.textContent?.includes('BLUE updated while selected') ===
        true,
    );
    expect(await page.locator('#screen').textContent()).not.toContain('RED updated while hidden');

    await page.getByRole('button', { name: 't1' }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('#screen')?.textContent?.includes('RED updated while hidden') ===
        true,
    );
    expect(await page.getByRole('button', { name: 't1' }).getAttribute('class')).toContain(
      'active',
    );
  });

  it('starts on the first terminal and stops after the last terminal closes', async () => {
    const state = fixture();
    state.setOpen(false);
    const started: string[] = [];
    const lifecycle = createMonitorLifecycle(state.stores, {
      openBrowser: false,
      onStarted: (url) => started.push(url),
    });
    expect(lifecycle.url).toBeUndefined();
    expect(started).toEqual([]);

    state.setOpen(true);
    await lifecycle.terminalLaunched();
    expect(lifecycle.url).toMatch(/^http:\/\/127\.0\.0\.1:/u);
    expect(started).toEqual([lifecycle.url]);

    state.setOpen(false);
    await lifecycle.terminalClosed();
    expect(lifecycle.url).toBeUndefined();
    await lifecycle.close();
  });

  it('reports a browser startup failure without failing terminal launch lifecycle', async () => {
    const state = fixture();
    const errors: unknown[] = [];
    const lifecycle = createMonitorLifecycle(state.stores, {
      browserLauncher: () => {
        throw new Error('browser unavailable');
      },
      onError: (error) => errors.push(error),
    });

    await expect(lifecycle.terminalLaunched()).resolves.toBeUndefined();
    expect(lifecycle.url).toBeUndefined();
    expect(errors).toEqual([expect.objectContaining({ message: 'browser unavailable' })]);
    await lifecycle.close();
  });
});
