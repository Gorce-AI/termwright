import { describe, expect, it } from 'vitest';
import { editorChoices, editorLink } from './editor-link.js';

describe('opening a spec in an editor', () => {
  it('builds the link each editor understands', () => {
    expect(editorLink('vscode', '/repo/src/login.test.ts', 42)).toBe(
      'vscode://file/repo/src/login.test.ts:42',
    );
    expect(editorLink('zed', '/repo/a.test.ts')).toBe('zed://file/repo/a.test.ts');
    // JetBrains takes the line as part of a query parameter, not as a suffix.
    expect(editorLink('webstorm', '/repo/a.test.ts', 7)).toContain('navigate/reference?path=');
    expect(editorLink('webstorm', '/repo/a.test.ts', 7)).toContain('%3A7');
  });

  it('makes the path absolute, because a relative one opens nothing', () => {
    expect(editorLink('vscode', 'src/a.test.ts')).toBe('vscode://file/src/a.test.ts');
  });

  it('offers no link when the choice is to copy the path', () => {
    expect(editorLink('none', '/repo/a.test.ts')).toBeNull();
  });

  it('offers no link for a test whose producer reported no file', () => {
    expect(editorLink('vscode', '')).toBeNull();
  });

  it('names every choice it offers', () => {
    const choices = editorChoices();
    expect(choices.map((choice) => choice.id)).toContain('cursor');
    expect(choices.every((choice) => choice.label !== '')).toBe(true);
  });
});
