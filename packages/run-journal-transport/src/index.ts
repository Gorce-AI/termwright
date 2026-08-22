import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, connect, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RunIdFactory,
  parseRunId,
  validateRunEvent,
  type RunEvent,
  type RunEventProducerId,
  type RunId,
} from '@termwright/protocol/run-events';

const VERSION = 1;
const MAX_FRAME_BYTES = 384 * 1024;

export class RunJournalTransportError extends Error {
  readonly code: 'authentication-failed' | 'connection-closed' | 'protocol-error' | 'stale-worker' | 'timeout';
  constructor(code: RunJournalTransportError['code'], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RunJournalTransportError';
    this.code = code;
  }
}

export interface RunJournalWorkerIdentity {
  readonly runId: RunId;
  readonly workerId: string;
  readonly workerEpoch: number;
}

export interface RunJournalProducerBinding {
  readonly producerId: RunEventProducerId;
  readonly producerEpoch: number;
}

export interface RunJournalServer {
  readonly endpoint: string;
  readonly token: string;
  close(): Promise<void>;
}

export interface RunJournalClient {
  readonly identity: RunJournalWorkerIdentity;
  readonly binding: RunJournalProducerBinding;
  append(event: RunEvent, deadline: number): Promise<void>;
  flush(deadline: number): Promise<void>;
  close(): Promise<void>;
}

export interface StartRunJournalServerOptions {
  readonly runId: RunId;
  readonly endpoint?: string;
  readonly token?: string;
  readonly append: (event: RunEvent) => void | Promise<void>;
}

interface Connection {
  readonly socket: Socket;
  readonly decoder: Decoder;
  chain: Promise<void>;
  identity: RunJournalWorkerIdentity | null;
  binding: RunJournalProducerBinding | null;
  closed: boolean;
}

export async function startRunJournalServer(options: StartRunJournalServerOptions): Promise<RunJournalServer> {
  parseRunId('run', options.runId);
  const token = options.token ?? randomBytes(32).toString('base64url');
  if (token.length < 32 || token.length > 512) throw protocol('journal token must contain 32..512 characters');
  const allocated = options.endpoint === undefined ? await allocateEndpoint() : { endpoint: options.endpoint };
  const ids = new RunIdFactory();
  const connections = new Set<Connection>();
  const workers = new Map<string, { readonly epoch: number; readonly connection: Connection }>();
  let closing = false;

  const server = createServer((socket) => {
    if (closing) { socket.destroy(); return; }
    socket.setNoDelay(true);
    const connection: Connection = {
      socket,
      decoder: undefined as unknown as Decoder,
      chain: Promise.resolve(),
      identity: null,
      binding: null,
      closed: false,
    };
    const decoder = new Decoder((message) => {
      const requestId = typeof message === 'object' && message !== null && !Array.isArray(message) &&
        typeof (message as Record<string, unknown>).requestId === 'string'
        ? (message as Record<string, unknown>).requestId as string
        : 'connection';
      connection.chain = connection.chain.then(() => dispatch(connection, message)).catch((error: unknown) => {
        respond(connection.socket, requestId, false, wireError(error));
        connection.socket.end();
      });
    });
    Object.defineProperty(connection, 'decoder', { value: decoder });
    connections.add(connection);
    socket.on('data', (chunk) => {
      try { decoder.push(chunk); } catch (error) { socket.destroy(error as Error); }
    });
    socket.once('close', () => closeConnection(connection));
    socket.once('error', () => closeConnection(connection));
  });

  async function dispatch(connection: Connection, value: unknown): Promise<void> {
    const message = record(value, 'message');
    if (message.v !== VERSION) throw protocol('unsupported journal transport version');
    const requestId = text(message.requestId, 'requestId', 256);
    const type = text(message.type, 'type', 64);
    if (connection.identity === null) {
      if (type !== 'hello') throw protocol('hello must be the first message');
      const presented = text(message.token, 'token', 512);
      if (!sameSecret(token, presented)) throw new RunJournalTransportError('authentication-failed', 'journal token rejected');
      const runId = parseRunId('run', message.runId);
      if (runId !== options.runId) throw protocol('journal run id does not match server');
      const workerId = text(message.workerId, 'workerId', 256);
      const workerEpoch = integer(message.workerEpoch, 'workerEpoch');
      const previous = workers.get(workerId);
      if (previous !== undefined && workerEpoch <= previous.epoch) {
        throw new RunJournalTransportError('stale-worker', `worker ${workerId} epoch ${workerEpoch} is stale`);
      }
      connection.identity = Object.freeze({ runId, workerId, workerEpoch });
      connection.binding = Object.freeze({ producerId: ids.create('producer'), producerEpoch: workerEpoch });
      workers.set(workerId, { epoch: workerEpoch, connection });
      respond(connection.socket, requestId, true, connection.binding);
      previous?.connection.socket.destroy();
      return;
    }
    if (type === 'append') {
      const parsed = validateRunEvent(message.event);
      if (!parsed.ok) throw protocol(`invalid run event: ${parsed.code}: ${parsed.detail}`);
      const event = parsed.value;
      const binding = connection.binding as RunJournalProducerBinding;
      const current = workers.get(connection.identity.workerId);
      if (current?.connection !== connection || current.epoch !== connection.identity.workerEpoch) {
        throw new RunJournalTransportError('stale-worker', 'event came from a superseded worker incarnation');
      }
      if (event.identity.runId !== options.runId || event.producerId !== binding.producerId || event.epoch !== binding.producerEpoch) {
        throw protocol('event producer/run binding does not match authenticated worker');
      }
      await options.append(event);
      respond(connection.socket, requestId, true, null);
      return;
    }
    if (type === 'flush') {
      respond(connection.socket, requestId, true, null);
      return;
    }
    throw protocol(`unknown journal request ${type}`);
  }

  function closeConnection(connection: Connection): void {
    if (connection.closed) return;
    connection.closed = true;
    connections.delete(connection);
  }

  try { await listen(server, allocated.endpoint); }
  catch (error) { await allocated.cleanup?.(); throw error; }
  return Object.freeze({
    endpoint: allocated.endpoint,
    token,
    async close(): Promise<void> {
      closing = true;
      for (const connection of connections) connection.socket.destroy();
      await closeServer(server);
      await allocated.cleanup?.();
    },
  });
}

