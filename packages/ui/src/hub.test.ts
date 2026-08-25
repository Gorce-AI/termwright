import { describe, expect, it } from 'vitest';
import { encodeMessage, parseServerMessage, toBase64, type ServerMessage } from './events.js';
import { UiHub } from './hub.js';
import { attachSession } from './live.js';
import { FakeSession, node, snapshot } from './__fixtures__/fake-session.js';

class RecordingClient {
  readonly received: ServerMessage[] = [];
  send(data: string): void {
    this.received.push(parseServerMessage(data));
  }
}

/**
 * Everything a session publishes comes after its `session` announcement, which
 * is the first thing on the wire so the browser can build a terminal that
 * measures the way the session does.
 */
const afterAnnouncement = (hub: UiHub): readonly ServerMessage[] => hub.backlog.slice(1);

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
    hub.publish({ v: 1, type: 'run-start', runId: 'run:test', mode: 'live', startedAt: 1 });
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
    hub.publish({ v: 1, type: 'run-start', runId: 'run:test', mode: 'live', startedAt: 1 });
    hub.publish(output('first run'));
    hub.publish({ v: 1, type: 'run-start', runId: 'run:test', mode: 'live', startedAt: 2 });
    expect(hub.backlog.map((message) => message.type)).toEqual(['run-start']);
  });

  it('drops output before lifecycle messages when the backlog fills', () => {
    const hub = new UiHub({ maxMessages: 3 });
    hub.publish({ v: 1, type: 'run-start', runId: 'run:test', mode: 'live', startedAt: 1 });
    hub.publish({ v: 1, type: 'test-start', id: 't1', title: 'login', file: '/repo/a.test.ts', startedAt: 1 });
    hub.publish(output('a'));
    hub.publish(output('b'));
    hub.publish(output('c'));
    expect(hub.backlog.map((message) => message.type)).toEqual(['run-start', 'test-start', 'diagnostic-gap']);
    expect(hub.backlog.at(-1)).toMatchObject({
      source: 'ui-hub',
      droppedMessages: 3,
    });
  });

  it('bounds the backlog by output bytes as well as by count', () => {
    const hub = new UiHub({ maxOutputBytes: 16 });
    for (let index = 0; index < 10; index += 1) hub.publish(output('0123456789'));
    const bytes = hub.backlog
      .filter((message) => message.type === 'output')
      .reduce((total, message) => total + (message.type === 'output' ? message.dataB64.length : 0), 0);
    expect(bytes).toBeLessThanOrEqual(16);
    expect(hub.backlog.find((message) => message.type === 'diagnostic-gap')).toMatchObject({
      source: 'ui-hub',
      droppedMessages: 9,
    });
  });

  it('coalesces and retains the newest session state under backlog pressure', () => {
    const hub = new UiHub({ maxMessages: 2 });
    hub.publish({ v: 1, type: 'run-start', runId: 'run:test', mode: 'live', startedAt: 1 });
    hub.publish({
      v: 1,
      type: 'session',
      sessionId: 's1',
      terminalProfile: 'default',
      columns: 80,
      rows: 24,
    });
    hub.publish({
      v: 1,
      type: 'session',
      sessionId: 's1',
      terminalProfile: 'default',
      columns: 80,
      rows: 24,
    });
    hub.publish(output('evict me'));
    hub.publish(output('evict me too'));

    expect(hub.backlog.map((message) => message.type)).toEqual(['run-start', 'session', 'diagnostic-gap']);
    expect(hub.backlog[1]).toMatchObject({
      type: 'session',
      terminalProfile: 'default',
    });
  });

  it('updates a session in place so late clients see metadata before its output', () => {
    const hub = new UiHub();
    hub.publish({
      v: 1,
      type: 'session',
      sessionId: 's1',
      terminalProfile: 'default',
      columns: 80,
      rows: 24,
    });
    hub.publish(output('already rendered'));
    hub.publish({
      v: 1,
      type: 'session',
      sessionId: 's1',
      terminalProfile: 'default',
      columns: 80,
      rows: 24,
    });

    expect(hub.backlog.map((message) => message.type)).toEqual(['session', 'output']);
    expect(hub.backlog[0]).toMatchObject({ terminalProfile: 'default' });
  });
});

