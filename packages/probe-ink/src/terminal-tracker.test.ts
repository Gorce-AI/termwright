import { EventEmitter } from 'node:events';
import { closeSync, mkdtempSync, openSync, rmSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { ShadowWriteQueue, trackTerminal } from './terminal-tracker.js';

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

describe('Ink terminal stream observation boundary', () => {
  it('does not treat direct descriptor/native or descendant writes as observed stream bytes', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'termwright-ink-stream-boundary-'));
    const path = join(directory, 'terminal-output');
    const descriptor = openSync(path, 'w');
    const stream = Object.assign(new EventEmitter(), {
      columns: 80,
      rows: 24,
      isTTY: false,
      write(chunk: string | Uint8Array) {
        if (typeof chunk === 'string') writeSync(descriptor, chunk);
        else writeSync(descriptor, chunk);
        return true;
      },
    }) as unknown as NodeJS.WriteStream;
    const tracker = trackTerminal(stream, stream);
    try {
      // The wrapped JS method is visible to the shadow.
      stream.write('\u001b[?1002h\u001b[?1006h\u001b[?1004hABC');
      await tracker.drain();
      expect(tracker.position().column).toBe(3);
      stream.write('\r');
      await tracker.drain();
      expect(tracker.position().column).toBe(0);

      // fs.writeSync reaches the same native descriptor boundary an addon can
      // use, without calling the patched JavaScript stream method.
      writeSync(descriptor, '\u001b[?1002h\u001b[?1006h\u001b[?1004hABC');
      await tracker.drain();
      expect(tracker.position().column).toBe(0);

      // A descendant inheriting stdout is equally opaque to the parent's
      // stream wrapper even though its bytes reach the same terminal output.
      const encodedModes = Buffer.from('\u001b[?1002h\u001b[?1006h\u001b[?1004hDEF').toString('base64');
      const child = spawnSync(process.execPath, [
        '-e',
        `process.stdout.write(Buffer.from(${JSON.stringify(encodedModes)}, 'base64'))`,
      ], { stdio: ['ignore', descriptor, 'ignore'] });
      expect(child.status).toBe(0);
      await tracker.drain();
      expect(tracker.position().column).toBe(0);
    } finally {
      tracker.stop();
      closeSync(descriptor);
      rmSync(directory, { recursive: true });
    }
  });
});
