import { describe, expect, it } from 'vitest';
import { assertExactCorpusCoverage, observedGapIds } from './unicode-certification.mjs';

const sample = (id, overrides = {}) => ({
  id,
  correct: true,
  markerColumn: 1,
  cursor: { x: 2, y: 0 },
  cells: [
    { column: 0, width: 1, continuation: false },
    { column: 1, width: 1, continuation: false },
  ],
  ...overrides,
});

describe('Unicode differential certification', () => {
  it('rejects missing, duplicate and reordered corpus cases', () => {
    const expected = ['a', 'b'];
    expect(() =>
      assertExactCorpusCoverage([{ engine: 'x', cases: [sample('a')] }], expected),
    ).toThrow(/coverage/u);
    expect(() =>
      assertExactCorpusCoverage([{ engine: 'x', cases: [sample('a'), sample('a')] }], expected),
    ).toThrow(/coverage/u);
    expect(() =>
      assertExactCorpusCoverage([{ engine: 'x', cases: [sample('b'), sample('a')] }], expected),
    ).toThrow(/coverage/u);
  });

  it('treats cursor and continuation topology drift as conformance gaps', () => {
    const canonical = { engine: 'termwright', cases: [sample('a'), sample('b')] };
    const candidate = {
      engine: 'candidate',
      cases: [
        sample('a', { cursor: { x: 3, y: 0 } }),
        sample('b', {
          cells: [
            { column: 0, width: 2, continuation: false },
            { column: 1, width: 0, continuation: true },
          ],
        }),
      ],
    };
    expect(observedGapIds(candidate, canonical)).toEqual(['a', 'b']);
  });

  it('rejects malformed geometry instead of omitting it from comparison', () => {
    expect(() =>
      assertExactCorpusCoverage(
        [{ engine: 'x', cases: [sample('a', { cursor: undefined })] }],
        ['a'],
      ),
    ).toThrow(/geometry/u);
  });
});