describe('attachSession', () => {
  it('replays startup output and its exact semantic snapshot after attaching', () => {
    const hub = new UiHub();
    const session = new FakeSession('s1');
    session.output('booted before observer');
    session.semantic(snapshot(1, [node({ id: 'boot', role: 'text', name: 'Booted' })]));

    attachSession(hub, session);

    expect(hub.backlog.map((message) => message.type)).toEqual(['session', 'output', 'semantic']);
    expect(hub.backlog[1]).toMatchObject({ type: 'output' });
    expect(hub.backlog[2]).toMatchObject({
      type: 'semantic',
      revision: 1,
      snapshot: { nodes: [expect.objectContaining({ id: 'boot', name: 'Booted' })] },
    });
  });

  it('withholds sensitive semantic values before Runner publication', () => {
    const secret = 'TW_SENTINEL_runner_4fe0';
    const hub = new UiHub();
    const session = new FakeSession('s1');
    attachSession(hub, session);
    session.semantic(snapshot(1, [node({
      id: 'password', role: 'textbox', name: 'Password',
      value: { status: 'known', value: secret, sensitivity: 'sensitive', evidence: { source: 'application', method: 'native', strength: 'authoritative', providerId: 'app' } },
    })]));
    const published = JSON.stringify(hub.backlog);
    expect(published).not.toContain(secret);
    expect(published).toContain('withheld');
  });
  it('announces the session before anything it produces', () => {
    const hub = new UiHub();
    const session = new FakeSession('s1');
    session.terminalProfile = 'iterm2-ambiguous-wide';
    attachSession(hub, session);
    expect(hub.backlog[0]).toEqual({
      v: 1,
      type: 'session',
      sessionId: 's1',
      terminalProfile: 'iterm2-ambiguous-wide',
      columns: 80,
      rows: 24,
    });
  });

  it('announces the frozen framework contract and supported capability layer', () => {
    const hub = new UiHub();
    const session = new FakeSession('s1');
    session.negotiateFramework('fixture', '2.0.0', ['semantic-tree', 'stable-identity']);
    attachSession(hub, session);
    expect(hub.backlog[0]).toMatchObject({
      contract: {
        framework: { name: 'fixture', version: '2.0.0' },
        capabilities: {
          'semantic-tree': { status: 'supported' },
          'stable-identity': { status: 'supported' },
        },
      },
      adapterStatus: 'attached',
    });
  });

  it('refreshes the contract after a late adapter handshake', () => {
    const hub = new UiHub();
    const client = new RecordingClient();
    hub.addClient(client);
    const session = new FakeSession('s1');
    attachSession(hub, session);

    session.negotiateFramework('fixture', '0.1.0', ['semantic-tree', 'stable-identity']);
    session.diagnostic('adapter-attached');

    expect(() => encodeMessage(hub.backlog[0] as ServerMessage)).not.toThrow();
    expect(() => parseServerMessage(encodeMessage(hub.backlog[0] as ServerMessage))).not.toThrow();
    expect(client.received).toHaveLength(2);
    expect(client.received[1]).toMatchObject({
      type: 'session',
      contract: {
        framework: { name: 'fixture', version: '0.1.0' },
        capabilities: {
          'semantic-tree': { status: 'supported' },
          'stable-identity': { status: 'supported' },
        },
      },
      adapterStatus: 'attached',
    });
    expect(hub.backlog).toHaveLength(1);
  });

  it('reports disconnects and does not downgrade a protocol failure', () => {
    const hub = new UiHub();
    const session = new FakeSession('s1');
    session.negotiateFramework('fixture', '1.0.0');
    attachSession(hub, session);

    session.diagnostic('protocol-violation');
    session.diagnostic('adapter-disconnected');

    expect(hub.backlog).toHaveLength(1);
    expect(hub.backlog[0]).toMatchObject({ type: 'session', adapterStatus: 'error' });
  });

  it('publishes output as base64 with the session clock', () => {
    const hub = new UiHub();
    const session = new FakeSession('s1');
    attachSession(hub, session);
    session.clock = 42;
    session.output('ready');
    expect(afterAnnouncement(hub)).toEqual([
      { v: 1, type: 'output', sessionId: 's1', dataB64: toBase64(new TextEncoder().encode('ready')), t: 42 },
    ]);
  });

  it('publishes the exact tree carried by each revision instead of reading newer state', () => {
    const hub = new UiHub();
    const session = new FakeSession('s1');
    const first = snapshot(7, [node({ id: 'n1', role: 'button', name: 'First' })]);
    const second = snapshot(8, [node({ id: 'n1', role: 'button', name: 'Second' })]);
    session.semantic(first);
    session.semantic(second);

    attachSession(hub, session);
    expect(afterAnnouncement(hub)).toEqual([
      { v: 1, type: 'semantic', sessionId: 's1', revision: 7, snapshot: first },
      { v: 1, type: 'semantic', sessionId: 's1', revision: 8, snapshot: second },
    ]);
  });

  it('stops publishing after detaching', () => {
    const hub = new UiHub();
    const session = new FakeSession('s1');
    attachSession(hub, session)();
    session.output('ignored');
    expect(afterAnnouncement(hub)).toHaveLength(0);
  });
});

