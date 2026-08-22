import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, connect, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { AttemptId, RunId } from '@termwright/protocol/run-events';
import {
  ResourceBroker,
  ResourceBrokerError,
  type AcquireResourcesOptions,
  type ResourceAttachment,
  type ResourceBrokerSnapshot,
  type ResourceLease,
  type ResourceLeaseSnapshot,
  type ResourceVector,
  type WorkerIdentity,
} from './index.js';

const PROTOCOL_VERSION = 1;
const DEFAULT_MAX_FRAME_BYTES = 64 * 1024;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_CONNECTIONS = 1_000;
const DEFAULT_MAX_REQUESTS_PER_CONNECTION = 100_000;
const ID_PATTERN = /^(run|attempt):[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export type ResourceBrokerTransportErrorCode =
  | 'authentication-failed'
  | 'connection-closed'
  | 'connection-limit'
  | 'frame-too-large'
  | 'handshake-timeout'
  | 'protocol-error'
  | 'request-timeout';

export class ResourceBrokerTransportError extends Error {
  readonly code: ResourceBrokerTransportErrorCode;

  constructor(code: ResourceBrokerTransportErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ResourceBrokerTransportError';
    this.code = code;
  }
}

export interface ResourceBrokerServerOptions {
  readonly broker: ResourceBroker;
  readonly runId: RunId;
  readonly endpoint?: string;
  readonly token?: string;
  readonly maxFrameBytes?: number;
  readonly handshakeTimeoutMs?: number;
  readonly maxConnections?: number;
  readonly maxRequestsPerConnection?: number;
  readonly randomToken?: () => string;
}

export interface ResourceBrokerServer {
  readonly endpoint: string;
  readonly token: string;
  snapshot(): ResourceBrokerSnapshot;
  close(): Promise<void>;
}

export interface ConnectResourceBrokerWorkerOptions extends WorkerIdentity {
  readonly endpoint: string;
  readonly token: string;
  readonly maxFrameBytes?: number;
  readonly handshakeDeadline: number;
  readonly signal?: AbortSignal;
  readonly monotonicNow?: () => number;
}

export interface RemoteAcquireResourcesOptions {
  readonly attemptId: AttemptId;
  readonly resources: ResourceVector;
  /** Absolute deadline from the host-comparable monotonic epoch clock. */
  readonly deadline: number;
  readonly signal?: AbortSignal;
}

export interface RemoteResourceLease extends ResourceLeaseSnapshot {
  attach(attachments: readonly ResourceAttachment[]): Promise<void>;
  release(): Promise<void>;
}

export interface ResourceBrokerClient {
  readonly identity: WorkerIdentity;
  acquire(options: RemoteAcquireResourcesOptions): Promise<RemoteResourceLease>;
  snapshot(): Promise<ResourceBrokerSnapshot>;
  close(): Promise<void>;
}

interface JsonObject {
  readonly [key: string]: unknown;
}

interface ServerConnection {
  readonly socket: Socket;
  readonly decoder: FrameDecoder;
  readonly seenRequests: Set<string>;
  readonly pendingAcquires: Map<string, { readonly controller: AbortController; cancelled: boolean }>;
  readonly acquireLeases: Map<string, string>;
  readonly leases: Map<string, {
    readonly lease: ResourceLease;
    readonly attemptId: AttemptId;
    readonly acquireRequestId: string;
  }>;
  identity: WorkerIdentity | null;
  handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  closed: boolean;
}

interface PendingClientRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly cleanup: () => void;
}

