/**
 * Channel tests: they speak the wire protocol directly over the real endpoint,
 * without a PTY, so both the happy path and the hostile paths are covered where
 * they actually live.
 */
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LIMITS, encodeFrame, type LogRecord, type SemanticSnapshot } from '@termwright/protocol';
import type { ProtocolViolationError } from './errors.js';
import {
  SemanticChannel,
  type SemanticAttachment,
  type SemanticChannelListenDependencies,
} from './semantic.js';

const SESSION_ID = 'session-under-test';
const TOKEN = 'a-very-secret-token';

interface Harness {
  channel: SemanticChannel;
  snapshots: SemanticSnapshot[];
  records: LogRecord[];
  attachments: SemanticAttachment[];
  frameBegins: number[];
  diagnostics: string[];
  diagnosticWireCodes: string[];
  violations: ProtocolViolationError[];
  wireCodes: string[];
}

const open: { channel: SemanticChannel; sockets: Socket[] }[] = [];

afterEach(async () => {
  while (open.length > 0) {
    const entry = open.pop();
    for (const socket of entry?.sockets ?? []) socket.destroy();
    await entry?.channel.close();
  }
});

async function createChannel(
  accepting = true,
  handshakeTimeoutMs?: number,
  dependencies?: SemanticChannelListenDependencies,
): Promise<Harness> {
  const snapshots: SemanticSnapshot[] = [];
  const records: LogRecord[] = [];
  const attachments: SemanticAttachment[] = [];
  const frameBegins: number[] = [];
  const diagnostics: string[] = [];
  const diagnosticWireCodes: string[] = [];
  const violations: ProtocolViolationError[] = [];
  const wireCodes: string[] = [];
  const channel = await SemanticChannel.listen({
    sessionId: SESSION_ID,
    token: TOKEN,
    limits: DEFAULT_LIMITS,
    acceptHello: () => accepting,
    logBudget: { maxRecordsPerSecond: 200, burst: 500 },
    ...(handshakeTimeoutMs === undefined ? {} : { handshakeTimeoutMs }),
    hooks: {
      onSnapshot: (snapshot) => snapshots.push(snapshot),
      onLogRecord: (record) => records.push(record),
      onCommit: () => {},
      onFrameBegin: (revision) => frameBegins.push(revision),
      onAttach: (attachment) => attachments.push(attachment),
      onDisconnect: () => undefined,
      onDiagnostic: (code, detail, about) => {
        diagnostics.push(`${code}: ${detail}`);
        if (about?.wireCode !== undefined) diagnosticWireCodes.push(`${code}:${about.wireCode}`);
      },
      onProtocolViolation: (error, wireCode) => {
        violations.push(error);
        wireCodes.push(wireCode);
      },
    },
  }, dependencies);
  open.push({ channel, sockets: [] });
  return {
    channel,
    snapshots,
    records,
    attachments,
    frameBegins,
    diagnostics,
    diagnosticWireCodes,
    violations,
    wireCodes,
  };
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
  const requested = (overrides['capabilities'] as readonly string[] | undefined) ?? ['tree', 'states', 'render-revisions'];
  return {
    type: 'hello',
    protocol: 'termwright/2',
    token: TOKEN,
    adapter: { name: 'test-adapter', version: '1.2.3' },
    capabilities: requested,
    ...overrides,
    ...('capabilities' in overrides ? { capabilities: requested } : {}),
  };
}

function snapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const { nodes: _nodes, ...rest } = overrides;
  const nodes = ((overrides['nodes'] as readonly Record<string, unknown>[] | undefined) ?? [{ id: 'n1', role: 'application', name: 'app' }])
    .map((node) => ({
      geometry: { displayed: { status: 'unknown', reason: 'awaiting-revision-pair' }, intendedRect: { status: 'unknown', reason: 'awaiting-revision-pair' }, visibleRect: { status: 'unknown', reason: 'awaiting-revision-pair' } },
      ...node,
    }));
  return {
    v: 2,
    sessionId: SESSION_ID,
    revision: 1,
    columns: 80,
    rows: 24,
    rootIds: ['n1'],
    coordinateSpace: { status: 'known', value: 'viewport-cells', evidence: { source: 'application', method: 'declared', strength: 'authoritative', providerId: 'test' } },
    hitGrid: { status: 'unsupported', capability: 'pointer-hit-grid', reason: 'framework-unobservable' },
    ...rest,
    nodes,
  };
}

/** A probe's self-description, as `hello.probe` carries it. */
function probeInfo(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    framework: 'test-framework',
    frameworkVersion: '9.9.9',
    probeVersion: '0.1.0',
    identityKind: 'stable',
    capabilities: ['frame-begin'],
    ...overrides,
  };
}

