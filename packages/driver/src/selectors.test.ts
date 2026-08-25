import { describe, expect, it } from 'vitest';
import { matchesText, parseRef, parseSelector, textMatcher } from './selectors.js';

describe('locator refs', () => {
  it('requires and preserves an explicit locator domain', () => {
    expect(parseRef('semantic:save@7')).toEqual({ kind: 'node', nodeId: 'save', revision: 7 });
    expect(parseRef('screen:2,4,6,1@9')).toEqual({
      kind: 'rect', rect: { row: 2, column: 4, width: 6, height: 1 }, revision: 9,
    });
    expect(parseRef('save@7')).toBeNull();
    expect(parseRef('grid:2,4,6,1@9')).toBeNull();
  });
});

describe('parseSelector', () => {
  it('parses a role', () => {
    const query = parseSelector('button');
    expect(query.steps).toHaveLength(1);
    expect(query.steps[0]?.role).toBe('button');
  });

  it('parses a descendant chain with classes, ids and pseudo-classes', () => {
    const query = parseSelector('dialog button.primary:focused');
    expect(query.steps).toHaveLength(2);
    expect(query.steps[0]?.role).toBe('dialog');
    const last = query.steps[1];
    expect(last?.role).toBe('button');
    expect(last?.classes).toEqual(['primary']);
    expect(last?.state).toEqual({ focused: true });
  });

  it('parses #testId on its own', () => {
    const query = parseSelector('#confirm');
    expect(query.steps[0]?.testId).toBe('confirm');
    expect(query.steps[0]?.role).toBeUndefined();
  });

  it('collects several pseudo-classes', () => {
    const query = parseSelector('checkbox:checked:disabled');
    expect(query.steps[0]?.state).toEqual({ checked: true, disabled: true });
  });

  it('rejects unknown roles, unknown pseudo-classes and stray characters', () => {
    for (const selector of ['widget', 'button:glowing', 'button[name=x]', '']) {
      expect(() => parseSelector(selector), selector).toThrow(TypeError);
    }
  });

  it('rejects two roles or two ids in one compound selector', () => {
    expect(() => parseSelector('#a#b')).toThrow(TypeError);
  });
});

describe('matchesText', () => {
  it('matches substrings case-insensitively by default', () => {
    expect(matchesText('Approve all', textMatcher('approve'))).toBe(true);
    expect(matchesText('Approve all', textMatcher('approve', true))).toBe(false);
  });

  it('matches exactly after trimming', () => {
    expect(matchesText('  Approve  ', textMatcher('Approve', true))).toBe(true);
  });

  it('matches regular expressions without leaking lastIndex', () => {
    const matcher = textMatcher(/issues \d+/giu);
    expect(matchesText('Issues 42', matcher)).toBe(true);
    expect(matchesText('Issues 42', matcher)).toBe(true);
  });

  it('never matches a missing value', () => {
    expect(matchesText(undefined, textMatcher('x'))).toBe(false);
  });
});