export async function startResourceBrokerServer(
  options: ResourceBrokerServerOptions,
): Promise<ResourceBrokerServer> {
  const maxFrameBytes = positiveInteger(options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES, 'maxFrameBytes');
  const handshakeTimeoutMs = positiveInteger(
    options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS,
    'handshakeTimeoutMs',
  );
  const maxConnections = positiveInteger(options.maxConnections ?? DEFAULT_MAX_CONNECTIONS, 'maxConnections');
  const maxRequestsPerConnection = positiveInteger(
    options.maxRequestsPerConnection ?? DEFAULT_MAX_REQUESTS_PER_CONNECTION,
    'maxRequestsPerConnection',
  );
  const token = options.token ?? options.randomToken?.() ?? randomBytes(32).toString('base64url');
  if (token.length < 32 || token.length > 512) {
    throw new ResourceBrokerTransportError('protocol-error', 'broker token must contain 32..512 characters');
  }
  const allocated = options.endpoint === undefined ? await allocateEndpoint() : { endpoint: options.endpoint };
  const sockets = new Set<ServerConnection>();
  const workers = new Map<string, ServerConnection>();
  let closing = false;
  let closePromise: Promise<void> | null = null;

  const server = createServer((socket) => {
    if (closing || sockets.size >= maxConnections) {
      sendAndEnd(socket, failure('connection-limit', 'broker connection limit reached'), maxFrameBytes);
      return;
    }
    socket.setNoDelay(true);
    const connection: ServerConnection = {
      socket,
      decoder: new FrameDecoder(maxFrameBytes, (message) => dispatch(connection, message)),
      seenRequests: new Set(),
      pendingAcquires: new Map(),
      acquireLeases: new Map(),
      leases: new Map(),
      identity: null,
      handshakeTimer: undefined,
      closed: false,
    };
    sockets.add(connection);
    connection.handshakeTimer = setTimeout(() => {
      sendAndEnd(socket, failure('handshake-timeout', 'broker hello deadline expired'), maxFrameBytes);
    }, handshakeTimeoutMs);
    connection.handshakeTimer.unref();
    socket.on('data', (chunk) => {
      try {
        connection.decoder.push(chunk);
      } catch (error) {
        closeConnection(connection);
        sendAndEnd(socket, wireFailure(error), maxFrameBytes);
      }
    });
    socket.once('error', () => closeConnection(connection));
    socket.once('close', () => closeConnection(connection));
  });

  function dispatch(connection: ServerConnection, value: unknown): void {
    try {
      const message = object(value, 'message');
      if (message.v !== PROTOCOL_VERSION) throw protocolError('unsupported broker protocol version');
      const type = string(message.type, 'message.type');
      const requestId = string(message.requestId, 'message.requestId', 256);
      if (connection.seenRequests.has(requestId)) throw protocolError(`duplicate requestId ${requestId}`);
      if (connection.seenRequests.size >= maxRequestsPerConnection) {
        throw protocolError(`connection exceeded ${maxRequestsPerConnection} requests`);
      }
      connection.seenRequests.add(requestId);
      if (connection.identity === null) {
        if (type !== 'hello') throw protocolError('hello must be the first broker message');
        handleHello(connection, requestId, message);
        return;
      }
      if (type === 'hello') throw protocolError('broker hello cannot be repeated');
      handleAuthenticated(connection, requestId, type, message);
    } catch (error) {
      closeConnection(connection);
      sendAndEnd(connection.socket, wireFailure(error), maxFrameBytes);
    }
  }

  function handleHello(connection: ServerConnection, requestId: string, message: JsonObject): void {
    const presentedToken = string(message.token, 'hello.token', 512);
    if (!sameSecret(token, presentedToken)) {
      sendAndEnd(connection.socket, responseFailure(requestId, 'authentication-failed', 'broker token rejected'), maxFrameBytes);
      return;
    }
    const runId = wireId(message.runId, 'run') as RunId;
    if (runId !== options.runId) {
      sendAndEnd(connection.socket, responseFailure(requestId, 'stale-run', 'broker run rejected'), maxFrameBytes);
      return;
    }
    const identity: WorkerIdentity = {
      runId,
      workerId: string(message.workerId, 'hello.workerId', 256),
      workerEpoch: nonNegativeInteger(message.workerEpoch, 'hello.workerEpoch'),
    };
    try {
      options.broker.registerWorker(identity);
    } catch (error) {
      sendAndEnd(connection.socket, responseFromError(requestId, error), maxFrameBytes);
      return;
    }
    const previous = workers.get(identity.workerId);
    connection.identity = identity;
    workers.set(identity.workerId, connection);
    if (connection.handshakeTimer !== undefined) clearTimeout(connection.handshakeTimer);
    connection.handshakeTimer = undefined;
    writeFrame(connection.socket, success(requestId, { protocolVersion: PROTOCOL_VERSION }), maxFrameBytes);
    if (previous !== undefined && previous !== connection) previous.socket.destroy();
  }

  function handleAuthenticated(
    connection: ServerConnection,
    requestId: string,
    type: string,
    message: JsonObject,
  ): void {
    const identity = connection.identity;
    if (identity === null) throw protocolError('connection lost its identity');
    if (type === 'acquire') {
      const attemptId = wireId(message.attemptId, 'attempt') as AttemptId;
      const resources = resourceVector(message.resources);
      const deadline = finiteNumber(message.deadline, 'acquire.deadline');
      const controller = new AbortController();
      const pendingAcquire = { controller, cancelled: false };
      connection.pendingAcquires.set(requestId, pendingAcquire);
      const acquire: AcquireResourcesOptions = { ...identity, attemptId, resources, deadline, signal: controller.signal };
      void options.broker.acquire(acquire).then(
        (lease) => {
          connection.pendingAcquires.delete(requestId);
          if (connection.closed || pendingAcquire.cancelled) {
            void lease.release();
            return;
          }
          connection.acquireLeases.set(requestId, lease.leaseId);
          connection.leases.set(lease.leaseId, { lease, attemptId, acquireRequestId: requestId });
          writeFrame(connection.socket, success(requestId, leaseWire(lease)), maxFrameBytes);
        },
        (error: unknown) => {
          connection.pendingAcquires.delete(requestId);
          if (!connection.closed) writeFrame(connection.socket, responseFromError(requestId, error), maxFrameBytes);
        },
      );
      return;
    }
    if (type === 'cancel') {
      const targetRequestId = string(message.targetRequestId, 'cancel.targetRequestId', 256);
      const pending = connection.pendingAcquires.get(targetRequestId);
      if (pending !== undefined) {
        pending.cancelled = true;
        pending.controller.abort();
      }
      else {
        const leaseId = connection.acquireLeases.get(targetRequestId);
        const granted = leaseId === undefined ? undefined : connection.leases.get(leaseId);
        if (granted !== undefined) {
          connection.acquireLeases.delete(targetRequestId);
          connection.leases.delete(granted.lease.leaseId);
          void granted.lease.release();
        }
      }
      writeFrame(connection.socket, success(requestId, null), maxFrameBytes);
      return;
    }
    if (type === 'attach' || type === 'release') {
      const leaseId = string(message.leaseId, `${type}.leaseId`, 256);
      const leaseToken = string(message.leaseToken, `${type}.leaseToken`, 512);
      const attemptId = wireId(message.attemptId, 'attempt') as AttemptId;
      const owned = connection.leases.get(leaseId);
      if (owned === undefined || owned.attemptId !== attemptId || owned.lease.token !== leaseToken) {
        throw new ResourceBrokerError('stale-lease', 'lease token or owner is stale');
      }
      const operation = type === 'attach'
        ? owned.lease.attach(attachments(message.attachments))
        : owned.lease.release().then(() => {
          connection.acquireLeases.delete(owned.acquireRequestId);
          connection.leases.delete(leaseId);
        });
      void operation.then(
        () => writeFrame(connection.socket, success(requestId, null), maxFrameBytes),
        (error: unknown) => writeFrame(connection.socket, responseFromError(requestId, error), maxFrameBytes),
      );
      return;
    }
    if (type === 'snapshot') {
      writeFrame(connection.socket, success(requestId, options.broker.snapshot()), maxFrameBytes);
      return;
    }
    throw protocolError(`unknown broker message type ${type}`);
  }

  function closeConnection(connection: ServerConnection): void {
    if (connection.closed) return;
    connection.closed = true;
    sockets.delete(connection);
    if (connection.handshakeTimer !== undefined) clearTimeout(connection.handshakeTimer);
    for (const pending of connection.pendingAcquires.values()) {
      pending.cancelled = true;
      pending.controller.abort();
    }
    connection.pendingAcquires.clear();
    const identity = connection.identity;
    if (identity !== null) {
      if (workers.get(identity.workerId) === connection) workers.delete(identity.workerId);
      options.broker.disconnectWorker(identity);
    }
    connection.leases.clear();
    connection.acquireLeases.clear();
  }

  try {
    await listen(server, allocated.endpoint);
  } catch (error) {
    await allocated.cleanup?.();
    throw error;
  }

  return Object.freeze({
    endpoint: allocated.endpoint,
    token,
    snapshot: () => options.broker.snapshot(),
    close(): Promise<void> {
      closePromise ??= (async () => {
        closing = true;
        for (const connection of [...sockets]) {
          connection.socket.destroy();
          closeConnection(connection);
        }
        const cleanups = [closeServer(server)];
        if (allocated.cleanup !== undefined) cleanups.push(allocated.cleanup());
        const results = await Promise.allSettled(cleanups);
        const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
        if (failures.length > 0) throw new AggregateError(failures, 'resource broker server cleanup failed');
      })();
      return closePromise;
    },
  });
}

