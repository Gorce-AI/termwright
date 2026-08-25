/**
 * The fan-out point: every producer (the host projection, a live session bridge,
 * a replayed trace) writes {@link ServerMessage}s here, and every connected
 * browser tab reads them.
 *
 * A tab that connects late still needs to see the run so far, so the hub keeps a
 * bounded backlog and replays it on connect. The bound matters: terminal output
 * is unbounded by nature, and a runner UI that grows without limit while a
 * `yes`-style program floods the PTY is a runner UI that gets killed by the OS
 * halfway through the run it was supposed to explain.
 *
 * @packageDocumentation
 */

import { encodeMessage, type ServerMessage } from './events.js';

/** Anything that can receive an encoded message — a WebSocket, or a test fake. */
export interface UiClient {
  send(data: string): void;
  /** Bytes already buffered by the transport for this client. */
  bufferedBytes?(): number;
  /** Disconnects a client which cannot keep up with the bounded projection. */
  close?(reason: string): void;
}

/** Options for {@link UiHub}. */
export interface UiHubOptions {
  /** Backlog message ceiling. Default 4096. */
  readonly maxMessages?: number;
  /** Backlog byte ceiling for `output` payloads. Default 4 MiB. */
  readonly maxOutputBytes?: number;
  /** Total encoded replay backlog ceiling. Default 16 MiB. */
  readonly maxBacklogBytes?: number;
  /** Per-client transport buffer ceiling. Default 4 MiB. */
  readonly maxClientBufferedBytes?: number;
  /** Generic/manual session handshakes retained across a run boundary. Default 256. */
  readonly maxSessions?: number;
}

function firstIndexOf(messages: readonly ServerMessage[], type: ServerMessage['type']): number | undefined {
  const index = messages.findIndex((message) => message.type === type);
  return index === -1 ? undefined : index;
}

const DEFAULT_MAX_MESSAGES = 4096;
const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_BACKLOG_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_CLIENT_BUFFERED_BYTES = 4 * 1024 * 1024;
const wireEncoder = new TextEncoder();

/** JSON is sent as UTF-8 over WebSocket; string length is not a byte count. */
function encodedBytes(message: ServerMessage): number {
  return wireEncoder.encode(encodeMessage(message)).byteLength;
}

/**
 * Broadcast hub with a replay backlog.
 *
 * @example
 * ```ts
 * const hub = new UiHub();
 * hub.publish({ v: 1, type: 'run-start', runId: 'run:test', mode: 'live', startedAt: Date.now() });
 * const detach = hub.addClient(socket); // socket receives the backlog first
 * ```
 */
export class UiHub {
  readonly #clients = new Set<UiClient>();
  readonly #backlog: ServerMessage[] = [];
  readonly #maxMessages: number;
  readonly #maxOutputBytes: number;
  readonly #maxBacklogBytes: number;
  readonly #maxClientBufferedBytes: number;
  readonly #maxSessions: number;
  #outputBytes = 0;
  #backlogBytes = 0;
  #runGeneration = 0;
  #runBusy = false;

  constructor(options: UiHubOptions = {}) {
    // run-start + session + an explicit gap must always fit. A smaller limit
    // cannot truthfully retain identity and disclose projection loss.
    this.#maxMessages = Math.max(3, nonNegativeSafeInteger(options.maxMessages ?? DEFAULT_MAX_MESSAGES, 'maxMessages'));
    this.#maxOutputBytes = nonNegativeSafeInteger(options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES, 'maxOutputBytes');
    this.#maxBacklogBytes = nonNegativeSafeInteger(options.maxBacklogBytes ?? DEFAULT_MAX_BACKLOG_BYTES, 'maxBacklogBytes');
    this.#maxClientBufferedBytes = nonNegativeSafeInteger(
      options.maxClientBufferedBytes ?? DEFAULT_MAX_CLIENT_BUFFERED_BYTES,
      'maxClientBufferedBytes',
    );
    this.#maxSessions = nonNegativeSafeInteger(
      options.maxSessions ?? Math.min(256, Math.max(1, this.#maxMessages - 1)),
      'maxSessions',
    );
  }

  /** Messages a newly connected client would be replayed, oldest first. */
  get backlog(): readonly ServerMessage[] {
    return this.#backlog;
  }

  /** Number of connected clients. */
  get clientCount(): number {
    return this.#clients.size;
  }

  /** Monotonic projection epoch, independent of replay eviction. */
  get runGeneration(): number {
    return this.#runGeneration;
  }

  /** Authoritative projected run state, independent of replay eviction. */
  get runBusy(): boolean {
    return this.#runBusy;
  }

