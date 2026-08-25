/**
 * Server wiring: tools onto an `McpServer`, and the two transports.
 *
 * Both transports share one code path — `createTermwrightMcpServer(store)` — so
 * a tool behaves identically over stdio and over Streamable HTTP. What differs
 * is only who owns the session key: stdio has exactly one implicit session,
 * HTTP keys sessions by `Mcp-Session-Id` in our {@link SessionRegistry}.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { CrashContextError, describeCrash } from './crash.js';
import { renderErrorPayload, toErrorPayload, usageError } from './errors.js';
import {
  BoundedRateLimiter,
  admitHttpRequest,
  isLoopbackHost,
  normalizeAllowedOrigins,
} from './http-security.js';
import type { HttpRateLimitOptions } from './http-security.js';
import {
  InMemoryTransport,
  connectTransport,
  McpServer,
  StdioServerTransport,
  StreamableHTTPServerTransport,
  isInitializeRequest,
} from './sdk-facade.js';
import type { CallToolResult, Transport } from './sdk-facade.js';
import { SessionRegistry, closeSessionStores, createSessionStores } from './sessions.js';
import type { SessionStores } from './sessions.js';
import { TOOLS } from './registry.js';
import type { ToolContext, ToolOutcome } from './tool-kit.js';
import { SERVER_NAME, SERVER_VERSION } from './version.js';

/** Server-level instructions shown to hosts that surface them. */
const INSTRUCTIONS =
  'Drive terminal programs the way a person would. terminal.launch starts a program and returns a ' +
  'handle; terminal.snapshot gives compact refs plus visible text; act with terminal.click / press / ' +
  'type; wait with terminal.wait_for; poll cheaply with terminal.capture_since using the revision a ' +
  'snapshot returned. Refs like semantic:n8@42 are only valid at semantic revision 42 — re-snapshot after the ' +
  'screen changes. Programs without a termwright adapter report semanticTree: unavailable; target ' +
  'them by text instead of by role.';

/** Builds the `CallToolResult` for a successful handler outcome. */
function successResult(outcome: ToolOutcome<Record<string, unknown>>): CallToolResult {
  return {
    content: [
      { type: 'text', text: outcome.text },
      ...(outcome.images ?? []).map((image) => ({
        type: 'image' as const,
        data: image.data,
        mimeType: image.mimeType,
      })),
    ],
    structuredContent: outcome.data,
  };
}

/**
 * Attaches the crash report when the failure happened against a terminal whose
 * program died on its own.
 *
 * This lives here, once, rather than in every acting tool: the server is the
 * only place that sees both the raw arguments (which name the terminal) and
 * every thrown error. Without it a locator that never resolved because the
 * child was gone reports a bare `timeout`, which tells an agent to wait longer
 * — precisely the wrong move.
 */
function withCrashContext(context: ToolContext, args: unknown, error: unknown): unknown {
  if (error instanceof CrashContextError) return error;
  const id = (args as { terminal?: unknown } | null)?.terminal;
  if (typeof id !== 'string') return error;
  const report = context.terminals.find(id)?.harness.crashReport();
  return report === undefined || report === null ? error : new CrashContextError(error, describeCrash(report));
}

/** `_meta` key carrying the structured error payload of a failed tool call. */
export const ERROR_META_KEY = 'io.termwright/error';

/**
 * Builds the `CallToolResult` for a failure.
 *
 * The payload travels in `_meta`, not in `structuredContent`: a client that has
 * seen the tool list validates `structuredContent` against the success
 * `outputSchema`, and an error object would be rejected before the agent ever
 * saw it. The text content carries the same information in readable form —
 * typed kind, message, the driver's suggestion and its bounded candidates.
 */
function errorResult(error: unknown): CallToolResult {
  const payload = toErrorPayload(error);
  return {
    isError: true,
    content: [{ type: 'text', text: renderErrorPayload(payload) }],
    _meta: { [ERROR_META_KEY]: payload },
  };
}

/** Registers every tool from {@link TOOLS} on a fresh `McpServer`. */
export function createTermwrightMcpServer(stores: SessionStores): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );
  const context: ToolContext = { terminals: stores.terminals, traces: stores.traces };

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        annotations: tool.annotations,
      },
      async (args: unknown): Promise<CallToolResult> => {
        try {
          return successResult(await tool.handler(context, args as never));
        } catch (error) {
          return errorResult(withCrashContext(context, args, error));
        }
      },
    );
  }
  return server;
}

