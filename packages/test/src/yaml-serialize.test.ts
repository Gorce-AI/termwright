import { describe, expect, it } from 'vitest';
import { node, permissionDialog, snapshot } from './__fixtures__/tree.js';
import { describeState, normalizeName, serializeSemanticSnapshot } from './yaml-serialize.js';

describe('serializeSemanticSnapshot', () => {
  it('renders the contract example', () => {
    expect(serializeSemanticSnapshot(permissionDialog())).toBe(
      [
        '- dialog "Permission" [modal]:',
        '    - text "Allow bash to run?"',
        '    - button "Approve" [focused]',
        '    - button "Reject"',
        '',
      ].join('\n'),
    );
  });

  it('omits the colon for leaves and nests deeper levels', () => {
    const tree = snapshot([
      node('n1', 'list', 'Files'),
      node('n2', 'listitem', 'src', { parentId: 'n1' }),
      node('n3', 'text', 'index.ts', { parentId: 'n2' }),
    ]);
    expect(serializeSemanticSnapshot(tree)).toBe(
      ['- list "Files":', '    - listitem "src":', '        - text "index.ts"', ''].join('\n'),
    );
  });

  it('drops names that are empty after normalization', () => {
    const tree = snapshot([node('n1', 'generic', '   ')]);
    expect(serializeSemanticSnapshot(tree)).toBe('- generic\n');
  });

  it('collapses whitespace inside names', () => {
    const tree = snapshot([node('n1', 'button', '  Save   all ')]);
    expect(serializeSemanticSnapshot(tree)).toBe('- button "Save all"\n');
    expect(normalizeName(' a  b ')).toBe('a b');
  });

  it('quotes heads that YAML would read differently', () => {
    const tree = snapshot([node('n1', 'heading', 'Issue #12')]);
    expect(serializeSemanticSnapshot(tree)).toBe(`- 'heading "Issue #12"'\n`);
  });

  it('emits false and unset states as nothing at all', () => {
    const tree = snapshot([node('n1', 'button', 'Save', { state: { focused: false, disabled: true } })]);
    expect(serializeSemanticSnapshot(tree)).toBe('- button "Save" [disabled]\n');
  });

  it('renders non-boolean states as key=value', () => {
    const tree = snapshot([
      node('n1', 'checkbox', 'All', { state: { checked: 'mixed' } }),
      node('n2', 'heading', 'Title', { state: { level: 2 } }),
    ]);
    expect(serializeSemanticSnapshot(tree)).toBe(
      ['- checkbox "All" [checked=mixed]', '- heading "Title" [level=2]', ''].join('\n'),
    );
  });

  it('keeps volatile states out of the stable selection', () => {
    const state = { focused: true, scrollOffset: 12, positionInSet: 3 };
    expect(describeState(state)).toEqual(['focused']);
    const tree = snapshot([node('n1', 'listitem', 'Item', { state })]);
    expect(serializeSemanticSnapshot(tree, { states: 'all' })).toBe(
      '- listitem "Item" [focused,positionInSet=3,scrollOffset=12]\n',
    );
    expect(serializeSemanticSnapshot(tree, { states: ['scrollOffset'] })).toBe(
      '- listitem "Item" [scrollOffset=12]\n',
    );
  });

  it('serializes what is inside a node when the root is excluded', () => {
    expect(serializeSemanticSnapshot(permissionDialog(), { rootId: 'n1', includeRoot: false })).toBe(
      [
        '- text "Allow bash to run?"',
        '- button "Approve" [focused]',
        '- button "Reject"',
        '',
      ].join('\n'),
    );
    expect(serializeSemanticSnapshot(permissionDialog(), { rootId: 'n3', includeRoot: false })).toBe('');
  });

  it('serializes a subtree when a root is named', () => {
    expect(serializeSemanticSnapshot(permissionDialog(), { rootId: 'n3' })).toBe(
      '- button "Approve" [focused]\n',
    );
  });

  it('can skip hidden nodes and their subtrees', () => {
    const tree = snapshot([
      node('n1', 'dialog', 'Main'),
      node('n2', 'button', 'Ghost', { parentId: 'n1', state: { hidden: true } }),
      node('n3', 'button', 'Real', { parentId: 'n1' }),
    ]);
    expect(serializeSemanticSnapshot(tree, { skipHidden: true })).toBe(
      ['- dialog "Main":', '    - button "Real"', ''].join('\n'),
    );
  });

  it('honours a custom indent', () => {
    expect(serializeSemanticSnapshot(permissionDialog(), { indent: 2 })).toContain(
      '\n  - text "Allow bash to run?"',
    );
  });

  it('renders an empty tree as an empty string', () => {
    expect(serializeSemanticSnapshot(snapshot([]))).toBe('');
  });
});
