import { afterEach, describe, expect, it } from 'vitest';
import { FakeSession, node, snapshot } from './__fixtures__/fake-session.js';
import { connectLiveSession } from './live-client.js';
import { startUiServer, type UiServer } from './server.js';

const servers: UiServer[] = [];
const connections: { close(): Promise<void> }[] = [];

afterEach(async () => {
  for (const connection of connections.splice(0)) await connection.close();
  for (const server of servers.splice(0)) await server.close();
});

describe('connectLiveSession', () => {
  it('queues a complete live session until the producer socket opens', async () => {
    const server = await startUiServer();
    servers.push(server);
    const session = new FakeSession('worker-session');
    const connection = connectLiveSession(session, { url: server.url, testId: 'test-42' });
    connections.push(connection);

    // Deliberately publish synchronously: all of these occur before the local
    // WebSocket handshake on a normal event-loop turn.
    session.clock = 12;
    session.output('Permission required');
    const tree = snapshot(
      2,
      [node({ id: 'approve', role: 'button', name: 'Approve' })],
      session.sessionId,
    );
    session.semantic(tree);
    session.action({ api: 'press', ok: true, selector: 'getByRole("button")' });
    session.logRecord({ level: 'warn', message: 'slow render', logger: 'app' });

    await until(
      () => server.hub.backlog.some((message) => message.type === 'app-log'),
      'the worker session messages',
    );
    expect(connection.enabled).toBe(true);
    expect(server.hub.backlog.map((message) => message.type)).toEqual([
      'session',
      'output',
      'semantic',
      'action',
      'app-log',
    ]);
    expect(server.hub.backlog.find((message) => message.type === 'semantic')).toMatchObject({
      sessionId: 'worker-session',
      revision: 2,
      snapshot: tree,
    });
    expect(server.hub.backlog.find((message) => message.type === 'action')).toMatchObject({
      sessionId: 'worker-session',
      testId: 'test-42',
      api: 'press',
      ok: true,
    });

    await connection.close();
    const count = server.hub.backlog.length;
    session.output('after detach');
    await new Promise((done) => setTimeout(done, 20));
    expect(server.hub.backlog).toHaveLength(count);
  });

  it('is a true no-op when no URL or an invalid URL is configured', async () => {
    const previous = process.env['TERMWRIGHT_UI_URL'];
    delete process.env['TERMWRIGHT_UI_URL'];
    try {
      const untouched = new Proxy({} as FakeSession, {
        get() {
          throw new Error('a disabled bridge touched its source');
        },
      });
      const absent = connectLiveSession(untouched);
      const explicitlyEmpty = connectLiveSession(untouched, { url: '' });
      const malformed = connectLiveSession(untouched, { url: 'not a URL' });
      expect(absent.enabled).toBe(false);
      expect(explicitlyEmpty.enabled).toBe(false);
      expect(malformed.enabled).toBe(false);
      await expect(absent.close()).resolves.toBeUndefined();
      await expect(explicitlyEmpty.close()).resolves.toBeUndefined();
      await expect(malformed.close()).resolves.toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env['TERMWRIGHT_UI_URL'];
      else process.env['TERMWRIGHT_UI_URL'] = previous;
    }
  });

  it('does not reject when the configured server is unavailable', async () => {
    const connection = connectLiveSession(new FakeSession(), {
      url: 'http://127.0.0.1:1/?token=gone',
      closeTimeoutMs: 50,
    });
    connections.push(connection);
    expect(connection.enabled).toBe(true);
    await expect(connection.close()).resolves.toBeUndefined();
  });

  it('makes close idempotent', async () => {
    const server = await startUiServer();
    servers.push(server);
    const connection = connectLiveSession(new FakeSession(), { url: server.url });
    connections.push(connection);
    const first = connection.close();
    expect(connection.close()).toBe(first);
    await expect(first).resolves.toBeUndefined();
  });
});

async function until(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}
