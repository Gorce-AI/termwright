/**
 * The control channel on its own, where its socket path is known and nothing
 * else in the suite shares the namespace.
 */

import { connect, createServer } from 'node:net';
import { once } from 'node:events';
import { access } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ControlChannel } from './control.js';

const open: ControlChannel[] = [];

function connectFailure(endpoint: string): Promise<Error> {
  return new Promise((resolve, reject) => {
    const socket = connect(endpoint);
    socket.once('connect', () => {
      socket.destroy();
      reject(new Error(`rolled-back endpoint still accepts connections: ${endpoint}`));
    });
    socket.once('error', (error) => resolve(error));
  });
}

afterEach(async () => {
  for (const channel of open.splice(0)) await channel.close();
});

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function attachFixture(channel: ControlChannel): Promise<ReturnType<typeof connect>> {
  const fixture = connect(channel.endpoint);
  await once(fixture, 'connect');
  fixture.write(`${JSON.stringify({ v: 1, type: 'hello', token: channel.token })}\n`);
  await channel.waitForFixture(1_000);
  return fixture;
}

async function nextCommand(fixture: ReturnType<typeof connect>): Promise<{ commandId: number }> {
  const [data] = await once(fixture, 'data');
  return JSON.parse(String(data)) as { commandId: number };
}

