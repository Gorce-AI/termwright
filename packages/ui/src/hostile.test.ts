/**
 * Hostile input. A runner UI is pointed at whatever the program under test
 * prints, which is not a trusted source; this suite runs under
 * `node --max-old-space-size=128` in CI, per `/CONTRACTS.md`.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { toBase64, type ServerMessage } from './events.js';
import { UiHub } from './hub.js';
import { generateSelector } from './selector.js';
import { startUiServer, type UiServer } from './server.js';
import { decodeInput, InputDecoder } from './input-decode.js';
import { node, snapshot } from './__fixtures__/fake-session.js';

const servers: UiServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

async function start(): Promise<UiServer> {
  const server = await startUiServer();
  servers.push(server);
  return server;
}

const chunk = (bytes: number, t: number): ServerMessage => ({
  v: 1,
  type: 'output',
  sessionId: 's1',
  dataB64: toBase64(new Uint8Array(bytes)),
  t,
});

describe('flooding', () => {
  it('keeps the backlog bounded through a 128 MiB flood', () => {
    const hub = new UiHub({ maxOutputBytes: 1024 * 1024 });
    for (let index = 0; index < 2_000; index += 1) hub.publish(chunk(64 * 1024, index));
    const bytes = hub.backlog.reduce(
      (total, message) => total + (message.type === 'output' ? message.dataB64.length : 0),
      0,
    );
    expect(bytes).toBeLessThanOrEqual(1024 * 1024);
    expect(hub.backlog.length).toBeLessThan(200);
  });

  it('does not let a flood starve the lifecycle messages a timeline needs', () => {
    const hub = new UiHub({ maxMessages: 50 });
    hub.publish({ v: 1, type: 'run-start', runId: 'run:test', mode: 'live', startedAt: 0 });
    hub.publish({ v: 1, type: 'test-start', id: 't1', title: 'login', file: '/repo/a.test.ts', startedAt: 1 });
    for (let index = 0; index < 5_000; index += 1) hub.publish(chunk(1_024, index));
    const kinds = hub.backlog.map((message) => message.type);
    expect(kinds[0]).toBe('run-start');
    expect(kinds[1]).toBe('test-start');
  });
});

describe('oversized input', () => {
  it('refuses a request body over the cap', async () => {
    const server = await start();
    const url = new URL('/api/record/step', server.url);
    url.searchParams.set('token', server.token);
    const response = await fetch(url, { method: 'POST', body: 'x'.repeat(2 * 1024 * 1024) });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('closes a socket that sends an oversized frame, and keeps serving', async () => {
    const server = await start();
    const url = new URL(server.url);
    url.protocol = 'ws:';
    url.pathname = '/ws';
    const socket = new WebSocket(url);
    await new Promise<void>((done, fail) => {
      socket.once('open', () => done());
      socket.once('error', fail);
    });
    const closed = new Promise<void>((done) => socket.once('close', () => done()));
    socket.send('x'.repeat(9 * 1024 * 1024));
    await closed;

    const state = await fetch(new URL(`/api/state?token=${server.token}`, server.url));
    expect(state.status).toBe(200);
  });
});

describe('hostile trees', () => {
  it('generates a selector over a 20 000-node tree without blowing up', () => {
    const nodes = Array.from({ length: 20_000 }, (_, index) =>
      node({ id: `n${index}`, role: 'listitem', name: `Item ${index % 100}` }),
    );
    const tree = snapshot(1, nodes);
    const selector = generateSelector(tree, 'n19999');
    expect(selector?.code).toContain('getByRole');
  });

  it('survives a tree whose parents form a cycle', () => {
    const tree = snapshot(1, [
      node({ id: 'a', role: 'region', name: 'A', parentId: 'c' }),
      node({ id: 'b', role: 'region', name: 'B', parentId: 'a' }),
      node({ id: 'c', role: 'region', name: 'C', parentId: 'b' }),
      node({ id: 'x', role: 'button', name: 'Go', parentId: 'a' }),
      node({ id: 'y', role: 'button', name: 'Go', parentId: 'b' }),
    ]);
    expect(generateSelector(tree, 'x')).toBeDefined();
  });
});

describe('hostile input bytes', () => {
  it('decodes 1 MiB of random bytes without throwing', () => {
    const bytes = new Uint8Array(1024 * 1024);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = (index * 7919) % 256;
    expect(() => decodeInput(bytes)).not.toThrow();
  });

  it('does not buffer without bound on an escape sequence that never ends', () => {
    const decoder = new InputDecoder();
    const filler = new TextEncoder().encode('\x1b[' + '1;'.repeat(1_000));
    const kinds = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      for (const decoded of decoder.push(filler)) kinds.add(decoded.kind);
    }
    // The unterminated sequence comes back as raw bytes (its tail then reads as
    // ordinary typing); no keypress is invented, and nothing accumulates.
    expect(kinds.has('raw')).toBe(true);
    expect([...kinds].every((kind) => kind === 'raw' || kind === 'type')).toBe(true);
    expect(decoder.flush().length).toBeLessThanOrEqual(1);
  });
});
