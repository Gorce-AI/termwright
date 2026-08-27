import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const connectProbe = vi.hoisted(() => vi.fn());
vi.mock('@termwright/probe-runtime', () => ({ connectProbe }));

import { CONFIG_HOOK, RENDERER_FAILURE_HOOK, RENDERER_HOOK } from './attach.js';
import { bootstrap } from './bootstrap.js';
import { OUTPUT_INSTRUMENTATION_SYMBOL } from './output-instrumentation.js';
import {
  MARKER_SINK_FEED_WRITE_SYMBOL,
  MARKER_SINK_SYMBOL,
  MARKER_SINK_TARGET_SYMBOL,
} from './sink.js';

const instances: ReturnType<typeof bootstrap>[] = [];

beforeEach(() => {
  (globalThis as Record<PropertyKey, unknown>)[OUTPUT_INSTRUMENTATION_SYMBOL] = {
    version: 1,
    frameworkVersion: '0.5.3',
    token: 'token',
  };
});

afterEach(() => {
  for (const instance of instances.splice(0)) instance.stop();
  connectProbe.mockReset();
  delete (globalThis as Record<PropertyKey, unknown>)[OUTPUT_INSTRUMENTATION_SYMBOL];
});

function channelFailure() {
  let resolveFailure: (value: [string, string]) => void = () => undefined;
  const failed = new Promise<[string, string]>((resolve) => {
    resolveFailure = resolve;
  });
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
    stdout: Object.assign(new PassThrough(), {
      isTTY: true,
      columns: 80,
      rows: 24,
    }) as unknown as NodeJS.WriteStream,
  });
  instances.push(instance);
  return instance;
}

function hooks() {
  return {
    config: (globalThis as Record<string, unknown>)[CONFIG_HOOK] as (
      config: Record<string, unknown>,
    ) => Record<string, unknown> | undefined,
    renderer: (globalThis as Record<string, unknown>)[RENDERER_HOOK] as (
      renderer: object,
      certification: { version: string; source: 'builtin' },
      effectiveConfig: Record<string, unknown>,
    ) => void,
    rendererFailure: (globalThis as Record<string, unknown>)[RENDERER_FAILURE_HOOK] as (
      effectiveConfig: Record<string, unknown>,
    ) => void,
  };
}