describe('the probe lifecycle', () => {
  it('records what a probe says about itself, and takes its frame boundaries', async () => {
    const harness = await createChannel();
    const client = await connectClient(harness.channel);

    client.send(hello({ probe: probeInfo() }));
    await client.next();
    await expect.poll(() => harness.attachments.length).toBe(1);
    expect(harness.attachments[0]?.probe?.framework).toBe('test-framework');
    expect(harness.attachments[0]?.probe?.identityKind).toBe('stable');

    client.send({ type: 'frame-begin', revision: 7 });
    await expect.poll(() => harness.frameBegins).toEqual([7]);
  });

  it('leaves probe null for a hand-written adapter', async () => {
    const harness = await createChannel();
    const client = await connectClient(harness.channel);

    client.send(hello());
    await client.next();
    await expect.poll(() => harness.attachments.length).toBe(1);
    expect(harness.attachments[0]?.probe).toBeNull();
  });

  it('does not believe a frame boundary from a sender that never claimed one', async () => {
    // Not a reason to close the channel — a capability nobody announced is a
    // reason not to trust the message, and to say why. Believing it would let
    // a sender hold expiry open through an ability it never claimed to have.
    const harness = await createChannel();
    const client = await connectClient(harness.channel);

    client.send(hello({ probe: probeInfo({ capabilities: [] }) }));
    await client.next();
    client.send({ type: 'frame-begin', revision: 3 });
    client.send({ type: 'snapshot', snapshot: snapshot() });

    await expect.poll(() => harness.snapshots.length).toBe(1);
    expect(harness.frameBegins).toEqual([]);
    expect(harness.diagnostics.join('\n')).toContain('frame-begin');
    // The channel is still open and still working: the snapshot arrived after.
    expect(harness.violations).toEqual([]);
  });
});

