/**
 * Browser-side transport: the WebSocket that carries `§UI events` and the
 * handful of `/api/` calls that carry state.
 *
 * The token travels in the query string of the URL the server printed, so the
 * page authenticates itself simply by having been opened from that link.
 */

import {
  encodeMessage,
  parseServerMessage,
  toBase64,
  type ClientMessage,
  type ServerMessage,
} from '../events.js';
import type { TraceOverview, TraceStatePayload } from '../trace-source.js';
import type { GeneratedSelector } from '../selector.js';
import type { RecordedEvent } from '../codegen.js';

/** `/api/state` — everything the app needs that is not an event. */
export interface ServerState {
  readonly mode: 'live' | 'post-mortem' | 'record';
  readonly sessions: readonly {
    readonly sessionId: string;
    readonly command: readonly string[];
    readonly columns: number | null;
    readonly rows: number | null;
    readonly writable: boolean;
  }[];
  readonly trace: TraceOverview | null;
  readonly record: {
    readonly sessionId: string;
    readonly command: readonly string[];
    readonly picking: boolean;
    readonly outFile: string | null;
  } | null;
}

/** Connection to the runner server. */
export class RunnerClient {
  readonly #token: string;
  #socket: WebSocket | undefined;
  #onMessage: (message: ServerMessage) => void = () => undefined;
  #onStatus: (connected: boolean) => void = () => undefined;

  constructor(token: string = new URLSearchParams(location.search).get('token') ?? '') {
    this.#token = token;
  }

  /** Opens the socket and reconnects when the server restarts. */
  connect(onMessage: (message: ServerMessage) => void, onStatus: (connected: boolean) => void): void {
    this.#onMessage = onMessage;
    this.#onStatus = onStatus;
    this.#open();
  }

  #open(): void {
    const url = new URL('/ws', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('token', this.#token);
    const socket = new WebSocket(url);
    this.#socket = socket;
    socket.addEventListener('open', () => this.#onStatus(true));
    socket.addEventListener('message', (event: MessageEvent<string>) => {
      try {
        this.#onMessage(parseServerMessage(event.data));
      } catch {
        // A frame this build does not understand is dropped, not fatal: the
        // server may be newer than the page a browser tab kept open.
      }
    });
    socket.addEventListener('close', () => {
      this.#onStatus(false);
      setTimeout(() => this.#open(), 1_000);
    });
  }

  /** Sends a client→server message. */
  send(message: ClientMessage): void {
    if (this.#socket?.readyState !== WebSocket.OPEN) return;
    this.#socket.send(encodeMessage(message));
  }

  /** Forwards raw terminal bytes (recorder mode). */
  sendInput(sessionId: string, data: string): void {
    this.send({ v: 1, type: 'input', sessionId, dataB64: toBase64(new TextEncoder().encode(data)) });
  }

  async state(): Promise<ServerState> {
    return this.#get<ServerState>('/api/state');
  }

  async traceState(timeMs: number): Promise<TraceStatePayload> {
    return this.#get<TraceStatePayload>(`/api/trace/state?t=${Math.round(timeMs)}`);
  }

  async recordAction(kind: 'click' | 'assert-visible', nodeId: string): Promise<{ selector: GeneratedSelector; source: string }> {
    return this.#post('/api/record/action', { kind, nodeId });
  }

  async recordAssert(kind: 'snapshot' | 'text' | 'wait-text', text?: string): Promise<{ source: string }> {
    return this.#post('/api/record/assert', { kind, ...(text === undefined ? {} : { text }) });
  }

  async recordStep(title: string): Promise<{ source: string }> {
    return this.#post('/api/record/step', { title });
  }

  async recordedEvents(): Promise<{ events: readonly RecordedEvent[]; source: string }> {
    return this.#get('/api/record/events');
  }

  async save(file?: string): Promise<{ path: string; source: string }> {
    return this.#post('/api/record/save', file === undefined ? {} : { file });
  }

  async #get<T>(path: string): Promise<T> {
    const url = new URL(path, location.href);
    url.searchParams.set('token', this.#token);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${path}: ${response.status}`);
    return (await response.json()) as T;
  }

  async #post<T>(path: string, body: unknown): Promise<T> {
    const url = new URL(path, location.href);
    url.searchParams.set('token', this.#token);
    const response = await fetch(url, { method: 'POST', body: JSON.stringify(body) });
    const parsed: unknown = await response.json();
    if (!response.ok) {
      const error = (parsed as { error?: string }).error ?? String(response.status);
      throw new Error(error);
    }
    return parsed as T;
  }
}
