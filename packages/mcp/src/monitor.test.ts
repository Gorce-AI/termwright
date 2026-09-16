import { describe, expect, it } from 'vitest';
import { createSessionStores, closeSessionStores } from './sessions.js';
import { startMonitor } from './monitor.js';

describe('MCP Monitor', () => {
  it('serves a capability-scoped read-only page and live state', async () => {
    const stores = createSessionStores({ sessionKey: 'monitor-test' });
    const monitor = await startMonitor(stores, { openBrowser: false });
    try {
      const page = await fetch(monitor.url);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('Termwright MCP Monitor');

      const state = await fetch(new URL('state', monitor.url));
      expect(await state.json()).toEqual({ terminals: [], watchers: [] });

      const denied = await fetch(new URL('/state', monitor.url));
      expect(denied.status).toBe(404);
    } finally {
      await monitor.close();
      await monitor.close();
      await closeSessionStores(stores);
    }
  });

  it('refuses to expose the monitor on a non-loopback interface', async () => {
    const stores = createSessionStores({ sessionKey: 'monitor-bind-test' });
    try {
      await expect(startMonitor(stores, { host: '0.0.0.0', openBrowser: false })).rejects.toThrow(
        /non-loopback/u,
      );
    } finally {
      await closeSessionStores(stores);
    }
  });
});
