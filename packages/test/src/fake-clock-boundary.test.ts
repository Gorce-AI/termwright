import { describe, expect, it, vi } from 'vitest';

/**
 * A test that installs fake timers restores them in its own teardown, and a
 * timeout is precisely the case that never reaches it: the body is abandoned
 * where it stands. The hijacked clock is a process global, so without the
 * host putting it back, two things break that have nothing to do with the
 * offending test — its own authoritative finalizer is timed by a clock that
 * reads backwards, and the next attempt in that worker inherits it.
 *
 * Both cost real Windows failures before the runner restored the clock at the
 * boundaries it owns. The first test here leaves the clock faked on purpose.
 */
describe('a leaked fake clock', () => {
  it('does not stop its own attempt from closing', () => {
    vi.useFakeTimers();
    expect(vi.isFakeTimers()).toBe(true);
  });

  it('is gone by the time the next attempt starts', () => {
    expect(vi.isFakeTimers()).toBe(false);
  });
});
