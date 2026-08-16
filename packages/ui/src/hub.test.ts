import { describe, expect, it } from 'vitest';
import { parseServerMessage, toBase64, type ServerMessage } from './events.js';
import { UiHub } from './hub.js';
import { attachSession } from './live.js';
import { FakeSession, node, snapshot } from './__fixtures__/fake-session.js';

class RecordingClient {
  readonly received: ServerMessage[] = [];
  send(data: string): void {
    this.received.push(parseServerMessage(data));
  }
}

const output = (text: string, t = 0): ServerMessage => ({
  v: 1,
  type: 'output',
  sessionId: 's1',
  dataB64: toBase64(new TextEncoder().encode(text)),
  t,
});

describe('UiHub', () => {
  it('replays the backlog to a client that connects late', () => {
    const hub = new UiHub();
    hub.publish({ v: 1, type: 'run-start', mode: 'live', startedAt: 1 });
    hub.publish({ v: 1, type: 'test-start', id: 't1', title: 'login', file: '/repo/a.test.ts', startedAt: 1 });
    const client = new RecordingClient();
    hub.addClient(client);
    expect(client.received.map((message) => message.type)).toEqual(['run-start', 'test-start']);
  });

  it('broadcasts to every connected client', () => {
    const hub = new UiHub();
    const first = new RecordingClient();
    const second = new RecordingClient();
    hub.addClient(first);
    hub.addClient(second);
    hub.publish(output('hi'));
    expect(first.received).toHaveLength(1);
    expect(second.received).toHaveLength(1);
  });

  it('stops sending to a removed client', () => {
    const hub = new UiHub();
    const client = new RecordingClient();
    const remove = hub.addClient(client);
    remove();
    hub.publish(output('hi'));
    expect(client.received).toHaveLength(0);
    expect(hub.clientCount).toBe(0);
  });

  it('drops a client whose socket throws mid-broadcast', () => {
    const hub = new UiHub();
    hub.addClient({
      send() {
        throw new Error('socket closed');
      },
    });
    hub.publish(output('hi'));
    expect(hub.clientCount).toBe(0);
  });

  it('clears the backlog when a new run starts', () => {
    const hub = new UiHub();
    hub.publish({ v: 1, type: 'run-start', mode: 'live', startedAt: 1 });
    hub.publish(output('first run'));
    hub.publish({ v: 1, type: 'run-start', mode: 'live', startedAt: 2 });
    expect(hub.backlog.map((message) => message.type)).toEqual(['run-start']);
  });

  it('drops output before lifecycle messages when the backlog fills', () => {
    const hub = new UiHub({ maxMessages: 3 });
    hub.publish({ v: 1, type: 'run-start', mode: 'live', startedAt: 1 });
    hub.publish({ v: 1, type: 'test-start', id: 't1', title: 'login', file: '/repo/a.test.ts', startedAt: 1 });
    hub.publish(output('a'));
    hub.publish(output('b'));
    hub.publish(output('c'));
    expect(hub.backlog.map((message) => message.type)).toEqual(['run-start', 'test-start', 'output']);
  });

  it('bounds the backlog by output bytes as well as by count', () => {
    const hub = new UiHub({ maxOutputBytes: 16 });
    for (let index = 0; index < 10; index += 1) hub.publish(output('0123456789'));
    const bytes = hub.backlog
      .filter((message) => message.type === 'output')
      .reduce((total, message) => total + (message.type === 'output' ? message.dataB64.length : 0), 0);
    expect(bytes).toBeLessThanOrEqual(16);
  });
});

