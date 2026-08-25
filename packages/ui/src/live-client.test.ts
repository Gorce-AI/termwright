import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { FakeSession, node, snapshot } from './__fixtures__/fake-session.js';
import { connectLiveSession } from './live-client.js';
import { startUiServer, type UiServer } from './server.js';
import { encodeMessage, parseServerMessage, type ServerMessage } from './events.js';

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
    const connection = connectLiveSession(session, { url: server.producerUrl, testId: 'test-42' });
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

  it('reports an explicit diagnostic gap when the pre-connect queue overflows', async () => {
    const server = await startUiServer();
    servers.push(server);
    const session = new FakeSession('flooded-worker-session');
    const connection = connectLiveSession(session, { url: server.producerUrl });
    connections.push(connection);

    for (let index = 0; index < 4_200; index += 1) session.output(`line ${index}`);

    await until(
      () => server.hub.backlog.some((message) => message.type === 'diagnostic-gap'),
      'the producer diagnostic gap',
    );
    expect(server.hub.backlog.find((message) => message.type === 'diagnostic-gap')).toMatchObject({
      source: 'live-session-producer',
    });
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
    const connection = connectLiveSession(new FakeSession(), { url: server.producerUrl });
    connections.push(connection);
    const first = connection.close();
    expect(connection.close()).toBe(first);
    await expect(first).resolves.toBeUndefined();
  });

  it('routes live Inspector questions to the worker production planner at one checkpoint', async () => {
    const server = await startUiServer();
    servers.push(server);
    const session = new FakeSession('planned-session');
    const tree = snapshot(7, [node({ id: 'save', role: 'button', name: 'Save' })], session.sessionId);
    session.semantic(tree);
    const calls: string[] = [];
    session.actionabilityPlanner = async (action, ref) => {
      calls.push(`${action}:${ref}`);
      return {
        actionable: true,
        intent: { kind: action, targetRef: ref },
        checkpoint: { sessionId: session.sessionId, contractId: 'planned-session:0', epoch: 0, sequence: 9, screenRevision: 8, semanticRevision: 7, pairedScreenRevision: 8 },
        requirements: [],
        strategy: action === 'type' ? 'focused-keyboard-type' : 'production-plan',
      };
    };
    const connection = connectLiveSession(session, { url: server.producerUrl });
    connections.push(connection);
    await until(() => server.hub.backlog.some((message) => message.type === 'session' && message.sessionId === session.sessionId), 'producer session');

    const url = new URL(server.url);
    url.protocol = 'ws:';
    url.pathname = '/ws';
    const socket = new WebSocket(url);
    const received: ServerMessage[] = [];
    socket.on('message', (raw: Buffer) => received.push(parseServerMessage(raw)));
    await new Promise<void>((done, fail) => { socket.once('open', done); socket.once('error', fail); });
    socket.send(encodeMessage({ v: 1, type: 'inspect-actionability', requestId: 'inspect-1', sessionId: session.sessionId, nodeId: 'save' }));
    await until(() => received.some((message) => message.type === 'actionability-inspection'), 'planner response');
    const response = received.find((message) => message.type === 'actionability-inspection');
    expect(response).toMatchObject({ requestId: 'inspect-1', nodeId: 'save' });
    expect(response?.type === 'actionability-inspection' ? response.results?.map((entry) => entry.kind) : []).toEqual(['click', 'hover', 'focus', 'type']);
    expect(response?.type === 'actionability-inspection' ? new Set(response.results?.map((entry) => `${entry.contractId}:${entry.sequence}`)).size : 0).toBe(1);
    expect(calls).toEqual([
      'click:semantic:save@7',
      'hover:semantic:save@7',
      'focus:semantic:save@7',
      'type:semantic:save@7',
    ]);
    socket.close();
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
