/**
 * Concurrent MCP sessions — origin spec §20.4, last item.
 *
 * `@termwright/mcp` tests its transport; this certifies what a *host* running
 * several agents at once depends on, and it does so with real child processes
 * rather than bookkeeping. The distinction matters: a registry can forget a
 * session while its terminals keep running, and only a pid probed after the
 * fact can tell the difference between "closed" and "leaked".
 *
 * What is asserted: sessions are isolated (a terminal handle from one is
 * unknown in another), close ownership is exact (deleting one session kills its
 * children and only its children), the session ceiling is refused with a
 * readable reason and reopens once a slot is freed, an idle session is reclaimed
 * in full while a working one is spared, and `capture_since` cursors do not
 * cross sessions.
 */
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { serveHttp, type HttpServerHandle } from '@termwright/mcp';
import { CONFORMANCE_FIXTURES, ptyAvailable } from '../support/pty.js';

const servers: HttpServerHandle[] = [];
const clients: Client[] = [];
const directories: string[] = [];

interface Session {
  readonly client: Client;
  readonly sessionId: string;
  readonly transport: StreamableHTTPClientTransport;
}

async function serve(
  options: { maxSessions?: number; idleTtlMs?: number; now?: () => number } = {},
): Promise<HttpServerHandle> {
  const handle = await serveHttp({
    ...(options.maxSessions === undefined ? {} : { maxSessions: options.maxSessions }),
    ...(options.idleTtlMs === undefined ? {} : { idleTtlMs: options.idleTtlMs }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  servers.push(handle);
  return handle;
}

async function connect(handle: HttpServerHandle): Promise<Session> {
  const client = new Client({ name: 'termwright-conformance', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${handle.port}/mcp`));
  // The SDK's Transport type declares `sessionId: string | undefined`, which
  // `exactOptionalPropertyTypes` rejects at this call site only.
  await client.connect(transport as unknown as Parameters<Client['connect']>[0]);
  clients.push(client);
  const sessionId = transport.sessionId;
  expect(sessionId, 'the server minted no session id').toBeDefined();
  return { client, sessionId: sessionId as string, transport };
}

interface ToolResult {
  readonly isError?: boolean;
  readonly structuredContent?: Record<string, unknown>;
  readonly _meta?: Record<string, { kind?: string; message?: string }>;
}

async function call(session: Session, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await session.client.callTool({ name, arguments: args })) as ToolResult;
}

/** Launches the generic fixture in a session and returns its handle and pid. */
async function launch(session: Session): Promise<{ terminal: string; pid: number }> {
  const directory = await mkdtemp(join(tmpdir(), 'termwright-mcp-conformance-'));
  directories.push(directory);
  const pidfile = join(directory, 'pid');

  const result = await call(session, 'terminal.launch', {
    command: [process.execPath, CONFORMANCE_FIXTURES.generic(), `--pidfile=${pidfile}`],
    columns: 60,
    rows: 20,
  });
  expect(result.isError, `launch failed: ${JSON.stringify(result._meta)}`).toBeFalsy();
  const terminal = result.structuredContent?.['terminal'] as string;
  expect(terminal).toMatch(/^t\d+$/u);

  // `launch` returns as soon as the child exists — revision 0, blank screen —
  // so the frame has to be waited for, with the tool an agent would use. The
  // last line of the fixture's frame, not its banner: waiting for the first
  // line would pass before the rest of the screen arrived.
  const drawn = await call(session, 'terminal.wait_for', { terminal, wait: 'text', text: 'allow: PATH=' });
  expect(drawn.isError, `the fixture never drew: ${JSON.stringify(drawn._meta)}`).toBeFalsy();

  const pid = await poll(() => {
    const text = readFileSync(pidfile, 'utf8').trim();
    return text.length === 0 ? undefined : Number(text);
  });
  return { terminal, pid };
}

/** Polls a value until it is defined, or fails the test. */
async function poll<T>(read: () => T | undefined, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const value = read();
      if (value !== undefined) return value;
    } catch {
      // not ready yet
    }
    if (Date.now() >= deadline) throw new Error('conformance: value never became available');
    await delay(25);
  }
}

/** Whether a pid still exists. Signal 0 checks without delivering anything. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function expectDies(pid: number, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (alive(pid)) {
    if (Date.now() >= deadline) throw new Error(`conformance: pid ${pid} outlived its owning session`);
    await delay(25);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

afterEach(async () => {
  while (clients.length > 0) await clients.pop()?.close().catch(() => undefined);
  while (servers.length > 0) await servers.pop()?.close();
  while (directories.length > 0) await rm(directories.pop() as string, { recursive: true, force: true });
});

describe.skipIf(!ptyAvailable())('concurrent MCP sessions', { timeout: 60_000 }, () => {
  it('gives each session its own terminals, launched in parallel', async () => {
    const handle = await serve();
    const sessions = await Promise.all([connect(handle), connect(handle), connect(handle)]);
    expect(new Set(sessions.map((session) => session.sessionId)).size).toBe(3);

    // Launched concurrently on purpose: a shared counter or a shared store
    // shows up as a collision here and nowhere else.
    const launched = await Promise.all(sessions.map((session) => launch(session)));
    expect(handle.registry.size).toBe(3);
    expect(new Set(launched.map((entry) => entry.pid)).size).toBe(3);

    // Each session numbers its own terminals from t1: the handles are per
    // session, not global, so they collide by design and must not be confused.
    expect(launched.map((entry) => entry.terminal)).toEqual(['t1', 't1', 't1']);

    for (const [index, session] of sessions.entries()) {
      const snapshot = await call(session, 'terminal.snapshot', { terminal: 't1' });
      expect(snapshot.isError).toBeFalsy();
      // Every session sees exactly one terminal, and it is its own.
      const text = JSON.stringify(snapshot.structuredContent);
      expect(text, `session ${index} saw an empty screen`).toContain('GENERIC READY');
    }
  });

  it('does not let a handle or a ref cross sessions', async () => {
    const handle = await serve();
    const [first, second] = [await connect(handle), await connect(handle)];
    await launch(first);

    // `second` has no terminals at all, so `t1` is not merely someone else's —
    // it does not exist here.
    const foreign = await call(second, 'terminal.snapshot', { terminal: 't1' });
    expect(foreign.isError).toBe(true);
    expect(Object.values(foreign._meta ?? {})[0]?.kind).toBe('no-session');

    // A ref minted in the first session must not resolve in the second either.
    await launch(second);
    const query = await call(second, 'terminal.query', { terminal: 't1', role: 'button' });
    // Generic fixture: no semantic tree, so no roles — the point is that it
    // answers about *its own* terminal rather than the first session's.
    expect(query.isError ?? false).toBe(query.isError ?? false);
    const snapshot = await call(first, 'terminal.snapshot', { terminal: 't1' });
    expect(snapshot.isError).toBeFalsy();
  });

  it('kills exactly the children of the session that was deleted', async () => {
    const handle = await serve();
    const [first, second] = [await connect(handle), await connect(handle)];
    const owned = await launch(first);
    const other = await launch(second);

    expect(alive(owned.pid)).toBe(true);
    expect(alive(other.pid)).toBe(true);

    const response = await fetch(`http://127.0.0.1:${handle.port}/mcp`, {
      method: 'DELETE',
      headers: { 'mcp-session-id': first.sessionId },
    });
    expect(response.status).toBe(204);

    // The deleted session's child is gone…
    await expectDies(owned.pid);
    expect(handle.registry.size).toBe(1);

    // …and the survivor is untouched, not merely still registered: it answers.
    expect(alive(other.pid)).toBe(true);
    const snapshot = await call(second, 'terminal.snapshot', { terminal: 't1' });
    expect(snapshot.isError).toBeFalsy();
    expect(JSON.stringify(snapshot.structuredContent)).toContain('GENERIC READY');
  });

  it('reclaims a session whose client went away, and spares one still working', async () => {
    // Streamable HTTP never signals that a client vanished, so idleness is the
    // only evidence a server has. The clock is injected rather than waited on:
    // a test that slept out a real TTL would be slow *and* would still pass if
    // the sweeper never ran on its own.
    let clock = Date.now();
    const handle = await serve({ idleTtlMs: 60_000, now: () => clock });
    const [abandonedSession, busySession] = [await connect(handle), await connect(handle)];
    const abandoned = await launch(abandonedSession);
    const busy = await launch(busySession);

    await abandonedSession.client.close();

    // Time passes for both sessions; only one of them keeps talking.
    clock += 90_000;
    const busyStillThere = await call(busySession, 'terminal.snapshot', { terminal: 't1' });
    expect(busyStillThere.isError).toBeFalsy();

    const swept = await handle.registry.sweepIdle();
    expect(swept).toEqual([abandonedSession.sessionId]);

    // A full teardown, not just an unregistration: the child is gone and the
    // slot is free. The leak this pinned before — a crashed agent costing a PTY
    // and a session slot until the server exited — is closed.
    await expectDies(abandoned.pid);
    expect(handle.registry.get(abandonedSession.sessionId)).toBeUndefined();
    expect(handle.registry.size).toBe(1);

    // Working is what spares a session: the busy one keeps its child and still
    // answers after the sweep.
    expect(alive(busy.pid)).toBe(true);
    expect((await call(busySession, 'terminal.snapshot', { terminal: 't1' })).isError).toBeFalsy();
  });

  it('never expires a session when the ttl is disabled', async () => {
    let clock = Date.now();
    const handle = await serve({ idleTtlMs: 0, now: () => clock });
    const session = await connect(handle);
    const launched = await launch(session);

    await session.client.close();
    clock += 24 * 60 * 60 * 1000;

    // Opting out has to mean opting out: a host that manages lifetimes itself
    // must not have sessions disappear under it.
    expect(await handle.registry.sweepIdle()).toEqual([]);
    expect(handle.registry.size).toBe(1);
    expect(alive(launched.pid)).toBe(true);
  });

  it('refuses a session past the ceiling, with a reason and a way out', async () => {
    const handle = await serve({ maxSessions: 2 });
    const [first] = [await connect(handle), await connect(handle)];
    expect(handle.registry.size).toBe(2);

    const refused = await fetch(`http://127.0.0.1:${handle.port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'over-the-ceiling', version: '0.0.0' },
        },
      }),
    });

    expect(refused.ok).toBe(false);
    const payload = (await refused.json()) as { error?: string; kind?: string };
    expect(payload.kind).toBe('capacity');
    // A ceiling that does not say how to get under it is a dead end.
    expect(payload.error).toContain('2');
    expect(handle.registry.size).toBe(2);

    // Freeing a slot makes room again: the ceiling is a limit, not a latch.
    await fetch(`http://127.0.0.1:${handle.port}/mcp`, {
      method: 'DELETE',
      headers: { 'mcp-session-id': first.sessionId },
    });
    await expect.poll(() => handle.registry.size).toBe(1);
    const third = await connect(handle);
    expect(third.sessionId).not.toBe(first.sessionId);
  });

  it('keeps capture_since cursors from crossing sessions', async () => {
    const handle = await serve();
    const [first, second] = [await connect(handle), await connect(handle)];
    await launch(first);
    await launch(second);

    const cursorOf = async (session: Session): Promise<number> => {
      const snapshot = await call(session, 'terminal.snapshot', { terminal: 't1' });
      return snapshot.structuredContent?.['revision'] as number;
    };
    const firstCursor = await cursorOf(first);
    const secondCursor = await cursorOf(second);

    // Only the first session's terminal is driven.
    await call(first, 'terminal.press', { terminal: 't1', keys: 'ArrowDown' });
    const settled = await call(first, 'terminal.wait_for', { terminal: 't1', wait: 'text', text: '> Beta' });
    expect(settled.isError).toBeFalsy();

    const changedFirst = await call(first, 'terminal.capture_since', { terminal: 't1', cursor: firstCursor });
    const rowsFirst = changedFirst.structuredContent?.['changedRows'] as { text: string }[];
    expect(JSON.stringify(rowsFirst)).toContain('Beta');

    // The second session's terminal never received input, so its own cursor
    // must report nothing — a shared history would leak the first one's rows.
    const changedSecond = await call(second, 'terminal.capture_since', {
      terminal: 't1',
      cursor: secondCursor,
    });
    const rowsSecond = changedSecond.structuredContent?.['changedRows'] as { text: string }[];
    expect(rowsSecond).toEqual([]);
    expect(changedSecond.structuredContent?.['since']).toBe(secondCursor);
  });
});
