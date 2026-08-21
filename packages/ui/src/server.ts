/**
 * The runner server: one `node:http` listener that serves the browser app,
 * speaks `§UI events` over a WebSocket, and answers the handful of HTTP
 * requests that are state rather than events (the session list, a moment on a
 * trace's timeline, the recorder's generated source).
 *
 * Keeping time travel and the recorder off the socket is deliberate. The
 * WebSocket protocol is normative in `/CONTRACTS.md`; anything this package
 * needs beyond it lives behind `/api/`, where it can grow without a contract
 * change and without a second implementation appearing in some other package.
 *
 * The listener binds to loopback and requires an unguessable per-launch token,
 * as `§10` demands: a runner UI exposes a live terminal, and a live terminal is
 * a shell.
 *
 * @packageDocumentation
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openTrace, type TraceReader } from '@termwright/trace';
import { watch } from 'chokidar';
import {
  fromBase64,
  MAX_UI_WIRE_STRING_LENGTH,
  parseClientMessage,
  parseServerMessage,
  UiProtocolError,
  type ClientMessage,
  type ServerMessage,
  type UiServerMode,
} from './events.js';
import { discoverTests, parseDiscoveredId, type DiscoveredTest, type DiscoveryOptions } from './discovery.js';
import { readProjectInfo } from './project.js';
import { readSpecFacts } from './specs.js';
import { DEFAULT_RUNS_DIR, readRunHistory, readRunManifest } from './runs.js';
import { UiHub, type UiHubOptions } from './hub.js';
import { attachSession, type UiSessionSource } from './live.js';
import { startRecorder, type RecorderOptions, type RecorderSession } from './recorder.js';
import {
  publishTraceTimeline,
  readTraceOverview,
  traceStateAt,
  type TraceOverview,
} from './trace-source.js';
import { readTraceLogs, type TraceLogs } from './trace-logs.js';
import {
  readCommandLog,
  readFrames,
  type TraceCommands,
  type TraceFrames,
} from './trace-playback.js';
import { WebSocketServer, type WebSocket } from 'ws';

/** Maximum accepted request body. Bodies here are small by construction. */
const MAX_BODY_BYTES = 1024 * 1024;

/** Maximum accepted WebSocket frame. */
const MAX_FRAME_BYTES = 8 * 1024 * 1024;

/** Options for {@link startUiServer}. */
export interface UiServerOptions {
  /** Port to listen on. Default 0 — an ephemeral port, printed on the URL. */
  readonly port?: number;
  /** Interface to bind. Default `127.0.0.1`; changing it exposes a shell. */
  readonly host?: string;
  /** Open a `.twtrace` archive in post-mortem mode. */
  readonly trace?: string;
  /** Launch a session and record it. */
  readonly record?: RecorderOptions;
  /** Directory holding the built browser app. Default `dist/app` in this package. */
  readonly appDir?: string;
  /** Pre-shared token. Default: 24 random bytes. */
  readonly token?: string;
  /** Called when a client asks for a rerun. */
  /**
   * Start a run. `testIds` names spec files or tests; absent means everything.
   *
   * May return a promise: `POST /api/run` awaits it and reports a failure to
   * the panel, because a run that could not be started must not look like a
   * run that produced nothing.
   */
  readonly onRerun?: (testIds: readonly string[] | undefined) => void | Promise<void>;
  /** Called when a client asks to stop the run. */
  readonly onStop?: () => void | Promise<void>;
  /**
   * List the project's tests at startup, and again when its files change, so
   * the panel shows what a run *would* contain before one happens.
   */
  readonly discovery?: DiscoveryOptions & { readonly watch?: boolean };
  /**
   * Directory holding run manifests. Default `.termwright/runs`. The panel
   * lists what it finds there and can open any run's archives.
   */
  readonly runsDir?: string;
  /** Backlog limits. */
  readonly hub?: UiHubOptions;
}

/** A session the server knows about, and how to write to it. */
export interface AttachedSession {
  readonly source: UiSessionSource;
  /** Forwards browser input. Absent for read-only (test-run) sessions. */
  write?(bytes: Uint8Array): Promise<void>;
  /** Turns pick mode on or off. Absent when the session is not recordable. */
  setPickMode?(enabled: boolean): void;
  readonly command?: readonly string[];
}

