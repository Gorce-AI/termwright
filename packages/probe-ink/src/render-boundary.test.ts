import { describe, expect, it, vi } from 'vitest';
import { RenderBoundaryQueue } from './render-boundary.js';

describe('Ink render boundary', () => {
  it('does not let a trailing render acknowledge a later mutation', async () => {
    const boundaries = new RenderBoundaryQueue();
    let releaseCurrentRender: (() => void) | undefined;
    const currentRender = new Promise<void>((resolve) => {
      releaseCurrentRender = resolve;
    });
    let mutated: (() => void) | undefined;
    const mutation = new Promise<void>((resolve) => {
      mutated = resolve;
    });
    const mutate = vi.fn(() => mutated?.());

    const revision = boundaries.afterCurrentRender(() => currentRender, mutate);

    // This is an onRender already queued by the initial mount. The new
    // mutation is not armed yet, so it cannot steal that mutation's boundary.
    expect(boundaries.take()).toBeUndefined();
    expect(mutate).not.toHaveBeenCalled();

    releaseCurrentRender?.();
    await mutation;
    expect(mutate).toHaveBeenCalledOnce();

    boundaries.take()?.resolve(7);
    await expect(revision).resolves.toBe(7);
  });

  it('removes a boundary when its mutation throws', async () => {
    const boundaries = new RenderBoundaryQueue();
    const failure = boundaries.afterCurrentRender(
      async () => undefined,
      () => { throw new Error('rerender failed'); },
    );

    await expect(failure).rejects.toThrow('rerender failed');
    expect(boundaries.take()).toBeUndefined();
  });

  it('does not arm or mutate after stopping during the preceding flush', async () => {
    const boundaries = new RenderBoundaryQueue();
    let releaseCurrentRender: (() => void) | undefined;
    const currentRender = new Promise<void>((resolve) => {
      releaseCurrentRender = resolve;
    });
    const mutate = vi.fn();

    const revision = boundaries.afterCurrentRender(() => currentRender, mutate);
    boundaries.stop();

    await expect(revision).rejects.toThrow('stopped before the render boundary');
    expect(mutate).not.toHaveBeenCalled();
    expect(boundaries.take()).toBeUndefined();
    releaseCurrentRender?.();
  });
});
