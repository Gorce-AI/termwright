import { describe, expect, it, vi } from 'vitest';
import { ShellCommandTracker } from './shell.js';

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

describe('ShellCommandTracker', () => {
  it('captures only output between chunked OSC 133 command markers', async () => {
    const tracker = new ShellCommandTracker();
    const result = tracker.arm('build', 1_000);

    tracker.feed(bytes('prompt $ build\r\n\u001b]13'));
    tracker.feed(bytes('3;C\u0007building\r\n'));
    tracker.feed(bytes('done\r\n\u001b]133;D;0\u001b\\prompt $ '));

    await expect(result).resolves.toEqual({
      command: 'build',
      output: 'building\r\ndone\r\n',
      exitCode: 0,
    });
  });

  it('accepts BEL terminators and an absent exit code', async () => {
    const tracker = new ShellCommandTracker();
    const result = tracker.arm('status', 1_000);
    tracker.feed(bytes('\u001b]133;C\u0007ok\u001b]133;D\u0007'));
    await expect(result).resolves.toMatchObject({ output: 'ok', exitCode: null });
  });

  it('bounds command output', async () => {
    const tracker = new ShellCommandTracker();
    const result = tracker.arm('large', 1_000, 3);
    tracker.feed(bytes('\u001b]133;C\u0007four'));
    await expect(result).rejects.toThrow('exceeded 3 bytes');
  });

  it('times out and can be reused', async () => {
    vi.useFakeTimers();
    try {
      const tracker = new ShellCommandTracker();
      const timedOut = tracker.arm('slow', 25);
      const assertion = expect(timedOut).rejects.toThrow('within 25 ms');
      await vi.advanceTimersByTimeAsync(25);
      await assertion;

      const next = tracker.arm('next', 25);
      tracker.feed(bytes('\u001b]133;C\u0007yes\u001b]133;D;2\u0007'));
      await expect(next).resolves.toMatchObject({ output: 'yes', exitCode: 2 });
    } finally {
      vi.useRealTimers();
    }
  });
});