export async function connectResourceBrokerWorker(
  options: ConnectResourceBrokerWorkerOptions,
): Promise<ResourceBrokerClient> {
  const maxFrameBytes = positiveInteger(options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES, 'maxFrameBytes');
  const now = options.monotonicNow ?? monotonicEpochNow;
  if (!Number.isFinite(options.handshakeDeadline) || options.handshakeDeadline <= now()) {
    throw new ResourceBrokerTransportError('request-timeout', 'broker handshake deadline expired');
  }
  if (options.signal?.aborted === true) {
    throw new ResourceBrokerError('aborted', 'broker handshake was aborted');
  }
  const socket = connect(options.endpoint);
  socket.setNoDelay(true);
  const pending = new Map<string, PendingClientRequest>();
  let requestSequence = 0;
  let closed = false;
  let closePromise: Promise<void> | null = null;

  const decoder = new FrameDecoder(maxFrameBytes, (value) => {
    try {
      const message = object(value, 'response');
      if (message.v !== PROTOCOL_VERSION || message.type !== 'response') throw protocolError('invalid broker response');
      const requestId = string(message.requestId, 'response.requestId', 256);
      const request = pending.get(requestId);
      if (request === undefined) return;
      pending.delete(requestId);
      request.cleanup();
      if (message.ok === true) request.resolve(message.result);
      else request.reject(errorFromWire(message.error));
    } catch (error) {
      failClient(error instanceof Error ? error : protocolError('invalid broker response'));
    }
  });

  socket.on('data', (chunk) => {
    try {
      decoder.push(chunk);
    } catch (error) {
      failClient(error instanceof Error ? error : protocolError('invalid broker frame'));
    }
  });
  socket.once('error', (error) => failClient(new ResourceBrokerTransportError('connection-closed', error.message, { cause: error })));
  socket.once('close', () => failClient(new ResourceBrokerTransportError('connection-closed', 'broker connection closed')));

  function failClient(error: Error): void {
    if (closed) return;
    closed = true;
    socket.destroy();
    for (const request of pending.values()) {
      request.cleanup();
      request.reject(error);
    }
    pending.clear();
  }

  function request(
    type: string,
    fields: JsonObject,
    deadline?: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (closed) return Promise.reject(new ResourceBrokerTransportError('connection-closed', 'broker connection closed'));
    const requestId = `request:${++requestSequence}`;
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const onAbort = (): void => {
        cancel(new ResourceBrokerError('aborted', `broker ${type} request was aborted`));
      };
      const cancel = (error: Error): void => {
        if (!pending.delete(requestId)) return;
        cleanup();
        reject(error);
        try {
          writeFrame(socket, { v: PROTOCOL_VERSION, type: 'cancel', requestId: `request:${++requestSequence}`, targetRequestId: requestId }, maxFrameBytes);
        } catch {
          socket.destroy();
        }
      };
      const cleanup = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      if (signal?.aborted === true) {
        reject(new ResourceBrokerError('aborted', `broker ${type} request was aborted`));
        return;
      }
      if (deadline !== undefined) {
        if (!Number.isFinite(deadline) || deadline <= now()) {
          reject(new ResourceBrokerError('deadline-exceeded', `broker ${type} deadline expired`));
          return;
        }
        timer = setTimeout(() => {
          cancel(new ResourceBrokerError('deadline-exceeded', `broker ${type} deadline expired`));
        }, deadline - now());
        timer.unref();
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      pending.set(requestId, { resolve, reject, cleanup });
      try {
        writeFrame(socket, { v: PROTOCOL_VERSION, type, requestId, ...fields }, maxFrameBytes);
      } catch (error) {
        pending.delete(requestId);
        cleanup();
        reject(error);
      }
    });
  }

  const connected = new Promise<void>((resolve, reject) => {
    const onConnect = (): void => { cleanup(); resolve(); };
    const onError = (error: Error): void => { cleanup(); reject(error); };
    const cleanup = (): void => {
      socket.removeListener('connect', onConnect);
      socket.removeListener('error', onError);
    };
    socket.once('connect', onConnect);
    socket.once('error', onError);
  });
  const handshakeAbort = new AbortController();
  const forwardAbort = (): void => handshakeAbort.abort();
  options.signal?.addEventListener('abort', forwardAbort, { once: true });
  try {
    await connected;
    await request('hello', {
      token: options.token,
      runId: options.runId,
      workerId: options.workerId,
      workerEpoch: options.workerEpoch,
    }, options.handshakeDeadline, handshakeAbort.signal);
  } catch (error) {
    socket.destroy();
    throw error;
  } finally {
    options.signal?.removeEventListener('abort', forwardAbort);
  }

  const identity: WorkerIdentity = Object.freeze({
    runId: options.runId,
    workerId: options.workerId,
    workerEpoch: options.workerEpoch,
  });
  return Object.freeze({
    identity,
    async acquire(acquireOptions: RemoteAcquireResourcesOptions): Promise<RemoteResourceLease> {
      const result = object(await request('acquire', {
        attemptId: acquireOptions.attemptId,
        resources: acquireOptions.resources,
        deadline: acquireOptions.deadline,
      }, acquireOptions.deadline, acquireOptions.signal), 'acquire result');
      const snapshot = leaseSnapshot(result);
      const leaseToken = string(result.token, 'lease.token', 512);
      let releasePromise: Promise<void> | null = null;
      return Object.freeze({
        ...snapshot,
        async attach(values: readonly ResourceAttachment[]): Promise<void> {
          await request('attach', {
            attemptId: snapshot.attemptId,
            leaseId: snapshot.leaseId,
            leaseToken,
            attachments: values,
          });
        },
        release(): Promise<void> {
          releasePromise ??= request('release', {
            attemptId: snapshot.attemptId,
            leaseId: snapshot.leaseId,
            leaseToken,
          }).then(() => undefined);
          return releasePromise;
        },
      });
    },
    async snapshot(): Promise<ResourceBrokerSnapshot> {
      return await request('snapshot', {}) as ResourceBrokerSnapshot;
    },
    close(): Promise<void> {
      closePromise ??= new Promise<void>((resolve) => {
        if (socket.destroyed) { failClient(new ResourceBrokerTransportError('connection-closed', 'broker client closed')); resolve(); return; }
        socket.once('close', () => resolve());
        failClient(new ResourceBrokerTransportError('connection-closed', 'broker client closed'));
      });
      return closePromise;
    },
  });
}