/** A running server plus the handle needed to shut it down. */
export interface RunningServer {
  readonly server: McpServer;
  readonly stores: SessionStores;
  close(): Promise<void>;
}

/** Options shared by the transports. */
export interface ServeOptions {
  /** Root for `variant: "full"` snapshot dumps. */
  readonly storageDir?: string;
  readonly maxSessions?: number;
}

/** Connects a server to a transport and returns its lifecycle handle. */
async function connect(stores: SessionStores, transport: Transport): Promise<RunningServer> {
  const server = createTermwrightMcpServer(stores);
  try {
    await connectTransport(server, transport);
  } catch (error) {
    const cleanup = await Promise.allSettled([closeSessionStores(stores), server.close()]);
    const failures = cleanup.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
    if (failures.length > 0) throw new AggregateError([error, ...failures], 'MCP transport startup and rollback failed');
    throw error;
  }
  return {
    server,
    stores,
    close: async (): Promise<void> => {
      const results = await Promise.allSettled([closeSessionStores(stores), server.close()]);
      const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
      if (failures.length > 0) throw new AggregateError(failures, 'MCP transport failed to close cleanly');
    },
  };
}

/** Serves the tools over stdio — the transport an MCP host spawns. */
export async function serveStdio(options: ServeOptions = {}): Promise<RunningServer> {
  const stores = createSessionStores({ sessionKey: 'stdio', storageDir: options.storageDir });
  return connect(stores, new StdioServerTransport());
}

/**
 * An in-process client/server pair over `InMemoryTransport`. Used by this
 * package's tests, and by anything embedding the tools without a socket.
 */
export async function serveInMemory(
  options: ServeOptions & { readonly sessionKey?: string } = {},
): Promise<RunningServer & { readonly clientTransport: Transport }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const stores = createSessionStores({
    sessionKey: options.sessionKey ?? 'in-memory',
    storageDir: options.storageDir,
  });
  const running = await connect(stores, serverTransport);
  return { ...running, clientTransport };
}

/** A listening Streamable HTTP server. */
export interface HttpServerHandle {
  readonly http: Server;
  readonly registry: SessionRegistry<{ transport: StreamableHTTPServerTransport; server: McpServer }>;
  readonly port: number;
  /** Per-launch bearer required by every HTTP request. Never put it in a URL. */
  readonly authToken: string;
  close(): Promise<void>;
}

/** Default idle ceiling for an HTTP session. */
export const DEFAULT_IDLE_TTL_MS = 10 * 60_000;

/** Options for {@link serveHttp}. */
export interface HttpServeOptions extends ServeOptions {
  readonly port?: number;
  readonly host?: string;
  /**
   * Explicit acknowledgement that a non-loopback bind exposes process launch,
   * terminal input and filesystem-backed trace tools to the network.
   */
  readonly allowNonLoopback?: boolean;
  /**
   * Browser origins allowed to call the endpoint. Non-browser MCP clients omit
   * `Origin`; any presented origin is rejected unless it appears here exactly.
   */
  readonly allowedOrigins?: readonly string[];
  /** Per-peer request ceiling. The limiter's identity map is bounded too. */
  readonly rateLimit?: HttpRateLimitOptions;
  /** Path the MCP endpoint listens on. Defaults to `/mcp`. */
  readonly path?: string;
  /**
   * Milliseconds a session may sit idle before it is torn down. Defaults to
   * {@link DEFAULT_IDLE_TTL_MS}; `0` disables expiry.
   */
  readonly idleTtlMs?: number;
  /** Injectable clock, for tests. */
  readonly now?: () => number;
  /** Where an expiry is reported. Defaults to stderr. */
  readonly log?: (message: string) => void;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(text);
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk as Buffer);
    size += buffer.byteLength;
    if (size > 4 * 1024 * 1024) throw new Error('request body too large');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/**
 * Serves the tools over Streamable HTTP with multi-session support.
 *
 * Sessions live in {@link SessionRegistry}: `initialize` mints a session id and
 * registers a store together with its transport, every later request is routed
 * by its `Mcp-Session-Id` header, and `DELETE` (or transport close) disposes the
 * session's terminals. The ceiling is enforced here, before a transport exists.
 */
