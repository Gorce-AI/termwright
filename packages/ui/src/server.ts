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
import { createReadStream, watch } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openTrace, type TraceReader } from '@termwright/trace';
import {
  fromBase64,
  parseClientMessage,
  parseServerMessage,
  UiProtocolError,
  type ClientMessage,
  type ServerMessage,
  type UiServerMode,
} from './events.js';
import { discoverTests, type DiscoveryOptions } from './discovery.js';
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
  readonly onRerun?: (testIds: readonly string[] | undefined) => void;
  /** Called when a client asks to stop the run. */
  readonly onStop?: () => void;
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

  let mode: UiServerMode = 'live';
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

  if (options.trace !== undefined) {
    await openArchive(options.trace);
  } else if (options.record !== undefined) {
    mode = 'record';
    recorder = await startRecorder(options.record);
    hub.publish({ v: 1, type: 'run-start', mode: 'record', startedAt: Date.now() });
    hub.publish({
      v: 1,
      type: 'test-start',
      id: recorder.sessionId,
      title: options.record.testName ?? options.record.command.join(' '),
      // The recording has no source file yet — it becomes one when it is saved.
      file: options.record.outFile ?? '',
      startedAt: Date.now(),
      sessionId: recorder.sessionId,
    });
  } else {
    hub.publish({ v: 1, type: 'run-start', mode: 'live', startedAt: Date.now() });
  }

  const attach = (session: AttachedSession): (() => void) => {
    sessions.set(session.source.sessionId, session);
    const detach = attachSession(hub, session.source);
    return () => {
      detach();
      sessions.delete(session.source.sessionId);
    };
  };

  let detachRecorder: (() => void) | undefined;
  if (recorder !== undefined) {
    const live = recorder;
    detachRecorder = attach({
      source: live.harness,
      write: (bytes) => live.handleInput(bytes),
      setPickMode: (enabled) => {
        live.setPickMode(enabled);
      },
      command: options.record?.command ?? [],
    });
  }

  /** Lists the project's tests and publishes them. Failure is not fatal. */
  const publishDiscovery = async (): Promise<void> => {
    if (options.discovery === undefined) return;
    const tests = await discoverTests(options.discovery);
    if (tests.length > 0) hub.publish({ v: 1, type: 'tests-discovered', tests });
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
    if (!authorized(request, token)) {
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
      void handleClientMessage(message);
    });
    ws.on('close', remove);
    ws.on('error', remove);
  }

  /** A producer (the Vitest reporter) publishes into the hub. */
  function acceptProducer(ws: WebSocket): void {
    ws.on('message', (raw: Buffer) => {
      let message: ServerMessage;
      try {
        message = parseServerMessage(raw);
      } catch (error) {
        if (error instanceof UiProtocolError) return; // a bad frame is not fatal
        throw error;
      }
      hub.publish(message);
    });
  }

  async function handleClientMessage(message: ClientMessage): Promise<void> {
    switch (message.type) {
      case 'rerun':
        options.onRerun?.(message.testIds);
        return;
      case 'stop':
        options.onStop?.();
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
    if (!authorized(request, token)) {
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
                  command: options.record?.command ?? [],
                  picking: recorder.picking,
                  outFile: options.record?.outFile ?? null,
                },
        });
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
        sendJson(response, 200, manifest);
        return;
      }
      case 'POST /api/trace/open': {
        const body = await readJsonBody(request);
        const path = body['path'];
        if (typeof path !== 'string' || path === '') {
          sendJson(response, 400, { error: 'path must be a non-empty string' });
          return;
        }
        try {
          await openArchive(path);
        } catch (error) {
          sendJson(response, 409, { error: describeError(error) });
          return;
        }
        sendJson(response, 200, { mode, trace: overview });
        return;
      }
      case 'GET /api/trace/commands': {
        if (traceCommands === undefined) {
          sendJson(response, 409, { error: 'no trace is open' });
          return;
        }
        sendJson(response, 200, traceCommands);
        return;
      }
      case 'GET /api/trace/frames': {
        if (traceFrames === undefined) {
          sendJson(response, 409, { error: 'no trace is open' });
          return;
        }
        sendJson(response, 200, traceFrames);
        return;
      }
      case 'GET /api/trace/logs': {
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
      case 'POST /api/record/save': {
        if (recorder === undefined) {
          sendJson(response, 409, { error: 'not recording' });
          return;
        }
        const body = await readJsonBody(request);
        const file = body['file'];
        if (file !== undefined && typeof file !== 'string') {
          sendJson(response, 400, { error: 'file must be a string' });
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
  const stopWatching = options.discovery?.watch === true ? watchForChanges(options.discovery.cwd, publishDiscovery) : undefined;

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
      stopWatching?.();
      detachRecorder?.();
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((done) => wss.close(() => done()));
      await new Promise<void>((done) => http.close(() => done()));
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
 * listing takes seconds. Watching is best-effort: a platform without recursive
 * watching loses the refresh, not the server.
 */
function watchForChanges(cwd: string, onChange: () => Promise<void>): (() => void) | undefined {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const watcher = watch(cwd, { recursive: true }, (_event, filename) => {
      const name = filename === null ? '' : filename.toString();
      if (name === '' || IGNORED_DIRECTORIES.test(name)) return;
      if (!/\.(ts|tsx|js|jsx|mts|cts)$/.test(name)) return;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => void onChange(), 300);
    });
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      watcher.close();
    };
  } catch {
    return undefined;
  }
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
 * Constant-time token comparison over the query string, the header, or the
 * cookie the app page was given.
 *
 * The cookie exists because a page loads sub-resources on its own, without the
 * token the user opened it with; it is `SameSite=Strict` and `HttpOnly`, so it
 * rides only on requests this page makes.
 */
function authorized(request: IncomingMessage, token: string): boolean {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const provided = url.searchParams.get('token') ?? headerToken(request) ?? cookieToken(request);
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
