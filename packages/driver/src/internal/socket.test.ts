import { createServer, connect, type Server, type Socket } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { endAfterFlush } from './socket.js';

const directories: string[] = [];
const servers: Server[] = [];

afterEach(() => {
  while (servers.length > 0) servers.pop()?.close();
  while (directories.length > 0) rmSync(directories.pop() ?? '', { recursive: true, force: true });
});

/** Starts a unix-socket server that hands each connection to `onConnection`. */
async function serve(onConnection: (socket: Socket) => void): Promise<string> {
  const directory = mkdtempSync(join(tmpdir(), 'termwright-socket-'));
  directories.push(directory);
  const path = join(directory, 'test.sock');
  const server = createServer(onConnection);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(path, () => resolve()));
  return path;
}

async function readAll(path: string): Promise<Buffer> {
  const socket = connect(path);
  const chunks: Buffer[] = [];
  return new Promise<Buffer>((resolve, reject) => {
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.on('end', () => resolve(Buffer.concat(chunks)));
    socket.on('close', () => resolve(Buffer.concat(chunks)));
    socket.on('error', reject);
  });
}

describe('endAfterFlush', () => {
  it('delivers a payload too large to flush in one turn', async () => {
    // A megabyte cannot leave in the tick that wrote it, which is exactly the
    // case `write()` + `destroy()` loses: conformance measured the refusal
    // frame missing in half the runs.
    const payload = Buffer.alloc(1024 * 1024, 0x61);
    const path = await serve((socket) => endAfterFlush(socket, payload));

    const received = await readAll(path);
    expect(received.length).toBe(payload.length);
    expect(received.subarray(0, 4).toString()).toBe('aaaa');
  });

  it('closes the socket after the payload', async () => {
    const path = await serve((socket) => endAfterFlush(socket, Buffer.from('bye')));
    const received = await readAll(path);
    // FIN follows the bytes: the peer sees the farewell and then the close.
    expect(received.toString()).toBe('bye');
  });

  it('does not hold the socket open when the peer never reads', async () => {
    // The grace is a ceiling, not a promise: a peer that stops draining must
    // not be able to keep the session's socket alive.
    let served: Socket | null = null;
    const path = await serve((socket) => {
      served = socket;
      endAfterFlush(socket, Buffer.alloc(4 * 1024 * 1024), 50);
    });

    const idle = connect(path);
    idle.pause(); // never drains
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(served).not.toBeNull();
    expect((served as unknown as Socket).destroyed).toBe(true);
    idle.destroy();
  });

  it('ignores a socket that is already gone', () => {
    const socket = connect('/nonexistent/termwright.sock');
    socket.destroy();
    expect(() => endAfterFlush(socket, Buffer.from('x'))).not.toThrow();
  });
});
