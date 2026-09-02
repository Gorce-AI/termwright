import { describe, expect, it } from 'vitest';
import { BoundedRing } from './bounded-ring.js';

describe('BoundedRing', () => {
  it('retains FIFO order across repeated wrap-around without shifting storage', () => {
    const ring = new BoundedRing<number>(3);
    for (let value = 0; value < 10; value += 1) ring.push(value);
    expect(ring.size).toBe(3);
    expect(ring.toArray()).toEqual([7, 8, 9]);
    expect(ring.tail(2)).toEqual([8, 9]);
    expect(ring.tail(20)).toEqual([7, 8, 9]);
  });

  it('rejects invalid capacities and tail limits', () => {
    expect(() => new BoundedRing(0)).toThrow(/positive safe integer/u);
    const ring = new BoundedRing<number>(1);
    expect(() => ring.tail(-1)).toThrow(/non-negative safe integer/u);
  });
});
