/**
 * Channel tests: they speak the wire protocol directly over the real endpoint,
 * without a PTY, so both the happy path and the hostile paths are covered where
 * they actually live.
 */
import { connect, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, encodeFrame, type SemanticSnapshot } from '@termwright/protocol';
import type { ProtocolViolationError } from './errors.js';
import { SemanticChannel, type SemanticAttachment } from './semantic.js';

const SESSION_ID = 'session-under-test';
const TOKEN = 'a-very-secret-token';

interface Harness {
  channel: SemanticChannel;
  snapshots: SemanticSnapshot[];
  attachments: SemanticAttachment[];
  diagnostics: string[];
  violations: ProtocolViolationError[];
}

const open: { channel: SemanticChannel; sockets: Socket[] }[] = [];

afterEach(async () => {
  while (open.length > 0) {
    const entry = open.pop();
    for (const socket of entry?.sockets ?? []) socket.destroy();
    await entry?.channel.close();
  }
});

async function createChannel(): Promise<Harness> {
  const snapshots: SemanticSnapshot[] = [];
  const attachments: SemanticAttachment[] = [];
  const diagnostics: string[] = [];
  const violations: ProtocolViolationError[] = [];
  const channel = await SemanticChannel.listen({
    sessionId: SESSION_ID,
    token: TOKEN,
    limits: DEFAULT_LIMITS,
    hooks: {
      onSnapshot: (snapshot) => snapshots.push(snapshot),
      onCommit: () => {},
      onAttach: (attachment) => attachments.push(attachment),
      onDiagnostic: (code, detail) => diagnostics.push(`${code}: ${detail}`),
      onProtocolViolation: (error) => violations.push(error),
    },
  });
  open.push({ channel, sockets: [] });
  return { channel, snapshots, attachments, diagnostics, violations };
}

interface Client {
  socket: Socket;
  send(message: unknown): void;
  sendRaw(bytes: Uint8Array): void;
  next(): Promise<Record<string, unknown>>;
  closed: Promise<void>;
}

async function connectClient(channel: SemanticChannel): Promise<Client> {
  const socket = connect(channel.endpoint);
  open.at(-1)?.sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });

  const queue: Record<string, unknown>[] = [];
  const waiters: ((message: Record<string, unknown>) => void)[] = [];
  let pending = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    for (;;) {
      if (pending.length < 4) return;
      const length = pending.readUInt32BE(0);
      if (pending.length < 4 + length) return;
      const message = JSON.parse(pending.subarray(4, 4 + length).toString('utf8')) as Record<string, unknown>;
      pending = pending.subarray(4 + length);
      const waiter = waiters.shift();
      if (waiter === undefined) queue.push(message);
      else waiter(message);
    }
  });

  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));

  return {
    socket,
    send(message: unknown): void {
      socket.write(encodeFrame(message, DEFAULT_LIMITS.maxFrameBytes));
    },
    sendRaw(bytes: Uint8Array): void {
      socket.write(bytes);
    },
    next(): Promise<Record<string, unknown>> {
      const queued = queue.shift();
      if (queued !== undefined) return Promise.resolve(queued);
      return new Promise((resolve) => waiters.push(resolve));
    },
    closed,
  };
}

function hello(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'hello',
    protocol: 'termwright/1',
    token: TOKEN,
    adapter: { name: 'test-adapter', version: '1.2.3' },
    capabilities: ['tree', 'bounds', 'states', 'render-revisions'],
    ...overrides,
  };
}

function snapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    sessionId: SESSION_ID,
    revision: 1,
    columns: 80,
    rows: 24,
    rootIds: ['n1'],
    nodes: [{ id: 'n1', role: 'application', name: 'app' }],
    ...overrides,
  };
}

