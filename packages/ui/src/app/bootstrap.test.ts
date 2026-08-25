import { describe, expect, it, vi } from 'vitest';
import type { ViewerState } from '../data-source.js';
import type { ServerMessage } from '../events.js';
import { bootstrapRunner } from './bootstrap.js';

describe('Runner bootstrap barrier', () => {
  it('commits the HTTP snapshot before subscribing to replayed live events', async () => {
    let resolveState!: (viewer: ViewerState) => void;
    const state = new Promise<ViewerState>((resolve) => { resolveState = resolve; });
    const order: string[] = [];
    const viewer = {} as ViewerState;
    const message = {} as ServerMessage;
    const task = bootstrapRunner(
      { state: () => state },
      {
        connect: (onMessage, onStatus) => {
          order.push('connect');
          onStatus(true);
          onMessage(message);
        },
      },
      {
        active: () => true,
        ready: (received) => { expect(received).toBe(viewer); order.push('ready'); },
        failed: vi.fn(),
        message: (received) => { expect(received).toBe(message); order.push('message'); },
        status: (connected) => { expect(connected).toBe(true); order.push('status'); },
      },
    );

    expect(order).toEqual([]);
    resolveState(viewer);
    await task;
    expect(order).toEqual(['ready', 'connect', 'status', 'message']);
  });

  it('does not connect a page that unmounted while its snapshot was loading', async () => {
    let resolveState!: (viewer: ViewerState) => void;
    const state = new Promise<ViewerState>((resolve) => { resolveState = resolve; });
    let active = true;
    const connect = vi.fn();
    const ready = vi.fn();
    const task = bootstrapRunner(
      { state: () => state },
      { connect },
      { active: () => active, ready, failed: vi.fn(), message: vi.fn(), status: vi.fn() },
    );
    active = false;
    resolveState({} as ViewerState);
    await task;
    expect(ready).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it('reports snapshot failure without opening a live subscription', async () => {
    const failure = new Error('snapshot unavailable');
    const failed = vi.fn();
    const connect = vi.fn();
    await bootstrapRunner(
      { state: () => Promise.reject(failure) },
      { connect },
      { active: () => true, ready: vi.fn(), failed, message: vi.fn(), status: vi.fn() },
    );
    expect(failed).toHaveBeenCalledWith(failure);
    expect(connect).not.toHaveBeenCalled();
  });
});
