/**
 * The control channel on its own, where its socket path is known and nothing
 * else in the suite shares the namespace.
 */

import { connect } from 'node:net';
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
      code: 'unsupported-action',
    });
  });
});
