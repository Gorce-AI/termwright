import { describe, expect, it } from 'vitest';
import { node, snapshot } from './__fixtures__/fake-session.js';
import { generateSelector } from './selector.js';

describe('generateSelector', () => {
  it('prefers a test id over anything else', () => {
    const tree = snapshot(1, [node({ id: 'n1', role: 'button', name: 'Save', testId: 'save' })]);
    expect(generateSelector(tree, 'n1')?.code).toBe("getByTestId('save')");
  });

  it('uses role and name when they are unique', () => {
    const tree = snapshot(1, [
      node({ id: 'n1', role: 'button', name: 'Approve' }),
      node({ id: 'n2', role: 'button', name: 'Reject' }),
    ]);
    const selector = generateSelector(tree, 'n1');
    expect(selector?.kind).toBe('role');
    expect(selector?.expression).toBe("terminal.getByRole('button', { name: 'Approve' })");
  });

  it('scopes duplicates by their nearest named container', () => {
    const tree = snapshot(1, [
      node({ id: 'd1', role: 'dialog', name: 'Permission' }),
      node({ id: 'b1', role: 'button', name: 'OK', parentId: 'd1' }),
      node({ id: 'd2', role: 'dialog', name: 'Quit' }),
      node({ id: 'b2', role: 'button', name: 'OK', parentId: 'd2' }),
    ]);
    const selector = generateSelector(tree, 'b2');
    expect(selector?.kind).toBe('role-scoped');
    expect(selector?.code).toBe(
      "getByRole('button', { name: 'OK' }).within(terminal.getByRole('dialog', { name: 'Quit' }))",
    );
  });

  it('scopes through an intermediate unnamed node', () => {
    const tree = snapshot(1, [
      node({ id: 'd1', role: 'dialog', name: 'Permission' }),
      node({ id: 'g1', role: 'generic', parentId: 'd1' }),
      node({ id: 'b1', role: 'button', name: 'OK', parentId: 'g1' }),
      node({ id: 'b2', role: 'button', name: 'OK' }),
    ]);
    expect(generateSelector(tree, 'b1')?.code).toBe(
      "getByRole('button', { name: 'OK' }).within(terminal.getByRole('dialog', { name: 'Permission' }))",
    );
  });

  it('falls back to an index when no container disambiguates', () => {
    const tree = snapshot(1, [
      node({ id: 'l1', role: 'list' }),
      node({ id: 'i1', role: 'listitem', name: 'Item', parentId: 'l1' }),
      node({ id: 'i2', role: 'listitem', name: 'Item', parentId: 'l1' }),
    ]);
    const selector = generateSelector(tree, 'i2');
    expect(selector?.kind).toBe('role-index');
    expect(selector?.code).toBe("getByRole('listitem', { name: 'Item' }).nth(1)");
  });

  it('falls back to text for nodes without a name', () => {
    const tree = snapshot(1, [node({ id: 'n1', role: 'text', value: 'running: ls -la' })]);
    const selector = generateSelector(tree, 'n1');
    expect(selector?.kind).toBe('text');
    expect(selector?.code).toBe("getByText('running: ls -la')");
  });

  it('marks a nameless, textless node as fragile', () => {
    const tree = snapshot(1, [node({ id: 'n1', role: 'generic' }), node({ id: 'n2', role: 'generic' })]);
    const selector = generateSelector(tree, 'n2');
    expect(selector?.unique).toBe(false);
    expect(selector?.code).toBe("getByRole('generic').nth(1)");
  });

  it('escapes quotes in names', () => {
    const tree = snapshot(1, [node({ id: 'n1', role: 'button', name: "Don't" })]);
    expect(generateSelector(tree, 'n1')?.code).toBe("getByRole('button', { name: 'Don\\'t' })");
  });

  it('honours the receiver name', () => {
    const tree = snapshot(1, [node({ id: 'n1', role: 'button', name: 'Save' })]);
    expect(generateSelector(tree, 'n1', { root: 'app' })?.expression).toBe(
      "app.getByRole('button', { name: 'Save' })",
    );
  });

  it('returns undefined for an unknown node', () => {
    expect(generateSelector(snapshot(1, []), 'nope')).toBeUndefined();
  });

  it('survives a parent cycle without hanging', () => {
    const tree = snapshot(1, [
      node({ id: 'a', role: 'region', name: 'A', parentId: 'b' }),
      node({ id: 'b', role: 'region', name: 'B', parentId: 'a' }),
      node({ id: 'c', role: 'button', name: 'Go', parentId: 'a' }),
    ]);
    expect(generateSelector(tree, 'c')?.code).toBe("getByRole('button', { name: 'Go' })");
  });
});
