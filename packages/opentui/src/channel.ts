/**
 * The adapter's side of the semantic channel.
 *
 * Two rules govern this file. First, **the channel may never take the
 * application down**: a refused connection, a truncated frame, a driver that
 * disappears mid-session — all of it collapses into "disabled", silently, and
 * the Ink app keeps rendering as if it had never been instrumented. Second,
 * nothing is sent before a successful handshake, so a half-open channel cannot
 * leak an application's screen content to whatever is listening on the socket.
 */

import { createConnection, type Socket } from 'node:net';
import {
  createFrameDecoder,
  encodeFrame,
  parseDriverMessage,
  DEFAULT_LIMITS,
  PROTOCOL_ID,
  type AdapterCapability,
  type AdapterToDriverMessage,
  type FrameDecoder,
  type HelloAckMessage,
  type ProtocolLimits,
  type SemanticSnapshot,
} from '@termwright/protocol';
import type { AdapterEnv } from './config.js';

/** Handshake result: the parameters the driver chose for this session. */
export interface ChannelSession {
  readonly sessionId: string;
  readonly limits: ProtocolLimits;
  readonly subscribe: HelloAckMessage['subscribe'];
  readonly markerEnabled: boolean;
}

/** Serves a driver `get-tree` request. Returns `undefined` when the revision is gone. */
export type TreeProvider = (revision?: number) => SemanticSnapshot | undefined;

/** Connection parameters. Defaults follow the design's negotiation window. */
export interface ChannelOptions {
  /** Milliseconds to wait for connect + `hello-ack` before giving up. Default 1000. */
  readonly handshakeTimeoutMs?: number;
  readonly adapterName: string;
  readonly adapterVersion: string;
  readonly capabilities: readonly AdapterCapability[];
}

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 1_000;

/**
 * A connected, handshaken channel to the driver.
 *
 * Obtain one with {@link openChannel}; a `null` result means "stay dormant",
 * and every later failure flips {@link SemanticChannel.isOpen} to `false`.
 */
export class SemanticChannel {
  readonly #socket: Socket;
  readonly session: ChannelSession;
  #open = true;
  #treeProvider: TreeProvider | undefined;

  /**
   * @internal Constructed by {@link openChannel} once the handshake succeeded.
   *
   * The handshake decoder is handed over rather than replaced, so bytes that
   * arrived in the same TCP-level chunk as the `hello-ack` are not dropped. It
   * is bounded by {@link DEFAULT_LIMITS}, the ceiling that applies before the
   * driver has had a chance to tighten anything.
   */
  constructor(
    socket: Socket,
    session: ChannelSession,
    decoder: FrameDecoder,
    pending: readonly unknown[],
  ) {
    this.#socket = socket;
    this.session = session;

    for (const message of pending) this.#dispatch(message);

    socket.on('data', (chunk: Buffer) => {
      if (!this.#open) return;
      try {
        for (const message of decoder.push(chunk)) this.#dispatch(message);
      } catch {
        this.close();
      }
    });
    socket.on('error', () => this.close());
    socket.on('close', () => this.close());
  }

  /** Whether the channel is still usable. Turns `false` permanently on any fault. */
  get isOpen(): boolean {
    return this.#open;
  }

  /** Install the callback that answers driver `get-tree` requests. */
  onGetTree(provider: TreeProvider): void {
    this.#treeProvider = provider;
  }

  /** Push a committed snapshot. No-op once the channel is disabled. */
  sendSnapshot(snapshot: SemanticSnapshot): void {
    this.#send({ type: 'snapshot', snapshot });
  }

  /** Push a bare revision commit. No-op once the channel is disabled. */
  sendRevisionCommit(revision: number): void {
    this.#send({ type: 'revision-commit', revision });
  }

  /** Disable the channel and release the socket. Safe to call repeatedly. */
  close(): void {
    if (!this.#open) return;
    this.#open = false;
    this.#treeProvider = undefined;
    this.#socket.removeAllListeners('data');
    this.#socket.destroy();
  }

  #dispatch(value: unknown): void {
    const parsed = parseDriverMessage(value, this.session.limits);
    if (!parsed.ok) {
      this.close();
      return;
    }
    const message = parsed.message;
    if (message.type === 'error') {
      this.close();
      return;
    }
    if (message.type !== 'get-tree') return;

    const snapshot = this.#treeProvider?.(message.revision);
    this.#send(
      snapshot === undefined
        ? {
            type: 'get-tree-result',
            requestId: message.requestId,
            error: 'revision not retained',
          }
        : { type: 'get-tree-result', requestId: message.requestId, snapshot },
    );
  }

