import { PassThrough } from 'node:stream';
import { createElement } from 'react';
import { ENV_ENDPOINT, ENV_TOKEN } from '@termwright/protocol';
import type { ProbeChannel } from '@termwright/probe-runtime';
import type { Instance, RenderOptions } from 'ink';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { wrapInkRender, type InkModule } from './instrument.js';
import {
  INK_FRAME_CONTEXT,
  INK_RENDER_CAPTURE,
} from './instrumentation.js';
import type { InkReconcilerInstrumentation } from './react-commit-bridge.js';

const env = {
  [ENV_ENDPOINT]: 'termwright-test-endpoint',
  [ENV_TOKEN]: 'termwright-test-token',
};

const holder = globalThis as typeof globalThis & {
  __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown;
};
const originalHook = Object.getOwnPropertyDescriptor(
  holder,
  '__REACT_DEVTOOLS_GLOBAL_HOOK__',
);
const originalDev = process.env['DEV'];

afterEach(() => {
  if (originalHook === undefined) delete holder.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  else Object.defineProperty(holder, '__REACT_DEVTOOLS_GLOBAL_HOOK__', originalHook);
  if (originalDev === undefined) delete process.env['DEV'];
  else process.env['DEV'] = originalDev;
});

describe('Ink render instrumentation transaction', () => {
  it('drains the pre-attach render before issuing the authoritative initial rerender', async () => {
    delete process.env['DEV'];
    delete holder.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    const currentRender = deferred<void>();
    const rerendered = deferred<void>();
    const raw = fakeInstance();
    raw.waitUntilRenderFlush = vi.fn(() => currentRender.promise);
    raw.rerender = vi.fn(() => rerendered.resolve());
    const reconciler = registeringReconciler();
    const channel = lifecycleChannel();
    const connector = vi.fn(async () => channel.value);
    const render = vi.fn(() => raw);
    const instance = wrapInkRender(fakeInk(render), {
      env,
      certifiedHarness: true,
      reconciler,
      connect: connector,
    })(createElement('ink-text', null, 'application'), {
      stdout: tty(),
      stderr: tty(),
      patchConsole: false,
    });

    await connector.mock.results[0]?.value;
    expect(raw.rerender).not.toHaveBeenCalled();
    currentRender.resolve();
    await rerendered.promise;
    expect(raw.rerender).toHaveBeenCalledOnce();

    // No fake renderer callback is emitted in this transaction test. Cleanup
    // must reject the deliberately pending boundary instead of leaking it.
    instance.cleanup();
    await channel.closed;
    expect(channel.fail).not.toHaveBeenCalled();
  });

  it('rejects an initial boundary when the Ink instance exits during its pre-attach flush', async () => {
    delete process.env['DEV'];
    delete holder.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    const currentRender = deferred<void>();
    const exited = deferred<void>();
    const raw = fakeInstance();
    raw.waitUntilRenderFlush = vi.fn(() => currentRender.promise);
    raw.waitUntilExit = vi.fn(() => exited.promise);
    const reconciler = registeringReconciler();
    const channel = lifecycleChannel();
    const connector = vi.fn(async () => channel.value);
    const instance = wrapInkRender(fakeInk(() => raw), {
      env,
      certifiedHarness: true,
      reconciler,
      connect: connector,
    })(createElement('ink-text', null, 'application'), {
      stdout: tty(),
      stderr: tty(),
      patchConsole: false,
    });

    exited.resolve();
    await channel.closed;
    expect(raw.rerender).not.toHaveBeenCalled();
    expect(channel.fail).not.toHaveBeenCalled();
    instance.cleanup();
    currentRender.resolve();
  });

  it('reports bridge setup failure, cleans acquired hooks, and executes the app render once', async () => {
    delete process.env['DEV'];
    delete holder.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    const globals = globalThis as Record<PropertyKey, unknown>;
    const priorCapture = globals[INK_RENDER_CAPTURE];
    const priorContext = globals[INK_FRAME_CONTEXT];
    const stdout = tty();
    const stderr = tty();
    const originalWrite = stdout.write;
    const raw = fakeInstance();
    const render = vi.fn(() => raw);
    let report!: (value: readonly [string, string]) => void;
    const reported = new Promise<readonly [string, string]>((resolve) => {
      report = resolve;
    });
    let channelOpen = true;
    const close = vi.fn(() => { channelOpen = false; });
    const connector = vi.fn(async () => ({
      fail(code: string, message: string) {
        channelOpen = false;
        report([code, message]);
      },
      get isOpen() { return channelOpen; },
      close,
    }) as unknown as ProbeChannel);
    const reconciler: InkReconcilerInstrumentation = {
      injectIntoDevTools: vi.fn(() => false),
    };
    const node = createElement('ink-text', null, 'application');
    const supplied: RenderOptions = { stdout, stderr, patchConsole: false };
    const wrapped = wrapInkRender(fakeInk(render), {
      env,
      certifiedHarness: true,
      reconciler,
      connect: connector,
    });

    expect(wrapped(node, supplied)).toBe(raw);
    expect(render).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledWith(node, supplied);
    await expect(reported).resolves.toEqual([
      'adapter-guarantee-violation',
      'Ink semantic probe unavailable: React renderer instrumentation did not register Ink.',
    ]);
    expect(connector).toHaveBeenCalledOnce();
    expect(channelOpen).toBe(false);
    expect(close).not.toHaveBeenCalled();
    expect(stdout.write).toBe(originalWrite);
    expect(globals[INK_RENDER_CAPTURE]).toBe(priorCapture);
    expect(globals[INK_FRAME_CONTEXT]).toBe(priorContext);
    expect(holder.__REACT_DEVTOOLS_GLOBAL_HOOK__).toBeUndefined();
  });

  it('preserves the exact application render error identity and never retries', () => {
    delete process.env['DEV'];
    delete holder.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    const globals = globalThis as Record<PropertyKey, unknown>;
    const priorCapture = globals[INK_RENDER_CAPTURE];
    const priorContext = globals[INK_FRAME_CONTEXT];
    const stdout = tty();
    const stderr = tty();
    const originalWrite = stdout.write;
    const applicationError = new Error('application render failed');
    const render = vi.fn(() => { throw applicationError; });
    const connector = vi.fn(async () => null);
    const reconciler = registeringReconciler();
    const wrapped = wrapInkRender(fakeInk(render), {
      env,
      certifiedHarness: true,
      reconciler,
      connect: connector,
    });

    let observed: unknown;
    try {
      wrapped(createElement('ink-text'), { stdout, stderr, patchConsole: false });
    } catch (error) {
      observed = error;
    }
    expect(observed).toBe(applicationError);
    expect(render).toHaveBeenCalledOnce();
    expect(connector).not.toHaveBeenCalled();
    expect(stdout.write).toBe(originalWrite);
    expect(globals[INK_RENDER_CAPTURE]).toBe(priorCapture);
    expect(globals[INK_FRAME_CONTEXT]).toBe(priorContext);
    expect(holder.__REACT_DEVTOOLS_GLOBAL_HOOK__).toBeUndefined();
  });

  it('lets the real DEV render path inject once into an existing hook', () => {
    process.env['DEV'] = 'true';
    const existingInject = vi.fn(() => 81);
    const existingHook = { inject: existingInject };
    holder.__REACT_DEVTOOLS_GLOBAL_HOOK__ = existingHook;
    const reconciler = registeringReconciler();
    const raw = fakeInstance();
    const render = vi.fn(() => {
      reconciler.injectIntoDevTools();
      return raw;
    });
    const connector = vi.fn(async () => null);
    const wrapped = wrapInkRender(fakeInk(render), {
      env: { ...env, DEV: 'true' },
      certifiedHarness: true,
      reconciler,
      connect: connector,
    });

    const instance = wrapped(createElement('ink-text'), {
      stdout: tty(),
      stderr: tty(),
      patchConsole: false,
    });
    expect(instance).not.toBe(raw);
    expect(render).toHaveBeenCalledOnce();
    expect(reconciler.injectIntoDevTools).toHaveBeenCalledOnce();
    expect(existingInject).toHaveBeenCalledOnce();
    instance.cleanup();
    expect(holder.__REACT_DEVTOOLS_GLOBAL_HOOK__).toBe(existingHook);
  });

  it('reports a missing DEV registration after the single completed render', async () => {
    process.env['DEV'] = 'true';
    delete holder.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    const raw = fakeInstance();
    const render = vi.fn(() => raw);
    const reconciler: InkReconcilerInstrumentation = {
      injectIntoDevTools: vi.fn(() => false),
    };
    let report!: (value: readonly [string, string]) => void;
    const reported = new Promise<readonly [string, string]>((resolve) => {
      report = resolve;
    });
    let channelOpen = true;
    const connector = vi.fn(async () => ({
      fail(code: string, message: string) {
        channelOpen = false;
        report([code, message]);
      },
      get isOpen() { return channelOpen; },
      close() { channelOpen = false; },
    }) as unknown as ProbeChannel);
    const wrapped = wrapInkRender(fakeInk(render), {
      env: { ...env, DEV: 'true' },
      certifiedHarness: true,
      reconciler,
      connect: connector,
    });

    expect(wrapped(createElement('ink-text'), {
      stdout: tty(),
      stderr: tty(),
      patchConsole: false,
    })).toBe(raw);
    expect(render).toHaveBeenCalledOnce();
    expect(reconciler.injectIntoDevTools).not.toHaveBeenCalled();
    await expect(reported).resolves.toEqual([
      'adapter-guarantee-violation',
      'Ink semantic probe unavailable: React renderer instrumentation did not register Ink.',
    ]);
    expect(channelOpen).toBe(false);
    expect(holder.__REACT_DEVTOOLS_GLOBAL_HOOK__).toBeUndefined();
  });
});

