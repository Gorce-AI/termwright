import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Server, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createFrameDecoder,
  encodeFrame,
  ProtocolViolation,
  type FrameDecoder,
} from '@termwright/protocol';

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

export type LocalTransportErrorCode =
  | 'frame-encoding'
  | 'frame-malformed'
  | 'frame-oversized'
  | 'invalid-envelope'
  | 'invalid-token';

export class LocalTransportError extends Error {
  readonly code: LocalTransportErrorCode;

  constructor(code: LocalTransportErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'LocalTransportError';
    this.code = code;
  }
}

export interface RequestEnvelope extends Readonly<Record<string, unknown>> {
  readonly v: number;
  readonly type: string;
  readonly requestId: string;
}

export interface ResponseEnvelope extends Readonly<Record<string, unknown>> {
  readonly v: number;
  readonly type: 'response';
  readonly requestId: string;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: unknown;
}

export interface BoundLocalEndpoint {
  readonly endpoint: string;
  close(): Promise<void>;
}

/** Poison-on-error decoder over the repository's sole JSON framing codec. */
export class LocalJsonDecoder {
  readonly #decoder: FrameDecoder;
  readonly #onMessage: (message: unknown) => void;
  readonly #maxBufferedBytes: number;

  constructor(maxFrameBytes: number, onMessage: (message: unknown) => void) {
    this.#onMessage = onMessage;
    try {
      this.#decoder = createFrameDecoder(maxFrameBytes);
    } catch (error) {
      throw localError(error);
    }
    this.#maxBufferedBytes = maxFrameBytes + 4;
  }

  get buffered(): number {
    return this.#decoder.buffered;
  }