  /** Broadcasts a message and appends it to the backlog. */
  publish(message: ServerMessage): void {
    const outgoing = [message];
    if (message.type === 'run-start') {
      this.#runGeneration += 1;
      this.#runBusy = true;
      // Existing viewers clear run-local state on run-start. Replay the
      // authoritative listing and generic/manual session handshakes
      // immediately afterwards, in the same order a late viewer receives
      // them. Test-bound sessions belong to the run that created them and must
      // not become terminal choices for the next attempt of the same test.
      this.reset();
      this.#backlog.unshift(message);
      this.#backlogBytes += encodedBytes(message);
      this.#enforceBounds();
      outgoing.push(...this.#backlog.slice(1));
    } else {
      if (message.type === 'run-end' || message.type === 'run-cancelled' || message.type === 'run-infrastructure-failed') {
        this.#runBusy = false;
      }
      this.#remember(message);
    }
    for (const next of outgoing) {
      const encoded = encodeMessage(next);
      for (const client of this.#clients) {
        try {
          if (this.#clientIsSlow(client)) continue;
          client.send(encoded);
          this.#clientIsSlow(client);
        } catch {
          // A socket that died between the readiness check and the write is not
          // an error worth failing the run over; the close handler removes it.
          this.#clients.delete(client);
        }
      }
    }
  }

  /**
   * Registers a client and replays the backlog to it.
   *
   * @returns a function that unregisters the client.
   */
  addClient(client: UiClient): () => void {
    this.#clients.add(client);
    for (const message of this.#backlog) {
      try {
        if (this.#clientIsSlow(client)) return () => undefined;
        client.send(encodeMessage(message));
        if (this.#clientIsSlow(client)) return () => undefined;
      } catch {
        this.#clients.delete(client);
        return () => undefined;
      }
    }
    return () => {
      this.#clients.delete(client);
    };
  }

  /**
   * Drops the backlog. Called when a new run starts.
   *
   * The project's test listing survives: `tests-discovered` describes what the
   * project *has*, which a run does not change. Generic/manual session
   * announcements survive too: they can be attached before a run begins and
   * are not owned by one test attempt. A session carrying `testId` is
   * run-local, so retaining it would make a rerun default to stale terminal
   * output and accumulate one selector option per previous attempt.
   */
  reset(): ServerMessage[] {
    const listing = this.#backlog.filter((message) => message.type === 'tests-discovered');
    const sessions = this.#backlog.filter(
      (message) => message.type === 'session' && message.testId === undefined,
    );
    const retained = [...listing.slice(-1), ...sessions];
    this.#backlog.length = 0;
    this.#backlog.push(...retained);
    this.#outputBytes = 0;
    this.#backlogBytes = retained.reduce((total, message) => total + encodedBytes(message), 0);
    this.#trimSessions();
    return [...this.#backlog];
  }

  #remember(message: ServerMessage): void {
    if (message.type === 'session') {
      // This is current state, not an append-only event. Coalescing means a
      // late client receives the newest handshake/lifecycle facts exactly once.
      const previous = this.#backlog.findIndex(
        (candidate) =>
          candidate.type === 'session' && candidate.sessionId === message.sessionId,
      );
      if (previous >= 0) {
        this.#backlogBytes -= encodedBytes(this.#backlog[previous]!);
        this.#backlog[previous] = message;
        this.#backlogBytes += encodedBytes(message);
        this.#enforceBounds();
        return;
      }
    }
    if (message.type === 'semantic') {
      const previous = this.#backlog.findIndex(
        (candidate) => candidate.type === 'semantic' && candidate.sessionId === message.sessionId,
      );
      if (previous >= 0) {
        this.#backlogBytes -= encodedBytes(this.#backlog[previous]!);
        this.#backlog[previous] = message;
        this.#backlogBytes += encodedBytes(message);
        this.#enforceBounds();
        return;
      }
    }
    this.#backlog.push(message);
    this.#backlogBytes += encodedBytes(message);
    if (message.type === 'output') this.#outputBytes += message.dataB64.length;
    if (message.type === 'session') this.#trimSessions();

    this.#enforceBounds();
  }

  #enforceBounds(): void {
    let droppedMessages = 0;
    let droppedBytes = 0;
    while (
      this.#backlog.length > this.#maxMessages ||
      this.#outputBytes > this.#maxOutputBytes ||
      this.#backlogBytes > this.#maxBacklogBytes
    ) {
      const dropped = this.#dropOldest();
      if (dropped !== undefined) {
        droppedMessages += 1;
        droppedBytes += encodedBytes(dropped);
        continue;
      }
      const sessionDrop = this.#dropOldestSession();
      if (sessionDrop.messages === 0) break;
      droppedMessages += sessionDrop.messages;
      droppedBytes += sessionDrop.bytes;
    }
    if (droppedMessages > 0) this.#recordGap(droppedMessages, droppedBytes);
  }

