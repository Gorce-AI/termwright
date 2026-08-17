/**
 * The driver channel, from a probe's side.
 *
 * Nothing here knows what framework is being observed: it takes snapshots and
 * returns markers. That is deliberate — `packages/ink` and the legacy
 * `packages/opentui` adapter each already carry a channel of their own, and a
 * third copy is only worth writing if it can later become the shared one by
 * being moved rather than rewritten. When `probe-ink` arrives it will be the
 * second real consumer, and that is the moment to extract this file.
 *
 * The rules are the ones every adapter in this repo follows: nothing is sent
 * before a successful handshake, and no fault on this channel is ever allowed
 * to reach the application. A refused connection, a rejected token, a driver
 * that vanishes mid-session — all of it collapses into "disabled", silently.
 */

import { createConnection, type Socket } from 'node:net';
import {
  createFrameDecoder,
  encodeFrame,
  encodeMarker,
  parseDriverMessage,
  DEFAULT_LIMITS,
  PROTOCOL_ID,
  type AdapterCapability,
  type AdapterToDriverMessage,
  type FrameDecoder,
  type ProbeInfo,
  type ProtocolLimits,
  type SemanticSnapshot,
} from '@termwright/protocol';

/** What the driver decided for this session. */
export interface ChannelSession {
  readonly sessionId: string;
  readonly limits: ProtocolLimits;
  readonly markerEnabled: boolean;
}

/** Connection parameters. */
export interface ConnectOptions {
  readonly endpoint: string;
  readonly token: string;
  readonly probe: ProbeInfo;
  readonly capabilities: readonly AdapterCapability[];
  readonly adapterName: string;
  readonly adapterVersion: string;
  /** Milliseconds for connect plus handshake. Default 1000. */
  readonly handshakeTimeoutMs?: number;
}

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 1_000;

/**
 * A connected channel.
 *
 * `publish` returns the marker to write, if the driver enabled one. It returns
 * it rather than writing it, because only the caller knows when the frame's
 * bytes have actually left — under OpenTUI that is a sink, under Ink it is a
 * stdout drain, and the channel has no business guessing.
 */
export class ProbeChannel {
  readonly #socket: Socket;
  readonly session: ChannelSession;
  readonly #token: string;
  #open = true;
  #revision = 0;
  #latest: SemanticSnapshot | undefined;

  /** @internal Built by {@link connectProbe} once the handshake succeeded. */
  constructor(socket: Socket, session: ChannelSession, token: string, decoder: FrameDecoder) {
    this.#socket = socket;
    this.session = session;
    this.#token = token;

    socket.on('data', (chunk: Buffer) => {
      if (!this.#open) return;
      try {
        for (const value of decoder.push(chunk)) this.#dispatch(value);
      } catch {
        this.close();
      }
    });
    socket.on('error', () => this.close());
    socket.on('close', () => this.close());
  }

  get isOpen(): boolean {
    return this.#open;
  }

  /** Revisions published so far. */
  get revision(): number {
    return this.#revision;
  }

  /**
   * Send a tree and commit the revision it belongs to.
   *
   * Always a full snapshot. The producer obligation from D5 — a probe that
   * dropped anything from its fact stream must send a full snapshot instead of
   * the next delta — is therefore satisfied by construction rather than by
   * bookkeeping, which is the cheapest way to be correct while `subscribe`
   * negotiation for diffs is not implemented here yet.
   *
   * @returns the marker to write after the frame's bytes, or `undefined`.
   */
  publish(snapshot: SemanticSnapshot): string | undefined {
    if (!this.#open) return undefined;
    this.#revision = snapshot.revision;
    this.#latest = snapshot;

    this.#send({ type: 'snapshot', snapshot });
    this.#send({ type: 'revision-commit', revision: snapshot.revision });

    if (!this.session.markerEnabled) return undefined;
    try {
      return encodeMarker(this.#token, this.session.sessionId, snapshot.revision);
    } catch {
      return undefined;
    }
  }

  /** Disable the channel and release the socket. Idempotent. */
  close(): void {
    if (!this.#open) return;
    this.#open = false;
    this.#latest = undefined;
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

    const held = this.#latest;
    const usable = held !== undefined && (message.revision === undefined || message.revision === held.revision);
    this.#send(
      usable
        ? { type: 'get-tree-result', requestId: message.requestId, snapshot: held }
        : { type: 'get-tree-result', requestId: message.requestId, error: 'revision not retained' },
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
 * Connect and complete the handshake.
 *
 * @returns the channel, or `null` if anything went wrong. Callers treat `null`
 * exactly like an uninstrumented process: the application runs untouched.
 */
export async function connectProbe(options: ConnectOptions): Promise<ProbeChannel | null> {
  const timeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;

  return new Promise<ProbeChannel | null>((resolve) => {
    let settled = false;
    let socket: Socket;
    const decoder = createFrameDecoder(DEFAULT_LIMITS.maxFrameBytes);
    const timer = setTimeout(() => abandon(), timeoutMs);
    timer.unref();

    const detach = (): void => {
      clearTimeout(timer);
      for (const event of ['connect', 'data', 'error', 'close']) socket.removeAllListeners(event);
    };
    const abandon = (): void => {
      if (settled) return;
      settled = true;
      detach();
      socket.destroy();
      resolve(null);
    };
    const accept = (session: ChannelSession): void => {
      if (settled) return;
      settled = true;
      detach();
      resolve(new ProbeChannel(socket, session, options.token, decoder));
    };

    try {
      socket = createConnection(options.endpoint);
      // Never the reason a finished application keeps running.
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
              token: options.token,
              adapter: { name: options.adapterName, version: options.adapterVersion },
              capabilities: options.capabilities,
              // What this sender actually is. A probe says so, so the driver
              // can tell an inferred tree from a hand-written adapter's.
              probe: options.probe,
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

      const parsed = parseDriverMessage(messages[0], DEFAULT_LIMITS);
      if (!parsed.ok || parsed.message.type !== 'hello-ack') {
        abandon();
        return;
      }
      const ack = parsed.message;
      accept({
        sessionId: ack.sessionId,
        limits: narrowLimits(ack.limits),
        markerEnabled: ack.marker.enabled,
      });
    });
  });
}

/** Adopt the driver's limits, never above our own: it may tighten, not widen. */
function narrowLimits(offered: ProtocolLimits): ProtocolLimits {
  const entries = Object.entries(DEFAULT_LIMITS).map(([key, fallback]) => {
    const value = (offered as unknown as Record<string, unknown>)[key];
    const usable = typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
    return [key, usable ? Math.min(value, fallback as number) : fallback];
  });
  return Object.freeze(Object.fromEntries(entries)) as ProtocolLimits;
}
