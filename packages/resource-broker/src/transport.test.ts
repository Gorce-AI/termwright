import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it } from 'vitest';
import type { AttemptId, RunId } from '@termwright/protocol/run-events';
import { ResourceBroker, type ResourceCapacities } from './index.js';
import {
  connectResourceBrokerWorker,
  startResourceBrokerServer,
  type ResourceBrokerClient,
  type ResourceBrokerServer,
} from './transport.js';

const RUN = 'run:00000000-0000-4000-8000-000000000001' as RunId;
const OTHER_RUN = 'run:00000000-0000-4000-8000-000000000002' as RunId;
const TOKEN = 'a'.repeat(48);
const CAPACITIES: ResourceCapacities = {
  ptySession: 1,
  externalProcess: 1,
  semanticEndpoint: 1,
  nativeHostPressure: 1,
  traceWriter: 1,
};
const servers: ResourceBrokerServer[] = [];
const clients: ResourceBrokerClient[] = [];

afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map((client) => client.close()));
  await Promise.allSettled(servers.splice(0).map((server) => server.close()));
});

function deadline(ms = 2_000): number {
  return performance.timeOrigin + performance.now() + ms;
}

function attempt(id: number): AttemptId {
  return `attempt:00000000-0000-4000-8000-${String(id).padStart(12, '0')}` as AttemptId;
}

function framed(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message));
  const frame = Buffer.allocUnsafe(body.length + 4);
  frame.writeUInt32BE(body.length, 0);
  body.copy(frame, 4);
  return frame;
}

function frameReader(socket: ReturnType<typeof connect>): () => Promise<unknown> {
  let buffer = Buffer.alloc(0);
  const values: unknown[] = [];
  const waiters: Array<(value: unknown) => void> = [];
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32BE(0);
      if (buffer.length < length + 4) return;
      const value: unknown = JSON.parse(buffer.subarray(4, length + 4).toString('utf8'));
      buffer = buffer.subarray(length + 4);
      const waiter = waiters.shift();
      if (waiter === undefined) values.push(value);
      else waiter(value);
    }
  });
  return () => {
    const value = values.shift();
    return value === undefined
      ? new Promise((resolve) => waiters.push(resolve))
      : Promise.resolve(value);
  };
}

async function rawAuthenticated(
  server: ResourceBrokerServer,
  workerId: string,
): Promise<{
  readonly socket: ReturnType<typeof connect>;
  readonly nextFrame: () => Promise<unknown>;
}> {
  const socket = connect(server.endpoint);
  socket.on('error', () => undefined);
  const nextFrame = frameReader(socket);
  await once(socket, 'connect');
  socket.write(
    framed({
      v: 1,
      type: 'hello',
      requestId: 'hello',
      token: server.token,
      runId: RUN,
      workerId,
      workerEpoch: 1,
    }),
  );
  expect(await nextFrame()).toMatchObject({ ok: true, requestId: 'hello' });
  return { socket, nextFrame };
}

async function harness(
  capacities: ResourceCapacities = CAPACITIES,
  serverOptions: Partial<Parameters<typeof startResourceBrokerServer>[0]> = {},
): Promise<{ broker: ResourceBroker; server: ResourceBrokerServer }> {
  const broker = new ResourceBroker({ runId: RUN, capacities });
  const server = await startResourceBrokerServer({
    broker,
    runId: RUN,
    token: TOKEN,
    ...serverOptions,
  });
  servers.push(server);
  return { broker, server };
}

async function worker(
  server: ResourceBrokerServer,
  workerId: string,
  workerEpoch = 1,
  overrides: Partial<Parameters<typeof connectResourceBrokerWorker>[0]> = {},
): Promise<ResourceBrokerClient> {
  const client = await connectResourceBrokerWorker({
    endpoint: server.endpoint,
    token: server.token,
    runId: RUN,
    workerId,
    workerEpoch,
    handshakeDeadline: deadline(),
    ...overrides,
  });
  clients.push(client);
  return client;
}

