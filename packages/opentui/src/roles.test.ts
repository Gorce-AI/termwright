import { describe, expect, it } from 'vitest';
import { SEMANTIC_ROLES } from '@termwright/protocol';
import { asSemanticRole, defaultActionsFor, mapRenderableClass } from './roles.js';

describe('mapRenderableClass', () => {
  it('maps the text-bearing and editable widgets', () => {
    expect(mapRenderableClass('TextRenderable')).toBe('text');
    expect(mapRenderableClass('InputRenderable')).toBe('textbox');
    expect(mapRenderableClass('TextareaRenderable')).toBe('textbox');
    expect(mapRenderableClass('SelectRenderable')).toBe('list');
    expect(mapRenderableClass('TextTableRenderable')).toBe('table');
  });

  it('leaves a layout box unmapped rather than guessing at a region', () => {
    expect(mapRenderableClass('BoxRenderable')).toBeUndefined();
    expect(mapRenderableClass(undefined)).toBeUndefined();
    expect(mapRenderableClass('SomethingNobodyHasWrittenYet')).toBeUndefined();
  });

  it('only ever yields roles the protocol defines', () => {
    for (const name of ['TextRenderable', 'InputRenderable', 'SelectRenderable', 'ScrollBarRenderable']) {
      const role = mapRenderableClass(name);
      expect(role === undefined || SEMANTIC_ROLES.includes(role)).toBe(true);
    }
  });

  it('resists prototype-pollution style lookups', () => {
    expect(mapRenderableClass('toString')).toBeUndefined();
    expect(mapRenderableClass('constructor')).toBeUndefined();
    expect(mapRenderableClass('__proto__')).toBeUndefined();
  });
});

describe('asSemanticRole', () => {
  it('accepts a protocol role and rejects everything else', () => {
    expect(asSemanticRole('button')).toBe('button');
    expect(asSemanticRole('widget')).toBeUndefined();
    expect(asSemanticRole(7)).toBeUndefined();
    expect(asSemanticRole(undefined)).toBeUndefined();
  });
});

describe('defaultActionsFor', () => {
  it('derives actions from the role', () => {
    expect(defaultActionsFor('button', false)).toEqual(['activate', 'focus']);
    expect(defaultActionsFor('textbox', false)).toEqual(['setValue', 'focus']);
  });

  it("falls back to OpenTUI's own focusable flag", () => {
    expect(defaultActionsFor('generic', true)).toEqual(['focus']);
    expect(defaultActionsFor('generic', false)).toBeUndefined();
  });
});
