/**
 * Streamable HTTP transport tests: real sockets, real MCP clients, and the
 * multi-session bookkeeping that CONTRACTS.md §MCP asks for — sessions keyed by
 * `Mcp-Session-Id` in our own registry rather than inside the transports.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport, connectClient } from './sdk-facade.js';
import { ERROR_META_KEY, serveHttp } from './server.js';
import type { HttpServerHandle } from './server.js';

const servers: HttpServerHandle[] = [];
const clients: Client[] = [];

afterEach(async () => {
  while (clients.length > 0) await clients.pop()?.close();
  while (servers.length > 0) await servers.pop()?.close();
});

async function connect(
  handle: HttpServerHandle,
): Promise<{ client: Client; sessionId: string | undefined }> {
  const client = new Client({ name: 'termwright-tests', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${handle.port}/mcp`));
  await connectClient(client, transport);
  clients.push(client);
  return { client, sessionId: transport.sessionId };
}

describe('the Streamable HTTP transport', () => {
  it('gives every client its own session and its own terminals', async () => {
    const handle = await serveHttp();
    servers.push(handle);

    const { client: first, sessionId: firstId } = await connect(handle);
    const { client: second, sessionId: secondId } = await connect(handle);
    expect(firstId).toBeDefined();
    expect(secondId).not.toBe(firstId);

    expect(handle.registry.size).toBe(2);
    expect((await first.listTools()).tools.length).toBe((await second.listTools()).tools.length);

    // A handle from one session is unknown in the other — the stores are separate.
    const result = (await second.callTool({
      name: 'terminal.snapshot',
      arguments: { terminal: 't1' },
    })) as { isError?: boolean; _meta?: Record<string, { kind?: string }> };
    expect(result.isError).toBe(true);
    expect(result._meta?.[ERROR_META_KEY]?.kind).toBe('no-session');
  });

  it('advertises the whole tool surface over HTTP as well', async () => {
    const handle = await serveHttp();
    servers.push(handle);
    const { client } = await connect(handle);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain('terminal.capture_since');
    expect(names).toContain('terminal.snapshot');
  });

  it('refuses to open more sessions than the ceiling allows', async () => {
    const handle = await serveHttp({ maxSessions: 1 });
    servers.push(handle);
    await connect(handle);
    await expect(connect(handle)).rejects.toThrow();
    expect(handle.registry.size).toBe(1);
  });

  it('drops a session and its terminals on DELETE', async () => {
    const handle = await serveHttp();
    servers.push(handle);
    const { sessionId } = await connect(handle);
    expect(handle.registry.size).toBe(1);

    const response = await fetch(`http://127.0.0.1:${handle.port}/mcp`, {
      method: 'DELETE',
      headers: { 'mcp-session-id': sessionId ?? '' },
    });
    expect(response.status).toBe(204);
    expect(handle.registry.size).toBe(0);
    expect(handle.registry.get(sessionId ?? '')).toBeUndefined();
  });

  it('rejects a request that carries no session id and is not initialize', async () => {
    const handle = await serveHttp();
    servers.push(handle);
    const response = await fetch(`http://127.0.0.1:${handle.port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()) as { kind: string }).toMatchObject({ kind: 'usage' });
  });

  it('404s anything that is not the MCP endpoint', async () => {
    const handle = await serveHttp();
    servers.push(handle);
    const response = await fetch(`http://127.0.0.1:${handle.port}/nope`);
    expect(response.status).toBe(404);
  });
});
