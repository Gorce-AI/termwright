import { describe, expect, it } from 'vitest';
import { WatchStore } from './watchers.js';

describe('durable MCP watchers', () => {
  it('buffers a match after the receiving MCP request is cancelled', async () => {
    const store = new WatchStore();
    let resolveOperation!: () => void;
    let revision = 4;
    const id = store.start(
      't1',
      revision,
      () => revision,
      async () => {
        await new Promise<void>((resolve) => {
          resolveOperation = resolve;
        });
        return {};
      },
    );

    const request = new AbortController();
    const firstWait = store.wait(id, request.signal);
    request.abort(new DOMException('transport timeout', 'AbortError'));
    await expect(firstWait).rejects.toThrow('transport timeout');

    revision = 7;
    resolveOperation();
    await expect(store.wait(id)).resolves.toEqual({
      status: 'matched',
      terminal: 't1',
      startRevision: 4,
      revision: 7,
    });
  });

  it('cancels every watcher owned by a closing terminal', async () => {
    const store = new WatchStore();
    const id = store.start(
      't1',
      1,
      () => 1,
      async (signal) => {
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
        );
        return {};
      },
    );
    const waiting = store.wait(id);
    store.cancelTerminal('t1');
    await expect(waiting).resolves.toMatchObject({ status: 'failed', terminal: 't1' });
    expect(store.list()).toEqual([]);
  });
});
