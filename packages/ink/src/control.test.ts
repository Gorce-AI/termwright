/**
 * The control channel on its own, where its socket path is known and nothing
 * else in the suite shares the namespace.
 */

import { connect } from 'node:net';
import { once } from 'node:events';
import { access } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { ControlChannel } from './control.js';

const open: ControlChannel[] = [];

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

describe('ControlChannel', () => {
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
    const command = once(fixture, 'data');

    const rerender = channel.rerender({ label: 'in flight' }, 1_000);
    await command;
    channel.fixtureExited();

    await expect(rerender).rejects.toMatchObject({ code: 'session-closed' });
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
