import { describe, expect, it, vi } from 'vitest';
import { bunTestCapability } from './bun-runtime.mjs';

describe('Bun test capability policy', () => {
  it('permits a deliberate local skip without probing the runtime', () => {
    const probe = vi.fn();
    expect(bunTestCapability(probe, { TERMWRIGHT_SKIP_BUN: '1' })).toBe(false);
    expect(probe).not.toHaveBeenCalled();
  });

  it('rejects a skip or unavailable runtime when certification requires Bun', () => {
    expect(() => bunTestCapability(() => true, {
      TERMWRIGHT_SKIP_BUN: '1',
      TERMWRIGHT_REQUIRE_BUN: '1',
    })).toThrow(/conflicts with required Bun certification/u);
    expect(() => bunTestCapability(() => false, {
      TERMWRIGHT_REQUIRE_BUN: '1',
    })).toThrow(/Bun runtime is unavailable/u);
  });

  it('preserves a required probe failure as the cause', () => {
    const failure = new Error('spawn failed');
    expect(() => bunTestCapability(() => { throw failure; }, {
      TERMWRIGHT_REQUIRE_BUN: '1',
    })).toThrow(expect.objectContaining({ message: 'Bun runtime is unavailable', cause: failure }));
  });

  it('maps a local probe failure to an unavailable capability', () => {
    expect(bunTestCapability(() => { throw new Error('missing'); }, {})).toBe(false);
  });
});
