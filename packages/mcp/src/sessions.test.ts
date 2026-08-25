import { describe, expect, it, vi } from 'vitest';
import { SessionRegistry } from './sessions.js';

describe('managed MCP session lifecycle', () => {
  it('shares one close transaction and removes ownership only after verified cleanup', async () => {
    let releases = 0;
    const registry = new SessionRegistry<{ id: string }>({
      disposeAttachment: async () => {
        releases += 1;
        await Promise.resolve();
      },
    });
    registry.create('s1', () => ({ id: 'attachment' }));

    const first = registry.delete('s1');
    const second = registry.delete('s1');
    expect(second).toBe(first);
    expect(registry.size).toBe(1);
    await first;
    expect(releases).toBe(1);
    expect(registry.size).toBe(0);
  });

  it('retains failed ownership and reports every close failure', async () => {
    const registry = new SessionRegistry<{ id: string }>({
      disposeAttachment: () => { throw new Error('transport close failed'); },
    });
    registry.create('s1', () => ({ id: 'attachment' }));

    await expect(registry.closeAll()).rejects.toThrow('MCP sessions failed to close');
    expect(registry.size).toBe(1);
  });

  it('runs one monotonic sweeper task at a time and observes its rejection', async () => {
    vi.useFakeTimers();
    try {
      let clock = 100;
      const failures: unknown[] = [];
      const registry = new SessionRegistry<{ id: string }>({
        idleTtlMs: 10,
        now: () => clock,
        disposeAttachment: () => { throw new Error('cleanup failed'); },
        onBackgroundError: (error) => failures.push(error),
      });
      registry.create('s1', () => ({ id: 'attachment' }));
      registry.startIdleSweeper(5);
      clock = 111;

      await vi.advanceTimersByTimeAsync(5);
      expect(failures).toHaveLength(1);
      expect(registry.size).toBe(1);
      registry.stopIdleSweeper();
    } finally {
      vi.useRealTimers();
    }
  });
});
