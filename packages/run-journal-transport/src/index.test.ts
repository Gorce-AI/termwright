import { randomUUID } from 'node:crypto';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFrameDecoder, encodeFrame } from '@termwright/protocol';
import {
  RunEventProducer,
  createRunId,
  type RunEvent,
  type RunEventProducerId,
} from '@termwright/protocol/run-events';
import { connectRunJournalWorker, startRunJournalServer, type RunJournalServer } from './index.js';

const servers: RunJournalServer[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.close())); });
const deadline = () => performance.timeOrigin + performance.now() + 5_000;

describe('run journal worker transport', () => {
  it('aborts server startup without leaving a listening endpoint', async () => {
    const controller = new AbortController();
    const endpoint = testEndpoint('journal-abort');
    const startup = startRunJournalServer({
      runId: createRunId('run'),
      append: () => undefined,
      endpoint,
      signal: controller.signal,
    });
    controller.abort();
    await expect(startup).rejects.toMatchObject({ name: 'AbortError' });
    await expectConnectionRefused(endpoint);
  });

  it('host-binds a producer and appends authenticated ordered events', async () => {
    const runId = createRunId('run');
    const received: RunEvent[] = [];
    const server = await startRunJournalServer({ runId, append: (event) => { received.push(event); } });
    servers.push(server);
    const client = await connectRunJournalWorker({ endpoint: server.endpoint, token: server.token, runId,
      workerId: 'worker-1', workerEpoch: 2, handshakeDeadline: deadline() });
    const producer = new RunEventProducer({ producerId: client.binding.producerId, epoch: client.binding.producerEpoch });
    const identity = { invocationId: createRunId('invocation'), runId, projectId: createRunId('project'),
      specId: createRunId('spec'), runnerTaskId: createRunId('runner-task'), executionId: createRunId('execution'),
      attemptId: createRunId('attempt') } as const;
    const first = producer.emit({ eventClass: 'authoritative', type: 'attempt.started',
      identity, payload: {} });
    const second = producer.emit({ eventClass: 'authoritative', type: 'attempt.finished',
      identity: first.identity, payload: { state: 'passed' } });
    await Promise.all([client.append(first, deadline()), client.append(second, deadline())]);
    await client.flush(deadline());
    expect(received.map((event) => [event.type, event.seq])).toEqual([
      ['attempt.started', 0], ['attempt.finished', 1],
    ]);
    await client.close();
  });

  it('rejects stale worker incarnations and wrong producer bindings', async () => {
    const runId = createRunId('run');
    const server = await startRunJournalServer({ runId, append: () => undefined });
    servers.push(server);
    const first = await connectRunJournalWorker({ endpoint: server.endpoint, token: server.token, runId,
      workerId: 'same-worker', workerEpoch: 3, handshakeDeadline: deadline() });
    await expect(connectRunJournalWorker({ endpoint: server.endpoint, token: server.token, runId,
      workerId: 'same-worker', workerEpoch: 3, handshakeDeadline: deadline() })).rejects.toMatchObject({ code: 'stale-worker' });
    const wrong = new RunEventProducer({ producerId: createRunId('producer'), epoch: 3 }).emit({
      eventClass: 'authoritative', type: 'attempt.started',
      identity: { invocationId: createRunId('invocation'), runId, projectId: createRunId('project'),
        specId: createRunId('spec'), runnerTaskId: createRunId('runner-task'), executionId: createRunId('execution'),
        attemptId: createRunId('attempt') }, payload: {},
    });
    await expect(first.append(wrong, deadline())).rejects.toMatchObject({ code: 'protocol-error' });
  });

  it('invalidates the old producer when a newer worker incarnation connects', async () => {
    const runId = createRunId('run');
    const server = await startRunJournalServer({ runId, append: () => undefined });
    servers.push(server);
    const old = await connectRunJournalWorker({ endpoint: server.endpoint, token: server.token, runId,
      workerId: 'restartable', workerEpoch: 1, handshakeDeadline: deadline() });
    await connectRunJournalWorker({ endpoint: server.endpoint, token: server.token, runId,
      workerId: 'restartable', workerEpoch: 2, handshakeDeadline: deadline() });
    const producer = new RunEventProducer({ producerId: old.binding.producerId, epoch: old.binding.producerEpoch });
    const event = producer.emit({ eventClass: 'authoritative', type: 'attempt.started', identity: {
      invocationId: createRunId('invocation'), runId, projectId: createRunId('project'), specId: createRunId('spec'),
      runnerTaskId: createRunId('runner-task'), executionId: createRunId('execution'), attemptId: createRunId('attempt'),
    }, payload: {} });
    await expect(old.append(event, deadline())).rejects.toMatchObject({ code: 'connection-closed' });
  });

  it('bounds an append whose journal sink never acknowledges it', async () => {
    const runId = createRunId('run');
    let releaseAppend!: () => void;
    const appendGate = new Promise<void>((resolve) => { releaseAppend = resolve; });
    const server = await startRunJournalServer({ runId, append: () => appendGate });
    servers.push(server);
    const client = await connectRunJournalWorker({ endpoint: server.endpoint, token: server.token, runId,
      workerId: 'blocked', workerEpoch: 1, handshakeDeadline: deadline() });
    const producer = new RunEventProducer({ producerId: client.binding.producerId, epoch: client.binding.producerEpoch });
    const event = producer.emit({ eventClass: 'authoritative', type: 'attempt.started', identity: {
      invocationId: createRunId('invocation'), runId, projectId: createRunId('project'), specId: createRunId('spec'),
      runnerTaskId: createRunId('runner-task'), executionId: createRunId('execution'), attemptId: createRunId('attempt'),
    }, payload: {} });
    await expect(client.append(event, performance.timeOrigin + performance.now() + 20)).rejects.toMatchObject({ code: 'timeout' });
    releaseAppend();
  });

  it('drains received journal appends before the server close barrier resolves', async () => {
    const runId = createRunId('run');
    let releaseAppend!: () => void;
    let markStarted!: () => void;
    const appendGate = new Promise<void>((resolve) => { releaseAppend = resolve; });
    const appendStarted = new Promise<void>((resolve) => { markStarted = resolve; });
    const received: RunEvent[] = [];
    const server = await startRunJournalServer({ runId, append: async (event) => {
      if (received.length === 0) {
        markStarted();
        await appendGate;
      }
      received.push(event);
    } });
    servers.push(server);
    const socket = connect(server.endpoint);
    socket.on('error', () => undefined);
    await onceConnected(socket);
    socket.write(encodeFrame({ v: 1, type: 'hello', requestId: 'hello', token: server.token, runId,
      workerId: 'barrier', workerEpoch: 1 }, 384 * 1024));
    const hello = await nextFrame(socket);
    const binding = hello.result as { producerId: RunEventProducerId; producerEpoch: number };
    const producer = new RunEventProducer({ producerId: binding.producerId, epoch: binding.producerEpoch });
    const first = producer.emit({ eventClass: 'authoritative', type: 'attempt.started', identity: {
      invocationId: createRunId('invocation'), runId, projectId: createRunId('project'), specId: createRunId('spec'),
      runnerTaskId: createRunId('runner-task'), executionId: createRunId('execution'), attemptId: createRunId('attempt'),
    }, payload: {} });
    const second = producer.emit({ eventClass: 'authoritative', type: 'attempt.finished',
      identity: first.identity, payload: { state: 'passed' } });
    socket.write(Buffer.concat([
      encodeFrame({ v: 1, type: 'append', requestId: 'append-1', event: first }, 384 * 1024),
      encodeFrame({ v: 1, type: 'append', requestId: 'append-2', event: second }, 384 * 1024),
    ]));
    await appendStarted;
    let closeResolved = false;
    const close = server.close().then(() => { closeResolved = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(closeResolved).toBe(false);
    releaseAppend();
    await close;
    expect(received.map((event) => event.type)).toEqual(['attempt.started', 'attempt.finished']);
  });

  it('fails close after cleanup when an in-flight journal append fails', async () => {
    const runId = createRunId('run');
    let rejectAppend!: (error: Error) => void;
    let markStarted!: () => void;
    const appendGate = new Promise<void>((_resolve, reject) => { rejectAppend = reject; });
    const appendStarted = new Promise<void>((resolve) => { markStarted = resolve; });
    const server = await startRunJournalServer({ runId, append: async () => {
      markStarted();
      await appendGate;
    } });
    servers.push(server);
    const client = await connectRunJournalWorker({ endpoint: server.endpoint, token: server.token, runId,
      workerId: 'failing-barrier', workerEpoch: 1, handshakeDeadline: deadline() });
    const producer = new RunEventProducer({ producerId: client.binding.producerId, epoch: client.binding.producerEpoch });
    const append = client.append(producer.emit({ eventClass: 'authoritative', type: 'attempt.started', identity: {
      invocationId: createRunId('invocation'), runId, projectId: createRunId('project'), specId: createRunId('spec'),
      runnerTaskId: createRunId('runner-task'), executionId: createRunId('execution'), attemptId: createRunId('attempt'),
    }, payload: {} }), performance.timeOrigin + performance.now() + 20);
    await appendStarted;
    await expect(append).rejects.toMatchObject({ code: 'timeout' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    let closeResolved = false;
    const close = server.close().then(() => { closeResolved = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(closeResolved).toBe(false);
    rejectAppend(new Error('persistence failed'));
    const failure = await close.catch((error: unknown) => error);
    servers.splice(servers.indexOf(server), 1);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([expect.objectContaining({ message: 'persistence failed' })]);
    await expectConnectionRefused(server.endpoint);
  });

  it('does not reflect an invalid unbounded request id on the failure path', async () => {
    const runId = createRunId('run');
    const server = await startRunJournalServer({ runId, append: () => undefined });
    servers.push(server);
    const hostile = connect(server.endpoint);
    hostile.on('error', () => undefined);
    await onceConnected(hostile);
    hostile.write(encodeFrame({
      v: 1, type: 'hello', requestId: 'x'.repeat(257), token: server.token, runId,
      workerId: 'hostile', workerEpoch: 1,
    }, 384 * 1024));
    expect(await nextFrame(hostile)).toMatchObject({ ok: false, requestId: 'connection' });
    await new Promise<void>((resolve) => hostile.once('close', () => resolve()));

    const healthy = await connectRunJournalWorker({ endpoint: server.endpoint, token: server.token, runId,
      workerId: 'healthy', workerEpoch: 1, handshakeDeadline: deadline() });
    await healthy.close();
  });
});

function testEndpoint(name: string): string {
  const suffix = randomUUID().slice(0, 8);
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\termwright-${name}-${suffix}`
    : join(tmpdir(), `tw-j-${suffix}.sock`);
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

function onceConnected(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
}

function nextFrame(socket: Socket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const decoder = createFrameDecoder(384 * 1024);
    const onData = (chunk: Uint8Array): void => {
      try {
        const [message] = decoder.push(chunk);
        if (message === undefined) return;
        socket.off('data', onData);
        resolve(message as Record<string, unknown>);
      } catch (error) {
        socket.off('data', onData);
        reject(error);
      }
    };
    socket.on('data', onData);
    socket.once('error', reject);
  });
}