/** A running server. */
export interface UiServer {
  /** Base URL including the token: open this and the app authenticates itself. */
  readonly url: string;
  readonly port: number;
  readonly token: string;
  readonly mode: UiServerMode;
  readonly hub: UiHub;
  /** The recorder, in record mode. */
  readonly recorder: RecorderSession | undefined;
  /** The opened archive, in post-mortem mode. */
  readonly trace: TraceReader | undefined;
  /** Registers a live session; returns a detach function. */
  attach(session: AttachedSession): () => void;
  close(): Promise<void>;
}

/**
 * Starts the runner server.
 *
 * @example
 * ```ts
 * // Live: the Vitest reporter connects and publishes into the same hub.
 * const server = await startUiServer();
 * process.env['TERMWRIGHT_UI_URL'] = server.url;
 *
 * // Post-mortem: open an archive from CI.
 * const viewer = await startUiServer({ trace: 'out/login.twtrace' });
 *
 * // Recorder: the server owns the PTY, the browser is its terminal.
 * const rec = await startUiServer({ record: { command: ['node', 'app.js'] } });
 * ```
 */
export async function startUiServer(options: UiServerOptions = {}): Promise<UiServer> {
  const token = options.token ?? randomBytes(24).toString('base64url');
  const hub = new UiHub(options.hub ?? {});
  const sessions = new Map<string, AttachedSession>();
  const appDir = options.appDir ?? fileURLToPath(new URL('../dist/app/', import.meta.url));

  // Read once at startup: the branch can change under a long-running server,
  // but re-reading it per request would spawn a git process on every poll for
  // a line of context. A restart is the cheap way to refresh it.
  const project = await readProjectInfo(options.discovery?.cwd ?? options.record?.cwd ?? process.cwd());

  let mode: UiServerMode = 'live';
  let stopping = false;
  let nextRequestedRunGeneration = 0;
  let requestedRun: { readonly generation: number } | undefined;
  let nextProducerGeneration = 0;
  const producerRuns = new Map<
    WebSocket,
    { readonly generation: number; readonly requestedRunGeneration: number | undefined }
  >();
  let reader: TraceReader | undefined;
  let overview: TraceOverview | undefined;
  let recorder: RecorderSession | undefined;
  let traceLogs: TraceLogs | undefined;
  let traceCommands: TraceCommands | undefined;
  let traceFrames: TraceFrames | undefined;

  /**
   * Opens an archive and republishes everything derived from it.
   *
   * Used at startup and by `/api/trace/open`, so opening the third failing test
   * of yesterday's run goes through exactly the same path as `--trace`.
   */
  const openArchive = async (path: string): Promise<void> => {
    const opened = await openTrace(path);
    const previous = reader;
    reader = opened;
    mode = 'post-mortem';
    overview = await readTraceOverview(opened);
    // Logs are windowed per request; only the summary is precomputed.
    traceLogs = await readTraceLogs(opened, { limit: 1 });
    traceCommands = await readCommandLog(opened);
    // Frames are read once here rather than per request: a page playing at 4x
    // asks for nothing, and a second tab gets the same array for free.
    traceFrames = await readFrames(opened);
    publishTraceTimeline(hub, overview);
    await previous?.close();
  };

  const attach = (session: AttachedSession): (() => void) => {
    sessions.set(session.source.sessionId, session);
    const detach = attachSession(hub, session.source);
    return () => {
      detach();
      sessions.delete(session.source.sessionId);
    };
  };

  let detachRecorder: (() => void) | undefined;
  let recordOptions: RecorderOptions | undefined = options.record;
  /**
   * What a finished recording wrote, held until someone decides its fate.
   *
   * Stopping closes the session — that is what stopping means — but the test
   * it produced has to outlive it, or "save" after "stop" would have nothing
   * to write. Cleared when it is saved or discarded.
   */
  let pending: { readonly source: string; readonly outFile: string | undefined } | undefined;

  /**
   * Starts recording a program.
   *
   * The same path whether the panel asked for it or the command line did:
   * `--record` is a deep link into this, exactly as `--trace` is a deep link
   * into opening an archive. A runner that could only record if you restarted
   * it with the right flag is a feature nobody finds.
   */
  const beginRecording = async (request: RecorderOptions): Promise<string> => {
    if (recorder !== undefined) throw new Error('already recording');
    recordOptions = request;
    recorder = await startRecorder(request);
    mode = 'record';
    // Start the run before attaching the session. `run-start` resets event
    // history, so the opposite order erased the only session announcement for
    // every browser that connected after recording began.
    hub.publish({ v: 1, type: 'run-start', mode: 'record', startedAt: Date.now() });
    detachRecorder = attach({
      source: recorder.harness,
      write: (bytes) => recorder?.handleInput(bytes) ?? Promise.resolve(),
      setPickMode: (enabled) => {
        recorder?.setPickMode(enabled);
      },
      command: request.command,
    });
    hub.publish({
      v: 1,
      type: 'test-start',
      id: recorder.sessionId,
      title: request.testName ?? request.command.join(' '),
      // The recording has no source file yet — it becomes one when it is saved.
      file: request.outFile ?? '',
      startedAt: Date.now(),
      sessionId: recorder.sessionId,
    });
    return recorder.sessionId;
  };

  /**
   * Stops recording and hands back the test it wrote.
   *
   * The source comes back rather than being written: what to do with it is the
   * person's decision — save it, copy it, or throw it away — and a recorder
   * that writes a file the moment you stop has made that decision for them.
   */
  const endRecording = async (): Promise<string> => {
    const live = recorder;
    if (live === undefined) throw new Error('not recording');
    const source = live.source();
    detachRecorder?.();
    detachRecorder = undefined;
    recorder = undefined;
    mode = 'live';
    await live.close();
    pending = { source, outFile: recordOptions?.outFile };
    // No `run-end`: stopping a recording is not a run finishing. A new
    // `run-start`, however, is the authoritative mode transition and replaces
    // the old recording backlog. Without it a tab opened after Stop replayed
    // the stale `record` start and showed a ghost REC banner for a process that
    // no longer existed. Resetting the hub also drops discovery, so republish
    // the cached listing immediately.
    hub.publish({ v: 1, type: 'run-start', mode: 'live', startedAt: Date.now() });
    if (options.discovery !== undefined) {
      hub.publish({ v: 1, type: 'tests-discovered', tests: discovered });
    }
    return source;
  };

  if (options.trace !== undefined) {
    await openArchive(options.trace);
  } else if (options.record !== undefined) {
    await beginRecording(options.record);
  }

  /**
   * The last listing, kept so `/api/specs` knows which files to describe
   * without listing the project again — a listing takes seconds and the
   * question "how old is this file" does not deserve one.
   */
  let discovered: readonly DiscoveredTest[] = [];
  let discoveryGeneration = 0;
  let discoveryReady = options.discovery === undefined;

  /** Lists the project's tests and publishes them. Failure is not fatal. */
  const publishDiscovery = async (): Promise<void> => {
    if (options.discovery === undefined) return;
    const generation = ++discoveryGeneration;
    const tests = await discoverTests(options.discovery);
    // A slow older listing must not overwrite a newer filesystem result.
    if (generation !== discoveryGeneration) return;
    discovered = tests;
    discoveryReady = true;
    // Empty is state too: deleting the last case must clear the browser's
    // stable catalogue rather than leave a ghost row behind.
    hub.publish({ v: 1, type: 'tests-discovered', tests });
  };

  const http = createServer((request, response) => {
    void handleRequest(request, response).catch((error: unknown) => {
      sendJson(response, 500, { error: describeError(error) });
    });
  });
  // Frames are JSON messages carrying at most a screenful of output or one
  // semantic tree; anything larger is a client that has lost the plot.
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });

  http.on('upgrade', (request, socket, head) => {
    // A cookie is host-wide rather than port/origin-bound. Another service on
    // 127.0.0.1 must not be able to use the browser's Termwright cookie to
    // become a producer or send control messages.
    if (!authorized(request, token, false)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      const role = new URL(request.url ?? '/', 'http://localhost').searchParams.get('role');
      if (role === 'producer') acceptProducer(ws);
      else acceptViewer(ws);
    });
  });

  function acceptViewer(ws: WebSocket): void {
    const remove = hub.addClient({ send: (data) => ws.send(data) });
    ws.on('message', (raw: Buffer) => {
      let message: ClientMessage;
      try {
        message = parseClientMessage(raw);
      } catch (error) {
        if (error instanceof UiProtocolError) return; // a bad frame is not fatal
        throw error;
      }
      // Session input and runner callbacks are allowed to be asynchronous. A
      // failed child write must not become an unhandled rejection that takes
      // the long-lived UI server down; stop has its own explicit failure event.
      void handleClientMessage(message).catch(() => undefined);
    });
    ws.on('close', remove);
    ws.on('error', remove);
  }

  /** A producer (the Vitest reporter) publishes into the hub. */
  function acceptProducer(ws: WebSocket): void {
    // Producers are observers living in test workers. A worker can disappear
    // at any point; an unhandled EventEmitter `error` must never take the UI
    // server down with it.
    ws.on('error', () => undefined);
    ws.on('message', (raw: Buffer) => {
      let message: ServerMessage;
      try {
        message = parseServerMessage(raw);
      } catch (error) {
        if (error instanceof UiProtocolError) return; // a bad frame is not fatal
        throw error;
      }
      if (message.type === 'run-start') {
        producerRuns.set(ws, {
          generation: ++nextProducerGeneration,
          requestedRunGeneration: requestedRun?.generation,
        });
      } else if (message.type === 'run-end' || message.type === 'run-cancelled') {
        // A producer owns its lifecycle. Never let an old watcher completion
        // release a newer browser run (or vice versa).
        producerRuns.delete(ws);
      }
      hub.publish(message);
    });
    // The reporter normally sends run-end before closing. If it crashes or
    // cannot finish the WebSocket handshake, retaining its lease forever
    // would make every later run impossible.
    ws.on('close', () => producerRuns.delete(ws));
  }

  function runIsBusy(): boolean {
    return stopping || requestedRun !== undefined || producerRuns.size > 0;
  }

  function validateRunTargets(testIds: readonly string[] | undefined): void {
    if (options.discovery === undefined || testIds === undefined || testIds.length === 0) return;
    if (!discoveryReady) throw new RunRequestError(409, 'the scoped test catalogue is still loading');
    const providerTests = discovered.filter((test) => test.provider !== undefined);
    for (const target of testIds) {
      const parsed = parseDiscoveredId(target);
      const allowed = parsed === null
        ? providerTests.some((test) => test.file === target)
        : providerTests.some((test) => test.id === target);
      if (!allowed) throw new RunRequestError(400, 'run targets must belong to the scoped provider catalogue');
    }
  }

  async function requestRun(testIds: readonly string[] | undefined): Promise<void> {
    if (options.onRerun === undefined) {
      throw new RunRequestError(409, 'this panel has no test runner behind it');
    }
    validateRunTargets(testIds);
    if (runIsBusy()) throw new RunRequestError(409, 'a live run is already in progress');
    const generation = ++nextRequestedRunGeneration;
    requestedRun = { generation };
    try {
      await options.onRerun(testIds);
    } finally {
      // A cancelled/older callback must not unlock a later request.
      if (requestedRun?.generation === generation) requestedRun = undefined;
    }
  }

  async function handleClientMessage(message: ClientMessage): Promise<void> {
    switch (message.type) {
      case 'rerun':
        // Legacy socket controls have no response channel, but they share the
        // exact same validation and atomic lease as POST /api/run. A rejected
        // request therefore starts no child instead of bypassing the gate.
        await requestRun(message.testIds);
        return;
      case 'stop':
        if (stopping) return;
        stopping = true;
        const stoppedRequestedGeneration = requestedRun?.generation;
        try {
          await options.onStop?.();
          if (stoppedRequestedGeneration !== undefined) {
            for (const [producer, run] of producerRuns) {
              if (run.requestedRunGeneration === stoppedRequestedGeneration) {
                producerRuns.delete(producer);
              }
            }
          }
          hub.publish({ v: 1, type: 'run-cancelled', stoppedAt: Date.now() });
        } catch (error) {
          hub.publish({ v: 1, type: 'run-cancel-failed', error: boundedWireError(error) });
        } finally {
          stopping = false;
        }
        return;
      case 'pick':
        sessions.get(message.sessionId)?.setPickMode?.(message.enabled ?? true);
        return;
      case 'input': {
        const session = sessions.get(message.sessionId);
        if (session?.write === undefined) return;
        await session.write(fromBase64(message.dataB64));
        return;
      }
    }
  }

  async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://localhost');
    // Static subresources may use the HttpOnly cookie set by index.html; API
    // calls must present the unguessable token explicitly in query/header.
    // Cookies are scoped to a site, not a localhost port, so accepting one for
    // POST /api/record/start would let an unrelated local origin start a
    // command through a cross-site request.
    const allowCookie = !url.pathname.startsWith('/api/');
    if (!authorized(request, token, allowCookie)) {
      sendJson(response, 401, { error: 'missing or invalid token' });
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      await handleApi(url, request, response);
      return;
    }
    await serveStatic(appDir, url.pathname, response, token);
  }

  async function handleApi(
    url: URL,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    switch (`${request.method ?? 'GET'} ${url.pathname}`) {
      case 'GET /api/state': {
        sendJson(response, 200, {
          mode,
          canRun: options.onRerun !== undefined,
          project,
          sessions: [...sessions.values()].map((session) => ({
            sessionId: session.source.sessionId,
            command: session.command ?? [],
            columns: session.source.screen().columns,
            rows: session.source.screen().rows,
            terminalProfile: session.source.capabilities().terminalProfile,
            writable: session.write !== undefined,
          })),
          trace: overview ?? null,
          record:
            recorder === undefined
              ? null
              : {
                  sessionId: recorder.sessionId,
                  command: recordOptions?.command ?? [],
                  picking: recorder.picking,
                  outFile: options.record?.outFile ?? null,
                },
        });
        return;
      }
      case 'GET /api/specs': {
        // The files the listing knows about, plus whatever any run touched:
        // a spec deleted since the last run still has a history worth showing.
        const files = new Set<string>(discovered.map((test) => test.file));
        for (const file of url.searchParams.getAll('file')) files.add(file);
        sendJson(response, 200, {
          specs: await readSpecFacts([...files], options.runsDir ?? DEFAULT_RUNS_DIR),
        });
        return;
      }
      case 'POST /api/specs': {
        const body = await readJsonBody(request);
        const requested = body['files'];
        if (
          !Array.isArray(requested) ||
          requested.some((file) => typeof file !== 'string')
        ) {
          sendJson(response, 400, { error: 'files must be an array of strings' });
          return;
        }
        const files = new Set<string>(discovered.map((test) => test.file));
        for (const file of requested) files.add(file as string);
        sendJson(response, 200, {
          specs: await readSpecFacts([...files], options.runsDir ?? DEFAULT_RUNS_DIR),
        });
        return;
      }
      case 'POST /api/run': {
        const body = await readJsonBody(request);
        const files = body['files'];
        if (files !== undefined && (!Array.isArray(files) || files.some((f) => typeof f !== 'string'))) {
          sendJson(response, 400, { error: 'files must be an array of strings' });
          return;
        }
        try {
          // Awaited so the answer says whether it *started*, not whether it
          // passed: the panel shows results over the event stream, and the one
          // thing it cannot learn from there is that nothing began.
          await requestRun(files as string[] | undefined);
          sendJson(response, 200, { started: true });
        } catch (error) {
          sendJson(response, error instanceof RunRequestError ? error.status : 500, { error: describeError(error) });
        }
        return;
      }
      case 'GET /api/runs': {
        sendJson(response, 200, { runs: await readRunHistory(options.runsDir ?? DEFAULT_RUNS_DIR) });
        return;
      }
      case 'GET /api/run': {
        const id = url.searchParams.get('id');
        const manifest = id === null ? null : await readRunManifest(options.runsDir ?? DEFAULT_RUNS_DIR, id);
        if (manifest === null) {
          sendJson(response, 404, { error: 'no such run' });
          return;
        }
        sendJson(response, 200, {
          ...manifest,
          tests: await Promise.all(
            manifest.tests.map(async (test) => {
              if (test.traceRef === undefined) return test;
              const traceAvailable = await stat(test.traceRef)
                .then((entry) => entry.isDirectory())
                .catch(() => false);
              return { ...test, traceAvailable };
            }),
          ),
        });
        return;
      }
      case 'POST /api/trace/open': {
        const body = await readJsonBody(request);
        const path = body['path'];
        if (typeof path !== 'string' || path === '') {
          sendJson(response, 400, { error: 'path must be a non-empty string' });
          return;
        }
        let contextual: TraceReader | undefined;
        try {
          contextual = await openTrace(path);
          // Opening a recording from Runs (or when LIVE turns into replay) is
          // a choice made by one browser tab. It must not replace the server's
          // live mode, reset the shared test catalogue, or publish a synthetic
          // pseudo-run into every other tab. Subsequent reads carry this path
          // explicitly and are therefore contextual too.
          const trace = await readTraceOverview(contextual);
          sendJson(response, 200, { mode: 'post-mortem', trace });
        } catch (error) {
          sendJson(response, 409, { error: describeError(error) });
        } finally {
          await contextual?.close();
        }
        return;
      }
      case 'GET /api/trace/commands': {
        const archive = url.searchParams.get('archive');
        if (archive !== null) {
          let contextual: TraceReader | undefined;
          try {
            contextual = await openTrace(archive);
            sendJson(response, 200, await readCommandLog(contextual));
          } catch (error) {
            sendJson(response, 409, { error: describeError(error) });
          } finally {
            await contextual?.close();
          }
          return;
        }
        if (traceCommands === undefined) {
          sendJson(response, 409, { error: 'no trace is open' });
          return;
        }
        sendJson(response, 200, traceCommands);
        return;
      }
      case 'GET /api/trace/frames': {
        const archive = url.searchParams.get('archive');
        if (archive !== null) {
          let contextual: TraceReader | undefined;
          try {
            contextual = await openTrace(archive);
            sendJson(response, 200, await readFrames(contextual));
          } catch (error) {
            sendJson(response, 409, { error: describeError(error) });
          } finally {
            await contextual?.close();
          }
          return;
        }
        if (traceFrames === undefined) {
          sendJson(response, 409, { error: 'no trace is open' });
          return;
        }
        sendJson(response, 200, traceFrames);
        return;
      }
      case 'GET /api/trace/logs': {
        const archive = url.searchParams.get('archive');
        if (archive !== null) {
          let contextual: TraceReader | undefined;
          try {
            contextual = await openTrace(archive);
            const before = numberParam(url, 'before');
            const after = numberParam(url, 'after');
            const limit = numberParam(url, 'limit');
            sendJson(
              response,
              200,
              await readTraceLogs(contextual, {
                ...(before === undefined ? {} : { before }),
                ...(after === undefined ? {} : { after }),
                ...(limit === undefined ? {} : { limit }),
              }),
            );
          } catch (error) {
            sendJson(response, 409, { error: describeError(error) });
          } finally {
            await contextual?.close();
          }
          return;
        }
        if (reader === undefined || traceLogs === undefined) {
          sendJson(response, 409, { error: 'no trace is open' });
          return;
        }
        const before = numberParam(url, 'before');
        const after = numberParam(url, 'after');
        const limit = numberParam(url, 'limit');
        sendJson(
          response,
          200,
          await readTraceLogs(reader, {
            ...(before === undefined ? {} : { before }),
            ...(after === undefined ? {} : { after }),
            ...(limit === undefined ? {} : { limit }),
          }),
        );
        return;
      }
      case 'GET /api/trace/state': {
        const archive = url.searchParams.get('archive');
        if (archive !== null) {
          let contextual: TraceReader | undefined;
          try {
            contextual = await openTrace(archive);
            const t = Number.parseFloat(url.searchParams.get('t') ?? '0');
            sendJson(response, 200, await traceStateAt(contextual, Number.isFinite(t) ? t : 0));
          } catch (error) {
            sendJson(response, 409, { error: describeError(error) });
          } finally {
            await contextual?.close();
          }
          return;
        }
        if (reader === undefined) {
          sendJson(response, 409, { error: 'no trace is open' });
          return;
        }
        const t = Number.parseFloat(url.searchParams.get('t') ?? '0');
        sendJson(response, 200, await traceStateAt(reader, Number.isFinite(t) ? t : 0));
        return;
      }
      case 'GET /api/record/events': {
        if (recorder === undefined) {
          sendJson(response, 409, { error: 'not recording' });
          return;
        }
        sendJson(response, 200, { events: recorder.events, source: recorder.source() });
        return;
      }
      case 'POST /api/record/action': {
        if (recorder === undefined) {
          sendJson(response, 409, { error: 'not recording' });
          return;
        }
        const body = await readJsonBody(request);
        const kind = body['kind'];
        const nodeId = body['nodeId'];
        if (typeof nodeId !== 'string') {
          sendJson(response, 400, { error: 'nodeId must be a string' });
          return;
        }
        const selector =
          kind === 'assert-visible' ? recorder.recordAssertVisible(nodeId) : recorder.recordClick(nodeId);
        if (selector === undefined) {
          sendJson(response, 409, { error: 'no semantic tree, or unknown node' });
          return;
        }
        sendJson(response, 200, { selector, source: recorder.source() });
        return;
      }
      case 'POST /api/record/assert': {
        if (recorder === undefined) {
          sendJson(response, 409, { error: 'not recording' });
          return;
        }
        const body = await readJsonBody(request);
        const text = body['text'];
        if (body['kind'] === 'text') {
          if (typeof text !== 'string') {
            sendJson(response, 400, { error: 'text must be a string' });
            return;
          }
          recorder.recordAssertText(text);
        } else if (body['kind'] === 'wait-text') {
          if (typeof text !== 'string') {
            sendJson(response, 400, { error: 'text must be a string' });
            return;
          }
          recorder.recordWaitForText(text);
        } else {
          recorder.recordAssertSnapshot();
        }
        sendJson(response, 200, { source: recorder.source() });
        return;
      }
      case 'POST /api/record/step': {
        if (recorder === undefined) {
          sendJson(response, 409, { error: 'not recording' });
          return;
        }
        const body = await readJsonBody(request);
        const title = body['title'];
        if (typeof title !== 'string' || title === '') {
          sendJson(response, 400, { error: 'title must be a non-empty string' });
          return;
        }
        recorder.recordStep(title);
        sendJson(response, 200, { source: recorder.source() });
        return;
      }
      case 'POST /api/record/start': {
        const body = await readJsonBody(request);
        const command = body['command'];
        if (!Array.isArray(command) || command.some((part) => typeof part !== 'string') || command.length === 0) {
          sendJson(response, 400, { error: 'command must be a non-empty array of strings' });
          return;
        }
        const outFile = body['outFile'];
        if (outFile !== undefined && typeof outFile !== 'string') {
          sendJson(response, 400, { error: 'outFile must be a string' });
          return;
        }
        if (recorder !== undefined) {
          sendJson(response, 409, { error: 'already recording' });
          return;
        }
        const sessionId = await beginRecording({
          command: command as string[],
          cwd: options.discovery?.cwd ?? process.cwd(),
          ...(outFile === undefined ? {} : { outFile }),
        });
        sendJson(response, 200, { sessionId });
        return;
      }
      case 'POST /api/record/stop': {
        if (recorder === undefined) {
          sendJson(response, 409, { error: 'not recording' });
          return;
        }
        sendJson(response, 200, { source: await endRecording() });
        return;
      }
      case 'POST /api/record/discard': {
        pending = undefined;
        sendJson(response, 200, { discarded: true });
        return;
      }
      case 'POST /api/record/save': {
        const body = await readJsonBody(request);
        const file = body['file'];
        if (file !== undefined && typeof file !== 'string') {
          sendJson(response, 400, { error: 'file must be a string' });
          return;
        }
        if (recorder === undefined) {
          // Saving after stopping is the ordinary case: the panel shows the
          // test first and asks second.
          if (pending === undefined) {
            sendJson(response, 409, { error: 'nothing recorded' });
            return;
          }
          const target = file ?? pending.outFile;
          if (target === undefined) {
            sendJson(response, 400, { error: 'no output file: name one to save to' });
            return;
          }
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, pending.source, 'utf8');
          const source = pending.source;
          pending = undefined;
          sendJson(response, 200, { path: target, source });
          return;
        }
        const path = await recorder.save(file);
        sendJson(response, 200, { path, source: recorder.source() });
        return;
      }
      default:
        sendJson(response, 404, { error: `no route for ${url.pathname}` });
    }
  }

  // Discovery runs in the background: the server is useful before it finishes,
  // and a project whose listing takes ten seconds should not delay the page.
  void publishDiscovery();
  const stopWatching = options.discovery?.watch === true
    ? await watchForChanges(options.discovery.cwd, publishDiscovery)
    : undefined;

  const port = await listen(http, options.port ?? 0, options.host ?? '127.0.0.1');
  const host = options.host ?? '127.0.0.1';
  const url = `http://${host}:${port}/?token=${token}`;

  return {
    url,
    port,
    token,
    mode,
    hub,
    recorder,
    trace: reader,
    attach,
    async close(): Promise<void> {
      await stopWatching?.();
      detachRecorder?.();
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((done) => wss.close(() => done()));
      const closed = new Promise<void>((done) => http.close(() => done()));
      // `close()` only stops new connections; it then waits for the open ones,
      // and a browser holds its keep-alive sockets open indefinitely. Without
      // this the promise never settles when the pages outlive the server.
      http.closeAllConnections();
      await closed;
      await recorder?.close();
      await reader?.close();
    },
  };
}