describe('resource broker transport', () => {
  it('aborts server startup without leaving a listening endpoint', async () => {
    const controller = new AbortController();
    const broker = new ResourceBroker({ runId: RUN, capacities: CAPACITIES });
    const endpoint = testEndpoint('broker-abort');
    const startup = startResourceBrokerServer({
      broker,
      runId: RUN,
      token: TOKEN,
      endpoint,
      signal: controller.signal,
    });
    controller.abort();
    await expect(startup).rejects.toMatchObject({ name: 'AbortError' });
    await expectConnectionRefused(endpoint);
  });

  it('authenticates a worker and transports leases, metadata, snapshots, and exact release', async () => {
    const { server } = await harness();
    const client = await worker(server, 'worker-1');
    const lease = await client.acquire({
      attemptId: attempt(1),
      resources: { ptySession: 1, semanticEndpoint: 1 },
      deadline: deadline(),
    });
    await lease.attach([
      { resource: 'ptySession', pid: 1234, sessionId: 'pty-1234' },
      { resource: 'semanticEndpoint', sessionId: 'semantic-1234' },
    ]);
    const snapshot = await client.snapshot();
    expect(snapshot.active[0]).toMatchObject({
      runId: RUN,
      attemptId: attempt(1),
      workerId: 'worker-1',
      workerEpoch: 1,
      attachments: [
        { resource: 'ptySession', pid: 1234, sessionId: 'pty-1234' },
        { resource: 'semanticEndpoint', sessionId: 'semantic-1234' },
      ],
    });
    const release = lease.release();
    expect(lease.release()).toBe(release);
    await release;
    expect((await client.snapshot()).active).toHaveLength(0);
  });

  it('rejects a bad token and a stale run before registering a worker', async () => {
    const { server } = await harness();
    await expect(worker(server, 'bad-token', 1, { token: 'z'.repeat(48) })).rejects.toMatchObject({
      code: 'authentication-failed',
    });
    await expect(worker(server, 'stale-run', 1, { runId: OTHER_RUN })).rejects.toMatchObject({
      code: 'stale-run',
    });
    expect(server.snapshot().active).toHaveLength(0);
  });

  it('rejects duplicate epochs and a newer reconnect atomically reclaims the old worker', async () => {
    const { server } = await harness();
    const original = await worker(server, 'worker', 7);
    await original.acquire({
      attemptId: attempt(2),
      resources: { ptySession: 1 },
      deadline: deadline(),
    });
    await expect(worker(server, 'worker', 7)).rejects.toMatchObject({ code: 'stale-worker' });
    expect(server.snapshot().used.ptySession).toBe(1);

    const replacement = await worker(server, 'worker', 8);
    expect(server.snapshot().used.ptySession).toBe(0);
    const replacementLease = await replacement.acquire({
      attemptId: attempt(3),
      resources: { ptySession: 1 },
      deadline: deadline(),
    });
    await replacementLease.release();
  });

  it('reclaims a dead worker connection and allows the next queued attempt to proceed', async () => {
    const { server } = await harness();
    const owner = await worker(server, 'owner');
    const waiter = await worker(server, 'waiter');
    await owner.acquire({
      attemptId: attempt(4),
      resources: { ptySession: 1 },
      deadline: deadline(),
    });
    const waiting = waiter.acquire({
      attemptId: attempt(5),
      resources: { ptySession: 1 },
      deadline: deadline(),
    });
    expect((await waiter.snapshot()).queue).toHaveLength(1);
    await owner.close();
    const granted = await waiting;
    expect(server.snapshot().active.map((entry) => entry.attemptId)).toEqual([attempt(5)]);
    await granted.release();
  });

  it('avoids two-terminal deadlock by granting an entire vector or none', async () => {
    const capacities = { ...CAPACITIES, ptySession: 2 };
    const { server } = await harness(capacities);
    const first = await worker(server, 'first');
    const second = await worker(server, 'second');
    const firstLease = await first.acquire({
      attemptId: attempt(6),
      resources: { ptySession: 2 },
      deadline: deadline(),
    });
    const secondLeasePromise = second.acquire({
      attemptId: attempt(7),
      resources: { ptySession: 2 },
      deadline: deadline(),
    });
    expect((await second.snapshot()).queue.map((entry) => entry.attemptId)).toEqual([attempt(7)]);
    await firstLease.release();
    await (await secondLeasePromise).release();
  });

  it('cancels a queued request by AbortSignal without consuming capacity later', async () => {
    const { server } = await harness();
    const owner = await worker(server, 'owner');
    const cancelled = await worker(server, 'cancelled');
    const next = await worker(server, 'next');
    const held = await owner.acquire({
      attemptId: attempt(8),
      resources: { ptySession: 1 },
      deadline: deadline(),
    });
    const controller = new AbortController();
    const acquisition = cancelled.acquire({
      attemptId: attempt(9),
      resources: { ptySession: 1 },
      deadline: deadline(),
      signal: controller.signal,
    });
    controller.abort();
    await expect(acquisition).rejects.toMatchObject({ code: 'aborted' });
    await cancelled.snapshot(); // ordered after cancel on the same framed connection
    expect(server.snapshot().queue).toHaveLength(0);
    const nextLease = next.acquire({
      attemptId: attempt(10),
      resources: { ptySession: 1 },
      deadline: deadline(),
    });
    await held.release();
    await (await nextLease).release();
  });

  it('cancels a queued request at its single absolute deadline', async () => {
    const { server } = await harness();
    const owner = await worker(server, 'deadline-owner');
    const expires = await worker(server, 'deadline-waiter');
    const next = await worker(server, 'deadline-next');
    const held = await owner.acquire({
      attemptId: attempt(11),
      resources: { ptySession: 1 },
      deadline: deadline(),
    });
    const acquisition = expires.acquire({
      attemptId: attempt(12),
      resources: { ptySession: 1 },
      deadline: deadline(30),
    });
    await expect(acquisition).rejects.toMatchObject({ code: 'deadline-exceeded' });
    await expires.snapshot();
    expect(server.snapshot().queue).toHaveLength(0);
    const nextLease = next.acquire({
      attemptId: attempt(13),
      resources: { ptySession: 1 },
      deadline: deadline(),
    });
    await held.release();
    await (await nextLease).release();
  });

  it('releases a grant racing with cancellation and fail-closes a stale lease token', async () => {
    const { server } = await harness();
    const racing = await rawAuthenticated(server, 'racing-worker');
    racing.socket.write(
      Buffer.concat([
        framed({
          v: 1,
          type: 'acquire',
          requestId: 'acquire-race',
          attemptId: attempt(14),
          resources: { ptySession: 1 },
          deadline: deadline(),
        }),
        framed({ v: 1, type: 'cancel', requestId: 'cancel-race', targetRequestId: 'acquire-race' }),
      ]),
    );
    expect(await racing.nextFrame()).toMatchObject({ ok: true, requestId: 'cancel-race' });
    expect(server.snapshot().used.ptySession).toBe(0);
    racing.socket.destroy();

    const stale = await rawAuthenticated(server, 'stale-token-worker');
    stale.socket.write(
      framed({
        v: 1,
        type: 'acquire',
        requestId: 'acquire-stale',
        attemptId: attempt(15),
        resources: { ptySession: 1 },
        deadline: deadline(),
      }),
    );
    const response = (await stale.nextFrame()) as { readonly result: { readonly leaseId: string } };
    stale.socket.write(
      framed({
        v: 1,
        type: 'release',
        requestId: 'forged-release',
        attemptId: attempt(15),
        leaseId: response.result.leaseId,
        leaseToken: 'forged-lease-token',
      }),
    );
    await once(stale.socket, 'close');
    expect(server.snapshot().used.ptySession).toBe(0);
  });

  it('closes stalled unauthenticated sockets and rejects oversized frames', async () => {
    const { server } = await harness(CAPACITIES, { handshakeTimeoutMs: 15, maxFrameBytes: 1_024 });
    const stalled = connect(server.endpoint);
    stalled.on('error', () => undefined);
    stalled.resume();
    await once(stalled, 'connect');
    await once(stalled, 'close');

    const hostile = connect(server.endpoint);
    hostile.on('error', () => undefined);
    hostile.resume();
    await once(hostile, 'connect');
    const header = Buffer.alloc(4);
    header.writeUInt32BE(1_025);
    hostile.write(header);
    await once(hostile, 'close');
  });
});

function testEndpoint(name: string): string {
  const suffix = randomUUID().slice(0, 8);
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\termwright-${name}-${suffix}`
    : join(tmpdir(), `tw-b-${suffix}.sock`);
}

async function expectConnectionRefused(endpoint: string): Promise<void> {
  const socket = connect(endpoint);
  await new Promise<void>((resolve, reject) => {
    socket.once('error', () => resolve());
    socket.once('connect', () => {
      socket.destroy();
      reject(new Error(`unexpected listener at ${endpoint}`));
    });
  });
}