  #dropOldestSession(): { readonly messages: number; readonly bytes: number } {
    const oldest = this.#backlog.find((message) => message.type === 'session');
    if (oldest?.type !== 'session') return { messages: 0, bytes: 0 };
    let messages = 0;
    let bytes = 0;
    for (let index = this.#backlog.length - 1; index >= 0; index -= 1) {
      const message = this.#backlog[index];
      if (message === undefined || !('sessionId' in message) || message.sessionId !== oldest.sessionId) continue;
      if (message.type === 'output') this.#outputBytes -= message.dataB64.length;
      const encoded = encodedBytes(message);
      this.#backlogBytes -= encoded;
      bytes += encoded;
      messages += 1;
      this.#backlog.splice(index, 1);
    }
    return { messages, bytes };
  }

  /** Evicts the oldest complete session record, including its dependent wire events. */
  #trimSessions(): void {
    while (this.#backlog.filter((message) => message.type === 'session').length > this.#maxSessions) {
      const oldest = this.#backlog.find((message) => message.type === 'session');
      if (oldest?.type !== 'session') return;
      for (let index = this.#backlog.length - 1; index >= 0; index -= 1) {
        const message = this.#backlog[index];
        if (message === undefined || !('sessionId' in message) || message.sessionId !== oldest.sessionId) continue;
        if (message.type === 'output') this.#outputBytes -= message.dataB64.length;
        this.#backlogBytes -= encodedBytes(message);
        this.#backlog.splice(index, 1);
      }
    }
  }

  /**
   * Drops the oldest droppable message, in order of how little it costs:
   * terminal output first, then application logs, then anything else that is
   * not `run-start` or `session`.
   *
   * Losing a screen fragment degrades the terminal pane; losing a log line
   * degrades the log panel; losing `run-start` would leave a tab that never
   * learns which mode it is in. Losing `session` makes every later terminal
   * and semantic event uninterpretable, so the newest announcement is retained
   * as well.
   */
  #dropOldest(): ServerMessage | undefined {
    const index =
      firstIndexOf(this.#backlog, 'output') ??
      firstIndexOf(this.#backlog, 'app-log') ??
      this.#backlog.findIndex(
        (message) => message.type !== 'run-start' && message.type !== 'session' && message.type !== 'diagnostic-gap',
      );
    if (index < 0) return undefined;
    const [dropped] = this.#backlog.splice(index, 1);
    if (dropped?.type === 'output') this.#outputBytes -= dropped.dataB64.length;
    if (dropped !== undefined) this.#backlogBytes -= encodedBytes(dropped);
    return dropped;
  }

  #recordGap(messages: number, bytes: number): void {
    const existing = this.#backlog.findIndex(
      (message) => message.type === 'diagnostic-gap' && message.source === 'ui-hub',
    );
    if (existing >= 0) {
      const gap = this.#backlog[existing];
      if (gap?.type === 'diagnostic-gap') {
        this.#backlogBytes -= encodedBytes(gap);
        let next = {
          ...gap,
          droppedMessages: gap.droppedMessages + messages,
          droppedBytes: gap.droppedBytes + bytes,
        };
        this.#backlog[existing] = next;
        this.#backlogBytes += encodedBytes(next);
        while (this.#backlog.length > this.#maxMessages || this.#backlogBytes > this.#maxBacklogBytes) {
          const dropped = this.#dropOldest();
          if (dropped !== undefined) {
            next = { ...next, droppedMessages: next.droppedMessages + 1, droppedBytes: next.droppedBytes + encodedBytes(dropped) };
          } else {
            const removed = this.#dropOldestSession();
            if (removed.messages === 0) break;
            next = { ...next, droppedMessages: next.droppedMessages + removed.messages, droppedBytes: next.droppedBytes + removed.bytes };
          }
          const gapIndex = this.#backlog.findIndex(
            (message) => message.type === 'diagnostic-gap' && message.source === 'ui-hub',
          );
          if (gapIndex < 0) break;
          this.#backlogBytes -= encodedBytes(this.#backlog[gapIndex]!);
          this.#backlog[gapIndex] = next;
          this.#backlogBytes += encodedBytes(next);
        }
      }
      return;
    }
    let droppedMessages = messages;
    let droppedBytes = bytes;
    let candidate: ServerMessage = {
      v: 1,
      type: 'diagnostic-gap',
      source: 'ui-hub',
      droppedMessages,
      droppedBytes,
    };
    while (this.#backlog.length >= this.#maxMessages ||
           this.#backlogBytes + encodedBytes(candidate) > this.#maxBacklogBytes) {
      const dropped = this.#dropOldest();
      if (dropped !== undefined) {
        droppedMessages += 1;
        droppedBytes += encodedBytes(dropped);
      } else {
        const removed = this.#dropOldestSession();
        if (removed.messages === 0) break;
        droppedMessages += removed.messages;
        droppedBytes += removed.bytes;
      }
      candidate = { ...candidate, droppedMessages, droppedBytes };
    }
    this.#backlog.push(candidate);
    this.#backlogBytes += encodedBytes(candidate);
  }

  #clientIsSlow(client: UiClient): boolean {
    const buffered = client.bufferedBytes?.() ?? 0;
    if (Number.isFinite(buffered) && buffered <= this.#maxClientBufferedBytes) return false;
    this.#clients.delete(client);
    try {
      client.close?.('client transport buffer exceeded its limit');
    } catch {
      // The client is already detached; transport cleanup cannot fail a run.
    }
    return true;
  }
}

function nonNegativeSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}
