import { randomUUID } from 'node:crypto';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RunEventProducer, createRunId, type RunEvent } from '@termwright/protocol/run-events';
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
    const server = await startRunJournalServer({ runId, append: () => new Promise<void>(() => undefined) });
    servers.push(server);
    const client = await connectRunJournalWorker({ endpoint: server.endpoint, token: server.token, runId,
      workerId: 'blocked', workerEpoch: 1, handshakeDeadline: deadline() });
    const producer = new RunEventProducer({ producerId: client.binding.producerId, epoch: client.binding.producerEpoch });
    const event = producer.emit({ eventClass: 'authoritative', type: 'attempt.started', identity: {
      invocationId: createRunId('invocation'), runId, projectId: createRunId('project'), specId: createRunId('spec'),
      runnerTaskId: createRunId('runner-task'), executionId: createRunId('execution'), attemptId: createRunId('attempt'),
    }, payload: {} });
    await expect(client.append(event, performance.timeOrigin + performance.now() + 20)).rejects.toMatchObject({ code: 'timeout' });
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
