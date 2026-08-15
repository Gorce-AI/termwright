import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildFixtureTrace } from './__fixtures__/build-trace.js';
import { FakeHarness, node, snapshot } from './__fixtures__/fake-session.js';
import { encodeMessage, parseServerMessage, toBase64, type ClientMessage, type ServerMessage } from './events.js';
import { startUiServer, type UiServer } from './server.js';

const servers: UiServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

async function start(options: Parameters<typeof startUiServer>[0] = {}): Promise<UiServer> {
  const server = await startUiServer(options);
  servers.push(server);
  return server;
}

/** A browser tab: connects, collects messages, sends client messages. */
class Viewer {
  readonly received: ServerMessage[] = [];
  readonly #socket: WebSocket;

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.on('message', (raw: Buffer) => {
      this.received.push(parseServerMessage(raw));
    });
  }

  static async connect(server: UiServer, role?: string): Promise<Viewer> {
    const url = new URL(server.url);
    url.protocol = 'ws:';
    url.pathname = '/ws';
    if (role !== undefined) url.searchParams.set('role', role);
    const socket = new WebSocket(url);
    // The listener has to be attached before the socket opens: the server
    // replays its backlog the moment the upgrade completes.
    const viewer = new Viewer(socket);
    await new Promise<void>((done, fail) => {
      socket.once('open', () => done());
      socket.once('error', fail);
    });
    return viewer;
  }

  send(message: ClientMessage | ServerMessage): void {
    this.#socket.send(encodeMessage(message as ServerMessage));
  }

  sendRaw(text: string): void {
    this.#socket.send(text);
  }

  close(): void {
    this.#socket.close();
  }

  /** Waits until `predicate` holds over the collected messages. */
  async until(predicate: (messages: readonly ServerMessage[]) => boolean, label: string): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (predicate(this.received)) return;
      await new Promise((done) => setTimeout(done, 10));
    }
    throw new Error(`timed out waiting for ${label}; received: ${this.received.map((m) => m.type).join(', ')}`);
  }
}

async function api(server: UiServer, path: string, init?: RequestInit): Promise<Response> {
  const url = new URL(path, server.url);
  url.searchParams.set('token', server.token);
  return fetch(url, init);
}

describe('authentication', () => {
  it('rejects HTTP without the token', async () => {
    const server = await start();
    const response = await fetch(new URL('/api/state', server.url));
    expect(response.status).toBe(401);
  });

  it('rejects a WebSocket upgrade without the token', async () => {
    const server = await start();
    const url = new URL(server.url);
    url.protocol = 'ws:';
    url.pathname = '/ws';
    url.searchParams.delete('token');
    const socket = new WebSocket(url);
    await expect(
      new Promise((done, fail) => {
        socket.once('open', () => done('opened'));
        socket.once('error', fail);
      }),
    ).rejects.toThrow(/401/);
  });

  it('accepts the token in a header, for API clients', async () => {
    const server = await start();
    const response = await fetch(new URL('/api/state', server.url), {
      headers: { 'x-termwright-token': server.token },
    });
    expect(response.status).toBe(200);
  });
});

describe('live mode', () => {
  it('streams a session as output and semantic messages', async () => {
    const server = await start();
    const session = new FakeHarness('s1');
    server.attach({ source: session });
    const viewer = await Viewer.connect(server);

    session.output('Permission required');
    const tree = snapshot(4, [node({ id: 'b1', role: 'button', name: 'Approve' })], 's1');
    session.semantic(tree);

    await viewer.until((messages) => messages.some((m) => m.type === 'semantic'), 'the tree');
    expect(viewer.received.map((message) => message.type)).toEqual(['run-start', 'output', 'semantic']);
    const output = viewer.received[1];
    expect(output?.type === 'output' && output.dataB64).toBe(
      toBase64(new TextEncoder().encode('Permission required')),
    );
    viewer.close();
  });

  it('delivers a run published by a producer to every viewer', async () => {
    const server = await start();
    const producer = await Viewer.connect(server, 'producer');
    const viewer = await Viewer.connect(server);

    producer.send({ v: 1, type: 'test-start', id: 't1', title: 'login' });
    producer.send({ v: 1, type: 'test-end', id: 't1', status: 'passed' });

    await viewer.until((messages) => messages.some((m) => m.type === 'test-end'), 'the test result');
    expect(viewer.received.map((message) => message.type)).toEqual(['run-start', 'test-start', 'test-end']);
    viewer.close();
    producer.close();
  });

  it('routes rerun and stop to the callbacks the runner supplied', async () => {
    const reruns: (readonly string[] | undefined)[] = [];
    let stopped = 0;
    const server = await start({
      onRerun: (testIds) => reruns.push(testIds),
      onStop: () => {
        stopped += 1;
      },
    });
    const viewer = await Viewer.connect(server);
    viewer.send({ v: 1, type: 'rerun', testIds: ['t1'] });
    viewer.send({ v: 1, type: 'stop' });

    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && (reruns.length === 0 || stopped === 0)) {
      await new Promise((done) => setTimeout(done, 10));
    }
    expect(reruns).toEqual([['t1']]);
    expect(stopped).toBe(1);
    viewer.close();
  });

  it('survives a malformed frame without dropping the connection', async () => {
    const server = await start();
    const viewer = await Viewer.connect(server);
    viewer.sendRaw('}{ not json');
    viewer.sendRaw('{"v":1,"type":"nonsense"}');
    const session = new FakeHarness('s1');
    server.attach({ source: session });
    session.output('still here');
    await viewer.until((messages) => messages.some((m) => m.type === 'output'), 'output after bad frames');
    viewer.close();
  });

  it('lists attached sessions over HTTP', async () => {
    const server = await start();
    const session = new FakeHarness('s1');
    const detach = server.attach({ source: session, command: ['node', 'app.js'], columns: 80, rows: 24 });
    const body = (await (await api(server, '/api/state')).json()) as {
      mode: string;
      sessions: { sessionId: string; writable: boolean }[];
    };
    expect(body.mode).toBe('live');
    expect(body.sessions).toEqual([
      { sessionId: 's1', command: ['node', 'app.js'], columns: 80, rows: 24, writable: false },
    ]);
    detach();
    const after = (await (await api(server, '/api/state')).json()) as { sessions: unknown[] };
    expect(after.sessions).toHaveLength(0);
  });
});

