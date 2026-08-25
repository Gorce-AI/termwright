import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

const connectProbe = vi.hoisted(() => vi.fn());
vi.mock('@termwright/probe-runtime', () => ({ connectProbe }));

import { CONFIG_HOOK, RENDERER_HOOK } from './attach.js';
import { bootstrap } from './bootstrap.js';

const instances: ReturnType<typeof bootstrap>[] = [];

afterEach(() => {
  for (const instance of instances.splice(0)) instance.stop();
  connectProbe.mockReset();
});

function channelFailure() {
  let resolveFailure: (value: [string, string]) => void = () => undefined;
  const failed = new Promise<[string, string]>((resolve) => { resolveFailure = resolve; });
  const channel = {
    session: { sessionId: 'session', limits: {} },
    publish: vi.fn(),
    close: vi.fn(),
    fail: vi.fn((code: string, detail: string) => resolveFailure([code, detail])),
  };
  connectProbe.mockResolvedValue(channel);
  return { channel, failed };
}

function start() {
  const instance = bootstrap({
    env: { TERMWRIGHT_ENDPOINT: '/tmp/endpoint', TERMWRIGHT_TOKEN: 'token' },
    stdout: Object.assign(new PassThrough(), { isTTY: true, columns: 80, rows: 24 }) as unknown as NodeJS.WriteStream,
  });
  instances.push(instance);
  return instance;
}

function hooks() {
  return {
    config: (globalThis as Record<string, unknown>)[CONFIG_HOOK] as (config: Record<string, unknown>) => Record<string, unknown> | undefined,
    renderer: (globalThis as Record<string, unknown>)[RENDERER_HOOK] as (renderer: object, certification: { version: string; source: 'builtin' }) => void,
  };
}

function validRenderer() {
  const handlers = new Map<string, Array<(event?: { frameId?: number }) => void>>();
  const root = {
    num: 1,
    visible: false,
    renderList: [] as unknown[],
    render: () => undefined,
    getChildren: () => [],
  };
  return {
    root,
    width: 80,
    height: 24,
    terminalWidth: 80,
    terminalHeight: 24,
    frameId: 0,
    renderOffset: 0,
    requestRender: vi.fn(),
    hitTest: () => 0,
    addToHitGrid: () => undefined,
    pushHitGridScissorRect: () => undefined,
    popHitGridScissorRect: () => undefined,
    clearHitGridScissorRects: () => undefined,
    on: (event: string, handler: (event?: { frameId?: number }) => void) => {
      const listeners = handlers.get(event) ?? [];
      listeners.push(handler);
      handlers.set(event, listeners);
    },
    off: (event: string, handler: (event?: { frameId?: number }) => void) => {
      const listeners = handlers.get(event);
      const index = listeners?.indexOf(handler) ?? -1;
      if (index >= 0) listeners?.splice(index, 1);
    },
    emit: (event: string) => {
      for (const handler of [...(handlers.get(event) ?? [])]) handler();
    },
    listenerCount: () => [...handlers.values()].reduce((total, listeners) => total + listeners.length, 0),
  };
}

describe('OpenTUI bootstrap fail-closed lifecycle', () => {
  it('reports a pre-handshake runtime capability failure through the typed channel', async () => {
    const { failed } = channelFailure();
    start();
    const { config, renderer } = hooks();
    expect(config({})?.['stdout']).toBeDefined();

    renderer({}, { version: '0.5.3', source: 'builtin' });

    await expect(failed).resolves.toEqual([
      'adapter-guarantee-violation',
      'OpenTUI renderer.root is unavailable',
    ]);
    expect((globalThis as Record<string, unknown>)[CONFIG_HOOK]).toBeUndefined();
    expect((globalThis as Record<string, unknown>)[RENDERER_HOOK]).toBeUndefined();
  });

  it('rejects an application-owned stdout instead of publishing without a same-writer marker', async () => {
    const { failed } = channelFailure();
    start();
    const { config, renderer } = hooks();
    expect(config({ stdout: new PassThrough() })).toBeUndefined();

    renderer(validRenderer(), { version: '0.5.3', source: 'builtin' });

    await expect(failed).resolves.toEqual([
      'adapter-guarantee-violation',
      'OpenTUI renderer has a custom stdout; same-writer render markers cannot be certified',
    ]);
  });

  it('atomically removes FRAME and lifecycle listeners when a second renderer appears', async () => {
    const { failed } = channelFailure();
    start();
    const { config, renderer } = hooks();
    config({});
    const first = validRenderer();
    renderer(first, { version: '0.5.3', source: 'builtin' });
    expect(first.listenerCount()).toBe(3);

    renderer(validRenderer(), { version: '0.5.3', source: 'builtin' });

    await expect(failed).resolves.toEqual([
      'adapter-guarantee-violation',
      'multiple OpenTUI renderers are not certified in one process',
    ]);
    expect(first.listenerCount()).toBe(0);
    expect((globalThis as Record<string, unknown>)[CONFIG_HOOK]).toBeUndefined();
    expect((globalThis as Record<string, unknown>)[RENDERER_HOOK]).toBeUndefined();
  });

  it('cleans the adapter exactly once on normal renderer destroy', async () => {
    const { channel } = channelFailure();
    const instance = start();
    const { config, renderer } = hooks();
    config({});
    const observed = validRenderer();
    renderer(observed, { version: '0.5.3', source: 'builtin' });
    expect(observed.listenerCount()).toBe(3);

    observed.emit('destroy');
    observed.emit('destroy');
    await connectProbe.mock.results[0]!.value;

    expect(observed.listenerCount()).toBe(0);
    expect(instance.session).toBeNull();
    expect(instance.channel).toBeNull();
    expect(channel.close).toHaveBeenCalledOnce();
    expect((globalThis as Record<string, unknown>)[CONFIG_HOOK]).toBeUndefined();
    expect((globalThis as Record<string, unknown>)[RENDERER_HOOK]).toBeUndefined();
  });
});
