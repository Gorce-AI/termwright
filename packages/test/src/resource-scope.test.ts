import { describe, expect, it, vi } from 'vitest';
import { createResourceScope, ResourceScopeClosedError } from './resource-scope.js';

describe('ResourceScope', () => {
  it('cleans resources and deferred work once in LIFO order', async () => {
    const calls: string[] = [];
    const scope = createResourceScope();
    scope.defer(() => calls.push('first'));
    scope.use({ close: () => calls.push('second') });
    scope.use({ [Symbol.asyncDispose]: async () => void calls.push('third') });

    await Promise.all([scope.close(), scope.close()]);

    expect(calls).toEqual(['third', 'second', 'first']);
  });

  it('aborts and disposes an acquisition that settles during close', async () => {
    let resolve!: (resource: { close(): void }) => void;
    const acquired = new Promise<{ close(): void }>((done) => (resolve = done));
    const close = vi.fn();
    const scope = createResourceScope();
    let acquisitionSignal!: AbortSignal;
    const result = scope.acquire((signal) => {
      acquisitionSignal = signal;
      return acquired;
    });

    const closing = scope.close();
    expect(scope.signal.aborted).toBe(true);
    await Promise.resolve();
    expect(acquisitionSignal.aborted).toBe(true);
    resolve({ close });

    await expect(result).rejects.toBeInstanceOf(ResourceScopeClosedError);
    await closing;
    expect(close).toHaveBeenCalledOnce();
  });

  it('lets a parent own child cleanup without double disposal', async () => {
    const dispose = vi.fn();
    const parent = createResourceScope();
    const child = parent.child();
    child.use({ dispose });

    await parent.close();
    await child.close();

    expect(child.signal.aborted).toBe(true);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('starts cleanup when its parent signal aborts', async () => {
    const controller = new AbortController();
    const dispose = vi.fn();
    const scope = createResourceScope({ signal: controller.signal });
    scope.use({ dispose });

    controller.abort(new Error('test timed out'));
    await scope.close();

    expect(dispose).toHaveBeenCalledOnce();
    expect(scope.signal.reason).toEqual(controller.signal.reason);
  });

  it('reports every cleanup failure in teardown order', async () => {
    const first = new Error('first');
    const second = new Error('second');
    const scope = createResourceScope();
    scope.defer(() => {
      throw first;
    });
    scope.defer(() => {
      throw second;
    });

    const failure = await scope.close().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([second, first]);
  });

  it('rejects registrations after close starts', async () => {
    const scope = createResourceScope();
    await scope.close();

    expect(() => scope.defer(() => undefined)).toThrow(ResourceScopeClosedError);
    expect(() => scope.use({ close() {} })).toThrow(ResourceScopeClosedError);
    await expect(scope.acquire(async () => ({ close() {} }))).rejects.toBeInstanceOf(
      ResourceScopeClosedError,
    );
  });
});