describe('post-mortem mode', () => {
  it('replays the archive timeline on connect and serves state at a moment', async () => {
    const server = await start({ trace: await buildFixtureTrace() });
    const viewer = await Viewer.connect(server);
    await viewer.until((messages) => messages.some((m) => m.type === 'run-end'), 'the replayed run');
    expect(viewer.received.map((message) => message.type)).toEqual([
      'run-start',
      'test-start',
      'step',
      'step',
      'test-end',
      'run-end',
    ]);

    const state = (await (await api(server, '/api/trace/state?t=500')).json()) as {
      castPrefixB64: string;
      revision: number;
    };
    expect(Buffer.from(state.castPrefixB64, 'base64').toString('utf8')).toContain('Permission required');
    expect(state.revision).toBe(1);
    viewer.close();
  });

  it('reports no trace when the server is live', async () => {
    const server = await start();
    expect((await api(server, '/api/trace/state?t=0')).status).toBe(409);
  });
});

describe('record mode', () => {
  it('forwards browser input to the child and generates a test', async () => {
    const harness = new FakeHarness('rec');
    const server = await start({
      record: { command: ['node', 'agent.js'], launch: async () => harness.asHarness() },
    });
    const viewer = await Viewer.connect(server);
    viewer.send({
      v: 1,
      type: 'input',
      sessionId: 'rec',
      dataB64: toBase64(new TextEncoder().encode('ls\r')),
    });

    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && harness.writtenText() !== 'ls\r') {
      await new Promise((done) => setTimeout(done, 10));
    }
    expect(harness.writtenText()).toBe('ls\r');

    harness.semantic(snapshot(1, [node({ id: 'b1', role: 'button', name: 'Approve' })], 'rec'));
    const action = await api(server, '/api/record/action', {
      method: 'POST',
      body: JSON.stringify({ kind: 'click', nodeId: 'b1' }),
    });
    const body = (await action.json()) as { selector: { expression: string }; source: string };
    expect(body.selector.expression).toBe("app.getByRole('button', { name: 'Approve' })");
    expect(body.source).toContain("await app.type('ls');");
    expect(body.source).toContain("await app.press('Enter');");
    expect(body.source).toContain("await app.getByRole('button', { name: 'Approve' }).click();");
    viewer.close();
  });

  it('holds input back while pick mode is on', async () => {
    const harness = new FakeHarness('rec');
    const server = await start({
      record: { command: ['node', 'agent.js'], launch: async () => harness.asHarness() },
    });
    const viewer = await Viewer.connect(server);
    viewer.send({ v: 1, type: 'pick', sessionId: 'rec', enabled: true });
    await new Promise((done) => setTimeout(done, 50));
    viewer.send({ v: 1, type: 'input', sessionId: 'rec', dataB64: toBase64(new TextEncoder().encode('x')) });
    await new Promise((done) => setTimeout(done, 100));
    expect(harness.writtenText()).toBe('');
    viewer.close();
  });

  it('records assertions and steps over HTTP', async () => {
    const harness = new FakeHarness('rec');
    const server = await start({
      record: { command: ['node', 'agent.js'], launch: async () => harness.asHarness() },
    });
    await api(server, '/api/record/step', { method: 'POST', body: JSON.stringify({ title: 'approve' }) });
    const response = await api(server, '/api/record/assert', {
      method: 'POST',
      body: JSON.stringify({ kind: 'snapshot' }),
    });
    const body = (await response.json()) as { source: string };
    expect(body.source).toContain("await step('approve', async () => {");
    expect(body.source).toContain('await expect(app).toMatchSemanticSnapshot();');
  });

  it('rejects recorder routes when not recording', async () => {
    const server = await start();
    expect((await api(server, '/api/record/events')).status).toBe(409);
  });
});

describe('static files', () => {
  it('explains itself when the bundle has not been built', async () => {
    const server = await start({ appDir: '/nonexistent-app-dir' });
    const response = await api(server, '/');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('not built');
  });

  it('refuses to serve outside the app directory', async () => {
    const server = await start({ appDir: '/nonexistent-app-dir' });
    const response = await api(server, '/%2e%2e/%2e%2e/etc/passwd');
    expect([403, 404]).toContain(response.status);
  });

  it('404s an unknown API route', async () => {
    const server = await start();
    expect((await api(server, '/api/nope')).status).toBe(404);
  });
});
