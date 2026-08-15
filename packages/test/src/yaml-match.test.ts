import { describe, expect, it } from 'vitest';
import { node, permissionDialog, snapshot } from './__fixtures__/tree.js';
import { parseSemanticSnapshot } from './yaml-pattern.js';
import { matchSemanticSnapshot } from './yaml-match.js';
import type { SemanticSnapshot } from '@termwright/protocol';

function match(expected: string, tree: SemanticSnapshot = permissionDialog()): ReturnType<typeof matchSemanticSnapshot> {
  return matchSemanticSnapshot(parseSemanticSnapshot(expected), tree);
}

describe('matchSemanticSnapshot', () => {
  it('matches the tree it was serialized from', () => {
    const result = match(`
      - dialog "Permission" [modal]:
          - text "Allow bash to run?"
          - button "Approve" [focused]
          - button "Reject"
    `);
    expect(result.ok).toBe(true);
  });

  it('treats omitted children as don\'t-care', () => {
    expect(match('- dialog "Permission"').ok).toBe(true);
  });

  it('allows unlisted siblings, in any position', () => {
    expect(match(`
      - dialog "Permission":
          - button "Reject"
    `).ok).toBe(true);
  });

  it('requires the listed children to keep their relative order', () => {
    const result = match(`
      - dialog "Permission":
          - button "Reject"
          - button "Approve"
    `);
    expect(result.ok).toBe(false);
    expect(result.mismatch?.reason).toMatch(/not in the expected order/u);
    expect(result.mismatch?.path).toBe('dialog "Permission" [modal]');
  });

  it('asserts only the flags that are listed', () => {
    expect(match('- button "Approve" [focused]', snapshot([
      node('n1', 'button', 'Approve', { state: { focused: true, disabled: true } }),
    ])).ok).toBe(true);
  });

  it('fails when a listed flag is not set', () => {
    const result = match(`
      - dialog "Permission":
          - button "Reject" [focused]
    `);
    expect(result.ok).toBe(false);
    expect(result.mismatch?.reason).toMatch(/\[focused\] is not set/u);
  });

  it('supports negated flags', () => {
    expect(match(`
      - dialog "Permission":
          - button "Reject" [!focused]
    `).ok).toBe(true);
    expect(match(`
      - dialog "Permission":
          - button "Approve" [!focused]
    `).ok).toBe(false);
  });

  it('compares valued flags as text', () => {
    const tree = snapshot([node('n1', 'checkbox', 'All', { state: { checked: 'mixed' } })]);
    expect(match('- checkbox "All" [checked=mixed]', tree).ok).toBe(true);
    const result = match('- checkbox "All" [checked=true]', tree);
    expect(result.ok).toBe(false);
    expect(result.mismatch?.reason).toMatch(/checked is mixed/u);
  });

  it('matches names by regex and ignores names when omitted', () => {
    expect(match('- dialog /^Perm/').ok).toBe(true);
    expect(match('- dialog').ok).toBe(true);
    const result = match('- dialog /^Deny/');
    expect(result.ok).toBe(false);
    expect(result.mismatch?.reason).toMatch(/does not match \/\^Deny\//u);
  });

  it('matches any role behind the wildcard', () => {
    expect(match(`- '* "Permission"'`).ok).toBe(true);
  });

  it('normalizes whitespace on both sides of a name', () => {
    const tree = snapshot([node('n1', 'button', '  Save   all ')]);
    expect(match('- button "Save all"', tree).ok).toBe(true);
  });

  it('reports the closest candidate when nothing matches', () => {
    const result = match(`
      - dialog "Permission":
          - button "Approvo"
    `);
    expect(result.ok).toBe(false);
    expect(result.mismatch?.expected).toBe('button "Approvo"');
    expect(result.mismatch?.reason).toMatch(/name is "Approve", expected "Approvo"/u);
  });

  it('reports the deepest failure rather than the outermost one', () => {
    const result = match(`
      - dialog "Permission":
          - button "Approve" [disabled]
    `);
    expect(result.mismatch?.path).toBe('dialog "Permission" [modal]');
    expect(result.mismatch?.expected).toBe('button "Approve" [disabled]');
  });

  it('says so when a level is empty', () => {
    const result = match(`
      - dialog "Permission":
          - button "Approve":
              - text "nested"
    `);
    expect(result.mismatch?.reason).toMatch(/no nodes exist at this level/u);
  });

  it('scopes matching to the inside of a node, excluding the node itself', () => {
    const patterns = parseSemanticSnapshot(['- button "Approve" [focused]', '- button "Reject"'].join('\n'));
    expect(
      matchSemanticSnapshot(patterns, permissionDialog(), { rootId: 'n1', includeRoot: false }).ok,
    ).toBe(true);
    // The same pattern anchored at the roots does not match: the dialog is in
    // the way, which is exactly what scoping is for.
    expect(matchSemanticSnapshot(patterns, permissionDialog()).ok).toBe(false);
  });

  it('reports an empty level when scoping into a node with no children', () => {
    const patterns = parseSemanticSnapshot('- button "Approve"');
    const result = matchSemanticSnapshot(patterns, permissionDialog(), { rootId: 'n3', includeRoot: false });
    expect(result.ok).toBe(false);
    expect(result.mismatch?.reason).toMatch(/no nodes exist at this level/u);
  });

  it('scopes matching to a subtree', () => {
    const result = matchSemanticSnapshot(parseSemanticSnapshot('- button "Approve" [focused]'), permissionDialog(), {
      rootId: 'n3',
    });
    expect(result.ok).toBe(true);
  });

  it('matches an empty pattern against anything', () => {
    expect(match('').ok).toBe(true);
  });

  it('gives up rather than hang on a pathological pattern', () => {
    const wide = snapshot([
      node('root', 'list', 'L'),
      ...Array.from({ length: 40 }, (_, index) => node(`n${index}`, 'listitem', 'same', { parentId: 'root' })),
    ]);
    const expected = ['- list "L":', ...Array.from({ length: 30 }, () => '    - listitem "same"'), '    - listitem "missing"'].join('\n');
    const result = matchSemanticSnapshot(parseSemanticSnapshot(expected), wide, { maxComparisons: 500 });
    expect(result.ok).toBe(false);
  });
});
