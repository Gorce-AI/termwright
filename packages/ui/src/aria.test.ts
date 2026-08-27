import { describe, expect, it } from 'vitest';
import { SEMANTIC_ROLES } from '@termwright/protocol';
import { ariaElementFor, ariaTextFor } from './aria.js';
import { node } from './__fixtures__/fake-session.js';

describe('ariaElementFor', () => {
  it('maps every protocol role to an element', () => {
    for (const role of SEMANTIC_ROLES) {
      const element = ariaElementFor(node({ id: 'n1', role }));
      expect(element.tag, role).toBeTruthy();
    }
  });

  it('uses native elements where one exists', () => {
    expect(ariaElementFor(node({ id: 'n1', role: 'button' })).tag).toBe('button');
    expect(ariaElementFor(node({ id: 'n1', role: 'list' })).tag).toBe('ul');
    expect(ariaElementFor(node({ id: 'n1', role: 'listitem' })).tag).toBe('li');
    expect(ariaElementFor(node({ id: 'n1', role: 'heading' })).tag).toBe('h3');
    expect(ariaElementFor(node({ id: 'n1', role: 'table' })).tag).toBe('table');
  });

  it('does not repeat a role the tag already carries', () => {
    expect(ariaElementFor(node({ id: 'n1', role: 'button' })).role).toBeUndefined();
    expect(ariaElementFor(node({ id: 'n1', role: 'dialog' })).role).toBe('dialog');
  });

  it('carries the accessible name as the label', () => {
    expect(ariaElementFor(node({ id: 'n1', role: 'button', name: 'Save' })).label).toBe('Save');
    expect(ariaElementFor(node({ id: 'n1', role: 'button', name: '' })).label).toBeUndefined();
  });

  it('translates state that ARIA has an attribute for', () => {
    const element = ariaElementFor(
      node({
        id: 'n1',
        role: 'button',
        name: 'Save',
        state: { disabled: true, busy: true, expanded: false },
      }),
    );
    expect(element.attrs).toEqual({
      'aria-disabled': 'true',
      'aria-busy': 'true',
      'aria-expanded': 'false',
    });
  });

  it('marks a modal dialog as modal', () => {
    expect(
      ariaElementFor(node({ id: 'n1', role: 'dialog', name: 'Permission', state: { modal: true } }))
        .attrs['aria-modal'],
    ).toBe('true');
    // Only a dialog can be modal; the flag on anything else is dropped.
    expect(
      ariaElementFor(node({ id: 'n1', role: 'region', state: { modal: true } })).attrs[
        'aria-modal'
      ],
    ).toBeUndefined();
  });

  it('emits aria-checked only where checking means something', () => {
    expect(
      ariaElementFor(node({ id: 'n1', role: 'checkbox', state: { checked: 'mixed' } })).attrs,
    ).toEqual({
      'aria-checked': 'mixed',
    });
    expect(
      ariaElementFor(node({ id: 'n1', role: 'radio', state: { checked: true } })).attrs,
    ).toEqual({
      'aria-checked': 'true',
    });
    expect(
      ariaElementFor(node({ id: 'n1', role: 'button', state: { checked: true } })).attrs,
    ).toEqual({});
  });

  it('falls back from aria-selected to aria-current where ARIA would ignore it', () => {
    expect(
      ariaElementFor(node({ id: 'n1', role: 'tab', state: { selected: true } })).attrs,
    ).toEqual({
      'aria-selected': 'true',
    });
    expect(
      ariaElementFor(node({ id: 'n1', role: 'listitem', state: { selected: true } })).attrs,
    ).toEqual({
      'aria-current': 'true',
    });
    // Not selected and not selectable: nothing to say.
    expect(
      ariaElementFor(node({ id: 'n1', role: 'listitem', state: { selected: false } })).attrs,
    ).toEqual({});
  });

  it('gives a heading its level', () => {
    expect(
      ariaElementFor(node({ id: 'n1', role: 'heading', state: { level: 2 } })).attrs['aria-level'],
    ).toBe('2');
    expect(
      ariaElementFor(node({ id: 'n1', role: 'button', state: { level: 2 } })).attrs['aria-level'],
    ).toBeUndefined();
  });

  it('describes position in a set', () => {
    expect(
      ariaElementFor(node({ id: 'n1', role: 'listitem', state: { positionInSet: 2, setSize: 5 } }))
        .attrs,
    ).toEqual({ 'aria-posinset': '2', 'aria-setsize': '5' });
  });

  it('turns a scrollbar’s offsets into value bounds', () => {
    expect(
      ariaElementFor(
        node({
          id: 'n1',
          role: 'scrollbar',
          state: { orientation: 'vertical' },
          scroll: {
            status: 'known',
            value: { axis: 'vertical', offset: 3, viewport: 4, extent: 20 },
            evidence: {
              source: 'application',
              method: 'native',
              strength: 'authoritative',
              providerId: 'app.scroll',
            },
          },
        }),
      ).attrs,
    ).toEqual({
      'aria-orientation': 'vertical',
      'aria-valuemin': '0',
      'aria-valuemax': '20',
      'aria-valuenow': '3',
    });
  });

  it('reads a progressbar’s value as a number when it is one', () => {
    expect(
      ariaElementFor(node({ id: 'n1', role: 'progressbar', value: '42' })).attrs['aria-valuenow'],
    ).toBe('42');
    expect(
      ariaElementFor(node({ id: 'n1', role: 'progressbar', value: 'almost' })).attrs[
        'aria-valuetext'
      ],
    ).toBe('almost');
  });

  it('passes a description through', () => {
    expect(
      ariaElementFor(
        node({ id: 'n1', role: 'button', name: 'Save', description: 'writes the file' }),
      ).attrs['aria-description'],
    ).toBe('writes the file');
  });
});

describe('ariaTextFor', () => {
  it('renders text and textbox content, since that is their meaning', () => {
    expect(ariaTextFor(node({ id: 'n1', role: 'text', value: 'running: ls -la' }))).toBe(
      'running: ls -la',
    );
    expect(ariaTextFor(node({ id: 'n1', role: 'textbox', value: 'draft' }))).toBe('draft');
  });

  it('does not repeat a name that the label already announces', () => {
    expect(ariaTextFor(node({ id: 'n1', role: 'button', name: 'Save' }))).toBe('');
  });
});
