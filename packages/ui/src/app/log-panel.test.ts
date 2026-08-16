import { describe, expect, it } from 'vitest';
import { summarise } from './log-panel.js';

describe('summarise', () => {
  it('reads as a sentence, worst level first', () => {
    expect(summarise({ warn: 1, error: 2 })).toBe('2 errors, 1 warning');
    expect(summarise({ fatal: 1, info: 3 })).toBe('1 fatal, 3 infos');
  });

  it('says nothing when nothing was levelled', () => {
    expect(summarise({})).toBe('');
  });
});
