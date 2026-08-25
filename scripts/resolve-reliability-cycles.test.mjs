import { describe, expect, it } from 'vitest';
import {
  MAXIMUM_CERTIFIED_CYCLES,
  MINIMUM_CERTIFIED_CYCLES,
  resolveReliabilityCycles,
} from './resolve-reliability-cycles.mjs';

describe('reliability certification cycle count', () => {
  it('uses the certifying minimum for a scheduled run without an input', () => {
    expect(resolveReliabilityCycles()).toBe(String(MINIMUM_CERTIFIED_CYCLES));
    expect(resolveReliabilityCycles('')).toBe(String(MINIMUM_CERTIFIED_CYCLES));
  });

  it('accepts the closed certifying range', () => {
    expect(resolveReliabilityCycles('250')).toBe('250');
    expect(resolveReliabilityCycles('10000')).toBe(String(MAXIMUM_CERTIFIED_CYCLES));
  });

  it.each(['249', '10001', '0', '-250', '0250', '250.0', 'abc'])(
    'rejects non-certifying input %s',
    (value) => expect(() => resolveReliabilityCycles(value)).toThrow(/certifying cycles/u),
  );
});
