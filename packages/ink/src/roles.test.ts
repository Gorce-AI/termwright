import { describe, expect, it } from 'vitest';
import { SEMANTIC_ACTIONS, SEMANTIC_ROLES } from '@termwright/protocol';
import { defaultActionsForRole, mapInkAriaRole } from './roles.js';

describe('mapInkAriaRole', () => {
  it('maps Ink roles that have an exact counterpart', () => {
    expect(mapInkAriaRole('button')).toBe('button');
    expect(mapInkAriaRole('listitem')).toBe('listitem');
    expect(mapInkAriaRole('progressbar')).toBe('progressbar');
  });

  it('maps close relatives onto the protocol vocabulary', () => {
    expect(mapInkAriaRole('listbox')).toBe('list');
    expect(mapInkAriaRole('option')).toBe('listitem');
    expect(mapInkAriaRole('timer')).toBe('status');
  });

  it('degrades ambiguous roles to generic rather than guessing', () => {
    expect(mapInkAriaRole('combobox')).toBe('generic');
    expect(mapInkAriaRole('radiogroup')).toBe('generic');
    expect(mapInkAriaRole('tablist')).toBe('generic');
    expect(mapInkAriaRole('toolbar')).toBe('generic');
  });

  it('returns nothing for absent or unknown input', () => {
    expect(mapInkAriaRole(undefined)).toBeUndefined();
    expect(mapInkAriaRole('marquee')).toBeUndefined();
    expect(mapInkAriaRole('constructor')).toBeUndefined();
  });

  it('only ever produces roles from the closed protocol set', () => {
    const inkRoles = [
      'button',
      'checkbox',
      'combobox',
      'list',
      'listbox',
      'listitem',
      'menu',
      'menuitem',
      'option',
      'progressbar',
      'radio',
      'radiogroup',
      'tab',
      'tablist',
      'table',
      'textbox',
      'timer',
      'toolbar',
    ];
    for (const role of inkRoles) {
      expect(SEMANTIC_ROLES).toContain(mapInkAriaRole(role));
    }
  });
});

describe('defaultActionsForRole', () => {
  it('implies the obvious interactions', () => {
    expect(defaultActionsForRole('button')).toEqual(['activate', 'focus']);
    expect(defaultActionsForRole('checkbox')).toEqual(['toggle', 'focus']);
  });

  it('implies nothing for passive roles', () => {
    expect(defaultActionsForRole('text')).toBeUndefined();
    expect(defaultActionsForRole('generic')).toBeUndefined();
    expect(defaultActionsForRole('application')).toBeUndefined();
  });

  it('only ever produces actions from the closed protocol set', () => {
    for (const role of SEMANTIC_ROLES) {
      for (const action of defaultActionsForRole(role) ?? []) {
        expect(SEMANTIC_ACTIONS).toContain(action);
      }
    }
  });
});
