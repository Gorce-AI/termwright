import { describe, expect, it, vi } from 'vitest';
import { NativeTurnWriteQueue } from './native-turn-write-queue.js';

describe('NativeTurnWriteQueue', () => {
  it('waits past the microtask checkpoint and preserves response order', async () => {
    const writes: string[] = [];
    const queue = new NativeTurnWriteQueue(
      (data) => writes.push(data.toString('utf8')),
      (error) => {
        throw error;
      },
    );

    queue.enqueue(Buffer.from('first'));
    queue.enqueue(Buffer.from('second'));
    await Promise.resolve();
    expect(writes).toEqual([]);

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(writes).toEqual(['first', 'second']);
    queue.close();
  });

  it('owns queued bytes and rejects memory beyond its bound', async () => {
    const writes: Buffer[] = [];
    const queue = new NativeTurnWriteQueue((data) => writes.push(data), vi.fn(), 4);
    const source = Buffer.from('abc');
    queue.enqueue(source);
    source.fill(0x78);
    expect(() => queue.enqueue(Buffer.from('de'))).toThrow(/capacity exceeded/u);

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(writes).toEqual([Buffer.from('abc')]);
    queue.close();
  });

  it('reports an asynchronous native rejection once and drops later responses', async () => {
    const failure = new Error('native input closed');
    const onError = vi.fn();
    const write = vi.fn(() => {
      throw failure;
    });
    const queue = new NativeTurnWriteQueue(write, onError);
    queue.enqueue(Buffer.from('first'));
    queue.enqueue(Buffer.from('second'));

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(write).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(failure);
    queue.close();
  });
});