describe('SemanticChannel', () => {
  it.skipIf(process.platform === 'win32')('rolls back its private directory when listen fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'termwright-listen-fault-'));
    await expect(createChannel(true, undefined, {
      makeDirectory: async () => directory,
      listen: async () => {
        throw new Error('injected listen failure');
      },
    })).rejects.toThrow('injected listen failure');
    expect(existsSync(directory)).toBe(false);
  });

  it('negotiates termwright/2 and accepts its evidence-qualified snapshot shape', async () => {
    const harness = await createChannel();
    const client = await connectClient(harness.channel);
    client.send(hello({
      protocol: 'termwright/2',
      capabilities: ['tree', 'states', 'render-revisions'],
    }));
    expect(await client.next()).toMatchObject({ type: 'hello-ack', protocol: 'termwright/2', subscribe: 'snapshots' });
    expect(harness.attachments[0]?.protocol).toBe('termwright/2');
    client.send({
      type: 'snapshot',
      snapshot: snapshot({
        v: 2,
        nodes: [{
          id: 'n1', role: 'application', name: 'app',
          geometry: {
            displayed: { status: 'known', value: true, evidence: { source: 'framework', method: 'native', strength: 'authoritative', providerId: 'test-adapter' } },
            intendedRect: { status: 'known', value: { row: 0, column: 0, width: 80, height: 24 }, evidence: { source: 'framework', method: 'native', strength: 'authoritative', providerId: 'test-adapter' } },
            visibleRect: { status: 'known', value: { row: 0, column: 0, width: 80, height: 24 }, evidence: { source: 'framework', method: 'native', strength: 'authoritative', providerId: 'test-adapter' } },
          },
        }],
        coordinateSpace: { status: 'known', value: 'viewport-cells', evidence: { source: 'framework', method: 'native', strength: 'authoritative', providerId: 'test-adapter' } },
        hitGrid: { status: 'unsupported', capability: 'pointer-hit-grid', reason: 'framework-unobservable' },
      }),
    });
    await expect.poll(() => harness.snapshots.length).toBe(1);
    expect(harness.snapshots[0]?.v).toBe(2);
  });

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

  it.each([
    {
      fact: 'tree',
      capabilities: ['states'],
      node: { id: 'n1', role: 'application', name: 'app' },
    },
    {
      fact: 'states',
      capabilities: ['tree'],
      node: { id: 'n1', role: 'application', name: 'app', state: { focused: true } },
    },
    {
      fact: 'extended state',
      capabilities: ['tree'],
      node: { id: 'n1', role: 'application', name: 'app', extended: { page: 2 } },
    },
    {
      fact: 'actions',
      capabilities: ['tree'],
      node: { id: 'n1', role: 'application', name: 'app', actions: ['activate'] },
    },
    {
      fact: 'text-ranges',
      capabilities: ['tree'],
      node: {
        id: 'n1',
        role: 'application',
        name: 'app',
        textRanges: [
          { startOffset: 0, endOffset: 1, rect: { row: 0, column: 0, width: 1, height: 1 } },
        ],
      },
    },
  ])('rejects $fact fields that Hello did not authorize', async ({ capabilities, node }) => {
    const harness = await createChannel();
    const client = await connectClient(harness.channel);
    client.send(hello({ capabilities }));
    await client.next();

    client.send({ type: 'snapshot', snapshot: snapshot({ nodes: [node] }) });
    const error = await client.next();
    expect(error['code']).toBe('malformed');
    await client.closed;
    expect(harness.snapshots).toHaveLength(0);
  });

  it('disables markers when the adapter cannot commit renders', async () => {
    const harness = await createChannel();
    const client = await connectClient(harness.channel);

    client.send(hello({ capabilities: ['tree', 'intended-geometry'] }));
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
    expect(harness.diagnosticWireCodes).toContain('adapter-capability:internal');
  });

  it('makes a single atomic claim when two accepted sockets hello concurrently', async () => {
    const harness = await createChannel();
    const first = await connectClient(harness.channel);
    const second = await connectClient(harness.channel);

    first.send(hello({ adapter: { name: 'first', version: '1.0.0' } }));
    second.send(hello({ adapter: { name: 'second', version: '1.0.0' } }));
    const replies = await Promise.all([first.next(), second.next()]);

    expect(replies.map((reply) => reply['type']).sort()).toEqual(['error', 'hello-ack']);
    expect(harness.attachments).toHaveLength(1);
    expect(['first', 'second']).toContain(harness.attachments[0]?.adapter.name);
    expect(harness.diagnosticWireCodes).toContain('adapter-capability:internal');
  });

  it('closes a peer that never authenticates at the absolute hello deadline', async () => {
    vi.useFakeTimers();
    try {
      const harness = await createChannel(true, 50);
      const client = await connectClient(harness.channel);

      await vi.advanceTimersByTimeAsync(50);
      expect(await client.next()).toMatchObject({
        type: 'error',
        code: 'internal',
        message: 'semantic hello deadline exceeded',
      });
      await client.closed;
      expect(harness.diagnostics.join('\n')).toContain('did not authenticate within 50 ms');
    } finally {
      vi.useRealTimers();
    }
  });

  it('destroys accepted unauthenticated sockets and shares concurrent close', async () => {
    const harness = await createChannel();
    const client = await connectClient(harness.channel);

    const first = harness.channel.close();
    const second = harness.channel.close();
    expect(second).toBe(first);
    await first;
    await client.closed;
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
    expect(harness.wireCodes.at(-1)).toBe('limit-exceeded');
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
    expect(harness.snapshots[0]?.nodes.every((node) => node.geometry !== undefined)).toBe(true);
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

  it('refuses a hello once the session has settled as generic', async () => {
    // Design §4.1: a late hello never flips an already selected mode.
    const harness = await createChannel(false);
    const client = await connectClient(harness.channel);

    client.send(hello());
    const error = await client.next();
    expect(error['code']).toBe('internal');
    await client.closed;
    expect(harness.attachments).toHaveLength(0);
    expect(harness.diagnostics.join('\n')).toContain('settled as generic');
    // The log says which error went on the wire, whatever the diagnostic code.
    expect(harness.diagnosticWireCodes).toContain('adapter-capability:internal');
  });

  it('grants a log budget only to an adapter that asked for logs', async () => {
    const harness = await createChannel();
    const client = await connectClient(harness.channel);

    client.send(hello({ capabilities: ['tree', 'logs'] }));
    const ack = await client.next();
    expect(ack['logs']).toEqual({ enabled: true, maxRecordsPerSecond: 200, burst: 500 });
    expect(harness.attachments[0]?.logsEnabled).toBe(true);

    client.send({
      type: 'log',
      record: { ts: Date.now(), level: 'info', message: 'hello from the adapter', seq: 1 },
    });
    await expect.poll(() => harness.records.length).toBe(1);
    expect(harness.records[0]?.message).toBe('hello from the adapter');
  });

  it('omits the budget when the capability was not announced', async () => {
    const harness = await createChannel();
    const client = await connectClient(harness.channel);

    client.send(hello({ capabilities: ['tree'] }));
    const ack = await client.next();
    // Absent means disabled; the adapter must stay quiet.
    expect(ack['logs']).toBeUndefined();
    expect(harness.attachments[0]?.logsEnabled).toBe(false);
  });

  it('closes the channel on a log record nobody invited', async () => {
    const harness = await createChannel();
    const client = await connectClient(harness.channel);
    client.send(hello({ capabilities: ['tree'] }));
    await client.next();

    client.send({ type: 'log', record: { ts: Date.now(), level: 'warn', message: 'x', seq: 1 } });
    const error = await client.next();
    expect(error['code']).toBe('malformed');
    await client.closed;
    expect(harness.records).toHaveLength(0);
  });

  it('rejects a log record that does not validate', async () => {
    const harness = await createChannel();
    const client = await connectClient(harness.channel);
    client.send(hello({ capabilities: ['tree', 'logs'] }));
    await client.next();

    client.send({ type: 'log', record: { ts: Date.now(), level: 'shouting', message: 'x', seq: 1 } });
    const error = await client.next();
    expect(error['type']).toBe('error');
    expect(harness.records).toHaveLength(0);
  });

  it('removes the endpoint on close', async () => {
    const harness = await createChannel();
    const endpoint = harness.channel.endpoint;
    await harness.channel.close();
    if (process.platform === 'win32') return;
    expect(existsSync(endpoint)).toBe(false);
  });
});
