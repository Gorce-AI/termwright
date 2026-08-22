import { describe, expect, it } from 'vitest';
import {
  EarlyPtyOutput,
  EarlyPtyOutputOverflowError,
  MAX_EARLY_PTY_OUTPUT_BYTES,
} from './early-pty-output.js';

describe('EarlyPtyOutput', () => {
  it('replays every byte in backend order below the bound', () => {
    const output = new EarlyPtyOutput();
    output.push(Uint8Array.from([0, 1, 2]));
    output.push(Uint8Array.from([255, 3]));
    const replayed: number[] = [];

    output.drain((chunk) => replayed.push(...chunk));

    expect(replayed).toEqual([0, 1, 2, 255, 3]);
    const second: Uint8Array[] = [];
    output.drain((chunk) => second.push(chunk));
    expect(second).toEqual([]);
  });

  it('fails closed instead of retaining or truncating an unbounded pre-subscription stream', () => {
    const output = new EarlyPtyOutput();
    output.push(new Uint8Array(MAX_EARLY_PTY_OUTPUT_BYTES));
    output.push(Uint8Array.of(1));
    output.push(new Uint8Array(MAX_EARLY_PTY_OUTPUT_BYTES));

    expect(() => output.drain(() => undefined)).toThrow(EarlyPtyOutputOverflowError);
    try {
      output.drain(() => undefined);
      throw new Error('expected overflow');
    } catch (error) {
      expect(error).toMatchObject({ observedBytes: MAX_EARLY_PTY_OUTPUT_BYTES + 1 });
    }
  });
});