/** Directories a source tree has that never contain tests worth listing. */
const IGNORED_DIRECTORIES = /(^|[/\\])(node_modules|dist|coverage|\.git)([/\\]|$)/;

/**
 * Re-lists the project's tests when its files change.
 *
 * Debounced, because saving a file in an editor fires several events, and a
 * listing takes seconds. The watcher is closed asynchronously with the server
 * so no native filesystem callback can outlive the project directory.
 */
async function watchForChanges(cwd: string, onChange: () => Promise<void>): Promise<() => Promise<void>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let pendingRefresh: Promise<void> | undefined;
  const watcher = watch(cwd, {
    ignoreInitial: true,
    ignored: (path) => IGNORED_DIRECTORIES.test(path),
    // Node's recursive fs-event backend can abort inside libuv while a watched
    // Windows tree is changing. Chokidar's polling backend preserves the same
    // catalogue refresh contract without entering that native code path.
    usePolling: process.platform === 'win32',
    interval: 200,
  });
  // A delete that happens during chokidar's initial crawl has no prior entry
  // to remove and can be missed. Do not report the server as ready until the
  // watch set itself is ready to observe every subsequent project change.
  await new Promise<void>((resolveReady) => {
    watcher.once('ready', resolveReady);
    watcher.once('error', () => resolveReady());
  });

  watcher.on('all', (_event, path) => {
    if (closed || !/\.(ts|tsx|js|jsx|mts|cts|feature)$/.test(path)) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      if (closed) return;
      // Discovery watching is an optional convenience. A transient listing
      // failure must not become an unhandled rejection in the UI process.
      pendingRefresh = onChange().catch(() => undefined);
    }, 300);
  });
  watcher.on('error', () => undefined);

  return async () => {
    closed = true;
    if (timer !== undefined) clearTimeout(timer);
    await watcher.close();
    await pendingRefresh;
  };
}

