/**
 * The fan-out point: every producer (a Vitest reporter, a live session bridge,
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
}

/** Options for {@link UiHub}. */
export interface UiHubOptions {
  /** Backlog message ceiling. Default 4096. */
  readonly maxMessages?: number;
  /** Backlog byte ceiling for `output` payloads. Default 4 MiB. */
  readonly maxOutputBytes?: number;
  /** Generic/manual session handshakes retained across a run boundary. Default 256. */
  readonly maxSessions?: number;
}

function firstIndexOf(messages: readonly ServerMessage[], type: ServerMessage['type']): number | undefined {
  const index = messages.findIndex((message) => message.type === type);
  return index === -1 ? undefined : index;
}

const DEFAULT_MAX_MESSAGES = 4096;
const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

/**
 * Broadcast hub with a replay backlog.
 *
 * @example
 * ```ts
 * const hub = new UiHub();
 * hub.publish({ v: 1, type: 'run-start', mode: 'live', startedAt: Date.now() });
 * const detach = hub.addClient(socket); // socket receives the backlog first
 * ```
 */
export class UiHub {
  readonly #clients = new Set<UiClient>();
  readonly #backlog: ServerMessage[] = [];
  readonly #maxMessages: number;
  readonly #maxOutputBytes: number;
  readonly #maxSessions: number;
  #outputBytes = 0;

  constructor(options: UiHubOptions = {}) {
    this.#maxMessages = options.maxMessages ?? DEFAULT_MAX_MESSAGES;
    this.#maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    this.#maxSessions = options.maxSessions ?? Math.min(256, Math.max(1, this.#maxMessages - 1));
  }

  /** Messages a newly connected client would be replayed, oldest first. */
  get backlog(): readonly ServerMessage[] {
    return this.#backlog;
  }

  /** Number of connected clients. */
  get clientCount(): number {
    return this.#clients.size;
  }

  /** Broadcasts a message and appends it to the backlog. */
  publish(message: ServerMessage): void {
    const outgoing = [message];
    if (message.type === 'run-start') {
      // Existing viewers clear run-local state on run-start. Replay the
      // authoritative listing and generic/manual session handshakes
      // immediately afterwards, in the same order a late viewer receives
      // them. Test-bound sessions belong to the run that created them and must
      // not become terminal choices for the next attempt of the same test.
      outgoing.push(...this.reset());
      this.#backlog.unshift(message);
    } else {
      this.#remember(message);
    }
    for (const next of outgoing) {
      const encoded = encodeMessage(next);
      for (const client of this.#clients) {
        try {
          client.send(encoded);
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
        client.send(encodeMessage(message));
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
        this.#backlog[previous] = message;
        return;
      }
    }
    this.#backlog.push(message);
    if (message.type === 'output') this.#outputBytes += message.dataB64.length;
    if (message.type === 'session') this.#trimSessions();

    while (
      this.#backlog.length > this.#maxMessages ||
      this.#outputBytes > this.#maxOutputBytes
    ) {
      const dropped = this.#dropOldest();
      if (dropped === undefined) break;
    }
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
        (message) => message.type !== 'run-start' && message.type !== 'session',
      );
    if (index < 0) return undefined;
    const [dropped] = this.#backlog.splice(index, 1);
    if (dropped?.type === 'output') this.#outputBytes -= dropped.dataB64.length;
    return dropped;
  }
}