describe('SemanticChannel', () => {
  it('completes the handshake and accepts snapshots', async () => {
    const harness = await createChannel();
    const client = await connectClient(harness.channel);

    client.send(hello());
    const ack = await client.next();
    expect(ack['type']).toBe('hello-ack');
    expect(ack['sessionId']).toBe(SESSION_ID);
    expect(ack['subscribe']).toBe('snapshots');
    expect(ack['marker']).toEqual({ enabled: true });
    expect(harness.attachments[0]?.adapter).toEqual({ name: 'test-adapter', version: '1.2.3' });

    client.send({ type: 'snapshot', snapshot: snapshot() });
    await expect.poll(() => harness.snapshots.length).toBe(1);
    expect(harness.snapshots[0]?.revision).toBe(1);
    expect(Object.isFrozen(harness.snapshots[0])).toBe(true);
  });

  it('disables markers when the adapter cannot commit renders', async () => {
    const harness = await createChannel();
    const client = await connectClient(harness.channel);

    client.send(hello({ capabilities: ['tree', 'bounds'] }));
    const ack = await client.next();
    expect(ack['marker']).toEqual({ enabled: false });
    expect(harness.attachments[0]?.markerEnabled).toBe(false);
    expect(harness.diagnostics.join('\n')).toContain('render-revisions');
  });

  it('rejects a bad token and closes the connection', async () => {
    const harness = await createChannel();
    const client = await connectClient(harness.channel);

    client.send(hello({ token: 'wrong-token-of-the-same-length' }));
    const error = await client.next();
    expect(error['type']).toBe('error');
    expect(error['code']).toBe('bad-token');
    await client.closed;
    expect(harness.attachments).toHaveLength(0);
    expect(harness.violations.map((error) => error.message).join('\n')).toContain('token');
  });

  it('rejects an unsupported protocol version', async () => {
    const harness = await createChannel();
    const client = await connectClient(harness.channel);

    client.send(hello({ protocol: 'termwright/99' }));
    const error = await client.next();
    expect(error['code']).toBe('bad-version');
    await client.closed;
  });

  it('requires hello before anything else', async () => {
    const harness = await createChannel();
    const client = await connectClient(harness.channel);

    client.send({ type: 'snapshot', snapshot: snapshot() });
    const error = await client.next();
    expect(error['code']).toBe('malformed');
    await client.closed;
    expect(harness.snapshots).toHaveLength(0);
  });

  it('accepts only one adapter per session', async () => {
    const harness = await createChannel();
    const first = await connectClient(harness.channel);
    first.send(hello());
    await first.next();

    const second = await connectClient(harness.channel);
    const error = await second.next();
    expect(error['code']).toBe('internal');
    await second.closed;
    expect(harness.attachments).toHaveLength(1);
  });

  it('fails closed on an oversized frame before decoding it', async () => {
    const harness = await createChannel();
    const client = await connectClient(harness.channel);
    client.send(hello());
    await client.next();

    const header = Buffer.alloc(4);
    header.writeUInt32BE(DEFAULT_LIMITS.maxFrameBytes + 1, 0);
    client.sendRaw(header);

    // A ceiling breach is 'limit-exceeded', not 'malformed': an adapter author
    // must be able to tell "your frame is too big" from "your JSON is broken".
    const error = await client.next();
    expect(error['code']).toBe('limit-exceeded');
    await client.closed;
    expect(harness.violations.map((error) => error.message).join('\n')).toMatch(/framing/u);

    // The protocol's own ProtocolViolation is wrapped in the driver's typed
    // error, and its machine-readable reason survives into the suggestion.
    const wrapped = harness.violations.at(-1);
    expect(wrapped?.code).toBe('protocol-violation');
    expect(wrapped?.diagnostics.suggestion).toContain('frame-oversized');
  });

  it('accepts a snapshot in which no node has bounds', async () => {
    const harness = await createChannel();
    const client = await connectClient(harness.channel);
    client.send(hello());
    await client.next();

    client.send({
      type: 'snapshot',
      snapshot: snapshot({
        nodes: [
          { id: 'n1', role: 'dialog', name: 'Permission' },
          { id: 'n2', parentId: 'n1', role: 'button', name: 'Approve' },
        ],
      }),
    });
    await expect.poll(() => harness.snapshots.length).toBe(1);
    expect(harness.snapshots[0]?.nodes.every((node) => node.bounds === undefined)).toBe(true);
  });

  it('rejects a snapshot with an unknown role', async () => {
    const harness = await createChannel();
    const client = await connectClient(harness.channel);
    client.send(hello());
    await client.next();

    client.send({
      type: 'snapshot',
      snapshot: snapshot({ nodes: [{ id: 'n1', role: 'wormhole', name: 'x' }] }),
    });
    const error = await client.next();
    expect(error['type']).toBe('error');
    await client.closed;
    expect(harness.snapshots).toHaveLength(0);
  });

  it('rejects a snapshot belonging to another session', async () => {
    const harness = await createChannel();
    const client = await connectClient(harness.channel);
    client.send(hello());
    await client.next();

    client.send({ type: 'snapshot', snapshot: snapshot({ sessionId: 'someone-else' }) });
    const error = await client.next();
    expect(error['code']).toBe('malformed');
    expect(harness.snapshots).toHaveLength(0);
  });

  it('removes the endpoint on close', async () => {
    const harness = await createChannel();
    const endpoint = harness.channel.endpoint;
    await harness.channel.close();
    if (process.platform === 'win32') return;
    const { existsSync } = await import('node:fs');
    expect(existsSync(endpoint)).toBe(false);
  });
});