/** A finite numeric query parameter, or `undefined` when absent or malformed. */
function numberParam(url: URL, name: string): number | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null) return undefined;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : undefined;
}

function listen(server: Server, port: number, host: string): Promise<number> {
  return new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        fail(new Error('server did not bind to a TCP port'));
        return;
      }
      done(address.port);
    });
  });
}

/**
 * Constant-time token comparison over the query string/header and, only for
 * static subresources, the cookie the app page was given.
 *
 * The cookie exists because a page loads sub-resources on its own, without the
 * token the user opened it with; it is `SameSite=Strict` and `HttpOnly`, so it
 * rides only on requests this page makes.
 */
function authorized(request: IncomingMessage, token: string, allowCookie: boolean): boolean {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const provided =
    url.searchParams.get('token') ??
    headerToken(request) ??
    (allowCookie ? cookieToken(request) : undefined);
  if (provided === undefined || provided === null) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(token);
  return left.length === right.length && timingSafeEqual(left, right);
}

function headerToken(request: IncomingMessage): string | undefined {
  const header = request.headers['x-termwright-token'];
  if (typeof header === 'string') return header;
  return Array.isArray(header) ? header[0] : undefined;
}

const COOKIE_NAME = 'termwright_token';

function cookieToken(request: IncomingMessage): string | undefined {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === COOKIE_NAME) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('request body too large');
    chunks.push(buffer);
  }
  if (size === 0) return {};
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('request body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(text);
}

const CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
});

async function serveStatic(
  appDir: string,
  pathname: string,
  response: ServerResponse,
  token: string,
): Promise<void> {
  const relative = normalize(decodeURIComponent(pathname)).replace(/^([/\\.]+)/, '');
  const target = relative === '' ? join(appDir, 'index.html') : join(appDir, relative);
  const root = resolve(appDir);
  if (!resolve(target).startsWith(root + sep) && resolve(target) !== root) {
    sendJson(response, 403, { error: 'path escapes the app directory' });
    return;
  }
  try {
    const info = await stat(target);
    const file = info.isDirectory() ? join(target, 'index.html') : target;
    await stat(file);
    response.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
      // The page needs to fetch its own bundle, which carries no query token.
      'set-cookie': `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; SameSite=Strict; HttpOnly`,
    });
    createReadStream(file).pipe(response);
  } catch {
    if (relative === '') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(notBuiltPage(appDir));
      return;
    }
    sendJson(response, 404, { error: `not found: ${pathname}` });
  }
}

/** Shown when the browser bundle has not been built yet. */
function notBuiltPage(appDir: string): string {
  return `<!doctype html><meta charset="utf-8"><title>termwright ui</title>
<body style="font:14px ui-monospace,monospace;background:#12151c;color:#e6e9ef;padding:2rem">
<h1>The browser app is not built</h1>
<p>The server is running, but no bundle was found in <code>${escapeHtml(appDir)}</code>.</p>
<p>Build it with <code>pnpm --filter @termwright/ui build</code>.</p>
</body>`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) =>
    char === '&' ? '&amp;' : char === '<' ? '&lt;' : char === '>' ? '&gt;' : '&quot;',
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class RunRequestError extends Error {
  constructor(readonly status: 400 | 409, message: string) {
    super(message);
  }
}

/** Keep server-authored errors valid for the same wire parser that receives them. */
function boundedWireError(error: unknown): string {
  const message = describeError(error) || 'unknown error';
  return message.slice(0, MAX_UI_WIRE_STRING_LENGTH);
}
