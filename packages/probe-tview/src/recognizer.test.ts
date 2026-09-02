/**
 * Tier B: the recognizer, fed IR directly.
 *
 * No build, no toolchain, no pseudo-terminal — which is the point. Every case
 * here is one an application would have to be coaxed into producing, and half
 * of them only occur on a framework release nobody has shipped yet.
 */

import type { ProbeFrame, ProbeObject } from '@termwright/protocol';
import { describe, expect, it } from 'vitest';
import { recognize, roleFor } from './recognizer.js';

const OPTIONS = { sessionId: 's-1', revision: 7, columns: 80, rows: 24 };

function object(overrides: Partial<ProbeObject> & { readonly frameworkType: string }): ProbeObject {
  return {
    identity: { kind: 'stable', value: overrides.identity?.value ?? 'n1' },
    ...overrides,
  } as ProbeObject;
}

function frameOf(...objects: readonly ProbeObject[]): ProbeFrame {
  return { frame: 1, objects };
}

describe('roles', () => {
  it('maps the tview widgets a test addresses', () => {
    expect(roleFor('Button')).toBe('button');
    expect(roleFor('InputField')).toBe('textbox');
    expect(roleFor('List')).toBe('list');
    expect(roleFor('Table')).toBe('table');
    expect(roleFor('Modal')).toBe('dialog');
    expect(roleFor('Pages')).toBe('region');
  });

  it('keeps an unknown widget alive as a named generic', () => {
    // The rule that makes a future tview release degrade instead of vanish.
    expect(roleFor('SomethingAddedInV0_43')).toBe('generic');

    const snapshot = recognize(
      frameOf(object({ frameworkType: 'SomethingAddedInV0_43', text: 'mystery' })),
      OPTIONS,
    );

    expect(snapshot.nodes[0]?.role).toBe('generic');
    expect(snapshot.nodes[0]?.frameworkType).toBe('SomethingAddedInV0_43');
    expect(snapshot.nodes[0]?.name).toBe('mystery');
  });

  it('keeps the framework type on recognised widgets too', () => {
    // Two containers both become `region`; the type is what tells them apart.
    const snapshot = recognize(
      frameOf(
        object({ identity: { kind: 'stable', value: 'a' }, frameworkType: 'Flex' }),
        object({ identity: { kind: 'stable', value: 'b' }, frameworkType: 'Form' }),
      ),
      OPTIONS,
    );

    expect(snapshot.nodes.map((node) => [node.role, node.frameworkType])).toEqual([
      ['region', 'Flex'],
      ['region', 'Form'],
    ]);
  });
});

describe('facts are carried, not invented', () => {
  it('keeps intended geometry unknown when the probe reported no geometry', () => {
    const snapshot = recognize(frameOf(object({ frameworkType: 'Button' })), OPTIONS);

    expect(snapshot.nodes[0]?.geometry.intendedRect).toEqual({
      status: 'unsupported',
      capability: 'intended-geometry',
      reason: 'framework-unobservable',
    });
  });

  it('uses intendedRect and never fabricates a visibleRect', () => {
    const snapshot = recognize(
      frameOf(
        object({
          frameworkType: 'List',
          geometry: { intendedRect: { row: 2, column: 1, width: 30, height: 7 } },
        }),
      ),
      OPTIONS,
    );

    expect(snapshot.nodes[0]?.geometry.intendedRect).toMatchObject({
      status: 'known',
      value: { row: 2, column: 1, width: 30, height: 7 },
    });
    expect(snapshot.nodes[0]?.geometry.visibleRect).toMatchObject({ status: 'unsupported' });
  });

  it('does not turn an unreported state into a false one', () => {
    // "The probe did not say" and "the widget is not focused" are different
    // claims, and a matcher asserting the second must not be handed the first.
    const snapshot = recognize(frameOf(object({ frameworkType: 'Button' })), OPTIONS);

    expect(snapshot.nodes[0]?.state).toBeUndefined();
  });

  it('translates displayed:false into hidden, and leaves displayed:true alone', () => {
    const hidden = recognize(
      frameOf(object({ frameworkType: 'InputField', state: { displayed: false } })),
      OPTIONS,
    );
    const shown = recognize(
      frameOf(object({ frameworkType: 'InputField', state: { displayed: true } })),
      OPTIONS,
    );

    expect(hidden.nodes[0]?.state?.hidden).toBe(true);
    expect(shown.nodes[0]?.state?.hidden).toBeUndefined();
  });

  it('drops a scroll offset from before the first layout', () => {
    // The bug the stalled-driver test surfaced, restated where it costs one
    // line to check: a negative offset is "not decided yet", not a position,
    // and publishing it gets the whole snapshot refused by the schema.
    const early = recognize(
      frameOf(object({ frameworkType: 'TextView', state: { scroll: { row: -1, column: 0 } } })),
      OPTIONS,
    );
    const settled = recognize(
      frameOf(object({ frameworkType: 'TextView', state: { scroll: { row: 3, column: 0 } } })),
      OPTIONS,
    );

    expect(early.nodes[0]?.scroll).toBeUndefined();
    expect(settled.nodes[0]?.scroll).toBeUndefined();
  });

  it('prefers an annotation over the widget text for the name', () => {
    const snapshot = recognize(
      frameOf(object({ frameworkType: 'Button', text: 'OK', annotations: { name: 'Confirm' } })),
      OPTIONS,
    );

    expect(snapshot.nodes[0]?.name).toBe('Confirm');
  });
});

describe('the shape of the tree', () => {
  it('roots the objects that have no parent', () => {
    const snapshot = recognize(
      frameOf(
        object({ identity: { kind: 'stable', value: 'root' }, frameworkType: 'Pages' }),
        object({
          identity: { kind: 'stable', value: 'child' },
          frameworkType: 'Flex',
          parent: 'root',
        }),
      ),
      OPTIONS,
    );

    expect(snapshot.rootIds).toEqual(['root']);
    expect(snapshot.nodes[1]?.parentId).toBe('root');
  });

  it('carries the session, revision and viewport through unchanged', () => {
    const snapshot = recognize(frameOf(object({ frameworkType: 'Box' })), OPTIONS);

    expect(snapshot).toMatchObject({ v: 3, sessionId: 's-1', revision: 7, columns: 80, rows: 24 });
  });

  it('accepts an empty frame rather than treating it as an error', () => {
    // A frame before the first layout has nothing in it, and that is a fact.
    const snapshot = recognize({ frame: 1, objects: [] }, OPTIONS);

    expect(snapshot.nodes).toEqual([]);
    expect(snapshot.rootIds).toEqual([]);
  });
});
