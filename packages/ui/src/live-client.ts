/**
 * Worker-side bridge from a live terminal session to a running Termwright UI.
 *
 * Import this Node-only entry point from the process which owns the terminal.
 * It is deliberately fail-open: a missing, malformed or unavailable UI server
 * never changes the outcome of the test driving that terminal.
 *
 * @packageDocumentation
 */

import { WebSocket } from 'ws';
import { encodeMessage, parseClientMessage, UiProtocolError, type ServerMessage } from './events.js';
import {
  inspectNodeActionability,
  streamSession,
  type UiSessionMessageSink,
  type UiSessionSource,
} from './live.js';

/** Environment variable set by `termwright ui` for worker processes. */
export const UI_URL_ENV = 'TERMWRIGHT_UI_URL';

/** Options for {@link connectLiveSession}. */
export interface LiveSessionClientOptions {
  /** UI base URL including its token. Default `process.env.TERMWRIGHT_UI_URL`. */
  readonly url?: string;
  /** Vitest test which owns the session, used to associate live actions. */
  readonly testId?: string;
  /** Innermost authored step at event time. */
  readonly currentStepId?: () => string | undefined;
  /** Maximum time teardown spends finishing the local handshake. Default 500 ms. */
  readonly closeTimeoutMs?: number;
}

/** A live bridge. Closing it detaches every session listener. */
export interface LiveSessionConnection {
  /** False when no valid UI URL was configured. */
  readonly enabled: boolean;
  /** Idempotent and fail-open; it never rejects. */
  close(): Promise<void>;
}

const DISABLED: LiveSessionConnection = {
  enabled: false,
  close: () => Promise.resolve(),
};

const DEFAULT_CLOSE_TIMEOUT_MS = 500;
const MAX_QUEUED_MESSAGES = 4096;
const MAX_QUEUED_BYTES = 8 * 1024 * 1024;

interface QueuedMessage {
  readonly type: ServerMessage['type'];
  readonly encoded: string;
  readonly bytes: number;
}

/**
 * Streams a terminal session to `termwright ui` over its producer WebSocket.
 *
 * No URL means no socket and no listeners. Invalid URLs, connection refusal,
 * server shutdown and send failures are all ignored: observing a test must not
 * be capable of failing it. Events emitted during the local handshake are held
 * in a bounded queue and flushed in order once the socket opens.
 */
export function connectLiveSession(
  source: UiSessionSource,
  options: LiveSessionClientOptions = {},
): LiveSessionConnection {
  const configured = options.url ?? process.env[UI_URL_ENV];
  if (configured === undefined || configured.trim() === '') return DISABLED;

  let sink: ProducerSocketSink;
  try {
    sink = new ProducerSocketSink(configured, options.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS, source);
  } catch {
    return DISABLED;
  }

  let detach: (() => void) | undefined;
  try {
    detach = streamSession(sink, source, {
      ...(options.testId === undefined ? {} : { testId: options.testId }),
      ...(options.currentStepId === undefined ? {} : { currentStepId: options.currentStepId }),
    });
  } catch {
    // A source which is already closing can fail while announcing its initial
    // state. Treat that exactly like an unavailable observer.
    void sink.close();
    return DISABLED;
  }

  let closing: Promise<void> | undefined;
  return {
    enabled: true,
    close(): Promise<void> {
      closing ??= (async () => {
        try {
          detach?.();
        } catch {
          // Detaching is observer cleanup and must not replace a test result.
        }
        detach = undefined;
        await sink.close();
      })();
      return closing;
    },
  };
}

/** A bounded, fail-open producer transport shared by every event in a session. */
class ProducerSocketSink implements UiSessionMessageSink {
  readonly #socket: WebSocket;
  readonly #settled: Promise<void>;
  readonly #closeTimeoutMs: number;
  #settle: (() => void) | undefined;
  #queue: QueuedMessage[] = [];
  #queuedBytes = 0;
  #open = false;
  #failed = false;
  #accepting = true;
  #closing: Promise<void> | undefined;