class FrameDecoder {
  readonly #maxFrameBytes: number;
  readonly #onMessage: (message: unknown) => void;
  #buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  constructor(maxFrameBytes: number, onMessage: (message: unknown) => void) {
    this.#maxFrameBytes = maxFrameBytes;
    this.#onMessage = onMessage;
  }

  push(chunk: Buffer): void {
    this.#buffer = this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk]);
    while (this.#buffer.length >= 4) {
      const length = this.#buffer.readUInt32BE(0);
      if (length === 0 || length > this.#maxFrameBytes) {
        throw new ResourceBrokerTransportError('frame-too-large', `broker frame length ${length} is invalid`);
      }
      if (this.#buffer.length < length + 4) return;
      const body = this.#buffer.subarray(4, length + 4);
      this.#buffer = this.#buffer.subarray(length + 4);
      let parsed: unknown;
      try { parsed = JSON.parse(body.toString('utf8')); }
      catch (error) { throw protocolError('broker frame is not valid JSON', error); }
      this.#onMessage(parsed);
    }
    if (this.#buffer.length > this.#maxFrameBytes + 4) {
      throw new ResourceBrokerTransportError('frame-too-large', 'broker partial frame exceeded its bound');
    }
  }
}

function writeFrame(socket: Socket, message: unknown, maxFrameBytes: number): void {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  if (body.length === 0 || body.length > maxFrameBytes) {
    throw new ResourceBrokerTransportError('frame-too-large', `broker frame contains ${body.length} bytes`);
  }
  const frame = Buffer.allocUnsafe(body.length + 4);
  frame.writeUInt32BE(body.length, 0);
  body.copy(frame, 4);
  socket.write(frame);
}