export async function connectRunJournalWorker(options: RunJournalWorkerIdentity & {
  readonly endpoint: string;
  readonly token: string;
  readonly handshakeDeadline: number;
}): Promise<RunJournalClient> {
  const now = monotonicEpochNow();
  if (!Number.isFinite(options.handshakeDeadline) || options.handshakeDeadline <= now) {
    throw new RunJournalTransportError('timeout', 'journal handshake deadline expired');
  }
  const socket = connect(options.endpoint);
  socket.setNoDelay(true);
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer?: ReturnType<typeof setTimeout> }>();
  let sequence = 0;
  let closed = false;
  let serial = Promise.resolve();
  const decoder = new Decoder((value) => {
    const message = record(value, 'response');
    const requestId = text(message.requestId, 'response.requestId', 256);
    const request = pending.get(requestId);
    if (request === undefined) return;
    pending.delete(requestId);
    if (request.timer !== undefined) clearTimeout(request.timer);
    if (message.ok === true) request.resolve(message.result);
    else request.reject(errorFromWire(message.error));
  });
  const fail = (error: Error): void => {
    if (closed) return;
    closed = true;
    socket.destroy();
    for (const request of pending.values()) {
      if (request.timer !== undefined) clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  };
  socket.on('data', (chunk) => { try { decoder.push(chunk); } catch (error) { fail(error as Error); } });
  socket.once('error', (error) => fail(new RunJournalTransportError('connection-closed', error.message, { cause: error })));
  socket.once('close', () => fail(new RunJournalTransportError('connection-closed', 'journal connection closed')));

  const request = (type: string, fields: Record<string, unknown>, deadline?: number): Promise<unknown> => {
    if (closed) return Promise.reject(new RunJournalTransportError('connection-closed', 'journal client is closed'));
    const requestId = `request:${++sequence}`;
    return new Promise((resolve, reject) => {
      const pendingRequest: { resolve(value: unknown): void; reject(error: Error): void; timer?: ReturnType<typeof setTimeout> } = { resolve, reject };
      if (deadline !== undefined) {
        const delay = deadline - monotonicEpochNow();
        if (delay <= 0) { reject(new RunJournalTransportError('timeout', `${type} deadline expired`)); return; }
        pendingRequest.timer = setTimeout(() => fail(
          new RunJournalTransportError('timeout', `${type} deadline expired`),
        ), delay);
        pendingRequest.timer.unref?.();
      }
      pending.set(requestId, pendingRequest);
      try { write(socket, { v: VERSION, type, requestId, ...fields }); }
      catch (error) { pending.delete(requestId); reject(error); }
    });
  };

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new RunJournalTransportError('timeout', 'journal connect deadline expired')),
      options.handshakeDeadline - monotonicEpochNow());
    timer.unref?.();
    socket.once('connect', () => { clearTimeout(timer); resolve(); });
    socket.once('error', (error) => { clearTimeout(timer); reject(error); });
  });
  const hello = record(await request('hello', {
    token: options.token, runId: options.runId, workerId: options.workerId, workerEpoch: options.workerEpoch,
  }, options.handshakeDeadline), 'hello response');
  const binding = Object.freeze({
    producerId: parseRunId('producer', hello.producerId),
    producerEpoch: integer(hello.producerEpoch, 'producerEpoch'),
  });
  const identity = Object.freeze({ runId: options.runId, workerId: options.workerId, workerEpoch: options.workerEpoch });
  return Object.freeze({
    identity,
    binding,
    append(event: RunEvent, deadline: number): Promise<void> {
      const operation = serial.then(async () => { await request('append', { event }, deadline); });
      serial = operation.catch(() => undefined);
      return operation;
    },
    async flush(deadline: number): Promise<void> {
      await serial;
      await request('flush', {}, deadline);
    },
    async close(): Promise<void> {
      if (closed) return;
      await serial;
      closed = true;
      socket.end();
    },
  });
}

