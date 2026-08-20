/**
 * Level B: the rules, on IR, without a process.
 *
 * Every case here is a fact a probe could report and a decision this package
 * owns. The point of the split is that these run in microseconds and state one
 * rule each — the same coverage through a live renderer would be slower, and
 * would conflate "the rule is wrong" with "the framework did something else".
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, validateSnapshot, type ProbeFrame, type ProbeObject } from '@termwright/protocol';
import { recognize, type RecognizeContext } from './recognize.js';

const context: RecognizeContext = {
  sessionId: 's1',
  revision: 1,
  columns: 80,
  rows: 24,
  framework: 'opentui',
};

function object(partial: Partial<ProbeObject> & { readonly num: number }): ProbeObject {
  const { num, ...rest } = partial;
  return {
    identity: { kind: 'stable', value: String(num) },
    frameworkType: 'BoxRenderable',
    ...rest,
  };
}

function frameOf(...objects: readonly ProbeObject[]): ProbeFrame {
  return { frame: 1, objects };
}

describe('role resolution, in the normative order', () => {
  it('maps a framework class where the counterpart is unambiguous', () => {
    const snapshot = recognize(
      frameOf(
        object({ num: 1, frameworkType: 'RootRenderable' }),
        object({ num: 2, frameworkType: 'InputRenderable', parent: '1' }),
        object({ num: 3, frameworkType: 'TextRenderable', parent: '1' }),
      ),
      context,
    );

    expect(snapshot.nodes.map((node) => node.role)).toEqual(['application', 'textbox', 'text']);
  });

  it('keeps an unrecognised widget as generic rather than dropping it', () => {
    // This is what D1 exists for: an application's own subclass survives with
    // its bounds, text and children, findable by what the framework called it.
    const snapshot = recognize(
      frameOf(object({ num: 1, frameworkType: 'PaymentPanel' })),
      context,
    );

    expect(snapshot.nodes[0]?.role).toBe('generic');
    expect(snapshot.nodes[0]?.frameworkType).toBe('PaymentPanel');
  });

  it('refuses to invent a role for a widget with no counterpart', () => {
    // TabSelectRenderable is a tab strip, and the protocol has `tab` — but a
    // strip is not a tab, and a role that reads right while matching the wrong
    // node is worse than `generic`.
    const snapshot = recognize(
      frameOf(object({ num: 1, frameworkType: 'TabSelectRenderable' })),
      context,
    );

    expect(snapshot.nodes[0]?.role).toBe('generic');
  });

  it('lets an annotation win over the framework map', () => {
    const snapshot = recognize(
      frameOf(
        object({
          num: 1,
          frameworkType: 'BoxRenderable',
          annotations: { role: 'dialog', name: 'Permission' },
        }),
      ),
      context,
    );

    expect(snapshot.nodes[0]?.role).toBe('dialog');
    expect(snapshot.nodes[0]?.p).toBe('annotation');
  });

  it('falls through a bad annotation instead of inventing the role it names', () => {
    const snapshot = recognize(
      frameOf(
        object({ num: 1, frameworkType: 'InputRenderable', annotations: { role: 'spinbutton' } }),
      ),
      context,
    );

    // The annotation is outside the closed set, so the framework map decides.
    expect(snapshot.nodes[0]?.role).toBe('textbox');
  });

  it('attributes Ink aria metadata to the framework, not to an author annotation', () => {
    const snapshot = recognize(
      frameOf(object({
        num: 1,
        frameworkType: 'ink-box',
        accessibility: { role: 'button' },
      })),
      { ...context, framework: 'ink' },
    );

    expect(snapshot.nodes[0]).toMatchObject({ role: 'button', p: 'framework' });
  });
});

describe('developer intent merge', () => {
  it('merges extended state, actions and relationships without replacing physical facts', () => {
    const snapshot = recognize(
      frameOf(
        object({ num: 1, frameworkType: 'TextRenderable', text: 'Label' }),
        object({
          num: 2,
          frameworkType: 'InputRenderable',
          geometry: { intendedRect: { row: 3, column: 4, width: 12, height: 1 } },
          state: { focused: true, value: 'physical' },
          annotations: {
            name: 'Domain input',
            description: 'Provided by the application',
            testId: 'domain-input',
            extended: { environment: 'production' },
            actions: ['setValue'],
            labelledBy: ['1'],
          },
        }),
      ),
      context,
    );

    expect(snapshot.nodes[1]).toMatchObject({
      role: 'textbox',
      name: 'Domain input',
      description: 'Provided by the application',
      value: 'physical',
      bounds: { row: 3, column: 4, width: 12, height: 1 },
      state: { focused: true },
      extended: { environment: 'production' },
      actions: ['setValue'],
      labelledBy: ['n1'],
      testId: 'domain-input',
      p: 'recognizer',
      px: expect.objectContaining({
        name: 'annotation',
        bounds: 'framework',
        state: 'framework',
        extended: 'annotation',
      }),
    });
    expect(validateSnapshot(snapshot, DEFAULT_LIMITS).ok).toBe(true);
  });
});

describe('naming', () => {
  it('names a content role from the text the probe observed', () => {
    const snapshot = recognize(
      frameOf(
        object({
          num: 1,
          frameworkType: 'BoxRenderable',
          annotations: { role: 'button' },
          text: '  Approve  ',
        }),
      ),
      context,
    );

    expect(snapshot.nodes[0]?.name).toBe('Approve');
  });

  it('leaves a container unnamed, so a locator stays selective', () => {
    // The rule's whole purpose: a dialog must not answer to the name of the
    // button inside it.
    const snapshot = recognize(
      frameOf(
        object({
          num: 1,
          frameworkType: 'BoxRenderable',
          annotations: { role: 'dialog' },
          text: 'Approve',
        }),
      ),
      context,
    );

    expect(snapshot.nodes[0]?.name).toBe('');
  });

  it('honours a deliberately empty annotated name', () => {
    const snapshot = recognize(
      frameOf(
        object({
          num: 1,
          frameworkType: 'BoxRenderable',
          annotations: { role: 'button', name: '' },
          text: 'Approve',
        }),
      ),
      context,
    );

    expect(snapshot.nodes[0]?.name).toBe('');
    // Role and name both came from the author, so the node-level source says so
    // and there is no exception to list. D2 is "one source per node plus
    // exceptions" — repeating the source in `px` would be bytes for nothing.
    expect(snapshot.nodes[0]?.p).toBe('annotation');
    expect(snapshot.nodes[0]?.px?.['name']).toBeUndefined();
  });

  it('records the exception when the name and the role disagree on source', () => {
    const snapshot = recognize(
      frameOf(
        // Role from the framework map, name from the author: two sources, so
        // the one that differs from the node's is listed.
        object({ num: 1, frameworkType: 'InputRenderable', annotations: { name: 'Email' } }),
      ),
      context,
    );

    expect(snapshot.nodes[0]?.role).toBe('textbox');
    expect(snapshot.nodes[0]?.p).toBe('recognizer');
    expect(snapshot.nodes[0]?.px?.['name']).toBe('annotation');
  });

  it('infers an Ink control name from descendants without crossing a nested control', () => {
    const snapshot = recognize(
      frameOf(
        object({
          num: 1,
          frameworkType: 'ink-box',
          annotations: { role: 'button' },
        }),
        object({ num: 2, parent: '1', frameworkType: 'ink-text', text: 'Outer' }),
        object({
          num: 3,
          parent: '1',
          frameworkType: 'ink-box',
          annotations: { role: 'button' },
        }),
        object({ num: 4, parent: '3', frameworkType: 'ink-text', text: 'Inner' }),
      ),
      { ...context, framework: 'ink' },
    );

    expect(snapshot.nodes[0]).toMatchObject({
      role: 'button',
      name: 'Outer',
      p: 'annotation',
      px: { name: 'recognizer' },
    });
    expect(snapshot.nodes[2]).toMatchObject({
      role: 'button',
      name: 'Inner',
      p: 'annotation',
      px: { name: 'recognizer' },
    });
  });

  it('does not apply Ink host correlation to another framework', () => {
    const snapshot = recognize(
      frameOf(
        object({ num: 1, annotations: { role: 'button' } }),
        object({ num: 2, parent: '1', frameworkType: 'TextRenderable', text: 'Approve' }),
      ),
      context,
    );

    expect(snapshot.nodes[0]?.name).toBe('');
  });

  it('separates text carried by sibling Ink hosts', () => {
    const snapshot = recognize(
      frameOf(
        object({
          num: 1,
          frameworkType: 'ink-box',
          annotations: { role: 'button' },
        }),
        object({ num: 2, parent: '1', frameworkType: 'ink-text', text: 'Save' }),
        object({ num: 3, parent: '1', frameworkType: 'ink-text', text: 'now' }),
      ),
      { ...context, framework: 'ink' },
    );

    expect(snapshot.nodes[0]?.name).toBe('Save now');
  });
});

describe('physical facts stay the framework\'s', () => {
  it('takes bounds from geometry and records where they came from', () => {
    const snapshot = recognize(
      frameOf(
        object({
          num: 1,
          geometry: { intendedRect: { row: 2, column: 3, width: 10, height: 4 } },
          paintOrder: 0,
        }),
      ),
      context,
    );

    expect(snapshot.nodes[0]?.bounds).toEqual({ row: 2, column: 3, width: 10, height: 4 });
    expect(snapshot.nodes[0]?.px?.['bounds']).toBe('framework');
  });

  it('marks a node the clip removed as hidden rather than publishing an empty box', () => {
    const snapshot = recognize(
      frameOf(
        object({
          num: 1,
          geometry: {
            intendedRect: { row: 2, column: 3, width: 10, height: 4 },
            visibleRect: { row: 0, column: 0, width: 0, height: 0 },
          },
        }),
      ),
      context,
    );

    expect(snapshot.nodes[0]?.state?.hidden).toBe(true);
    expect(snapshot.nodes[0]?.state?.offscreen).toBe(true);
  });

  it('clips intended bounds to the known terminal viewport', () => {
    const snapshot = recognize(
      frameOf(
        object({
          num: 1,
          geometry: { intendedRect: { row: 30, column: 3, width: 10, height: 4 } },
        }),
      ),
      context,
    );

    expect(snapshot.nodes[0]?.bounds).toEqual({ row: 30, column: 3, width: 10, height: 0 });
    expect(snapshot.nodes[0]?.state).toMatchObject({ hidden: true, offscreen: true });
    expect(validateSnapshot(snapshot, DEFAULT_LIMITS).ok).toBe(true);
  });

  it('marks an intrinsically empty out-of-viewport node hidden, but not offscreen', () => {
    const snapshot = recognize(
      frameOf(
        object({
          num: 1,
          geometry: { intendedRect: { row: 30, column: 3, width: 0, height: 1 } },
        }),
      ),
      context,
    );

    expect(snapshot.nodes[0]?.state).toEqual({ hidden: true });
    expect(validateSnapshot(snapshot, DEFAULT_LIMITS).ok).toBe(true);
  });

  it('carries an observed value, including an empty one', () => {
    const snapshot = recognize(
      frameOf(object({ num: 1, frameworkType: 'InputRenderable', state: { value: '' } })),
      context,
    );

    expect(snapshot.nodes[0]?.value).toBe('');
  });

  it('maps focus and display straight through', () => {
    const snapshot = recognize(
      frameOf(
        object({ num: 1, state: { focused: true } }),
        object({ num: 2, parent: '1', state: { displayed: false } }),
      ),
      context,
    );

    expect(snapshot.nodes[0]?.state?.focused).toBe(true);
    expect(snapshot.nodes[1]?.state?.hidden).toBe(true);
  });

  it('carries observed accessibility states into the semantic wire', () => {
    const snapshot = recognize(
      frameOf(
        object({ num: 1, state: { selected: true, busy: false, multiline: true } }),
      ),
      context,
    );

    expect(snapshot.nodes[0]?.state).toMatchObject({
      selected: true,
      busy: false,
      multiline: true,
    });
  });

  it('maps the selected item index to a one-based position', () => {
    const snapshot = recognize(
      frameOf(object({ num: 1, frameworkType: 'SelectRenderable', state: { selectedIndex: 2 } })),
      context,
    );

    expect(snapshot.nodes[0]?.state?.positionInSet).toBe(3);
  });
});

describe('structure', () => {
  it('rewrites probe identities into node ids and keeps the hierarchy', () => {
    const snapshot = recognize(
      frameOf(
        object({ num: 1, frameworkType: 'RootRenderable' }),
        object({ num: 2, parent: '1' }),
        object({ num: 3, parent: '2' }),
      ),
      context,
    );

    expect(snapshot.rootIds).toEqual(['n1']);
    expect(snapshot.nodes[1]?.parentId).toBe('n1');
    expect(snapshot.nodes[2]?.parentId).toBe('n2');
  });

  it('reparents an orphan instead of producing a tree validation refuses', () => {
    // A parent can go missing when the walk truncated. Losing the subtree would
    // be worse than reparenting it, and a dangling parentId is refused outright.
    const snapshot = recognize(
      frameOf(object({ num: 1 }), object({ num: 2, parent: '99' })),
      context,
    );

    expect(snapshot.nodes[1]?.parentId).toBeUndefined();
    expect(snapshot.rootIds).toContain('n2');
    expect(validateSnapshot(snapshot, DEFAULT_LIMITS).ok).toBe(true);
  });
});

describe('the protocol accepts what this produces', () => {
  it('emits qualified facts without turning intended geometry into visibility', () => {
    const snapshot = recognize(
      frameOf(object({
        num: 1,
        frameworkType: 'ink-box',
        geometry: { intendedRect: { row: 1, column: 2, width: 10, height: 2 } },
        state: { displayed: true },
        unobservable: ['visibleRect', 'paintOrder'],
      })),
      { ...context, framework: 'ink', qualified: true },
    );

    expect(snapshot).toMatchObject({
      v: 2,
      coordinateSpace: { status: 'known', value: 'viewport-cells' },
      hitGrid: { status: 'unsupported' },
      nodes: [{ geometry: {
        displayed: { status: 'known', value: true },
        intendedRect: { status: 'known', value: { row: 1, column: 2, width: 10, height: 2 } },
        visibleRect: { status: 'unsupported' },
      } }],
    });
    expect(validateSnapshot(snapshot, DEFAULT_LIMITS).ok).toBe(true);
  });

  it('validates a realistic tree end to end', () => {
    const snapshot = recognize(
      frameOf(
        object({ num: 1, frameworkType: 'RootRenderable', geometry: { intendedRect: { row: 0, column: 0, width: 80, height: 24 } } }),
        object({
          num: 2,
          parent: '1',
          frameworkType: 'BoxRenderable',
          annotations: { role: 'button', testId: 'approve' },
          text: 'Approve',
          geometry: { intendedRect: { row: 1, column: 1, width: 20, height: 3 } },
          state: { focused: true },
          paintOrder: 1,
        }),
        object({
          num: 3,
          parent: '1',
          frameworkType: 'InputRenderable',
          state: { value: 'draft' },
          geometry: { intendedRect: { row: 5, column: 1, width: 30, height: 1 } },
        }),
      ),
      context,
    );

    const result = validateSnapshot(snapshot, DEFAULT_LIMITS);
    expect(result.ok ? null : result.detail).toBeNull();
  });
});
