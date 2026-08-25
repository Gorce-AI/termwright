import { describe, expect, it } from 'vitest';
import { composeTagExpressions } from './plugin.js';

/**
 * A project's tag filter and a command line's are both restrictions, so a run
 * asked for both means both. The parenthesising is the part that is easy to
 * get wrong: tag expressions contain `or`, and joining two of them with a bare
 * `and` silently rewrites what one of the authors asked for.
 */
describe('composing tag expressions', () => {
  it('keeps a single expression as written', () => {
    expect(composeTagExpressions('@smoke', undefined)).toBe('@smoke');
    expect(composeTagExpressions(undefined, '@smoke')).toBe('@smoke');
  });

  it('is undefined when neither side asks for anything', () => {
    expect(composeTagExpressions(undefined, undefined)).toBeUndefined();
    expect(composeTagExpressions('', '   ')).toBeUndefined();
  });

  it('requires both when both are given', () => {
    expect(composeTagExpressions('@component', 'not @slow')).toBe('(@component) and (not @slow)');
  });

  it('parenthesises so an or on either side keeps its meaning', () => {
    // '@a or @b and not @slow' would bind as '@a or (@b and not @slow)',
    // which selects @a scenarios the command line asked to exclude.
    expect(composeTagExpressions('@a or @b', 'not @slow')).toBe('(@a or @b) and (not @slow)');
    expect(composeTagExpressions('@fast', '@x or @y')).toBe('(@fast) and (@x or @y)');
  });

  it('ignores an empty side rather than composing with nothing', () => {
    expect(composeTagExpressions('@only', '')).toBe('@only');
    expect(composeTagExpressions('   ', '@only')).toBe('@only');
  });

  it('trims, so a shell-quoted argument does not change the expression', () => {
    expect(composeTagExpressions('  @a  ', '  @b  ')).toBe('(@a) and (@b)');
  });
});