class Decoder {
  #buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  constructor(readonly onMessage: (value: unknown) => void) {}
  push(chunk: Buffer): void {
    this.#buffer = this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk]);
    while (this.#buffer.length >= 4) {
      const length = this.#buffer.readUInt32BE(0);
      if (length <= 0 || length > MAX_FRAME_BYTES) throw protocol(`invalid journal frame length ${length}`);
      if (this.#buffer.length < length + 4) return;
      const body = this.#buffer.subarray(4, length + 4);
      this.#buffer = this.#buffer.subarray(length + 4);
      try { this.onMessage(JSON.parse(body.toString('utf8'))); }
      catch (error) { throw protocol('journal frame is not valid JSON', error); }
    }
  }
}

function write(socket: Socket, message: unknown): void {
  const body = Buffer.from(JSON.stringify(message));
  if (body.length <= 0 || body.length > MAX_FRAME_BYTES) throw protocol(`journal frame contains ${body.length} bytes`);
  const frame = Buffer.allocUnsafe(body.length + 4);
  frame.writeUInt32BE(body.length, 0);
  body.copy(frame, 4);
  socket.write(frame);
}
function respond(socket: Socket, requestId: string, ok: boolean, result: unknown): void {
  write(socket, ok ? { v: VERSION, type: 'response', requestId, ok, result }
    : { v: VERSION, type: 'response', requestId, ok, error: result });
}
function wireError(error: unknown): Record<string, string> {
  return { code: error instanceof RunJournalTransportError ? error.code : 'protocol-error',
    message: error instanceof Error ? error.message : 'unknown journal failure' };
}
function errorFromWire(value: unknown): RunJournalTransportError {
  const error = record(value, 'response.error');
  const code = text(error.code, 'error.code', 64);
  const allowed = ['authentication-failed', 'connection-closed', 'protocol-error', 'stale-worker', 'timeout'] as const;
  const typed = allowed.includes(code as (typeof allowed)[number]) ? code as (typeof allowed)[number] : 'protocol-error';
  return new RunJournalTransportError(typed, text(error.message, 'error.message', 4_096));
}
function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw protocol(`${name} must be an object`);
  return value as Record<string, unknown>;
}
function text(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw protocol(`${name} is invalid`);
  return value;
}
function integer(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw protocol(`${name} is invalid`);
  return value;
}
function protocol(message: string, cause?: unknown): RunJournalTransportError {
  return new RunJournalTransportError('protocol-error', message, cause === undefined ? undefined : { cause });
}
function sameSecret(expected: string, actual: string): boolean {
  const a = Buffer.from(expected); const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}
function monotonicEpochNow(): number { return performance.timeOrigin + performance.now(); }
async function allocateEndpoint(): Promise<{ endpoint: string; cleanup?: () => Promise<void> }> {
  const suffix = randomBytes(12).toString('hex');
  if (process.platform === 'win32') return { endpoint: `\\\\.\\pipe\\termwright-journal-${suffix}` };
  const directory = await mkdtemp(join(tmpdir(), 'termwright-journal-'));
  return { endpoint: join(directory, 'journal.sock'), cleanup: () => rm(directory, { recursive: true, force: true }) };
}
function listen(server: Server, endpoint: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject); server.once('listening', resolve); server.listen(endpoint);
  });
}
function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
}
