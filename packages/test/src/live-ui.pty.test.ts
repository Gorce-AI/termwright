/**
 * Production-path proof that the Vitest fixture's worker-side session reaches
 * `termwright ui` over the producer WebSocket, not through an in-process hub.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startUiServer } from '@termwright/ui';
import { afterAll, describe, expect } from 'vitest';
import { configureTermwright, ptyAvailable, test } from './index.js';

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'driver',
  'test-fixtures',
);
const available = await ptyAvailable();
const previousUiUrl = process.env['TERMWRIGHT_UI_URL'];
const server = available ? await startUiServer() : undefined;

if (server !== undefined) process.env['TERMWRIGHT_UI_URL'] = server.producerUrl;

configureTermwright({
  columns: 80,
  rows: 24,
  trace: 'off',
  timeouts: { expect: 5_000 },
  command: [process.execPath, join(FIXTURES, 'semantic-app.mjs')],
});

afterAll(async () => {
  if (previousUiUrl === undefined) delete process.env['TERMWRIGHT_UI_URL'];
  else process.env['TERMWRIGHT_UI_URL'] = previousUiUrl;
  await server?.close();
});

describe.skipIf(!available)('the termwright ui worker/session bridge', () => {
  test(
    'streams a real PTY session while the test is running',
    { timeout: 30_000 },
    async ({ terminal }) => {
      const app = await terminal.launch();
      await app.waitForText('Permission required');
      // The adapter grants its live-log budget during negotiation. A screen can
      // be ready before that handshake on a busy, parallel test run.
      await app.settled({ timeout: 5_000 });

      // Both actions create fresh live evidence after terminal.launch() installed
      // the bridge: Tab repaints and revises the tree, `g` emits an adapter log.
      const beforeTab = app.screen().revision;
      await app.press('Tab');
      // PTYs may coalesce adjacent writes under parallel load. Waiting for the
      // repaint keeps Tab and `g` as two application inputs, not one `\tg` chunk
      // the fixture intentionally does not interpret.
      await app.waitForRender({ after: beforeTab, timeout: 5_000 });
      await app.press('g');

      await until(() => {
        const types = eventsFor(app.sessionId).map((message) => message.type);
        return ['session', 'output', 'semantic', 'action', 'app-log'].every((type) =>
          types.includes(type as (typeof types)[number]),
        );
      });

      const messages = eventsFor(app.sessionId);
      expect(messages.some((message) => message.type === 'session')).toBe(true);
      expect(messages.some((message) => message.type === 'output')).toBe(true);
      expect(messages.some((message) => message.type === 'semantic')).toBe(true);
      expect(
        messages.some(
          (message) => message.type === 'app-log' && message.message === 'a single record',
        ),
      ).toBe(true);
      expect(
        messages.some(
          (message) =>
            message.type === 'action' &&
            message.api === 'press' &&
            message.ok &&
            typeof message.testId === 'string' &&
            message.testId.length > 0,
        ),
      ).toBe(true);
    },
  );
});

function eventsFor(sessionId: string) {
  return (server?.hub.backlog ?? []).filter(
    (message) => 'sessionId' in message && message.sessionId === sessionId,
  );
}

async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error(
    `timed out waiting for live UI messages; received: ${server?.hub.backlog.map((message) => message.type).join(', ')}`,
  );
}