describe('ControlChannel', () => {
  it('rolls back a Windows named-pipe listener when endpoint startup fails', async () => {
    const server = createServer();
    const close = vi.spyOn(server, 'close');
    let endpoint = '';

    await expect(
      ControlChannel.listen({
        platform: 'win32',
        createServer: () => server,
        listen: async (listener, candidateEndpoint) => {
          endpoint = candidateEndpoint;
          await new Promise<void>((resolve, reject) => {
            listener.once('error', reject);
            listener.listen(candidateEndpoint, () => {
              listener.removeListener('error', reject);
              resolve();
            });
          });
          throw new Error('injected named-pipe listen failure');
        },
      }),
    ).rejects.toThrow('injected named-pipe listen failure');

    expect(endpoint).toMatch(/^\\\\\.\\pipe\\termwright-control-/u);
    expect(close).toHaveBeenCalledOnce();
    expect(server.listening).toBe(false);
    await expect(connectFailure(endpoint)).resolves.toBeDefined();
  });

  it('creates its endpoint and removes it again on close', async () => {
    const channel = await ControlChannel.listen();
    const endpoint = channel.endpoint;

    expect(await exists(endpoint)).toBe(true);

    await channel.close();

    expect(await exists(endpoint)).toBe(false);
    // Including the directory that held it.
    expect(await exists(endpoint.slice(0, endpoint.lastIndexOf('/')))).toBe(false);
  });

  it('is idempotent to close', async () => {
    const channel = await ControlChannel.listen();

    await channel.close();
    await expect(channel.close()).resolves.toBeUndefined();
  });

  it('mints a fresh secret per channel', async () => {
    const first = await ControlChannel.listen();
    open.push(first);
    const second = await ControlChannel.listen();
    open.push(second);

    expect(first.token).not.toBe(second.token);
    expect(first.endpoint).not.toBe(second.endpoint);
    expect(first.token.length).toBeGreaterThanOrEqual(32);
  });

  it('refuses a peer that never authenticates', async () => {
    const channel = await ControlChannel.listen();
    open.push(channel);

    const stranger = connect(channel.endpoint);
    const closed = new Promise<void>((resolve) => {
      stranger.on('close', () => resolve());
      stranger.on('error', () => resolve());
    });
    stranger.on('connect', () => stranger.write('{"type":"rerender","props":{}}\n'));
    await closed;

    expect(channel.connected).toBe(false);
  });

  it('lets the fixture authenticate while a silent stranger is connected', async () => {
    const channel = await ControlChannel.listen();
    open.push(channel);

    const stranger = connect(channel.endpoint);
    await once(stranger, 'connect');
    const closed = once(stranger, 'close');
    const fixture = await attachFixture(channel);

    expect(channel.connected).toBe(true);
    await closed;
    fixture.destroy();
  });

  it('bounds silent authentication candidates without locking out the fixture', async () => {
    const channel = await ControlChannel.listen();
    open.push(channel);
    const strangers = await Promise.all(
      Array.from({ length: 9 }, async () => {
        const socket = connect(channel.endpoint);
        const closed = new Promise<void>((resolve) => socket.once('close', resolve));
        // Server-side candidate eviction can surface as ECONNRESET on named
        // pipes. It is the expected lifecycle under test, never an unhandled
        // process error.
        socket.on('error', () => undefined);
        await once(socket, 'connect');
        return { socket, closed };
      }),
    );

    const fixture = await attachFixture(channel);
    expect(channel.connected).toBe(true);
    await Promise.all(strangers.map(({ closed }) => closed));
    for (const { socket } of strangers) socket.destroy();
    fixture.destroy();
  });

  it('isolates partial unauthenticated input from the fixture hello', async () => {
    const channel = await ControlChannel.listen();
    open.push(channel);

    const stranger = connect(channel.endpoint);
    await once(stranger, 'connect');
    stranger.write('{"v":1,"type":"hel');
    const closed = once(stranger, 'close');
    stranger.destroy();
    await closed;

    const fixture = await attachFixture(channel);
    expect(channel.connected).toBe(true);
    fixture.destroy();
  });

  it('refuses a second connection after the fixture authenticates', async () => {
    const channel = await ControlChannel.listen();
    open.push(channel);
    const fixture = await attachFixture(channel);

    const stranger = connect(channel.endpoint);
    const closed = new Promise<void>((resolve) => {
      stranger.on('close', resolve);
      stranger.on('error', () => resolve());
    });
    await closed;

    expect(channel.connected).toBe(true);
    fixture.destroy();
  });

  it('refuses a rerender when no fixture ever attached', async () => {
    const channel = await ControlChannel.listen();
    open.push(channel);

    await expect(channel.rerender({ label: 'nobody there' })).rejects.toMatchObject({
      code: 'session-closed',
    });
  });

  it('uses authoritative process exit instead of racing the socket close event', async () => {
    const channel = await ControlChannel.listen();
    open.push(channel);
    const fixture = await attachFixture(channel);

    // The process exit promise may settle before Node delivers `close` for its
    // control socket. The process lifecycle freezes the public error now.
    channel.fixtureExited();
    await expect(channel.rerender({ label: 'too late' })).rejects.toMatchObject({
      code: 'session-closed',
    });
    fixture.destroy();
  });

  it('rejects an in-flight rerender as session-closed when the fixture disappears', async () => {
    const channel = await ControlChannel.listen();
    open.push(channel);
    const fixture = await attachFixture(channel);
    const command = nextCommand(fixture);

    const rerender = channel.rerender({ label: 'in flight' }, 1_000);
    await command;
    channel.fixtureExited();

    await expect(rerender).rejects.toMatchObject({ code: 'session-closed' });
    fixture.destroy();
  });

  it('returns the exact semantic revision from a successful acknowledgement', async () => {
    const channel = await ControlChannel.listen();
    open.push(channel);
    const fixture = await attachFixture(channel);
    const command = nextCommand(fixture);

    const rerender = channel.rerender({ label: 'paired' }, 1_000);
    const { commandId } = await command;
    fixture.write(`${JSON.stringify({ v: 1, commandId, type: 'ok', semanticRevision: 17 })}\n`);

    await expect(rerender).resolves.toBe(17);
    fixture.destroy();
  });

  it('rejects an ok acknowledgement without a positive semantic revision', async () => {
    const channel = await ControlChannel.listen();
    open.push(channel);
    const fixture = await attachFixture(channel);
    const command = nextCommand(fixture);

    const rerender = channel.rerender({ label: 'unpaired' }, 1_000);
    const { commandId } = await command;
    fixture.write(`${JSON.stringify({ v: 1, commandId, type: 'ok' })}\n`);

    await expect(rerender).rejects.toMatchObject({ code: 'protocol-violation' });
    await expect(channel.rerender({ label: 'channel is poisoned' })).rejects.toMatchObject({
      code: 'session-closed',
    });
    fixture.destroy();
  });

  it('does not let a reply for another command acknowledge the pending rerender', async () => {
    const channel = await ControlChannel.listen();
    open.push(channel);
    const fixture = await attachFixture(channel);
    const command = nextCommand(fixture);

    const rerender = channel.rerender({ label: 'paired' }, 1_000);
    const { commandId } = await command;
    fixture.write(
      `${JSON.stringify({ v: 1, commandId: commandId + 1, type: 'ok', semanticRevision: 3 })}\n`,
    );
    fixture.write(`${JSON.stringify({ v: 1, commandId, type: 'ok', semanticRevision: 17 })}\n`);

    await expect(rerender).resolves.toBe(17);
    fixture.destroy();
  });

  it('classifies a kernel-observed disconnect as session-closed, not a protocol violation', async () => {
    const channel = await ControlChannel.listen();
    open.push(channel);
    const fixture = await attachFixture(channel);

    fixture.destroy();
    await expect(channel.rerender({ label: 'raced close' }, 1_000)).rejects.toMatchObject({
      code: 'session-closed',
    });
  });
});
