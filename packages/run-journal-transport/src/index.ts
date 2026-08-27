import { createServer, connect, type Socket } from 'node:net';
import {
  RunIdFactory,
  parseRunId,
  validateRunEvent,
  type RunEvent,
  type RunEventProducerId,
  type RunId,
} from '@termwright/protocol/run-events';
import {
  bindLocalEndpoint,
  createLocalToken,
  endWithLocalFrame,
  LocalJsonDecoder,
  LocalTransportError,
  parseRequestEnvelope,
  parseResponseEnvelope,
  responseEnvelope,
  sameLocalSecret,
  writeLocalFrame,
} from '@termwright/local-transport';

const VERSION = 1;
const MAX_FRAME_BYTES = 384 * 1024;
const MAX_CONNECTIONS = 1_000;
const MAX_REQUESTS_PER_CONNECTION = 100_000;
const HANDSHAKE_TIMEOUT_MS = 5_000;

export class RunJournalTransportError extends Error {
  readonly code:
    'authentication-failed' | 'connection-closed' | 'protocol-error' | 'stale-worker' | 'timeout';
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
  readonly signal?: AbortSignal;
}

interface Connection {
  readonly socket: Socket;
  readonly decoder: LocalJsonDecoder;
  chain: Promise<void>;
  identity: RunJournalWorkerIdentity | null;
  binding: RunJournalProducerBinding | null;
  readonly seenRequests: Set<string>;
  handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  failed: boolean;
  closed: boolean;
}