function sendAndEnd(socket: Socket, message: unknown, maxFrameBytes: number): void {
  try {
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    if (body.length === 0 || body.length > maxFrameBytes) { socket.destroy(); return; }
    const frame = Buffer.allocUnsafe(body.length + 4);
    frame.writeUInt32BE(body.length, 0);
    body.copy(frame, 4);
    socket.end(frame);
  } catch {
    socket.destroy();
  }
}

function success(requestId: string, result: unknown): JsonObject {
  return { v: PROTOCOL_VERSION, type: 'response', requestId, ok: true, result };
}

function failure(code: string, message: string): JsonObject {
  return { v: PROTOCOL_VERSION, type: 'response', requestId: 'connection', ok: false, error: { code, message } };
}

function responseFailure(requestId: string, code: string, message: string): JsonObject {
  return { v: PROTOCOL_VERSION, type: 'response', requestId, ok: false, error: { code, message } };
}

function responseFromError(requestId: string, error: unknown): JsonObject {
  const code = error instanceof ResourceBrokerError ? error.code : 'protocol-error';
  const message = error instanceof Error ? error.message : 'unknown broker failure';
  return responseFailure(requestId, code, message);
}

function wireFailure(error: unknown): JsonObject {
  const code = error instanceof ResourceBrokerTransportError ? error.code
    : error instanceof ResourceBrokerError ? error.code : 'protocol-error';
  const message = error instanceof Error ? error.message : 'unknown broker failure';
  return failure(code, message);
}

