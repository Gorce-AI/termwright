import { execFile } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { wrapPublicInkRender } from './public-render-wrapper-poc.js';

const execFileAsync = promisify(execFile);

describe('public Ink render wrapper POC', () => {
  it('preserves receiver, node/trailing argument identity, immutable options and return identity', () => {
    const receiver = { name: 'ink-module' };
    const node = {};
    const trailing = {};
    const result = {};
    const userOnRender = vi.fn(function (this: unknown) {
      expect(this).toBe(receiver);
      return 'user-result';
    });
    const options = Object.freeze({ stdout: new PassThrough(), onRender: userOnRender, custom: trailing });
    let received: unknown[] = [];
    const original = vi.fn(function (this: unknown, ...args: unknown[]) {
      expect(this).toBe(receiver);
      received = args;
      return result;
    });
    const observed = vi.fn(function (this: unknown) {
      expect(this).toBe(receiver);
    });
    const wrapped = wrapPublicInkRender(original, { onRender: observed });

    expect(Reflect.apply(wrapped, receiver, [node, options, trailing])).toBe(result);
    expect(received[0]).toBe(node);
    expect(received[2]).toBe(trailing);
    expect(received[1]).not.toBe(options);
    expect(received[1]).toMatchObject({ stdout: options.stdout, custom: trailing });
    expect(options.onRender).toBe(userOnRender);

    const composed = (received[1] as { onRender(metrics: unknown): unknown }).onRender;
    expect(Reflect.apply(composed, receiver, [{ renderTime: 1 }])).toBe('user-result');
    expect(observed).toHaveBeenCalledOnce();
    expect(userOnRender).toHaveBeenCalledOnce();
    expect(observed.mock.invocationCallOrder[0]).toBeLessThan(userOnRender.mock.invocationCallOrder[0]!);
  });

  it('normalizes the public stream overload without replacing the stream', () => {
    const stream = new PassThrough();
    let forwarded: unknown[] = [];
    const instance = {};
    const wrapped = wrapPublicInkRender((...args: unknown[]) => {
      forwarded = args;
      return instance;
    }, { onRender: () => undefined });
    expect(wrapped('node', stream)).toBe(instance);
    expect((forwarded[1] as { stdout: unknown }).stdout).toBe(stream);
  });

  it('observes option getters once and preserves an invalid user callback failure', () => {
    let reads = 0;
    const options = Object.defineProperty({}, 'onRender', {
      enumerable: true,
      get() {
        reads += 1;
        return 'invalid';
      },
    });
    let forwarded: unknown[] = [];
    const wrapped = wrapPublicInkRender((...args: unknown[]) => {
      forwarded = args;
      return {};
    }, { onRender: () => undefined });

    wrapped('node', options);
    expect(reads).toBe(1);
    expect(() => (forwarded[1] as { onRender(): void }).onRender()).toThrow(TypeError);
  });

  it('preserves Ink optional-callback semantics for null', () => {
    let forwarded: unknown[] = [];
    const wrapped = wrapPublicInkRender((...args: unknown[]) => {
      forwarded = args;
      return {};
    }, { onRender: () => undefined });
    wrapped('node', { onRender: null });
    expect(() => (forwarded[1] as { onRender(): void }).onRender()).not.toThrow();
  });

  it('does not let observer failure suppress the application callback', () => {
    const failure = new Error('observer failed');
    const onError = vi.fn(() => { throw new Error('diagnostic failed'); });
    const user = vi.fn();
    let forwarded: unknown[] = [];
    const wrapped = wrapPublicInkRender((...args: unknown[]) => {
      forwarded = args;
      return {};
    }, {
      onRender: () => { throw failure; },
      onError,
    });
    wrapped('node', { onRender: user });
    expect(() => (forwarded[1] as { onRender(): void }).onRender()).not.toThrow();
    expect(onError).toHaveBeenCalledWith(failure);
    expect(user).toHaveBeenCalledOnce();
  });

  it.each([
    ['Node', process.execPath],
    ['Bun', 'bun'],
  ] as const)('observes deterministic commit/output/onRender/flush ordering for multiple real Ink roots under %s', async (_runtime, executable) => {
    const result = await runFixture(executable);
    expect(result.rootCount).toBe(2);
    expect(result.returnIdentity).toEqual({ first: true, second: true });
    expect(result.userCallbacks).toEqual(result.observerCallbacks);
    expect(result.userAfterObserver).toBe(true);
    expect(result.flushAfterOnRender).toBe(true);
    expect(result.initialOnRenderBeforeCommit).toBe(true);
    expect(result.rapidCommitsBeforeOnRender).toBe(true);
    expect(result.unmountOnRenderBeforeCommit).toBe(true);
    expect(result.stdoutAfterUnmountCommit).toBe(true);
    expect(result.customStreams).toEqual(['first', 'second']);
    expect(result.rapidLabels.at(-1)).toBe('rapid-3');
    expect(result.unmountedRoots).toEqual([1, 2]);
  });
});

interface FixtureResult {
  readonly rootCount: number;
  readonly returnIdentity: { readonly first: boolean; readonly second: boolean };
  readonly observerCallbacks: { readonly first: number; readonly second: number };
  readonly userCallbacks: { readonly first: number; readonly second: number };
  readonly userAfterObserver: boolean;
  readonly flushAfterOnRender: boolean;
  readonly initialOnRenderBeforeCommit: boolean;
  readonly rapidCommitsBeforeOnRender: boolean;
  readonly unmountOnRenderBeforeCommit: boolean;
  readonly stdoutAfterUnmountCommit: boolean;
  readonly customStreams: readonly string[];
  readonly rapidLabels: readonly string[];
  readonly unmountedRoots: readonly number[];
}

async function runFixture(executable: string): Promise<FixtureResult> {
  const fixture = new URL('./testing/public-render-wrapper-fixture.mjs', import.meta.url);
  const { stdout, stderr } = await execFileAsync(executable, [fileURLToPath(fixture)], {
    cwd: process.cwd(),
    env: { ...process.env, DEV: 'false', CI: 'true', FORCE_COLOR: '0' },
  });
  expect(stderr).toBe('');
  return JSON.parse(stdout.trim()) as FixtureResult;
}
