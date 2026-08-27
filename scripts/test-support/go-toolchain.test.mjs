import { describe, expect, it, vi } from 'vitest';
import { goTestCapability } from './go-toolchain.mjs';

describe('Go test capability policy', () => {
  it('permits a deliberate local skip without running the probe', async () => {
    const probe = vi.fn();
    await expect(
      goTestCapability(probe, null, 'Go', { TERMWRIGHT_SKIP_GO: '1' }),
    ).resolves.toBeNull();
    expect(probe).not.toHaveBeenCalled();
  });

  it('rejects a skip or failed probe when certification requires Go', async () => {
    const failure = new Error('missing');
    await expect(
      goTestCapability(async () => true, false, 'Go', {
        TERMWRIGHT_SKIP_GO: '1',
        TERMWRIGHT_REQUIRE_GO: '1',
      }),
    ).rejects.toThrow(/conflicts with required Go certification/u);
    await expect(
      goTestCapability(
        async () => {
          throw failure;
        },
        false,
        'Go toolchain',
        {
          TERMWRIGHT_REQUIRE_GO: '1',
        },
      ),
    ).rejects.toMatchObject({ message: 'Go toolchain is unavailable', cause: failure });
  });

  it('maps a local probe failure to the caller-defined unavailable value', async () => {
    await expect(
      goTestCapability(
        async () => {
          throw new Error('missing');
        },
        false,
        'Go',
        {},
      ),
    ).resolves.toBe(false);
  });
});
