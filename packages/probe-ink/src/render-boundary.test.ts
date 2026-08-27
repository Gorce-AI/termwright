import { describe, expect, it, vi } from 'vitest';
import { RenderBoundaryQueue } from './render-boundary.js';

describe('Ink render boundary', () => {
  it('does not let pending stdout or a trailing render acknowledge the next commit', async () => {
    const boundaries = new RenderBoundaryQueue();
    let releaseCurrentRender: (() => void) | undefined;
    const currentRender = new Promise<void>((resolve) => {
      releaseCurrentRender = resolve;
    });
    let mutated: (() => void) | undefined;
    const mutation = new Promise<void>((resolve) => {
      mutated = resolve;
    });
    const mutate = vi.fn((_generation: number) => mutated?.());

    const revision = boundaries.afterCurrentRender(() => currentRender, mutate);

    // This is an onRender already queued by the initial mount. The new
    // mutation is not armed yet, so it cannot steal that mutation's boundary.
    expect(boundaries.take(0)).toBeUndefined();
    expect(mutate).not.toHaveBeenCalled();

    releaseCurrentRender?.();
    await mutation;
    expect(mutate).toHaveBeenCalledOnce();

    // A callback for a stale or unrelated host commit cannot steal the causal
    // boundary. Only the generation embedded in the explicit mutation can.
    expect(boundaries.take(0)).toBeUndefined();
    boundaries.take(1)?.resolve(7);
    await expect(revision).resolves.toBe(7);
  });

  it('does not arm a resize revision until pending stdout is causally flushed', async () => {
    const boundaries = new RenderBoundaryQueue();
    let releasePendingStdout: (() => void) | undefined;
    const pendingStdout = new Promise<void>((resolve) => {
      releasePendingStdout = resolve;
    });
    let resizeIssued: (() => void) | undefined;
    const issued = new Promise<void>((resolve) => {
      resizeIssued = resolve;
    });
    const resize = vi.fn((_generation: number) => resizeIssued?.());

    const revision = boundaries.afterCurrentRender(() => pendingStdout, resize);
    expect(resize).not.toHaveBeenCalled();
    expect(boundaries.take(1)).toBeUndefined();

    releasePendingStdout?.();
    await issued;
    expect(resize).toHaveBeenCalledOnce();
    // A pre-resize callback cannot resolve generation 1. The callback caused
    // by the issued resize is the first valid boundary.
    expect(boundaries.take(0)).toBeUndefined();
    boundaries.take(1)?.resolve(19);
    await expect(revision).resolves.toBe(19);
  });

  it('removes a boundary when its mutation throws', async () => {
    const boundaries = new RenderBoundaryQueue();
    const failure = boundaries.afterCurrentRender(
      async () => undefined,
      () => { throw new Error('rerender failed'); },
    );

    await expect(failure).rejects.toThrow('rerender failed');
    expect(boundaries.take(1)).toBeUndefined();
  });

  it('does not arm an unmount mutation after stopping during pending stdout', async () => {
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
    expect(boundaries.take(1)).toBeUndefined();
    releaseCurrentRender?.();
    await currentRender;
  });

  it('observes a flush rejection that arrives after stop instead of abandoning it', async () => {
    const boundaries = new RenderBoundaryQueue();
    let rejectCurrentRender: ((error: Error) => void) | undefined;
    const currentRender = new Promise<void>((_resolve, reject) => {
      rejectCurrentRender = reject;
    });
    const mutate = vi.fn();
    const revision = boundaries.afterCurrentRender(() => currentRender, mutate);

    boundaries.stop();
    rejectCurrentRender?.(new Error('flush failed during cleanup'));

    await expect(revision).rejects.toThrow('stopped before the render boundary');
    expect(mutate).not.toHaveBeenCalled();
    expect(boundaries.take(1)).toBeUndefined();
  });
});