describe('application logs', () => {
  it('publishes a followed file line without inventing a level', () => {
    const hub = new UiHub();
    const session = new FakeSession('s1');
    attachSession(hub, session);
    session.clock = 120;
    session.logLine('ERROR: disk full');

    expect(afterAnnouncement(hub)).toEqual([
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

    const message = afterAnnouncement(hub)[0];
    expect(message?.type === 'app-log' && message.level).toBe('warn');
    expect(message?.type === 'app-log' && message.logger).toBe('db.pool');
    expect(message?.type === 'app-log' && message.attrs).toEqual({ size: 10 });
  });

  it('drops a log event that carries nothing to show', () => {
    const hub = new UiHub();
    const session = new FakeSession('s1');
    attachSession(hub, session);
    session.logLine('');
    expect(afterAnnouncement(hub)).toHaveLength(0);
  });

  it('evicts logs before lifecycle messages, and never run-start', () => {
    const hub = new UiHub({ maxMessages: 3 });
    hub.publish({ v: 1, type: 'run-start', runId: 'run:test', mode: 'live', startedAt: 1 });
    hub.publish({ v: 1, type: 'test-start', id: 't1', title: 'login', file: '/repo/a.test.ts', startedAt: 1 });
    for (let index = 0; index < 20; index += 1) {
      hub.publish({ v: 1, type: 'app-log', sessionId: 's1', t: index, source: 'file', level: null, message: 'noise' });
    }
    expect(hub.backlog.map((message) => message.type)).toEqual(['run-start', 'test-start', 'diagnostic-gap']);
    expect(hub.backlog.at(-1)).toMatchObject({
      source: 'ui-hub',
      droppedMessages: 20,
    });
  });
});

describe('driver actions', () => {
  it('publishes a finished action with its selector and target', () => {
    const hub = new UiHub();
    const session = new FakeSession('s1');
    attachSession(hub, session);
    session.clock = 120;
    session.action({ api: 'click', ok: true, selector: 'getByRole("button")', ref: 'semantic:n8@42' });

    expect(afterAnnouncement(hub)).toEqual([
      {
        v: 1,
        type: 'action',
        actionId: 'a1',
        kind: 'action',
        api: 'click',
        t: 120,
        ok: true,
        sessionId: 's1',
        selector: 'getByRole("button")',
        ref: 'semantic:n8@42',
      },
    ]);
  });

  it('publishes a correlated start before the completed action', () => {
    const hub = new UiHub();
    const session = new FakeSession('s1');
    attachSession(hub, session);
    session.clock = 40;
    const actionId = session.startAction({ api: 'click', selector: 'getByRole("button")' });
    session.clock = 90;
    session.finishAction(actionId, {
      api: 'click',
      ok: true,
      selector: 'getByRole("button")',
      ref: 'semantic:n8@42',
    });

    expect(afterAnnouncement(hub)).toEqual([
      {
        v: 1,
        type: 'action-start',
        actionId: 'a1',
        api: 'click',
        t: 40,
        sessionId: 's1',
        selector: 'getByRole("button")',
      },
      {
        v: 1,
        type: 'action',
        actionId: 'a1',
        kind: 'action',
        api: 'click',
        t: 90,
        ok: true,
        sessionId: 's1',
        selector: 'getByRole("button")',
        ref: 'semantic:n8@42',
      },
    ]);
  });

  it('publishes the exact failed planner explanation without replanning', () => {
    const hub = new UiHub();
    const session = new FakeSession('s1');
    attachSession(hub, session);
    const checkpoint = { sessionId: 's1', contractId: 's1:0', epoch: 0, sequence: 7, screenRevision: 3, semanticRevision: 7, pairedScreenRevision: 3 };
    const evidence = { source: 'application', method: 'native', strength: 'authoritative', providerId: 'app.router' } as const;
    session.action({
      api: 'drag', ok: false, error: 'input-mode-disabled',
      actionability: {
        actionable: false, intent: { kind: 'drag', targetRef: 'semantic:save@7' }, checkpoint,
        requirements: [
          { condition: { kind: 'pointer-input', target: 'save@7' }, checkpoint, observation: { status: 'known', value: true, evidence }, verdict: 'satisfied' },
          { condition: { kind: 'mouse-input-enabled', target: 'save@7' }, checkpoint, observation: { status: 'known', value: false, evidence }, verdict: 'unsatisfied' },
        ],
        reason: { code: 'input-mode-disabled', message: 'Mouse reporting is disabled', targetRef: 'semantic:save@7' },
      },
    });

    expect(afterAnnouncement(hub)[0]).toMatchObject({
      type: 'action', ok: false,
      actionability: {
        actionable: false, kind: 'drag', contractId: 's1:0', sequence: 7,
        requirements: [
          { kind: 'pointer-input', target: 'save@7', verdict: 'satisfied', observation: 'known', evidence },
          { kind: 'mouse-input-enabled', target: 'save@7', verdict: 'unsatisfied', observation: 'known', evidence },
        ],
        reason: { code: 'input-mode-disabled', message: 'Mouse reporting is disabled', targetRef: 'semantic:save@7' },
      },
    });
  });

  it('publishes failures too, with the code that grouped them', () => {
    const hub = new UiHub();
    const session = new FakeSession('s1');
    attachSession(hub, session);
    session.action({ api: 'click', ok: false, error: 'not-actionable' });

    const message = afterAnnouncement(hub)[0];
    expect(message?.type === 'action' && message.ok).toBe(false);
    expect(message?.type === 'action' && message.error).toBe('not-actionable');
    expect(message?.type === 'action' && message.ref).toBeUndefined();
  });

  it('stops publishing actions after detaching', () => {
    const hub = new UiHub();
    const session = new FakeSession('s1');
    attachSession(hub, session)();
    session.action({ api: 'press', ok: true });
    expect(afterAnnouncement(hub)).toHaveLength(0);
  });
});

describe('what survives a new run', () => {
  it('keeps the project’s test listing, because a run does not change what exists', () => {
    const hub = new UiHub();
    hub.publish({
      v: 1,
      type: 'tests-discovered',
      tests: [{ id: '/repo/a.test.ts::logs in', title: 'logs in', file: '/repo/a.test.ts' }],
    });
    hub.publish({ v: 1, type: 'test-end', id: 't1', status: 'passed', durationMs: 1, flaky: false, lostLogRecords: 0 });

    hub.publish({ v: 1, type: 'run-start', runId: 'run:test', mode: 'live', startedAt: 2 });

    expect(hub.backlog.map((message) => message.type)).toEqual(['run-start', 'tests-discovered']);
  });

  it('keeps only the newest listing', () => {
    const hub = new UiHub();
    const listing = (title: string): ServerMessage => ({
      v: 1,
      type: 'tests-discovered',
      tests: [{ id: `/repo/a.test.ts::${title}`, title, file: '/repo/a.test.ts' }],
    });
    hub.publish(listing('old'));
    hub.publish(listing('new'));
    hub.publish({ v: 1, type: 'run-start', runId: 'run:test', mode: 'live', startedAt: 1 });

    const kept = hub.backlog.filter((message) => message.type === 'tests-discovered');
    expect(kept).toHaveLength(1);
    expect(kept[0]?.type === 'tests-discovered' && kept[0].tests[0]?.title).toBe('new');
  });

  it('keeps current session state when run-start resets event history', () => {
    const hub = new UiHub();
    const session = new FakeSession('s1');
    session.negotiateFramework('fixture', '1.0.0');
    attachSession(hub, session);

    hub.publish({ v: 1, type: 'run-start', runId: 'run:test', mode: 'record', startedAt: 1 });

    expect(hub.backlog.map((message) => message.type)).toEqual(['run-start', 'session']);
  });

  it('re-announces retained sessions after run-start to an existing viewer', () => {
    const hub = new UiHub();
    const session = new FakeSession('s1');
    attachSession(hub, session);
    const client = new RecordingClient();
    hub.addClient(client);
    client.received.length = 0;

    hub.publish({ v: 1, type: 'run-start', runId: 'run:test', mode: 'live', startedAt: 1 });

    expect(client.received.map((message) => message.type)).toEqual(['run-start', 'session']);
    expect(hub.backlog.map((message) => message.type)).toEqual(['run-start', 'session']);
  });

  it('drops test-bound sessions while retaining a generic/manual session for the next run', () => {
    const hub = new UiHub();
    hub.publish({
      v: 1,
      type: 'session',
      sessionId: 'manual',
      terminalProfile: 'default',
      columns: 80,
      rows: 24,
    });
    hub.publish({
      v: 1,
      type: 'session',
      sessionId: 'old-attempt',
      testId: 'same-runtime-test-id',
      terminalProfile: 'default',
      columns: 80,
      rows: 24,
    });
    const client = new RecordingClient();
    hub.addClient(client);
    client.received.length = 0;

    hub.publish({ v: 1, type: 'run-start', runId: 'run:test', mode: 'live', startedAt: 2 });

    expect(client.received.map((message) => message.type)).toEqual(['run-start', 'session']);
    expect(client.received.at(-1)).toMatchObject({ type: 'session', sessionId: 'manual' });
    expect(hub.backlog.map((message) => message.type)).toEqual(['run-start', 'session']);
    expect(hub.backlog.at(-1)).toMatchObject({ type: 'session', sessionId: 'manual' });
  });

  it('bounds retained generic/manual sessions across many watch-mode runs', () => {
    const hub = new UiHub({ maxMessages: 3 });
    for (let index = 0; index < 10; index += 1) {
      hub.publish({
        v: 1,
        type: 'session',
        sessionId: `s${index}`,
        terminalProfile: 'default',
        columns: 80,
        rows: 24,
      });
      hub.publish({ v: 1, type: 'run-start', runId: 'run:test', mode: 'live', startedAt: index });
    }
    expect(hub.backlog).toHaveLength(3);
    expect(hub.backlog.map((message) => message.type)).toEqual(['run-start', 'session', 'session']);
    expect(hub.backlog.filter((message) => message.type === 'session').map((message) => message.sessionId)).toEqual([
      's8',
      's9',
    ]);
  });
});
