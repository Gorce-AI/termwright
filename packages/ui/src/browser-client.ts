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
  type UiActionability,
} from './events.js';
import type { TraceOverview, TraceStatePayload } from './trace-source.js';
import type { DataSource, DataSourceFeatures, ViewerState } from './data-source.js';
import type { LogWindowQuery, TraceLogs } from './trace-logs.js';
import type { TraceCommands, TraceFrames } from './trace-playback.js';
import type { RunDetail, RunSummaryEntry } from './runs.js';
import type { SpecFacts } from './spec-tree.js';
import type { GeneratedSelector } from './selector.js';
import type { RecordedEvent } from './codegen.js';

/**
 * `/api/state` — everything the app needs that is not an event.
 *
 * The shape lives in `data-source.ts` because a report states the same facts
 * without a server; this name is kept for the routes that answer it.
 */
export type ServerState = ViewerState;

/** A live control request that the Runner could not complete or certify. */
export class RunnerControlError extends Error {
  override readonly name = 'RunnerControlError';

  constructor(
    readonly kind: 'rejected' | 'disconnected' | 'timeout' | 'protocol',
    message: string,
  ) {
    super(message);
  }
}

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
  /** Archive selected by this browser tab, never shared through the hub. */
  #archivePath: string | undefined;
  #nextInspection = 0;
  #nextControl = 0;
  #reconnect = false;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  #activeRunId: string | undefined;
  readonly #inspections = new Map<
    string,
    {
      readonly resolve: (results: readonly UiActionability[]) => void;
      readonly reject: (error: Error) => void;
      readonly timer: ReturnType<typeof setTimeout>;
    }
  >();
  readonly #controls = new Map<
    string,
    {
      readonly control: 'input';
      readonly resolve: () => void;
      readonly reject: (error: Error) => void;
      readonly timer: ReturnType<typeof setTimeout>;
    }
  >();
  readonly #inputQueues = new Map<string, Promise<void>>();

  constructor(token: string = new URLSearchParams(location.search).get('token') ?? '') {
    this.#token = token;
  }

  /** Opens the socket and reconnects when the server restarts. */
  connect(
    onMessage: (message: ServerMessage) => void,
    onStatus: (connected: boolean) => void,
  ): void {
    this.#onMessage = onMessage;
    this.#onStatus = onStatus;
    this.#reconnect = true;
    if (this.#reconnectTimer !== undefined) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = undefined;
    }
    if (this.#socket !== undefined) return;
    this.#open();
  }

  /** Closes the live transport and rejects work whose server acknowledgement has not arrived. */
  disconnect(): void {
    this.#reconnect = false;
    if (this.#reconnectTimer !== undefined) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = undefined;
    }
    this.#rejectPending(new RunnerControlError('disconnected', 'the Runner is disconnected'));
    const socket = this.#socket;
    this.#socket = undefined;
    socket?.close();
    this.#onStatus(false);
  }

  #open(): void {
    const url = new URL('/ws', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('token', this.#token);
    const socket = new WebSocket(url);
    this.#socket = socket;
    socket.addEventListener('open', () => {
      if (this.#socket === socket) this.#onStatus(true);
    });
    socket.addEventListener('message', (event: MessageEvent<string>) => {
      if (this.#socket !== socket) return;
      try {
        const message = parseServerMessage(event.data);
        if (message.type === 'actionability-inspection') {
          const pending = this.#inspections.get(message.requestId);
          if (pending === undefined) return;
          clearTimeout(pending.timer);
          this.#inspections.delete(message.requestId);
          if (message.results !== undefined) pending.resolve(message.results);
          else pending.reject(new Error(message.error ?? 'actionability inspection failed'));
          return;
        }
        if (message.type === 'control-result') {
          const pending = this.#controls.get(message.requestId);
          if (pending === undefined) return;
          clearTimeout(pending.timer);
          this.#controls.delete(message.requestId);
          if (message.control !== pending.control) {
            pending.reject(
              new RunnerControlError(
                'protocol',
                `Runner control response mismatch: expected ${pending.control}, received ${message.control}`,
              ),
            );
          } else if (message.ok) {
            pending.resolve();
          } else {
            pending.reject(
              new RunnerControlError('rejected', message.error ?? `${message.control} failed`),
            );
          }
          return;
        }
        if (
          message.type === 'run-end' ||
          message.type === 'run-cancelled' ||
          message.type === 'run-infrastructure-failed'
        ) {
          this.#activeRunId = undefined;
        }
        this.#onMessage(message);
      } catch {
        // A frame this build does not understand is dropped, not fatal: the
        // server may be newer than the page a browser tab kept open.
      }
    });
    socket.addEventListener('close', () => {
      if (this.#socket !== socket) return;
      this.#socket = undefined;
      this.#onStatus(false);
      this.#rejectPending(
        new RunnerControlError(
          'disconnected',
          'the Runner disconnected before acknowledging the request',
        ),
      );
      if (this.#reconnect)
        this.#reconnectTimer = setTimeout(() => {
          this.#reconnectTimer = undefined;
          if (this.#reconnect && this.#socket === undefined) this.#open();
        }, 1_000);
    });
  }

  /** Sends a client→server message. */
  send(message: ClientMessage): void {
    if (this.#socket?.readyState !== WebSocket.OPEN) return;
    this.#socket.send(encodeMessage(message));
  }

  /**
   * Forwards raw terminal bytes and resolves only after the recorder accepted
   * the write. Writes are serialized per session so acknowledgements also form
   * a causal input-order barrier.
   */
  sendInput(sessionId: string, data: string): Promise<void> {
    const previous = this.#inputQueues.get(sessionId) ?? Promise.resolve();
    const delivery = previous
      .catch((error: unknown) => {
        // A negative ACK is a definitive boundary for one rejected operation;
        // later queued bytes are still ordered and safe to attempt. A timeout,
        // disconnect or protocol mismatch leaves the write outcome unknown, so
        // the queue fails closed instead of possibly duplicating input.
        if (error instanceof RunnerControlError && error.kind === 'rejected') return;
        throw error;
      })
      .then(() => this.#sendInput(sessionId, data));
    this.#inputQueues.set(sessionId, delivery);
    void delivery.then(
      () => {
        if (this.#inputQueues.get(sessionId) === delivery) this.#inputQueues.delete(sessionId);
      },
      () => {
        if (this.#inputQueues.get(sessionId) === delivery) this.#inputQueues.delete(sessionId);
      },
    );
    return delivery;
  }

  #sendInput(sessionId: string, data: string): Promise<void> {
    const requestId = `control:input:${++this.#nextControl}`;
    return new Promise((resolve, reject) => {
      const socket = this.#socket;
      if (socket?.readyState !== WebSocket.OPEN) {
        reject(new RunnerControlError('disconnected', 'the Runner is disconnected'));
        return;
      }
      const timer = setTimeout(() => {
        this.#controls.delete(requestId);
        reject(new RunnerControlError('timeout', 'Runner input acknowledgement timed out'));
      }, 5_000);
      this.#controls.set(requestId, { control: 'input', resolve, reject, timer });
      try {
        socket.send(
          encodeMessage({
            v: 1,
            type: 'input',
            sessionId,
            dataB64: toBase64(new TextEncoder().encode(data)),
            requestId,
          }),
        );
      } catch (error) {
        clearTimeout(timer);
        this.#controls.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /** Reads the live production ActionPlanner without executing an action. */
  inspectActionability(sessionId: string, nodeId: string): Promise<readonly UiActionability[]> {
    const requestId = `inspect:${++this.#nextInspection}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#inspections.delete(requestId);
        reject(new Error('live actionability inspection timed out'));
      }, 5_000);
      this.#inspections.set(requestId, { resolve, reject, timer });
      if (this.#socket?.readyState !== WebSocket.OPEN) {
        clearTimeout(timer);
        this.#inspections.delete(requestId);
        reject(new Error('the Runner is disconnected'));
        return;
      }
      this.send({ v: 1, type: 'inspect-actionability', requestId, sessionId, nodeId });
    });
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#controls.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#controls.clear();
    for (const pending of this.#inspections.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#inspections.clear();
  }

  async state(): Promise<ServerState> {
    return this.#get<ServerState>('/api/state');
  }

  /**
   * One window of the archive's application logs, validated server-side.
   * Omitting both bounds returns the oldest window.
   */
  async traceLogs(query: LogWindowQuery = {}): Promise<TraceLogs> {
    const params = Object.entries({
      ...query,
      ...(this.#archivePath === undefined ? {} : { archive: this.#archivePath }),
    }).filter(([, value]) => value !== undefined);
    const search = new URLSearchParams(params.map(([key, value]) => [key, String(value)]));
    return this.#get<TraceLogs>(`/api/trace/logs${search.size === 0 ? '' : `?${search}`}`);
  }

  /** The command log of the opened archive. */
  async traceCommands(): Promise<TraceCommands> {
    return this.#get<TraceCommands>(this.#archiveUrl('/api/trace/commands'));
  }

  /** Every frame of the recording, for local playback. */
  async traceFrames(): Promise<TraceFrames> {
    return this.#get<TraceFrames>(this.#archiveUrl('/api/trace/frames'));
  }

  /**
   * Starts a run over HTTP rather than over the socket.
   *
   * Native RunnerTaskIds come from this invocation's structured catalogue.
   * The response confirms admission and returns the collision-safe RunId.
   */
  async startRun(runnerTaskIds: readonly string[]): Promise<{ runId: string }> {
    const accepted = await this.#post<{ runId: string }>('/api/run', { runnerTaskIds });
    this.#activeRunId = accepted.runId;
    return accepted;
  }

  async stopRun(): Promise<void> {
    const runId = this.#activeRunId;
    if (runId === undefined) throw new Error('there is no accepted run to stop');
    await this.#post('/api/stop', { runId });
    if (this.#activeRunId === runId) this.#activeRunId = undefined;
  }

  /** Facts about the project's spec files: age, average, recent results. */
  async specs(files: readonly string[]): Promise<{ readonly specs: readonly SpecFacts[] }> {
    // A real monorepo can list thousands of files. Query strings hit Node's
    // request-line/header limit long before the JSON body ceiling.
    return this.#post('/api/specs', { files });
  }

  /** Runs recorded under the history directory, newest first. */
  async runs(): Promise<{ runs: readonly RunSummaryEntry[] }> {
    return this.#get('/api/runs');
  }

  /** One run's manifest, with its tests. */
  async run(id: string): Promise<RunDetail> {
    return this.#get<RunDetail>(`/api/run?id=${encodeURIComponent(id)}`);
  }

  /** Replaces the replayed archive with another one. */
  async openTrace(path: string): Promise<{ trace: TraceOverview | null }> {
    // Select synchronously so overlapping A→B requests are last-started-wins:
    // a slow response from A must not silently retarget B's later seeks.
    const previous = this.#archivePath;
    this.#archivePath = path;
    try {
      return await this.#post<{ trace: TraceOverview | null }>('/api/trace/open', { path });
    } catch (error) {
      if (this.#archivePath === path) this.#archivePath = previous;
      throw error;
    }
  }

  async traceState(timeMs: number): Promise<TraceStatePayload> {
    const path = this.#archiveUrl(`/api/trace/state?t=${Math.round(timeMs)}`);
    return this.#get<TraceStatePayload>(path);
  }

  /** Adds this tab's archive without exposing it to another connected tab. */
  #archiveUrl(path: string): string {
    if (this.#archivePath === undefined) return path;
    const url = new URL(path, location.href);
    url.searchParams.set('archive', this.#archivePath);
    return `${url.pathname}${url.search}`;
  }

  /** Starts recording a program in this panel. */
  async startRecording(
    command: readonly string[],
    outFile?: string,
  ): Promise<{ sessionId: string }> {
    return this.#post('/api/record/start', {
      command,
      ...(outFile === undefined ? {} : { outFile }),
    });
  }

  /** Stops recording and returns the test that was written. */
  async stopRecording(): Promise<{ source: string }> {
    return this.#post('/api/record/stop', {});
  }

  /** Throws away a recording the panel decided not to keep. */
  async discardRecording(): Promise<{ discarded: boolean }> {
    return this.#post('/api/record/discard', {});
  }

  async recordAction(
    kind: 'click' | 'assert-visible',
    nodeId: string,
  ): Promise<{ selector: GeneratedSelector; source: string }> {
    return this.#post('/api/record/action', { kind, nodeId });
  }

  async recordAssert(
    kind: 'snapshot' | 'text' | 'wait-text',
    text?: string,
  ): Promise<{ source: string }> {
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
    const parsed: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const detail =
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof (parsed as { error?: unknown }).error === 'string'
          ? (parsed as { error: string }).error
          : String(response.status);
      throw new Error(`${path}: ${detail}`);
    }
    return parsed as T;
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