function errorFromWire(value: unknown): Error {
  const error = object(value, 'response.error');
  const code = string(error.code, 'response.error.code', 128);
  const message = string(error.message, 'response.error.message', 2_048);
  if (['aborted', 'attempt-owner-mismatch', 'deadline-exceeded', 'invalid-request', 'queue-full',
    'resource-unavailable', 'stale-lease', 'stale-run', 'stale-worker'].includes(code)) {
    return new ResourceBrokerError(code as ResourceBrokerError['code'], message);
  }
  const transportCode: ResourceBrokerTransportErrorCode =
    ['authentication-failed', 'connection-closed', 'connection-limit', 'frame-too-large',
      'handshake-timeout', 'protocol-error', 'request-timeout'].includes(code)
      ? code as ResourceBrokerTransportErrorCode
      : 'protocol-error';
  return new ResourceBrokerTransportError(transportCode, message);
}

function leaseWire(lease: ResourceLease): JsonObject {
  return { runId: lease.runId, workerId: lease.workerId, workerEpoch: lease.workerEpoch,
    attemptId: lease.attemptId, leaseId: lease.leaseId, resources: lease.resources,
    attachments: lease.attachments, token: lease.token };
}

function leaseSnapshot(value: JsonObject): ResourceLeaseSnapshot {
  return Object.freeze({
    runId: wireId(value.runId, 'run') as RunId,
    workerId: string(value.workerId, 'lease.workerId', 256),
    workerEpoch: nonNegativeInteger(value.workerEpoch, 'lease.workerEpoch'),
    attemptId: wireId(value.attemptId, 'attempt') as AttemptId,
    leaseId: string(value.leaseId, 'lease.leaseId', 256),
    resources: resourceVector(value.resources),
    attachments: Object.freeze(attachments(value.attachments)),
  });
}

