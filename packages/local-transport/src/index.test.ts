import { randomUUID } from 'node:crypto';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bindLocalEndpoint,
  createLocalToken,
  LocalJsonDecoder,
  LocalTransportError,
  parseRequestEnvelope,
  parseResponseEnvelope,
  responseEnvelope,
  sameLocalSecret,
} from './index.js';

describe('shared local transport primitives', () => {
  it('validates typed request and response envelopes once', () => {
    expect(LocalTransportError).toBeTypeOf('function');
    expect(LocalJsonDecoder).toBeTypeOf('function');
    expect(
      parseRequestEnvelope({ v: 1, type: 'hello', requestId: 'r1', token: 'x' }, 1),
    ).toMatchObject({ type: 'hello', requestId: 'r1', token: 'x' });
    expect(
      parseResponseEnvelope(responseEnvelope(1, 'r1', true, { ready: true }), 1),
    ).toMatchObject({ type: 'response', requestId: 'r1', ok: true, result: { ready: true } });
    expect(() =>
      parseResponseEnvelope({ v: 1, type: 'response', requestId: 'r1', ok: true }, 1),
    ).toThrow(/missing result/u);
    expect(() =>
      parseResponseEnvelope(
        {
          v: 1,
          type: 'response',
          requestId: 'r1',
          ok: true,
          result: null,
          error: { code: 'smuggled' },
        },
        1,
      ),
    ).toThrow(/cannot contain error/u);
    expect(() =>
      parseResponseEnvelope(
        {
          v: 1,
          type: 'response',
          requestId: 'r1',
          ok: false,
          error: null,
          result: { smuggled: true },
        },
        1,
      ),
    ).toThrow(/cannot contain result/u);
  });

  it('generates bounded tokens and compares exact string contents', () => {
    const token = createLocalToken();
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(sameLocalSecret(token, token)).toBe(true);
    expect(sameLocalSecret(token, `${token.slice(0, -1)}x`)).toBe(false);
    expect(sameLocalSecret(token, 'short')).toBe(false);
    expect(sameLocalSecret('ż'.repeat(32), 'z'.repeat(32))).toBe(false);
    expect(() => createLocalToken('weak')).toThrow(/32\.\.512/u);
    expect(() => createLocalToken('x'.repeat(513))).toThrow(/32\.\.512/u);
    expect(() => createLocalToken(undefined, () => 'predictable')).toThrow(/32\.\.512/u);
    expect(() => createLocalToken(`valid-prefix-${'x'.repeat(20)}\uD800`)).toThrow(/well-formed/u);
    expect(sameLocalSecret(`x${'a'.repeat(31)}\uD800`, `x${'a'.repeat(31)}\uD801`)).toBe(false);
  });

  it('aborts endpoint startup and leaves no listener behind', async () => {
    const endpoint =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\termwright-shared-abort-${randomUUID()}`
        : join(tmpdir(), `termwright-shared-abort-${randomUUID()}.sock`);
    const controller = new AbortController();
    controller.abort(new Error('cancelled before listen'));
    await expect(
      bindLocalEndpoint({
        server: createServer(),
        name: 'shared',
        endpoint,
        signal: controller.signal,
      }),
    ).rejects.toThrow('cancelled before listen');
    await expectConnectionRefused(endpoint);
  });

  it('owns endpoint close and cleanup idempotently', async () => {
    const bound = await bindLocalEndpoint({ server: createServer(), name: 'shared-test' });
    await Promise.all([bound.close(), bound.close()]);
    await expectConnectionRefused(bound.endpoint);
  });

  it('removes temporary lifecycle listeners when listen throws synchronously', async () => {
    const server = createServer();
    const first = await bindLocalEndpoint({ server, name: 'shared-first' });
    const before = {
      error: server.listenerCount('error'),
      listening: server.listenerCount('listening'),
      close: server.listenerCount('close'),
    };
    await expect(bindLocalEndpoint({ server, name: 'shared-second' })).rejects.toMatchObject({
      code: 'ERR_SERVER_ALREADY_LISTEN',
    });
    expect({
      error: server.listenerCount('error'),
      listening: server.listenerCount('listening'),
      close: server.listenerCount('close'),
    }).toEqual(before);
    await first.close();
  });
});

async function expectConnectionRefused(endpoint: string): Promise<void> {
  const socket = connect(endpoint);
  await new Promise<void>((resolve, reject) => {
    socket.once('error', () => resolve());
    socket.once('connect', () => {
      socket.destroy();
      reject(new Error(`unexpected listener at ${endpoint}`));
    });
  });
}