  push(chunk: Uint8Array): void {
    // A socket may hand us a chunk far larger than one legal frame. Feeding it
    // whole to the protocol decoder would first copy the entire attacker-owned
    // chunk and only then inspect its four-byte prefix. Slice without copying
    // so the decoder itself never retains more than one bounded frame while
    // still accepting any number of coalesced valid frames.
    let offset = 0;
    do {
      const capacity = Math.max(1, this.#maxBufferedBytes - this.#decoder.buffered);
      const end = Math.min(chunk.length, offset + capacity);
      let messages: readonly unknown[];
      try {
        messages = this.#decoder.push(chunk.subarray(offset, end));
      } catch (error) {
        throw localError(error);
      }
      for (const message of messages) this.#onMessage(message);
      offset = end;
    } while (offset < chunk.length);
  }
}

export function writeLocalFrame(socket: Socket, message: unknown, maxFrameBytes: number): void {
  let frame: Uint8Array;
  try {
    frame = encodeFrame(message, maxFrameBytes);
  } catch (error) {
    throw localError(error);
  }
  socket.write(frame);
}

export function endWithLocalFrame(socket: Socket, message: unknown, maxFrameBytes: number): void {
  try {
    socket.end(encodeFrame(message, maxFrameBytes));
  } catch {
    socket.destroy();
  }
}

export function parseRequestEnvelope(
  value: unknown,
  version: number,
  limits: { readonly type?: number; readonly requestId?: number } = {},
): RequestEnvelope {
  const message = object(value, 'message');
  if (message.v !== version) throw new LocalTransportError('invalid-envelope', 'unsupported transport version');
  boundedText(message.type, 'message.type', limits.type ?? 64);
  boundedText(message.requestId, 'message.requestId', limits.requestId ?? 256);
  return message as RequestEnvelope;
}

export function parseResponseEnvelope(
  value: unknown,
  version: number,
  requestIdMax = 256,
): ResponseEnvelope {
  const message = object(value, 'response');
  if (message.v !== version || message.type !== 'response' || typeof message.ok !== 'boolean') {
    throw new LocalTransportError('invalid-envelope', 'invalid transport response');
  }
  boundedText(message.requestId, 'response.requestId', requestIdMax);
  if (message.ok && !Object.hasOwn(message, 'result')) {
    throw new LocalTransportError('invalid-envelope', 'successful response is missing result');
  }
  if (!message.ok && !Object.hasOwn(message, 'error')) {
    throw new LocalTransportError('invalid-envelope', 'failed response is missing error');
  }
  if (message.ok && Object.hasOwn(message, 'error')) {
    throw new LocalTransportError('invalid-envelope', 'successful response cannot contain error');
  }
  if (!message.ok && Object.hasOwn(message, 'result')) {
    throw new LocalTransportError('invalid-envelope', 'failed response cannot contain result');
  }
  return message as unknown as ResponseEnvelope;
}

export function responseEnvelope(
  version: number,
  requestId: string,
  ok: boolean,
  payload: unknown,
): ResponseEnvelope {
  return Object.freeze(ok
    ? { v: version, type: 'response' as const, requestId, ok, result: payload }
    : { v: version, type: 'response' as const, requestId, ok, error: payload });
}

export function createLocalToken(provided?: string, randomToken?: () => string): string {
  const token = provided ?? randomToken?.() ?? randomBytes(32).toString('base64url');
  if (token.length < 32 || token.length > 512 || LONE_SURROGATE.test(token)) {
    throw new LocalTransportError(
      'invalid-token',
      'transport token must contain 32..512 well-formed Unicode characters',
    );
  }
  return token;
}

/** Compare fixed-size token digests without content- or length-dependent early exit. */
export function sameLocalSecret(expected: string, actual: string): boolean {
  // UTF-16LE preserves JavaScript string identity even for malformed direct
  // callers; UTF-8 would collapse every lone surrogate to the same U+FFFD
  // bytes before the constant-time digest comparison.
  const expectedDigest = createHash('sha256').update(expected, 'utf16le').digest();
  const actualDigest = createHash('sha256').update(actual, 'utf16le').digest();
  return timingSafeEqual(expectedDigest, actualDigest);
}

/** Allocate, listen and own cleanup of one Unix socket or Windows named pipe. */
export async function bindLocalEndpoint(options: {
  readonly server: Server;
  readonly name: string;
  readonly endpoint?: string;
  readonly signal?: AbortSignal;
}): Promise<BoundLocalEndpoint> {
  options.signal?.throwIfAborted();
  const allocated = options.endpoint === undefined
    ? await allocateEndpoint(options.name)
    : { endpoint: options.endpoint, cleanup: undefined };
  if (options.signal?.aborted === true) {
    await allocated.cleanup?.();
    options.signal.throwIfAborted();
  }
  try {
    await listen(options.server, allocated.endpoint, options.signal);
  } catch (error) {
    await allocated.cleanup?.();
    throw error;
  }
  let closePromise: Promise<void> | undefined;
  return Object.freeze({
    endpoint: allocated.endpoint,
    close(): Promise<void> {
      closePromise ??= closeEndpoint(options.server, allocated.cleanup);
      return closePromise;
    },
  });
}

function localError(error: unknown): LocalTransportError {
  if (error instanceof LocalTransportError) return error;
  if (error instanceof ProtocolViolation) {
    const code: LocalTransportErrorCode = error.code === 'frame-encoding'
      ? 'frame-encoding'
      : error.code === 'frame-oversized'
        ? 'frame-oversized'
        : 'frame-malformed';
    return new LocalTransportError(code, error.message, { cause: error });
  }
  return new LocalTransportError('frame-malformed', 'local transport framing failed', { cause: error });
}

function object(value: unknown, name: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new LocalTransportError('invalid-envelope', `${name} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function boundedText(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new LocalTransportError('invalid-envelope', `${name} is invalid`);
  }
  return value;
}

async function allocateEndpoint(name: string): Promise<{
  readonly endpoint: string;
  readonly cleanup?: () => Promise<void>;
}> {
  if (!/^[a-z0-9-]{1,48}$/u.test(name)) {
    throw new LocalTransportError('invalid-envelope', 'endpoint name is invalid');
  }
  const suffix = randomBytes(12).toString('hex');
  if (process.platform === 'win32') return { endpoint: `\\\\.\\pipe\\termwright-${name}-${suffix}` };
  const directory = await mkdtemp(join(tmpdir(), `termwright-${name}-`));
  return {
    endpoint: join(directory, `${name}.sock`),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

function listen(server: Server, endpoint: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => { cleanup(); reject(error); };
    const onListening = (): void => { cleanup(); resolve(); };
    const onClose = (): void => {
      cleanup();
      reject(signal?.reason ?? new Error('local server closed before listening'));
    };
    const cleanup = (): void => {
      server.removeListener('error', onError);
      server.removeListener('listening', onListening);
      server.removeListener('close', onClose);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.once('close', onClose);
    try {
      server.listen({ path: endpoint, signal });
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

async function closeEndpoint(server: Server, cleanup?: () => Promise<void>): Promise<void> {
  const cleanups: Promise<void>[] = [];
  if (server.listening) {
    cleanups.push(new Promise((resolve, reject) =>
      server.close((error) => error === undefined ? resolve() : reject(error))));
  }
  if (cleanup !== undefined) cleanups.push(cleanup());
  const results = await Promise.allSettled(cleanups);
  const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
  if (failures.length > 0) throw new AggregateError(failures, 'local endpoint cleanup failed');
}