function validRenderer(stdout: unknown) {
  const handlers = new Map<string, Array<(event?: { frameId?: number }) => void>>();
  const root = {
    num: 1,
    visible: false,
    renderList: [] as unknown[],
    render: () => undefined,
    getChildren: () => [],
  };
  return {
    stdout:
      stdout !== null && typeof stdout === 'object'
        ? ((stdout as Record<PropertyKey, unknown>)[MARKER_SINK_TARGET_SYMBOL] ?? stdout)
        : stdout,
    _feed: {},
    _usesProcessStdout: true,
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
    once: (event: string, handler: (event?: { frameId?: number }) => void) => {
      const wrapper = (value?: { frameId?: number }): void => {
        const listeners = handlers.get(event);
        const index = listeners?.indexOf(wrapper) ?? -1;
        if (index >= 0) listeners?.splice(index, 1);
        handler(value);
      };
      const listeners = handlers.get(event) ?? [];
      listeners.push(wrapper);
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
    listenerCount: () =>
      [...handlers.values()].reduce((total, listeners) => total + listeners.length, 0),
  };
}

describe('OpenTUI bootstrap fail-closed lifecycle', () => {
  it('reports a pre-handshake runtime capability failure through the typed channel', async () => {
    const { failed } = channelFailure();
    start();
    const { config, renderer } = hooks();
    const effective = config({});
    expect(effective?.['stdout']).toBeDefined();
    expect(effective?.['remote']).toBeUndefined();

    const { root: _root, ...invalid } = validRenderer(effective?.['stdout']);
    renderer(invalid, { version: '0.5.3', source: 'builtin' }, effective ?? {});

    await expect(failed).resolves.toEqual([
      'adapter-guarantee-violation',
      'OpenTUI renderer.root is unavailable',
    ]);
    expect((globalThis as Record<string, unknown>)[CONFIG_HOOK]).toBeUndefined();
    expect((globalThis as Record<string, unknown>)[RENDERER_HOOK]).toBeUndefined();
  });

  it('does not retain a session when stdout failed during renderer construction', async () => {
    const { failed } = channelFailure();
    const target = Object.assign(new PassThrough(), { isTTY: true, columns: 80, rows: 24 });
    const baseline = target.listenerCount('error');
    const instance = bootstrap({
      env: { TERMWRIGHT_ENDPOINT: '/tmp/endpoint', TERMWRIGHT_TOKEN: 'token' },
      stdout: target as unknown as NodeJS.WriteStream,
    });
    instances.push(instance);
    const { config, renderer } = hooks();
    const effective = config({})!;
    const sink = effective['stdout'] as NodeJS.WritableStream;
    const outputFailed = new Error('stdout failed during native setup');
    expect(() => target.emit('error', outputFailed)).not.toThrow();
    const observed = validRenderer(sink);

    renderer(observed, { version: '0.5.3', source: 'builtin' }, effective);

    await expect(failed).resolves.toEqual(['adapter-guarantee-violation', outputFailed.message]);
    expect(instance.session).toBeNull();
    expect(observed.listenerCount()).toBe(1);
    const finished = new Promise<void>((resolve) => sink.once('finish', resolve));
    observed.emit('destroy');
    await finished;
    expect(target.listenerCount('error')).toBe(baseline);
  });

  it('rejects an application-owned stdout instead of publishing without a same-writer marker', async () => {
    const { failed } = channelFailure();
    start();
    const { config, renderer } = hooks();
    expect(config({ stdout: new PassThrough() })).toBeUndefined();

    const custom = { stdout: new PassThrough() };
    renderer(validRenderer(custom.stdout), { version: '0.5.3', source: 'builtin' }, custom);

    await expect(failed).resolves.toEqual([
      'adapter-guarantee-violation',
      'OpenTUI renderer has an application-owned stdout; same-writer render markers cannot be certified',
    ]);
  });

  it('does not trust an application stdout that forges the public sink symbols', async () => {
    const { failed } = channelFailure();
    start();
    const { config, renderer } = hooks();
    const forged = new PassThrough() as PassThrough & Record<PropertyKey, unknown>;
    forged[MARKER_SINK_SYMBOL] = 'token';
    forged[MARKER_SINK_TARGET_SYMBOL] = process.stdout;
    forged[MARKER_SINK_FEED_WRITE_SYMBOL] = () => true;

    expect(config({ stdout: forged })).toBeUndefined();
    renderer(validRenderer(forged), { version: '0.5.3', source: 'builtin' }, { stdout: forged });

    await expect(failed).resolves.toEqual([
      'adapter-guarantee-violation',
      'OpenTUI renderer has an application-owned stdout; same-writer render markers cannot be certified',
    ]);
  });

  it('rejects memory-buffered output without changing the application config', async () => {
    const { failed } = channelFailure();
    start();
    const { config, renderer } = hooks();
    const applicationConfig = { bufferedOutput: 'memory', remote: true };

    expect(config(applicationConfig)).toBeUndefined();
    renderer(
      validRenderer(process.stdout),
      { version: '0.5.3', source: 'builtin' },
      applicationConfig,
    );

    await expect(failed).resolves.toEqual([
      'adapter-guarantee-violation',
      'OpenTUI memory-buffered output has no causal terminal commit channel',
    ]);
    expect(applicationConfig).toEqual({ bufferedOutput: 'memory', remote: true });
  });

  it('atomically removes FRAME and lifecycle listeners when a second renderer appears', async () => {
    const { failed } = channelFailure();
    start();
    const { config, renderer } = hooks();
    const firstEffective = config({});
    const first = validRenderer(firstEffective?.['stdout']);
    renderer(first, { version: '0.5.3', source: 'builtin' }, firstEffective ?? {});
    expect(first._usesProcessStdout).toBe(true);
    expect(first.listenerCount()).toBe(4);

    const secondEffective = config({});
    const second = validRenderer(secondEffective?.['stdout']);
    renderer(second, { version: '0.5.3', source: 'builtin' }, secondEffective ?? {});

    await expect(failed).resolves.toEqual([
      'adapter-guarantee-violation',
      'multiple OpenTUI renderers are not certified in one process',
    ]);
    expect(first.listenerCount()).toBe(1);
    expect(second.listenerCount()).toBe(1);
    expect((globalThis as Record<string, unknown>)[CONFIG_HOOK]).toBeUndefined();
    expect((globalThis as Record<string, unknown>)[RENDERER_HOOK]).toBeUndefined();
    first.emit('destroy');
    second.emit('destroy');
    expect(first.listenerCount()).toBe(0);
    expect(second.listenerCount()).toBe(0);
  });

  it('releases a per-construction sink when renderer creation rejects', async () => {
    const target = Object.assign(new PassThrough(), { isTTY: true, columns: 80, rows: 24 });
    const baseline = target.listenerCount('error');
    const instance = bootstrap({
      env: { TERMWRIGHT_ENDPOINT: '/tmp/endpoint', TERMWRIGHT_TOKEN: 'token' },
      stdout: target as unknown as NodeJS.WriteStream,
    });
    instances.push(instance);
    const { config, rendererFailure } = hooks();
    const effective = config({});

    expect(target.listenerCount('error')).toBe(baseline + 1);
    rendererFailure(effective ?? {});
    const sink = effective?.['stdout'] as NodeJS.WritableStream;
    await new Promise<void>((resolve) =>
      (sink as { writableFinished?: boolean }).writableFinished
        ? resolve()
        : sink.once('finish', resolve),
    );
    expect(target.listenerCount('error')).toBe(baseline);
  });

  it('keeps settlement cleanup hooks alive when stopped with pending constructions', async () => {
    const target = Object.assign(new PassThrough(), { isTTY: true, columns: 80, rows: 24 });
    const baseline = target.listenerCount('error');
    const instance = bootstrap({
      env: { TERMWRIGHT_ENDPOINT: '/tmp/endpoint', TERMWRIGHT_TOKEN: 'token' },
      stdout: target as unknown as NodeJS.WriteStream,
    });
    instances.push(instance);
    const { config, rendererFailure } = hooks();
    const first = config({})!;
    const second = config({})!;
    const sinks = [first['stdout'], second['stdout']] as NodeJS.WritableStream[];
    expect(target.listenerCount('error')).toBe(baseline + 1);

    instance.stop();
    expect((globalThis as Record<string, unknown>)[RENDERER_FAILURE_HOOK]).toBe(rendererFailure);
    const finished = sinks.map(
      (sink) => new Promise<void>((resolve) => sink.once('finish', resolve)),
    );
    rendererFailure(first);
    rendererFailure(second);
    await Promise.all(finished);

    expect(target.listenerCount('error')).toBe(baseline);
    expect((globalThis as Record<string, unknown>)[RENDERER_FAILURE_HOOK]).toBeUndefined();
  });

  it('cleans the adapter exactly once on normal renderer destroy', async () => {
    const { channel } = channelFailure();
    const instance = start();
    const { config, renderer } = hooks();
    const effective = config({});
    const observed = validRenderer(effective?.['stdout']);
    renderer(observed, { version: '0.5.3', source: 'builtin' }, effective ?? {});
    expect(observed._usesProcessStdout).toBe(true);
    expect(observed.listenerCount()).toBe(4);

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

  it('keeps the sink writable through OpenTUI final feed drains after destroy', async () => {
    const { channel } = channelFailure();
    const target = Object.assign(new PassThrough(), { isTTY: true, columns: 80, rows: 24 });
    let bytes = '';
    target.setEncoding('utf8');
    target.on('data', (chunk: string) => {
      bytes += chunk;
    });
    const instance = bootstrap({
      env: { TERMWRIGHT_ENDPOINT: '/tmp/endpoint', TERMWRIGHT_TOKEN: 'token' },
      stdout: target as unknown as NodeJS.WriteStream,
    });
    instances.push(instance);
    const { config, renderer } = hooks();
    const effective = config({})!;
    const sink = effective['stdout'] as NodeJS.WritableStream & {
      [MARKER_SINK_FEED_WRITE_SYMBOL](chunk: Uint8Array, callback: () => void): boolean;
    };
    const observed = validRenderer(sink);
    renderer(observed, { version: '0.5.3', source: 'builtin' }, effective);
    const finished = new Promise<void>((resolve) => sink.once('finish', resolve));

    observed.emit('destroy');
    sink[MARKER_SINK_FEED_WRITE_SYMBOL](Buffer.from('FINAL-DRAIN'), () => undefined);
    await finished;
    await connectProbe.mock.results[0]!.value;

    expect(bytes).toContain('FINAL-DRAIN');
    expect(channel.close).toHaveBeenCalledOnce();
  });
});