export async function startRunJournalServer(
  options: StartRunJournalServerOptions,
): Promise<RunJournalServer> {
  options.signal?.throwIfAborted();
  parseRunId('run', options.runId);
  let token: string;
  try {
    token = createLocalToken(options.token);
  } catch (error) {
    throw protocol('journal token must contain 32..512 characters', error);
  }
  const ids = new RunIdFactory();
  const connections = new Set<Connection>();
  const drainingConnections = new Set<Connection>();
  const workers = new Map<string, { readonly epoch: number; readonly connection: Connection }>();
  const appendFailures: unknown[] = [];
  let closing = false;
  let closePromise: Promise<void> | undefined;

  const server = createServer((socket) => {
    if (closing || connections.size >= MAX_CONNECTIONS) {
      socket.destroy();
      return;
    }
    socket.setNoDelay(true);
    const connection: Connection = {
      socket,
      decoder: undefined as unknown as LocalJsonDecoder,
      chain: Promise.resolve(),
      identity: null,
      binding: null,
      seenRequests: new Set(),
      handshakeTimer: undefined,
      failed: false,
      closed: false,
    };
    drainingConnections.add(connection);
    const decoder = new LocalJsonDecoder(MAX_FRAME_BYTES, (message) => {
      const requestId = failureRequestId(message);
      connection.chain = connection.chain
        .then(async () => {
          if (connection.failed) return;
          await dispatch(connection, message);
        })
        .catch((error: unknown) => {
          if (connection.failed || connection.closed) return;
          connection.failed = true;
          endWithLocalFrame(
            connection.socket,
            responseEnvelope(VERSION, requestId, false, wireError(error)),
            MAX_FRAME_BYTES,
          );
        });
    });
    Object.defineProperty(connection, 'decoder', { value: decoder });
    connections.add(connection);
    connection.handshakeTimer = setTimeout(() => {
      connection.failed = true;
      socket.destroy();
    }, HANDSHAKE_TIMEOUT_MS);
    connection.handshakeTimer.unref?.();
    socket.on('data', (chunk) => {
      try {
        decoder.push(chunk);
      } catch (error) {
        socket.destroy(error as Error);
      }
    });
    socket.once('close', () => closeConnection(connection));
    socket.once('error', () => closeConnection(connection));
  });

  async function dispatch(connection: Connection, value: unknown): Promise<void> {
    const message = parseRequestEnvelope(value, VERSION);
    const { requestId, type } = message;
    if (connection.seenRequests.has(requestId)) throw protocol(`duplicate requestId ${requestId}`);
    if (connection.seenRequests.size >= MAX_REQUESTS_PER_CONNECTION) {
      throw protocol(`connection exceeded ${MAX_REQUESTS_PER_CONNECTION} requests`);
    }
    connection.seenRequests.add(requestId);
    if (connection.identity === null) {
      if (type !== 'hello') throw protocol('hello must be the first message');
      const presented = text(message.token, 'token', 512);
      if (!sameLocalSecret(token, presented))
        throw new RunJournalTransportError('authentication-failed', 'journal token rejected');
      const runId = parseRunId('run', message.runId);
      if (runId !== options.runId) throw protocol('journal run id does not match server');
      const workerId = text(message.workerId, 'workerId', 256);
      const workerEpoch = integer(message.workerEpoch, 'workerEpoch');
      const previous = workers.get(workerId);
      if (previous !== undefined && workerEpoch <= previous.epoch) {
        throw new RunJournalTransportError(
          'stale-worker',
          `worker ${workerId} epoch ${workerEpoch} is stale`,
        );
      }
      connection.identity = Object.freeze({ runId, workerId, workerEpoch });
      connection.binding = Object.freeze({
        producerId: ids.create('producer'),
        producerEpoch: workerEpoch,
      });
      workers.set(workerId, { epoch: workerEpoch, connection });
      if (connection.handshakeTimer !== undefined) clearTimeout(connection.handshakeTimer);
      connection.handshakeTimer = undefined;
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
        throw new RunJournalTransportError(
          'stale-worker',
          'event came from a superseded worker incarnation',
        );
      }
      if (
        event.identity.runId !== options.runId ||
        event.producerId !== binding.producerId ||
        event.epoch !== binding.producerEpoch
      ) {
        throw protocol('event producer/run binding does not match authenticated worker');
      }
      try {
        await options.append(event);
      } catch (error) {
        appendFailures.push(error);
        throw error;
      }
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
    if (connection.handshakeTimer !== undefined) clearTimeout(connection.handshakeTimer);
    const drain = connection.chain;
    void drain.then(
      () => {
        if (connection.chain === drain) drainingConnections.delete(connection);
      },
      () => {
        if (connection.chain === drain) drainingConnections.delete(connection);
      },
    );
  }

  const endpoint = await bindLocalEndpoint({
    server,
    name: 'journal',
    ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  return Object.freeze({
    endpoint: endpoint.endpoint,
    token,
    close(): Promise<void> {
      closePromise ??= (async () => {
        closing = true;
        for (const connection of connections) connection.socket.destroy();
        const draining = [...drainingConnections];
        await Promise.allSettled(draining.map(async (connection) => connection.chain));
        const failures: unknown[] = [...appendFailures];
        try {
          await endpoint.close();
        } catch (error) {
          failures.push(error);
        }
        if (failures.length > 0) throw new AggregateError(failures, 'journal server close failed');
      })();
      return closePromise;
    },
  });
}

export async function connectRunJournalWorker(
  options: RunJournalWorkerIdentity & {
    readonly endpoint: string;
    readonly token: string;
    readonly handshakeDeadline: number;
  },
): Promise<RunJournalClient> {
  const now = monotonicEpochNow();
  if (!Number.isFinite(options.handshakeDeadline) || options.handshakeDeadline <= now) {
    throw new RunJournalTransportError('timeout', 'journal handshake deadline expired');
  }
  const socket = connect(options.endpoint);
  socket.setNoDelay(true);
  const pending = new Map<
    string,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer?: ReturnType<typeof setTimeout>;
    }
  >();
  let sequence = 0;
  let closed = false;
  let serial = Promise.resolve();
  let closePromise: Promise<void> | undefined;
  const socketClosed = new Promise<void>((resolve) => {
    socket.once('close', resolve);
  });
  const decoder = new LocalJsonDecoder(MAX_FRAME_BYTES, (value) => {
    try {
      const message = parseResponseEnvelope(value, VERSION);
      const request = pending.get(message.requestId);
      if (request === undefined) return;
      pending.delete(message.requestId);
      if (request.timer !== undefined) clearTimeout(request.timer);
      if (message.ok) request.resolve(message.result);
      else request.reject(errorFromWire(message.error));
    } catch (error) {
      fail(journalTransportError(error, 'invalid journal response'));
    }
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
  socket.on('data', (chunk) => {
    try {
      decoder.push(chunk);
    } catch (error) {
      fail(journalTransportError(error, 'invalid journal frame'));
    }
  });
  socket.once('error', (error) =>
    fail(new RunJournalTransportError('connection-closed', error.message, { cause: error })),
  );
  socket.once('close', () =>
    fail(new RunJournalTransportError('connection-closed', 'journal connection closed')),
  );

  const request = (
    type: string,
    fields: Record<string, unknown>,
    deadline?: number,
  ): Promise<unknown> => {
    if (closed)
      return Promise.reject(
        new RunJournalTransportError('connection-closed', 'journal client is closed'),
      );
    const requestId = `request:${++sequence}`;
    return new Promise((resolve, reject) => {
      const pendingRequest: {
        resolve(value: unknown): void;
        reject(error: Error): void;
        timer?: ReturnType<typeof setTimeout>;
      } = { resolve, reject };
      if (deadline !== undefined) {
        const delay = deadline - monotonicEpochNow();
        if (delay <= 0) {
          reject(new RunJournalTransportError('timeout', `${type} deadline expired`));
          return;
        }
        pendingRequest.timer = setTimeout(
          () => fail(new RunJournalTransportError('timeout', `${type} deadline expired`)),
          delay,
        );
        pendingRequest.timer.unref?.();
      }
      pending.set(requestId, pendingRequest);
      try {
        write(socket, { v: VERSION, type, requestId, ...fields });
      } catch (error) {
        pending.delete(requestId);
        if (pendingRequest.timer !== undefined) clearTimeout(pendingRequest.timer);
        reject(error);
      }
    });
  };

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new RunJournalTransportError('timeout', 'journal connect deadline expired'));
      }, options.handshakeDeadline - monotonicEpochNow());
      timer.unref?.();
      const onConnect = (): void => {
        cleanup();
        resolve();
      };
      const onError = (error: Error): void => {
        cleanup();
        reject(error);
      };
      const cleanup = (): void => {
        clearTimeout(timer);
        socket.removeListener('connect', onConnect);
        socket.removeListener('error', onError);
      };
      socket.once('connect', onConnect);
      socket.once('error', onError);
    });
    const hello = record(
      await request(
        'hello',
        {
          token: options.token,
          runId: options.runId,
          workerId: options.workerId,
          workerEpoch: options.workerEpoch,
        },
        options.handshakeDeadline,
      ),
      'hello response',
    );
    const binding = Object.freeze({
      producerId: parseRunId('producer', hello.producerId),
      producerEpoch: integer(hello.producerEpoch, 'producerEpoch'),
    });
    const identity = Object.freeze({
      runId: options.runId,
      workerId: options.workerId,
      workerEpoch: options.workerEpoch,
    });
    return Object.freeze({
      identity,
      binding,
      append(event: RunEvent, deadline: number): Promise<void> {
        const operation = serial.then(async () => {
          await request('append', { event }, deadline);
        });
        serial = operation.catch(() => undefined);
        return operation;
      },
      async flush(deadline: number): Promise<void> {
        await serial;
        await request('flush', {}, deadline);
      },
      close(): Promise<void> {
        closePromise ??= (async () => {
          await serial;
          if (!closed) {
            closed = true;
            socket.end();
          }
          await socketClosed;
        })();
        return closePromise;
      },
    });
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

