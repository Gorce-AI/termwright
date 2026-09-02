import { expect, test } from 'vitest';
import { observation } from './unicode-load-probe.mjs';

test('loads a deterministic grapheme provider with correct ZWJ geometry', () => {
  expect(observation.widths.familyZwj).toBe(2);
  expect(observation.widths.skinTone).toBe(2);
  expect(observation.widths.flag).toBe(2);
});