describe('attachSession', () => {
  it('publishes output as base64 with the session clock', () => {
    const hub = new UiHub();
    const session = new FakeSession('s1');
    attachSession(hub, session);
    session.clock = 42;
    session.output('ready');
    expect(hub.backlog).toEqual([
      { v: 1, type: 'output', sessionId: 's1', dataB64: toBase64(new TextEncoder().encode('ready')), t: 42 },
    ]);
  });

  it('publishes a tree only once the session holds the announced revision', () => {
    const hub = new UiHub();
    const session = new FakeSession('s1');
    attachSession(hub, session);

    session.announceRevision(7); // announced, not yet observable
    expect(hub.backlog).toHaveLength(0);

    const tree = snapshot(7, [node({ id: 'n1', role: 'button', name: 'Go' })]);
    session.semantic(tree);
    expect(hub.backlog).toEqual([{ v: 1, type: 'semantic', sessionId: 's1', revision: 7, snapshot: tree }]);
  });

  it('stops publishing after detaching', () => {
    const hub = new UiHub();
    const session = new FakeSession('s1');
    attachSession(hub, session)();
    session.output('ignored');
    expect(hub.backlog).toHaveLength(0);
  });
});

describe('application logs', () => {
  it('publishes a followed file line without inventing a level', () => {
    const hub = new UiHub();
    const session = new FakeSession('s1');
    attachSession(hub, session);
    session.clock = 120;
    session.logLine('ERROR: disk full');

    expect(hub.backlog).toEqual([
      {
        v: 1,
        type: 'app-log',
        sessionId: 's1',
        t: 120,
        source: 'file',
        level: null,
        message: 'ERROR: disk full',
        label: 'server.log',
      },
    ]);
  });

  it('publishes an adapter record with its level and structure', () => {
    const hub = new UiHub();
    const session = new FakeSession('s1');
    attachSession(hub, session);
    session.logRecord({ level: 'warn', message: 'pool exhausted', logger: 'db.pool', attrs: { size: 10 } });

    const message = hub.backlog[0];
    expect(message?.type === 'app-log' && message.level).toBe('warn');
    expect(message?.type === 'app-log' && message.logger).toBe('db.pool');
    expect(message?.type === 'app-log' && message.attrs).toEqual({ size: 10 });
  });

  it('drops a log event that carries nothing to show', () => {
    const hub = new UiHub();
    const session = new FakeSession('s1');
    attachSession(hub, session);
    session.logLine('');
    expect(hub.backlog).toHaveLength(0);
  });

  it('evicts logs before lifecycle messages, and never run-start', () => {
    const hub = new UiHub({ maxMessages: 3 });
    hub.publish({ v: 1, type: 'run-start', mode: 'live', startedAt: 1 });
    hub.publish({ v: 1, type: 'test-start', id: 't1', title: 'login', file: '/repo/a.test.ts', startedAt: 1 });
    for (let index = 0; index < 20; index += 1) {
      hub.publish({ v: 1, type: 'app-log', sessionId: 's1', t: index, source: 'file', level: null, message: 'noise' });
    }
    expect(hub.backlog.map((message) => message.type)).toEqual(['run-start', 'test-start', 'app-log']);
  });
});

describe('driver actions', () => {
  it('publishes a finished action with its selector and target', () => {
    const hub = new UiHub();
    const session = new FakeSession('s1');
    attachSession(hub, session);
    session.clock = 120;
    session.action({ api: 'click', ok: true, selector: 'getByRole("button")', ref: 'n8@42' });

    expect(hub.backlog).toEqual([
      {
        v: 1,
        type: 'action',
        kind: 'action',
        api: 'click',
        t: 120,
        ok: true,
        sessionId: 's1',
        selector: 'getByRole("button")',
        ref: 'n8@42',
      },
    ]);
  });

  it('publishes failures too, with the code that grouped them', () => {
    const hub = new UiHub();
    const session = new FakeSession('s1');
    attachSession(hub, session);
    session.action({ api: 'click', ok: false, error: 'unsupported-action' });

    const message = hub.backlog[0];
    expect(message?.type === 'action' && message.ok).toBe(false);
    expect(message?.type === 'action' && message.error).toBe('unsupported-action');
    expect(message?.type === 'action' && message.ref).toBeUndefined();
  });

  it('stops publishing actions after detaching', () => {
    const hub = new UiHub();
    const session = new FakeSession('s1');
    attachSession(hub, session)();
    session.action({ api: 'press', ok: true });
    expect(hub.backlog).toHaveLength(0);
  });
});
