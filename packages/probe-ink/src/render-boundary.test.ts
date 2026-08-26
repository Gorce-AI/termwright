import { PassThrough } from 'node:stream';
import { createElement, type ComponentType } from 'react';
import { Box, render, type DOMElement } from 'ink';
import { describe, expect, it, vi } from 'vitest';
import { RenderBoundaryQueue } from './render-boundary.js';

const COMMIT_GENERATION_ATTRIBUTE = '__termwrightCommitGeneration';

describe('Ink render boundary', () => {
  it('commits hidden Box metadata into host style before the real Ink onRender callback', async () => {
    const stdout = new PassThrough() as unknown as NodeJS.WriteStream;
    Object.defineProperties(stdout, {
      columns: { value: 20 },
      rows: { value: 8 },
      isTTY: { value: true },
    });
    const ref: { current: DOMElement | null } = { current: null };
    const generations: unknown[] = [];
    const HostBox = Box as ComponentType<Record<string, unknown>>;
    const node = (generation: number) => createElement(HostBox, {
      ref,
      display: 'none',
      [COMMIT_GENERATION_ATTRIBUTE]: generation,
    });
    const instance = render(node(0), {
      stdout,
      patchConsole: false,
      onRender() {
        generations.push((ref.current as (DOMElement & {
          style?: Record<string, unknown>;
        }) | null)?.style?.[COMMIT_GENERATION_ATTRIBUTE]);
      },
    });

    try {
      await instance.waitUntilRenderFlush();
      const beforeRerender = generations.length;
      expect(generations).toEqual([undefined]);
      instance.rerender(node(1));
      await instance.waitUntilRenderFlush();
      const committed = generations.slice(beforeRerender);
      expect(committed.length).toBeGreaterThan(0);
      expect(committed.every((generation) => generation === 1)).toBe(true);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
    }
  });

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

  it('removes a boundary when its mutation throws', async () => {
    const boundaries = new RenderBoundaryQueue();
    const failure = boundaries.afterCurrentRender(
      async () => undefined,
      () => { throw new Error('rerender failed'); },
    );

    await expect(failure).rejects.toThrow('rerender failed');
    expect(boundaries.take(1)).toBeUndefined();
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