function write(socket: Socket, message: unknown): void {
  try {
    writeLocalFrame(socket, message, MAX_FRAME_BYTES);
  } catch (error) {
    throw journalTransportError(error, 'journal frame could not be written');
  }
}
function respond(socket: Socket, requestId: string, ok: boolean, result: unknown): void {
  write(socket, responseEnvelope(VERSION, requestId, ok, result));
}
function wireError(error: unknown): Record<string, string> {
  return {
    code: error instanceof RunJournalTransportError ? error.code : 'protocol-error',
    message: error instanceof Error ? error.message : 'unknown journal failure',
  };
}
function failureRequestId(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'connection';
  const requestId = (value as Record<string, unknown>).requestId;
  return typeof requestId === 'string' && requestId.length > 0 && requestId.length <= 256
    ? requestId
    : 'connection';
}
function errorFromWire(value: unknown): RunJournalTransportError {
  const error = record(value, 'response.error');
  const code = text(error.code, 'error.code', 64);
  const allowed = [
    'authentication-failed',
    'connection-closed',
    'protocol-error',
    'stale-worker',
    'timeout',
  ] as const;
  const typed = allowed.includes(code as (typeof allowed)[number])
    ? (code as (typeof allowed)[number])
    : 'protocol-error';
  return new RunJournalTransportError(typed, text(error.message, 'error.message', 4_096));
}
function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw protocol(`${name} must be an object`);
  return value as Record<string, unknown>;
}
function text(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max)
    throw protocol(`${name} is invalid`);
  return value;
}
function integer(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw protocol(`${name} is invalid`);
  return value;
}
function protocol(message: string, cause?: unknown): RunJournalTransportError {
  return new RunJournalTransportError(
    'protocol-error',
    message,
    cause === undefined ? undefined : { cause },
  );
}
function journalTransportError(error: unknown, fallback: string): RunJournalTransportError {
  if (error instanceof RunJournalTransportError) return error;
  if (error instanceof LocalTransportError) return protocol(error.message, error);
  return protocol(fallback, error);
}
function monotonicEpochNow(): number {
  return performance.timeOrigin + performance.now();
}