  constructor(url: string, closeTimeoutMs: number, source: UiSessionSource) {
    if (!Number.isFinite(closeTimeoutMs) || closeTimeoutMs < 0) {
      throw new TypeError('closeTimeoutMs must be a non-negative finite number');
    }
    const target = producerUrl(url);
    this.#closeTimeoutMs = closeTimeoutMs;
    this.#socket = new WebSocket(target);
    this.#settled = new Promise<void>((done) => {
      this.#settle = done;
    });

    this.#socket.on('open', () => {
      if (this.#failed) return;
      this.#open = true;
      try {
        for (const message of this.#queue) this.#socket.send(message.encoded);
      } catch {
        this.#fail();
      }
      this.#clearQueue();
      this.#settleOnce();
    });
    this.#socket.on('error', () => {
      this.#fail();
    });
    this.#socket.on('close', () => {
      this.#fail();
    });
    this.#socket.on('message', (raw: Buffer) => {
      let message;
      try {
        message = parseClientMessage(raw);
      } catch (error) {
        if (error instanceof UiProtocolError) return;
        throw error;
      }
      if (message.type !== 'inspect-actionability' || message.sessionId !== source.sessionId) return;
      void inspectNodeActionability(source, message.nodeId).then((results) => {
        this.publish({
          v: 1,
          type: 'actionability-inspection',
          requestId: message.requestId,
          sessionId: message.sessionId,
          nodeId: message.nodeId,
          results,
        });
      }).catch((error: unknown) => {
        this.publish({
          v: 1,
          type: 'actionability-inspection',
          requestId: message.requestId,
          sessionId: message.sessionId,
          nodeId: message.nodeId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });
  }

  publish(message: ServerMessage): void {
    if (!this.#accepting || this.#failed) return;
    let encoded: string;
    try {
      encoded = encodeMessage(message);
    } catch {
      return;
    }
    if (this.#open && this.#socket.readyState === WebSocket.OPEN) {
      try {
        this.#socket.send(encoded);
      } catch {
        this.#fail();
      }
      return;
    }
    const queued = { type: message.type, encoded, bytes: Buffer.byteLength(encoded) };
    this.#queue.push(queued);
    this.#queuedBytes += queued.bytes;
    this.#boundQueue();
  }

  close(): Promise<void> {
    this.#closing ??= this.#close();
    return this.#closing;
  }

  async #close(): Promise<void> {
    this.#accepting = false;
    try {
      await withTimeout(this.#settled, this.#closeTimeoutMs);
      if (this.#failed || this.#socket.readyState === WebSocket.CLOSED) return;

      if (this.#socket.readyState === WebSocket.OPEN) {
        const closed = new Promise<void>((done) => this.#socket.once('close', () => done()));
        this.#socket.close();
        const graceful = await withTimeout(closed, this.#closeTimeoutMs);
        if (!graceful) this.#terminateIfOpen();
        return;
      }
      this.#socket.terminate();
    } catch {
      // ws teardown is outside the test's correctness boundary.
      try {
        this.#socket.terminate();
      } catch {
        // Already closed.
      }
    } finally {
      this.#clearQueue();
    }
  }

  #fail(): void {
    this.#failed = true;
    this.#open = false;
    this.#clearQueue();
    this.#settleOnce();
  }

  #terminateIfOpen(): void {
    if (this.#socket.readyState !== WebSocket.CLOSED) this.#socket.terminate();
  }

  #settleOnce(): void {
    this.#settle?.();
    this.#settle = undefined;
  }

  #clearQueue(): void {
    this.#queue = [];
    this.#queuedBytes = 0;
  }

  #boundQueue(): void {
    while (
      this.#queue.length > MAX_QUEUED_MESSAGES ||
      this.#queuedBytes > MAX_QUEUED_BYTES
    ) {
      // Preserve the session announcement whenever another event can be
      // sacrificed. The server cannot interpret output/tree events without it.
      let index = this.#queue.findIndex((message) => message.type === 'output');
      if (index < 0) index = this.#queue.findIndex((message) => message.type === 'app-log');
      if (index < 0) index = this.#queue.findIndex((message) => message.type !== 'session');
      if (index < 0) index = 0;
      const [dropped] = this.#queue.splice(index, 1);
      if (dropped !== undefined) this.#queuedBytes -= dropped.bytes;
    }
  }
}

function producerUrl(url: string): URL {
  const target = new URL(url);
  if (target.protocol !== 'http:' && target.protocol !== 'https:' &&
      target.protocol !== 'ws:' && target.protocol !== 'wss:') {
    throw new TypeError(`unsupported UI URL protocol ${target.protocol}`);
  }
  if (target.protocol === 'http:') target.protocol = 'ws:';
  if (target.protocol === 'https:') target.protocol = 'wss:';
  target.pathname = '/ws';
  target.searchParams.set('role', 'producer');
  return target;
}

/** Resolves false on timeout; the timer cannot keep a finished test alive. */
async function withTimeout(promise: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<false>((done) => {
    timer = setTimeout(() => done(false), timeoutMs);
    timer.unref?.();
  });
  const result = await Promise.race([promise.then(() => true as const), timedOut]);
  if (timer !== undefined) clearTimeout(timer);
  return result;
}
