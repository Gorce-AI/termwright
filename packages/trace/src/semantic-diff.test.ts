import { describe, expect, it } from 'vitest';
import { node, snapshot } from './__fixtures__/fake-session.js';
import { diffSemanticSnapshots } from './semantic-diff.js';

describe('diffSemanticSnapshots', () => {
  it('reports no changes for identical trees', () => {
    const tree = snapshot(1, [node({ id: 'n1', role: 'button', name: 'Submit' })]);
    const diff = diffSemanticSnapshots(tree, snapshot(2, tree.nodes));
    expect(diff.isEmpty).toBe(true);
    expect(diff.sentences).toEqual([]);
  });

  it('describes a state change in plain English', () => {
    const before = snapshot(1, [node({ id: 'n1', role: 'button', name: 'Submit' })]);
    const after = snapshot(2, [
      node({ id: 'n1', role: 'button', name: 'Submit', state: { disabled: true } }),
    ]);
    const diff = diffSemanticSnapshots(before, after);
    expect(diff.sentences).toEqual([`button "Submit" state changed to disabled`]);
    expect(diff.changed[0]?.changes[0]).toMatchObject({
      kind: 'state',
      field: 'disabled',
      before: undefined,
      after: true,
    });
  });

  it('records paint provenance changes independently of layout movement', () => {
    const evidence = {
      source: 'application' as const,
      method: 'native' as const,
      strength: 'authoritative' as const,
      providerId: 'app.paint',
    };
    const before = snapshot(1, [
      node({
        id: 'n1',
        role: 'button',
        name: 'Submit',
        paintedRegion: {
          status: 'known',
          value: {
            regionBounds: { row: 1, column: 1, width: 2, height: 1 },
            spans: [{ row: 1, from: 1, to: 3 }],
          },
          evidence,
        },
      }),
    ]);
    const after = snapshot(2, [
      node({
        id: 'n1',
        role: 'button',
        name: 'Submit',
        paintedRegion: {
          status: 'known',
          value: {
            regionBounds: { row: 1, column: 1, width: 1, height: 1 },
            spans: [{ row: 1, from: 1, to: 2 }],
          },
          evidence,
        },
      }),
    ]);
    expect(diffSemanticSnapshots(before, after).changed[0]?.changes).toEqual([
      expect.objectContaining({ kind: 'painted-region', field: 'paintedRegion' }),
    ]);
  });

  it('describes a state that was cleared', () => {
    const before = snapshot(1, [
      node({ id: 'n1', role: 'button', name: 'Submit', state: { focused: true } }),
    ]);
    const after = snapshot(2, [node({ id: 'n1', role: 'button', name: 'Submit' })]);
    expect(diffSemanticSnapshots(before, after).sentences).toEqual([
      `button "Submit" is no longer focused`,
    ]);
  });

  it('describes appearing and disappearing nodes', () => {
    const before = snapshot(1, [node({ id: 'n1', role: 'text', name: 'Loading' })]);
    const after = snapshot(2, [node({ id: 'n2', role: 'dialog', name: 'Permission' })]);
    const diff = diffSemanticSnapshots(before, after);
    expect(diff.sentences).toEqual([`dialog "Permission" appeared`, `text "Loading" disappeared`]);
    expect(diff.added.map((n) => n.id)).toEqual(['n2']);
    expect(diff.removed.map((n) => n.id)).toEqual(['n1']);
  });

  it('describes renames and value changes', () => {
    const before = snapshot(1, [
      node({ id: 'n1', role: 'button', name: 'Submit' }),
      node({
        id: 'n2',
        role: 'textbox',
        name: 'Name',
        value: {
          status: 'known',
          value: '',
          sensitivity: 'public',
          evidence: {
            source: 'driver',
            method: 'native',
            strength: 'authoritative',
            providerId: 'test',
          },
        },
      }),
    ]);
    const after = snapshot(2, [
      node({ id: 'n1', role: 'button', name: 'Send' }),
      node({
        id: 'n2',
        role: 'textbox',
        name: 'Name',
        value: {
          status: 'known',
          value: 'ada',
          sensitivity: 'public',
          evidence: {
            source: 'driver',
            method: 'native',
            strength: 'authoritative',
            providerId: 'test',
          },
        },
      }),
    ]);
    expect(diffSemanticSnapshots(before, after).sentences).toEqual([
      `button "Submit" renamed to "Send"`,
      `textbox "Name" value changed from "" to "ada"`,
    ]);
  });

  it('matches nodes by role and name when ids are regenerated', () => {
    const before = snapshot(1, [node({ id: 'a1', role: 'button', name: 'Submit' })]);
    const after = snapshot(2, [
      node({ id: 'b9', role: 'button', name: 'Submit', state: { disabled: true } }),
    ]);
    const diff = diffSemanticSnapshots(before, after);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.sentences).toEqual([`button "Submit" state changed to disabled`]);
  });

  it('keeps geometry out of the sentences unless nothing else changed', () => {
    const before = snapshot(1, [
      node({
        id: 'n1',
        role: 'button',
        name: 'Submit',
        geometry: visibleGeometry({ row: 1, column: 1, width: 8, height: 1 }),
      }),
    ]);
    const moved = snapshot(2, [
      node({
        id: 'n1',
        role: 'button',
        name: 'Submit',
        geometry: visibleGeometry({ row: 4, column: 1, width: 8, height: 1 }),
      }),
    ]);
    expect(diffSemanticSnapshots(before, moved).sentences).toEqual([
      `button "Submit" moved from (row 1, column 1) to (row 4, column 1)`,
    ]);

    const movedAndDisabled = snapshot(3, [
      node({
        id: 'n1',
        role: 'button',
        name: 'Submit',
        state: { disabled: true },
        geometry: visibleGeometry({ row: 4, column: 1, width: 8, height: 1 }),
      }),
    ]);
    const diff = diffSemanticSnapshots(before, movedAndDisabled);
    expect(diff.sentences).toEqual([`button "Submit" state changed to disabled`]);
    expect(diff.changed[0]?.changes.map((change) => change.kind)).toEqual(['state', 'bounds']);
    expect(
      diffSemanticSnapshots(before, movedAndDisabled, { includeBounds: true }).sentences,
    ).toHaveLength(2);
  });

  it('describes non-boolean state changes with both values', () => {
    const before = snapshot(1, [
      node({ id: 'n1', role: 'listitem', name: 'row', state: { level: 1 } }),
    ]);
    const after = snapshot(2, [
      node({ id: 'n1', role: 'listitem', name: 'row', state: { level: 3 } }),
    ]);
    expect(diffSemanticSnapshots(before, after).sentences).toEqual([
      `listitem "row" level changed from 1 to 3`,
    ]);
  });

  it('describes a tri-state checkbox', () => {
    const before = snapshot(1, [
      node({ id: 'n1', role: 'checkbox', name: 'All', state: { checked: false } }),
    ]);
    const after = snapshot(2, [
      node({ id: 'n1', role: 'checkbox', name: 'All', state: { checked: 'mixed' } }),
    ]);
    expect(diffSemanticSnapshots(before, after).sentences).toEqual([
      `checkbox "All" checked changed to mixed`,
    ]);
  });

  it('uses the bare role for unnamed nodes', () => {
    const before = snapshot(1, []);
    const after = snapshot(2, [node({ id: 'n1', role: 'separator' })]);
    expect(diffSemanticSnapshots(before, after).sentences).toEqual(['separator appeared']);
  });
});
const visibleGeometry = (rect: { row: number; column: number; width: number; height: number }) => ({
  displayed: {
    status: 'known',
    value: true,
    evidence: {
      source: 'framework',
      method: 'native',
      strength: 'authoritative',
      providerId: 'test',
    },
  } as const,
  intendedRect: {
    status: 'known',
    value: { ...rect },
    evidence: {
      source: 'framework',
      method: 'native',
      strength: 'authoritative',
      providerId: 'test',
    },
  } as const,
  visibleRect: {
    status: 'known',
    value: { ...rect },
    evidence: {
      source: 'framework',
      method: 'native',
      strength: 'authoritative',
      providerId: 'test',
    },
  } as const,
});