function resourceVector(value: unknown): ResourceVector {
  const input = object(value, 'resources');
  const allowed = new Set(['ptySession', 'externalProcess', 'semanticEndpoint', 'traceWriter']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw protocolError(`unknown resource class ${key}`);
  const output: Record<string, number> = {};
  for (const key of allowed) {
    if (input[key] !== undefined) output[key] = nonNegativeInteger(input[key], `resources.${key}`);
  }
  return Object.freeze(output) as ResourceVector;
}

function attachments(value: unknown): readonly ResourceAttachment[] {
  if (!Array.isArray(value) || value.length > 1_000) throw protocolError('attachments must be a bounded array');
  return Object.freeze(value.map((entry, index) => {
    const attachment = object(entry, `attachments[${index}]`);
    const resource = string(attachment.resource, `attachments[${index}].resource`, 64);
    if (!['ptySession', 'externalProcess', 'semanticEndpoint', 'traceWriter'].includes(resource)) {
      throw protocolError(`unknown attachment resource ${resource}`);
    }
    const pid = attachment.pid === undefined ? undefined : positiveInteger(attachment.pid, `attachments[${index}].pid`);
    const sessionId = attachment.sessionId === undefined
      ? undefined : string(attachment.sessionId, `attachments[${index}].sessionId`, 512);
    return Object.freeze({ resource, ...(pid === undefined ? {} : { pid }),
      ...(sessionId === undefined ? {} : { sessionId }) }) as ResourceAttachment;
  }));
}

function object(value: unknown, name: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw protocolError(`${name} must be an object`);
  return value as JsonObject;
}

function string(value: unknown, name: string, max = 4_096): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw protocolError(`${name} must contain 1..${max} characters`);
  }
  return value;
}

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw protocolError(`${name} must be finite`);
  return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw protocolError(`${name} must be a non-negative integer`);
  }
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw protocolError(`${name} must be a positive integer`);
  }
  return value;
}

function wireId(value: unknown, kind: 'run' | 'attempt'): string {
  const id = string(value, `${kind} id`, 128);
  if (!ID_PATTERN.test(id) || !id.startsWith(`${kind}:`)) throw protocolError(`invalid ${kind} id`);
  return id;
}

function protocolError(message: string, cause?: unknown): ResourceBrokerTransportError {
  return new ResourceBrokerTransportError('protocol-error', message, cause === undefined ? undefined : { cause });
}

function sameSecret(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

async function allocateEndpoint(): Promise<{ endpoint: string; cleanup?: () => Promise<void> }> {
  const suffix = randomBytes(12).toString('hex');
  if (process.platform === 'win32') return { endpoint: `\\\\.\\pipe\\termwright-broker-${suffix}` };
  const directory = await mkdtemp(join(tmpdir(), 'termwright-broker-'));
  return { endpoint: join(directory, 'broker.sock'), cleanup: () => rm(directory, { recursive: true, force: true }) };
}

function listen(server: Server, endpoint: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => { cleanup(); reject(error); };
    const onListening = (): void => { cleanup(); resolve(); };
    const cleanup = (): void => {
      server.removeListener('error', onError);
      server.removeListener('listening', onListening);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(endpoint);
  });
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
}

function monotonicEpochNow(): number {
  return performance.timeOrigin + performance.now();
}