function registeringReconciler(): InkReconcilerInstrumentation & {
  injectIntoDevTools: ReturnType<typeof vi.fn>;
} {
  return {
    injectIntoDevTools: vi.fn(() => {
      const hook = holder.__REACT_DEVTOOLS_GLOBAL_HOOK__ as {
        inject(renderer: Record<string, unknown>): unknown;
      };
      hook.inject({ rendererPackageName: 'ink', rendererVersion: '7.1.1' });
      return false;
    }),
  };
}

function fakeInk(render: InkModule['render']): InkModule {
  return {
    render,
    Box: (() => null) as InkModule['Box'],
    measureElement: () => ({ x: 0, y: 0, width: 1, height: 1 }),
  };
}

function fakeInstance(): Instance {
  return {
    rerender: vi.fn(),
    unmount: vi.fn(),
    waitUntilExit: vi.fn(() => new Promise(() => undefined)),
    waitUntilRenderFlush: vi.fn(async () => undefined),
    cleanup: vi.fn(),
    clear: vi.fn(),
  } as unknown as Instance;
}

function tty(): NodeJS.WriteStream {
  const stream = new PassThrough() as unknown as NodeJS.WriteStream;
  Object.defineProperties(stream, {
    columns: { value: 24, configurable: true },
    rows: { value: 8, configurable: true },
    isTTY: { value: true, configurable: true },
  });
  return stream;
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return {promise, resolve};
}

function lifecycleChannel(): {
  readonly value: ProbeChannel;
  readonly closed: Promise<void>;
  readonly fail: ReturnType<typeof vi.fn>;
} {
  const closed = deferred<void>();
  let open = true;
  const fail = vi.fn(() => {
    if (!open) return;
    open = false;
    closed.resolve();
  });
  return {
    value: {
      get isOpen() { return open; },
      fail,
      close() {
        if (!open) return;
        open = false;
        closed.resolve();
      },
    } as unknown as ProbeChannel,
    closed: closed.promise,
    fail,
  };
}
