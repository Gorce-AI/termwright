/**
 * Streamable HTTP transport tests: real sockets, real MCP clients, and the
 * multi-session bookkeeping that CONTRACTS.md §MCP asks for — sessions keyed by
 * `Mcp-Session-Id` in our own registry rather than inside the transports.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, request as httpRequest } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${handle.port}/mcp`),
    { requestInit: { headers: authorization(handle) } },
  );
  await connectClient(client, transport);
  clients.push(client);
  return { client, sessionId: transport.sessionId };
}

function authorization(
  handle: HttpServerHandle,
  headers: Readonly<Record<string, string>> = {},
): Record<string, string> {
  return { authorization: `Bearer ${handle.authToken}`, ...headers };
}

describe('the Streamable HTTP transport', () => {
  it('rejects an occupied port and does not leave a background server behind', async () => {
    const occupied = createServer();
    await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve));
    const address = occupied.address();
    if (typeof address !== 'object' || address === null) throw new Error('expected TCP address');
    try {
      await expect(serveHttp({ port: address.port })).rejects.toMatchObject({ code: 'EADDRINUSE' });
    } finally {
      await new Promise<void>((resolve, reject) => occupied.close((error) => error === undefined ? resolve() : reject(error)));
    }

    const rebound = await serveHttp({ port: address.port });
    servers.push(rebound);
    expect(rebound.port).toBe(address.port);
  });

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
      headers: authorization(handle, { 'mcp-session-id': sessionId ?? '' }),
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
      headers: authorization(handle, {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      }),
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()) as { kind: string }).toMatchObject({ kind: 'usage' });
  });

  it('404s anything that is not the MCP endpoint', async () => {
    const handle = await serveHttp();
    servers.push(handle);
    const response = await fetch(`http://127.0.0.1:${handle.port}/nope`, {
      headers: authorization(handle),
    });
    expect(response.status).toBe(404);
  });
});

describe('the Streamable HTTP trust boundary', () => {
  it('mints a fresh 256-bit bearer for every server', async () => {
    const first = await serveHttp();
    const second = await serveHttp();
    servers.push(first, second);

    expect(Buffer.from(first.authToken, 'base64url')).toHaveLength(32);
    expect(first.authToken).not.toBe(second.authToken);
  });

  it('authenticates before endpoint routing or session lookup', async () => {
    const handle = await serveHttp();
    servers.push(handle);

    const hiddenPath = await fetch(`http://127.0.0.1:${handle.port}/not-the-endpoint`);
    expect(hiddenPath.status).toBe(401);

    const guessedSession = await fetch(`http://127.0.0.1:${handle.port}/mcp`, {
      method: 'DELETE',
      headers: { 'mcp-session-id': 'guessed-session' },
    });
    expect(guessedSession.status).toBe(401);
    expect(handle.registry.size).toBe(0);
  });

  it('rejects from headers alone without waiting for or buffering the body', async () => {
    const handle = await serveHttp();
    servers.push(handle);

    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest({
        host: '127.0.0.1',
        port: handle.port,
        path: '/mcp',
        method: 'POST',
        headers: { 'content-length': String(4 * 1024 * 1024) },
      });
      request.once('response', (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
        request.destroy();
      });
      request.once('error', reject);
      // Deliberately do not call end(): the server must decide from headers.
      request.flushHeaders();
    });

    expect(status).toBe(401);
    expect(handle.registry.size).toBe(0);
  });

  it('does not let a wrong bearer delete an authenticated session', async () => {
    const handle = await serveHttp();
    servers.push(handle);
    const { sessionId } = await connect(handle);

    const response = await fetch(`http://127.0.0.1:${handle.port}/mcp`, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${'x'.repeat(handle.authToken.length)}`,
        'mcp-session-id': sessionId ?? '',
      },
    });
    expect(response.status).toBe(401);
    expect(handle.registry.get(sessionId ?? '')).toBeDefined();
  });

  it('rejects browser origins by default and admits only exact allowlisted origins', async () => {
    const denied = await serveHttp();
    servers.push(denied);
    const deniedResponse = await fetch(`http://127.0.0.1:${denied.port}/nope`, {
      headers: authorization(denied, { origin: 'https://agent.example' }),
    });
    expect(deniedResponse.status).toBe(403);

    const allowed = await serveHttp({ allowedOrigins: ['https://agent.example'] });
    servers.push(allowed);
    const allowedResponse = await fetch(`http://127.0.0.1:${allowed.port}/nope`, {
      headers: authorization(allowed, { origin: 'https://agent.example' }),
    });
    expect(allowedResponse.status).toBe(404);
    const siblingOrigin = await fetch(`http://127.0.0.1:${allowed.port}/nope`, {
      headers: authorization(allowed, { origin: 'https://other.agent.example' }),
    });
    expect(siblingOrigin.status).toBe(403);
  });

  it('answers only a narrow allowlisted CORS preflight without requiring a bearer', async () => {
    const handle = await serveHttp({ allowedOrigins: ['https://agent.example'] });
    servers.push(handle);

    const allowed = await fetch(`http://127.0.0.1:${handle.port}/mcp`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://agent.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, content-type, mcp-session-id',
      },
    });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://agent.example');
    expect(handle.registry.size).toBe(0);

    const foreignHeader = await fetch(`http://127.0.0.1:${handle.port}/mcp`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://agent.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, x-forwarded-for',
      },
    });
    expect(foreignHeader.status).toBe(403);
    expect(handle.registry.size).toBe(0);
  });

  it('keeps preflight and authenticated rate-limit capacity independent', async () => {
    const handle = await serveHttp({
      allowedOrigins: ['https://agent.example'],
      rateLimit: { maxRequests: 1, windowMs: 60_000, maxClients: 1 },
    });
    servers.push(handle);

    const preflight = await fetch(`http://127.0.0.1:${handle.port}/mcp`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://agent.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, content-type',
      },
    });
    expect(preflight.status).toBe(204);

    // maxClients=1 would reject this if preflight shared the same bucket map.
    const authenticated = await fetch(`http://127.0.0.1:${handle.port}/nope`, {
      headers: authorization(handle),
    });
    expect(authenticated.status).toBe(404);

    const exhaustedPreflight = await fetch(`http://127.0.0.1:${handle.port}/mcp`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://agent.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, content-type',
      },
    });
    expect(exhaustedPreflight.status).toBe(429);
    const exhaustedAuthenticated = await fetch(`http://127.0.0.1:${handle.port}/nope`, {
      headers: authorization(handle),
    });
    expect(exhaustedAuthenticated.status).toBe(429);
  });

  it('rate-limits authenticated work without letting invalid peers exhaust that budget', async () => {
    let clock = 10_000;
    const handle = await serveHttp({
      now: () => clock,
      rateLimit: { maxRequests: 1, windowMs: 1_000, maxClients: 1 },
    });
    servers.push(handle);

    const first = await fetch(`http://127.0.0.1:${handle.port}/mcp`);
    expect(first.status).toBe(401);
    const allowed = await fetch(`http://127.0.0.1:${handle.port}/nope`, {
      headers: authorization(handle),
    });
    expect(allowed.status).toBe(404);
    const limited = await fetch(`http://127.0.0.1:${handle.port}/mcp`, {
      headers: authorization(handle),
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('1');
    expect(handle.registry.size).toBe(0);

    clock += 1_000;
    const reset = await fetch(`http://127.0.0.1:${handle.port}/nope`, {
      headers: authorization(handle),
    });
    expect(reset.status).toBe(404);
  });

  it('requires explicit acknowledgement before binding beyond loopback', async () => {
    await expect(serveHttp({ host: '0.0.0.0' })).rejects.toThrow(/allowNonLoopback/u);

    const exposed = await serveHttp({ host: '0.0.0.0', allowNonLoopback: true });
    servers.push(exposed);
    expect(exposed.port).toBeGreaterThan(0);
  });
});

describe('idle sessions', () => {
  /** True while a process with this pid exists. */
  function alive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /** Launches a child that reports its pid and then sits there forever. */
  async function launchLongLived(client: Client, pidFile: string): Promise<void> {
    const result = (await client.callTool({
      name: 'terminal.launch',
      arguments: {
        command: [
          process.execPath,
          '-e',
          `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
           process.stdout.write('up\\r\\n');
           setInterval(() => {}, 1000);`,
        ],
        columns: 40,
        rows: 6,
      },
    })) as { isError?: boolean };
    expect(result.isError ?? false).toBe(false);
  }

  it('tears an idle session down: child dead, slot free, newcomer admitted', async () => {
    let clock = 1_000_000;
    const expired: string[] = [];
    const handle = await serveHttp({
      maxSessions: 1,
      idleTtlMs: 60_000,
      now: () => clock,
      log: (message) => expired.push(message),
    });
    servers.push(handle);

    const directory = await mkdtemp(join(tmpdir(), 'termwright-ttl-'));
    const pidFile = join(directory, 'pid');
    const { client, sessionId } = await connect(handle);
    await launchLongLived(client, pidFile);

    // The child writes its pid as it starts; give it that beat.
    const pid = await vi.waitFor(async () => {
      const value = Number(await readFile(pidFile, 'utf8'));
      expect(Number.isInteger(value)).toBe(true);
      return value;
    }, { timeout: 5_000 });
    expect(alive(pid)).toBe(true);
    expect(handle.registry.size).toBe(1);

    // A second client is refused while the slot is held.
    await expect(connect(handle)).rejects.toThrow();

    clock += 60_001;
    await handle.registry.sweepIdle();

    expect(handle.registry.size).toBe(0);
    expect(handle.registry.get(sessionId ?? '')).toBeUndefined();
    expect(expired.join('\n')).toContain('expired after idling');
    // The child is gone, not merely forgotten.
    await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 5_000 });

    // The freed slot admits a newcomer.
    const second = await connect(handle);
    expect(second.sessionId).toBeDefined();
    expect(handle.registry.size).toBe(1);

    await rm(directory, { recursive: true, force: true });
  });

  it('keeps a session that is being used, however long it lives', async () => {
    let clock = 5_000;
    const handle = await serveHttp({ idleTtlMs: 1_000, now: () => clock });
    servers.push(handle);
    const { client } = await connect(handle);

    // Each round trip is past the TTL, but each one also refreshes it.
    for (let round = 0; round < 3; round += 1) {
      clock += 900;
      await client.listTools();
      await handle.registry.sweepIdle();
      expect(handle.registry.size).toBe(1);
    }

    clock += 1_001;
    await handle.registry.sweepIdle();
    expect(handle.registry.size).toBe(0);
  });

  it('sweeps on its own timer, without anyone asking', async () => {
    const handle = await serveHttp({ idleTtlMs: 60 });
    servers.push(handle);
    await connect(handle);
    expect(handle.registry.size).toBe(1);

    // Real clock, real interval: proves the sweeper is actually running.
    await vi.waitFor(() => expect(handle.registry.size).toBe(0), { timeout: 5_000 });
  });

  it('leaves a registry without a TTL alone — the stdio case', async () => {
    const handle = await serveHttp({ idleTtlMs: 0 });
    servers.push(handle);
    await connect(handle);

    expect(handle.registry.idleTtlMs).toBe(0);
    expect(await handle.registry.sweepIdle()).toEqual([]);
    expect(handle.registry.size).toBe(1);
  });
});
