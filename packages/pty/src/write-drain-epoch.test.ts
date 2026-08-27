import { describe, expect, it, vi } from 'vitest';
import { NativeWriteDrainEpoch } from './write-drain-epoch.js';

describe('the shared native write/drain epoch', () => {
  it('publishes only the latest successfully admitted non-empty write', () => {
    const epoch = new NativeWriteDrainEpoch();
    const nativeWrite = vi.fn<(data: Uint8Array) => void>();

    epoch.admit(Uint8Array.of(0x61), nativeWrite);
    expect(epoch.isCurrent(1n)).toBe(true);

    epoch.admit(new Uint8Array(), nativeWrite);
    expect(epoch.isCurrent(1n)).toBe(true);

    expect(() =>
      epoch.admit(Uint8Array.of(0x78), () => {
        throw new Error('native queue rejected write');
      }),
    ).toThrow('native queue rejected write');
    expect(epoch.isCurrent(1n)).toBe(true);

    epoch.admit(Uint8Array.of(0x62), nativeWrite);
    expect(epoch.isCurrent(1n)).toBe(false);
    expect(epoch.isCurrent(2n)).toBe(true);
    expect(nativeWrite).toHaveBeenCalledTimes(3);
  });
});
