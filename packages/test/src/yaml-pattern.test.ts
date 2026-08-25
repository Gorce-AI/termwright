import { describe, expect, it } from 'vitest';
import { permissionDialog } from './__fixtures__/tree.js';
import { parseNodeHead, parseSemanticSnapshot } from './yaml-pattern.js';
import { serializeSemanticSnapshot } from './yaml-serialize.js';

describe('parseSemanticSnapshot', () => {
  it('parses the contract example, nesting and all', () => {
    const patterns = parseSemanticSnapshot(`
      - dialog "Permission" [modal]:
          - text "Allow bash to run?"
          - button "Approve" [focused]
          - button /Rej/
    `);
    expect(patterns).toHaveLength(1);
    const dialog = patterns[0];
    expect(dialog?.role).toBe('dialog');
    expect(dialog?.name?.test('Permission')).toBe(true);
    expect(dialog?.flags.map((flag) => flag.key)).toEqual(['modal']);
    expect(dialog?.children).toHaveLength(3);
    expect(dialog?.children?.[2]?.name?.kind).toBe('regex');
    expect(dialog?.children?.[2]?.name?.test('Reject')).toBe(true);
    expect(dialog?.children?.[2]?.name?.test('Approve')).toBe(false);
  });

  it('treats a head without children as unconstrained, not as childless', () => {
    const [pattern] = parseSemanticSnapshot('- dialog "Permission"');
    expect(pattern?.children).toBeUndefined();
  });

  it('reads an empty document as an empty pattern list', () => {
    expect(parseSemanticSnapshot('')).toEqual([]);
    expect(parseSemanticSnapshot('   \n')).toEqual([]);
  });

  it('accepts an omitted name and the quoted wildcard role', () => {
    const [any, button] = parseSemanticSnapshot([`- '* "Save"'`, '- button'].join('\n'));
    expect(any?.role).toBe('*');
    expect(any?.name?.test('Save')).toBe(true);
    expect(button?.name).toBeUndefined();
  });

  it('explains that a bare * is a YAML alias, not a wildcard', () => {
    expect(() => parseSemanticSnapshot('- *')).toThrow(/invalid semantic snapshot/u);
  });

  it('parses flags with values and negation', () => {
    const pattern = parseNodeHead('checkbox "All" [checked=mixed,!disabled,focused]');
    expect(pattern.flags).toEqual([
      { key: 'checked', negated: false, value: 'mixed', source: 'checked=mixed' },
      { key: 'disabled', negated: true, source: '!disabled' },
      { key: 'focused', negated: false, source: 'focused' },
    ]);
  });

  it('round-trips whatever the serializer produced', () => {
    const text = serializeSemanticSnapshot(permissionDialog());
    const patterns = parseSemanticSnapshot(text);
    expect(patterns[0]?.children?.map((child) => child.head)).toEqual([
      'text "Allow bash to run?"',
      'button "Approve" [focused]',
      'button "Reject"',
    ]);
  });

  it('round-trips a name that needed quoting', () => {
    const text = serializeSemanticSnapshot(
      {
        ...permissionDialog(),
        nodes: [{
          id: 'n1',
          role: 'heading',
          name: 'Issue #12',
          geometry: {
            displayed: { status: 'unknown', reason: 'awaiting-revision-pair' },
            intendedRect: { status: 'unknown', reason: 'awaiting-revision-pair' },
            visibleRect: { status: 'unknown', reason: 'awaiting-revision-pair' },
          },
        }],
        rootIds: ['n1'],
      },
    );
    const [pattern] = parseSemanticSnapshot(text);
    expect(pattern?.name?.test('Issue #12')).toBe(true);
  });

  it('rejects an unknown role', () => {
    expect(() => parseSemanticSnapshot('- widget "X"')).toThrow(/unknown role "widget"/u);
  });

  it('rejects an unknown state flag', () => {
    expect(() => parseSemanticSnapshot('- button "X" [glowing]')).toThrow(/unknown state flag "glowing"/u);
  });

  it('rejects a head it cannot read', () => {
    expect(() => parseSemanticSnapshot('- button Approve')).toThrow(/expected 'role "name" \[flags\]'/u);
  });

  it('rejects a negated flag with a value', () => {
    expect(() => parseNodeHead('heading [!level=2]')).toThrow(/cannot be both negated and compared/u);
  });

  it('rejects a broken regex', () => {
    expect(() => parseSemanticSnapshot('- button /[unclosed/')).toThrow(/invalid name pattern/u);
  });

  it('rejects a document that is not a list of nodes', () => {
    expect(() => parseSemanticSnapshot('role: button')).toThrow(/expected a list of nodes/u);
  });
});
