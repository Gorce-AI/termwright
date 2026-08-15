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
import { randomUUID } from 'node:crypto';
import { renderErrorPayload, toErrorPayload } from './errors.js';
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
import type { ToolContext } from './tool-kit.js';
import { SERVER_NAME, SERVER_VERSION } from './version.js';

/** Server-level instructions shown to hosts that surface them. */
const INSTRUCTIONS =
  'Drive terminal programs the way a person would. terminal.launch starts a program and returns a ' +
  'handle; terminal.snapshot gives compact refs plus visible text; act with terminal.click / press / ' +
  'type; wait with terminal.wait_for; poll cheaply with terminal.capture_since using the revision a ' +
  'snapshot returned. Refs like n8@42 are only valid at semantic revision 42 — re-snapshot after the ' +
  'screen changes. Programs without a termwright adapter report semanticTree: unavailable; target ' +
  'them by text instead of by role.';

/** Builds the `CallToolResult` for a successful handler outcome. */
function successResult(text: string, data: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text }], structuredContent: data };
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
          const outcome = await tool.handler(context, args as never);
          return successResult(outcome.text, outcome.data);
        } catch (error) {
          return errorResult(error);
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
  await connectTransport(server, transport);
  return {
    server,
    stores,
    close: async (): Promise<void> => {
      await closeSessionStores(stores);
      await server.close();
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
  close(): Promise<void>;
}

/** Options for {@link serveHttp}. */
export interface HttpServeOptions extends ServeOptions {
  readonly port?: number;
  readonly host?: string;
  /** Path the MCP endpoint listens on. Defaults to `/mcp`. */
  readonly path?: string;
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
  const registry = new SessionRegistry<{
    transport: StreamableHTTPServerTransport;
    server: McpServer;
  }>({
    ...(options.maxSessions === undefined ? {} : { maxSessions: options.maxSessions }),
    ...(options.storageDir === undefined ? {} : { storageDir: options.storageDir }),
  });

  const http = createServer((request, response) => {
    void (async () => {
      try {
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
            void registry.delete(newKey);
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

  await new Promise<void>((resolve) => {
    http.listen(options.port ?? 0, options.host ?? '127.0.0.1', resolve);
  });
  const address = http.address();
  const port = typeof address === 'object' && address !== null ? address.port : (options.port ?? 0);

  return {
    http,
    registry,
    port,
    close: async (): Promise<void> => {
      await registry.closeAll();
      await new Promise<void>((resolve) => {
        http.close(() => {
          resolve();
        });
      });
    },
  };
}
