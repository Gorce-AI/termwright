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
import type { DataSource, DataSourceFeatures, ViewerState } from '../data-source.js';
import type { LogWindowQuery, TraceLogs } from '../trace-logs.js';
import type { TraceCommands, TraceFrames } from '../trace-playback.js';
import type { RunManifest, RunSummaryEntry } from '../runs.js';
import type { SpecFacts } from '../spec-tree.js';
import type { GeneratedSelector } from '../selector.js';
import type { RecordedEvent } from '../codegen.js';

/**
 * `/api/state` — everything the app needs that is not an event.
 *
 * The shape lives in `data-source.ts` because a report states the same facts
 * without a server; this name is kept for the routes that answer it.
 */
export type ServerState = ViewerState;

/**
 * Connection to the runner server, and the {@link DataSource} backed by it.
 *
 * A server can do everything: it holds the history, it can open another
 * archive, and in live mode there is a process on the other end of the socket.
 */
export class RunnerClient implements DataSource {
  readonly features: DataSourceFeatures = { live: true, history: true, openTrace: true };
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

  /**
   * One window of the archive's application logs, validated server-side.
   * Omitting both bounds returns the oldest window.
   */
  async traceLogs(query: LogWindowQuery = {}): Promise<TraceLogs> {
    const params = Object.entries(query)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join('&');
    return this.#get<TraceLogs>(`/api/trace/logs${params === '' ? '' : `?${params}`}`);
  }

  /** The command log of the opened archive. */
  async traceCommands(): Promise<TraceCommands> {
    return this.#get<TraceCommands>('/api/trace/commands');
  }

  /** Every frame of the recording, for local playback. */
  async traceFrames(): Promise<TraceFrames> {
    return this.#get<TraceFrames>('/api/trace/frames');
  }

  /**
   * Starts a run over HTTP rather than over the socket.
   *
   * The `rerun` message has no reply, so a panel that sent one could not tell a
   * run that never started from a run that started slowly. This can.
   */
  async startRun(files: readonly string[]): Promise<{ started: boolean }> {
    return this.#post('/api/run', { files });
  }

  /** Facts about the project's spec files: age, average, recent results. */
  async specs(files: readonly string[]): Promise<{ readonly specs: readonly SpecFacts[] }> {
    const query = files.map((file) => `file=${encodeURIComponent(file)}`).join('&');
    return this.#get(`/api/specs${query === '' ? '' : `?${query}`}`);
  }

  /** Runs recorded under the history directory, newest first. */
  async runs(): Promise<{ runs: readonly RunSummaryEntry[] }> {
    return this.#get('/api/runs');
  }

  /** One run's manifest, with its tests. */
  async run(id: string): Promise<RunManifest> {
    return this.#get<RunManifest>(`/api/run?id=${encodeURIComponent(id)}`);
  }

  /** Replaces the replayed archive with another one. */
  async openTrace(path: string): Promise<{ trace: TraceOverview | null }> {
    return this.#post('/api/trace/open', { path });
  }

  async traceState(timeMs: number): Promise<TraceStatePayload> {
    return this.#get<TraceStatePayload>(`/api/trace/state?t=${Math.round(timeMs)}`);
  }

  /** Starts recording a program in this panel. */
  async startRecording(command: readonly string[], outFile?: string): Promise<{ sessionId: string }> {
    return this.#post('/api/record/start', { command, ...(outFile === undefined ? {} : { outFile }) });
  }

  /** Stops recording and returns the test that was written. */
  async stopRecording(): Promise<{ source: string }> {
    return this.#post('/api/record/stop', {});
  }

  /** Throws away a recording the panel decided not to keep. */
  async discardRecording(): Promise<{ discarded: boolean }> {
    return this.#post('/api/record/discard', {});
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
