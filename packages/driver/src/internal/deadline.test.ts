import { describe, expect, it } from 'vitest';
import { Deadline, type MonotonicClock } from './deadline.js';

describe('Deadline', () => {
  it('shares one absolute budget across phases', () => {
    let now = 10;
    const clock: MonotonicClock = { now: () => now };
    const deadline = Deadline.after(50, clock);

    now = 35;
    expect(deadline.remaining()).toBe(25);
    expect(deadline.cap(100)).toBe(60);
    expect(deadline.expired()).toBe(false);

    now = 60;
    expect(deadline.remaining()).toBe(0);
    expect(deadline.expired()).toBe(true);
  });
});