export async function serveHttp(options: HttpServeOptions = {}): Promise<HttpServerHandle> {
  const path = options.path ?? '/mcp';
  const host = options.host ?? '127.0.0.1';
  if (!isLoopbackHost(host) && options.allowNonLoopback !== true) {
    throw usageError(
      `refusing non-loopback MCP HTTP bind ${JSON.stringify(host)} without allowNonLoopback`,
      'keep the default loopback bind, or explicitly acknowledge the remote trust boundary',
    );
  }
  const authToken = randomBytes(32).toString('base64url');
  const allowedOrigins = normalizeAllowedOrigins(options.allowedOrigins);
  const authenticatedRateLimiter = new BoundedRateLimiter(options.rateLimit);
  const preflightRateLimiter = new BoundedRateLimiter(options.rateLimit);
  const now = options.now ?? Date.now;
  // stdout may be a protocol stream elsewhere; server-level notes go to stderr.
  const log = options.log ?? ((message: string): void => void process.stderr.write(`${message}\n`));
  const registry = new SessionRegistry<{
    transport: StreamableHTTPServerTransport;
    server: McpServer;
  }>({
    ...(options.maxSessions === undefined ? {} : { maxSessions: options.maxSessions }),
    ...(options.storageDir === undefined ? {} : { storageDir: options.storageDir }),
    ...(options.now === undefined ? {} : { now: options.now }),
    idleTtlMs: options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS,
    disposeAttachment: async (attachment) => {
      await attachment.transport.close();
    },
    onExpired: (key) => {
      log(`termwright: session ${key} expired after idling; terminals and traces released`);
    },
    onBackgroundError: (error) => {
      log(`termwright: idle session cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    },
  });

  const http = createServer((request, response) => {
    void (async () => {
      try {
        // Security admission is intentionally before URL routing, body reads,
        // session lookup/touch and initialize. A rejected peer cannot allocate
        // an MCP session, refresh one it guessed, or make us buffer its body.
        if (!admitHttpRequest(request, response, {
          token: authToken,
          allowedOrigins,
          authenticatedRateLimiter,
          preflightRateLimiter,
          now,
        })) return;
        const url = new URL(request.url ?? '/', 'http://localhost');
        if (url.pathname !== path) {
          sendJson(response, 404, { error: 'not found' });
          return;
        }
        const sessionId = request.headers['mcp-session-id'];
        const key = Array.isArray(sessionId) ? sessionId[0] : sessionId;

        if (request.method === 'DELETE') {
          if (key !== undefined) await registry.delete(key);
          response.writeHead(204).end();
          return;
        }

        const body = request.method === 'POST' ? await readBody(request) : undefined;

        if (key !== undefined) {
          const session = registry.get(key);
          if (session === undefined) {
            sendJson(response, 404, { error: 'unknown session', kind: 'no-session' });
            return;
          }
          // Every request that names a session is proof the client is alive.
          registry.touch(key);
          await session.attachment.transport.handleRequest(request, response, body);
          return;
        }

        if (request.method !== 'POST' || !isInitializeRequest(body)) {
          sendJson(response, 400, { error: 'missing Mcp-Session-Id', kind: 'usage' });
          return;
        }

        const newKey = randomUUID();
        const session = registry.create(newKey, (stores) => {
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => newKey,
          });
          const server = createTermwrightMcpServer(stores);
          transport.onclose = (): void => {
            void registry.delete(newKey).catch((error) => {
              log(`termwright: session ${newKey} transport cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
            });
          };
          return { transport, server };
        });
        await connectTransport(session.attachment.server, session.attachment.transport);
        await session.attachment.transport.handleRequest(request, response, body);
      } catch (error) {
        const payload = toErrorPayload(error);
        if (!response.headersSent) sendJson(response, 500, { error: payload.message, kind: payload.kind });
        else response.end();
      }
    })();
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        http.off('listening', onListening);
        reject(error);
      };
      const onListening = (): void => {
        http.off('error', onError);
        resolve();
      };
      http.once('error', onError);
      http.once('listening', onListening);
      http.listen(options.port ?? 0, host);
    });
  } catch (error) {
    await registry.closeAll().catch((cleanup) => {
      throw new AggregateError([error, cleanup], 'MCP HTTP bind and rollback both failed');
    });
    throw error;
  }
  registry.startIdleSweeper();
  const address = http.address();
  const port = typeof address === 'object' && address !== null ? address.port : (options.port ?? 0);

  return {
    http,
    registry,
    port,
    authToken,
    close: async (): Promise<void> => {
      registry.stopIdleSweeper();
      const results = await Promise.allSettled([
        registry.closeAll(),
        new Promise<void>((resolve, reject) => {
          http.close((error) => error === undefined ? resolve() : reject(error));
        }),
      ]);
      const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
      if (failures.length > 0) throw new AggregateError(failures, 'MCP HTTP server failed to close cleanly');
    },
  };
}