  #send(message: AdapterToDriverMessage): void {
    if (!this.#open) return;
    try {
      this.#socket.write(encodeFrame(message, this.session.limits.maxFrameBytes));
    } catch {
      this.close();
    }
  }
}

/**
 * Connect to the driver and complete the handshake.
 *
 * @returns the open channel, or `null` if anything at all went wrong — an
 * unreachable endpoint, a rejected token, a timeout, a malformed `hello-ack`.
 * Callers treat `null` exactly like a dormant environment.
 *
 * @example
 * ```ts
 * const channel = await openChannel(env, {
 *   adapterName: '@termwright/ink',
 *   adapterVersion: '0.1.0',
 *   capabilities: ['tree', 'states', 'actions', 'render-revisions'],
 * });
 * ```
 */
export async function openChannel(
  env: AdapterEnv,
  options: ChannelOptions,
): Promise<SemanticChannel | null> {
  const timeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;

  return new Promise<SemanticChannel | null>((resolve) => {
    let settled = false;
    let socket: Socket;

    const decoder = createFrameDecoder(DEFAULT_LIMITS.maxFrameBytes);
    const timer = setTimeout(() => abandon(), timeoutMs);
    timer.unref();

    const detach = (): void => {
      clearTimeout(timer);
      socket.removeAllListeners('connect');
      socket.removeAllListeners('data');
      socket.removeAllListeners('error');
      socket.removeAllListeners('close');
    };

    const abandon = (): void => {
      if (settled) return;
      settled = true;
      detach();
      socket.destroy();
      resolve(null);
    };

    const accept = (session: ChannelSession, pending: readonly unknown[]): void => {
      if (settled) return;
      settled = true;
      detach();
      resolve(new SemanticChannel(socket, session, decoder, pending));
    };

    try {
      socket = createConnection(env.endpoint);
      // The channel must never be the reason a finished app keeps running.
      socket.unref();
    } catch {
      clearTimeout(timer);
      resolve(null);
      return;
    }

    socket.on('error', abandon);
    socket.on('close', abandon);

    socket.on('connect', () => {
      try {
        socket.write(
          encodeFrame(
            {
              type: 'hello',
              protocol: PROTOCOL_ID,
              token: env.token,
              adapter: { name: options.adapterName, version: options.adapterVersion },
              capabilities: options.capabilities,
            },
            DEFAULT_LIMITS.maxFrameBytes,
          ),
        );
      } catch {
        abandon();
      }
    });

    socket.on('data', (chunk: Buffer) => {
      if (settled) return;
      let messages: readonly unknown[];
      try {
        messages = decoder.push(chunk);
      } catch {
        abandon();
        return;
      }
      if (messages.length === 0) return;

      const session = readHelloAck(messages[0]);
      if (session === null) {
        abandon();
        return;
      }
      accept(session, messages.slice(1));
    });
  });
}

function readHelloAck(value: unknown): ChannelSession | null {
  const parsed = parseDriverMessage(value, DEFAULT_LIMITS);
  if (!parsed.ok || parsed.message.type !== 'hello-ack') return null;
  const ack = parsed.message;

  return {
    sessionId: ack.sessionId,
    limits: narrowLimits(ack.limits),
    subscribe: ack.subscribe,
    markerEnabled: ack.marker.enabled,
  };
}

/**
 * Adopt the driver's limits, but never above our own defaults: a driver may
 * tighten what the adapter produces, never widen it.
 */
function narrowLimits(value: unknown): ProtocolLimits {
  if (!isRecord(value)) return DEFAULT_LIMITS;
  const entries = Object.entries(DEFAULT_LIMITS).map(([key, fallback]) => {
    const offered = value[key];
    const usable = typeof offered === 'number' && Number.isSafeInteger(offered) && offered > 0;
    return [key, usable ? Math.min(offered, fallback as number) : fallback];
  });
  return Object.freeze(Object.fromEntries(entries)) as ProtocolLimits;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
