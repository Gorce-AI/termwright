import { describe, expect, it } from 'vitest';
import { roleForInkAria, roleForInkHost } from './ink.js';

describe('roleForInkHost', () => {
  it('maps only Ink host kinds with intrinsic meaning', () => {
    expect(roleForInkHost('ink-root')).toBe('application');
    expect(roleForInkHost('ink-text')).toBe('text');
    expect(roleForInkHost('ink-virtual-text')).toBe('text');
    expect(roleForInkHost('ink-box')).toBe('generic');
  });

  it('does not invent source-component provenance', () => {
    expect(roleForInkHost('ApproveButton')).toBeUndefined();
  });
});

describe('roleForInkAria', () => {
  it('normalizes Ink roles that differ from the protocol vocabulary', () => {
    expect(roleForInkAria('listbox')).toBe('list');
    expect(roleForInkAria('option')).toBe('listitem');
    expect(roleForInkAria('timer')).toBe('status');
  });

  it('keeps ambiguous roles generic and rejects unknown ones', () => {
    expect(roleForInkAria('combobox')).toBe('generic');
    expect(roleForInkAria('toolbar')).toBe('generic');
    expect(roleForInkAria('made-up')).toBeUndefined();
  });
});
