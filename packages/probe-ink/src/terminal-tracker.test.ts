import { describe, expect, it, vi } from 'vitest';
import { ShadowWriteQueue } from './terminal-tracker.js';

describe('Ink shadow terminal write queue', () => {
  it('retains the first parser failure and never resumes on later bytes', async () => {
    const writes: string[] = [];
    const queue = new ShadowWriteQueue();
    queue.enqueue(async () => {
      writes.push('first');
      throw new Error('shadow parser failed');
    });
    const ignored = vi.fn(async () => { writes.push('second'); });
    queue.enqueue(ignored);

    await expect(queue.drain()).rejects.toThrow('shadow parser failed');
    expect(writes).toEqual(['first']);
    expect(ignored).not.toHaveBeenCalled();
    await expect(queue.drain()).rejects.toThrow('shadow parser failed');
  });
});
