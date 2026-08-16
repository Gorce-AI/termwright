/**
 * Level A: the observation layer, without a renderer.
 *
 * `observeTree` reads a structural shape rather than importing the framework,
 * so these tests describe trees directly. That is not a shortcut — it is what
 * lets the rules be stated one at a time, including the ones a real renderer
 * would make hard to arrange (an unreadable z-order list, a runaway tree).
 */

import { describe, expect, it } from 'vitest';
import { validateProbeFrame, DEFAULT_LIMITS } from '@termwright/protocol';
import { observeTree, type ObservableNode } from './observe.js';

/** Minimal stand-in for a Renderable; only what the observer reads. */
function node(name: string, num: number, extra: Partial<ObservableNode> = {}): ObservableNode {
  const base = {
    num,
    screenX: 0,
    screenY: 0,
    width: 10,
    height: 1,
    visible: true,
    getChildren: () => [],
    ...extra,
  };
  // `constructor.name` is what the probe reports as frameworkType, so the fake
  // has to carry a real one rather than a property called `constructor`.
  return Object.setPrototypeOf(base, { constructor: { name } }) as ObservableNode;
}

describe('identity and structure', () => {
  it('reports num as a stable identity, never the mutable id', () => {
    const child = node('TextRenderable', 7);
    const root = node('RootRenderable', 1, { id: 'renamed-at-runtime', getChildren: () => [child] });

    const { frame } = observeTree(root, { frame: 1 });

    expect(frame.objects[0]?.identity).toEqual({ kind: 'stable', value: '1' });
    expect(frame.objects[1]?.identity.value).toBe('7');
    // `id` defaults to `renderable-<num>`, is mutable at runtime and updates no
    // index, so it is a label rather than a handle.
    expect(JSON.stringify(frame.objects)).not.toContain('renamed-at-runtime');
  });

  it('names the framework type from the class', () => {
    const root = node('RootRenderable', 1, { getChildren: () => [node('InputRenderable', 2)] });

    const { frame } = observeTree(root, { frame: 1 });

    expect(frame.objects.map((object) => object.frameworkType)).toEqual([
      'RootRenderable',
      'InputRenderable',
    ]);
  });

  it('links a child to its parent and leaves the root without one', () => {
    const root = node('RootRenderable', 1, { getChildren: () => [node('BoxRenderable', 2)] });

    const { frame } = observeTree(root, { frame: 1 });

    expect(frame.objects[0]?.parent).toBeUndefined();
    expect(frame.objects[1]?.parent).toBe('1');
  });
});

describe('geometry', () => {
  it('reports screen coordinates as terminal cells', () => {
    const root = node('RootRenderable', 1, {
      getChildren: () => [node('BoxRenderable', 2, { screenX: 4, screenY: 3, width: 20, height: 5 })],
    });

    const { frame } = observeTree(root, { frame: 1 });

    expect(frame.objects[1]?.geometry?.intendedRect).toEqual({
      row: 3,
      column: 4,
      width: 20,
      height: 5,
    });
  });

  it('says the visible rectangle is unknowable rather than guessing it', () => {
    // OpenTUI clips with scissor rects at render time and exposes no per-node
    // visible rectangle. Deriving one from the intended rect would invent a
    // fact, which is the thing the IR's two-rectangle split exists to prevent.
    const { frame } = observeTree(node('RootRenderable', 1), { frame: 1 });

    expect(frame.objects[0]?.geometry?.visibleRect).toBeUndefined();
    expect(frame.objects[0]?.unobservable).toContain('visibleRect');
  });

  it('omits geometry entirely when the node has none', () => {
    // A TextNodeRenderable is not a layout node: it has no yoga node and no
    // position, so the fake simply lacks those keys.
    const bare = Object.setPrototypeOf(
      { num: 2, getChildren: () => [] },
      { constructor: { name: 'TextNodeRenderable' } },
    ) as ObservableNode;
    const root = node('RootRenderable', 1, { getChildren: () => [bare] });

    const { frame } = observeTree(root, { frame: 1 });

    expect(frame.objects[1]?.geometry).toBeUndefined();
  });
});

describe('state', () => {
  it('reads focus, value and item selection from their own accessors', () => {
    const input = node('InputRenderable', 2, { focused: true, value: 'hello' });
    const select = node('SelectRenderable', 3, { getSelectedIndex: () => 2 });
    const root = node('RootRenderable', 1, { getChildren: () => [input, select] });

    const { frame } = observeTree(root, { frame: 1 });

    expect(frame.objects[1]?.state?.focused).toBe(true);
    expect(frame.objects[1]?.state?.value).toBe('hello');
    expect(frame.objects[2]?.state?.selectedIndex).toBe(2);
  });

  it('keeps an empty value, which is not the same as having none', () => {
    const input = node('InputRenderable', 2, { value: '' });
    const root = node('RootRenderable', 1, { getChildren: () => [input] });

    const { frame } = observeTree(root, { frame: 1 });

    expect(frame.objects[1]?.state?.value).toBe('');
    expect(frame.objects[1]?.unobservable).not.toContain('value');
  });

  it('separates a text range from a highlighted item', () => {
    const editor = node('TextareaRenderable', 2, {
      plainText: 'abc',
      getSelection: () => ({ start: 1, end: 2 }),
    });
    const root = node('RootRenderable', 1, { getChildren: () => [editor] });

    const { frame } = observeTree(root, { frame: 1 });

    expect(frame.objects[1]?.state?.textSelection).toEqual({ start: 1, end: 2 });
    expect(frame.objects[1]?.state?.selectedIndex).toBeUndefined();
  });

  it('takes an editor value from its buffer, which has no `value` of its own', () => {
    // A Textarea carries its content as `plainText`; only Input adds `value`.
    // Without this the whole editor family would report no value at all, and
    // nothing else in this suite would notice.
    const editor = node('TextareaRenderable', 2, { plainText: 'draft text' });
    const root = node('RootRenderable', 1, { getChildren: () => [editor] });

    const { frame } = observeTree(root, { frame: 1 });

    expect(frame.objects[1]?.state?.value).toBe('draft text');
    expect(frame.objects[1]?.unobservable).not.toContain('value');
  });

  it('reports what the framework has no concept of as unobservable', () => {
    const { frame } = observeTree(node('BoxRenderable', 1), { frame: 1 });

    // Not "off" — OpenTUI has no checkbox, no disabled state and no expansion.
    for (const field of ['checked', 'disabled', 'expanded', 'readonly'] as const) {
      expect(frame.objects[0]?.unobservable).toContain(field);
    }
  });

  it('reads scroll position and extent where a widget has them', () => {
    const box = node('ScrollBoxRenderable', 2, {
      scrollTop: 4,
      scrollLeft: 1,
      scrollHeight: 80,
      scrollWidth: 40,
    });
    const root = node('RootRenderable', 1, { getChildren: () => [box] });

    const { frame } = observeTree(root, { frame: 1 });

    expect(frame.objects[1]?.state?.scroll).toEqual({ row: 4, column: 1 });
    expect(frame.objects[1]?.state?.scrollExtent).toEqual({ rows: 80, columns: 40 });
  });
});

describe('text', () => {
  it('joins the chunks a TextRenderable carries', () => {
    const text = node('TextRenderable', 2, {
      chunks: [{ text: 'Hello ' }, { text: 'world' }],
    });
    const root = node('RootRenderable', 1, { getChildren: () => [text] });

    const { frame } = observeTree(root, { frame: 1 });

    expect(frame.objects[1]?.text).toBe('Hello world');
  });

  it('takes a plain string content where a widget uses one', () => {
    const code = node('CodeRenderable', 2, { content: 'const x = 1;' });
    const root = node('RootRenderable', 1, { getChildren: () => [code] });

    expect(observeTree(root, { frame: 1 }).frame.objects[1]?.text).toBe('const x = 1;');
  });
});

describe('paint order', () => {
  it('walks z-order where the framework exposes it, and says so', () => {
    const back = node('BoxRenderable', 2);
    const front = node('BoxRenderable', 3);
    const root = node('RootRenderable', 1, {
      // Document order puts `back` first; z-order puts `front` on top.
      getChildren: () => [back, front],
      _childrenInZIndexOrder: [front, back],
    });

    const { frame, paintOrderKnown } = observeTree(root, { frame: 1 });

    expect(paintOrderKnown).toBe(true);
    const order = frame.objects.map((object) => object.identity.value);
    expect(order).toEqual(['1', '3', '2']);
    expect(frame.objects[1]?.paintOrder).toBeLessThan(frame.objects[2]?.paintOrder as number);
  });

  it('degrades to document order and refuses to claim the capability', () => {
    // The z-order list is protected upstream. When a version stops exposing it
    // the walk still works, and the caller must not announce `paint-order`.
    const root = node('RootRenderable', 1, {
      getChildren: () => [node('BoxRenderable', 2), node('BoxRenderable', 3)],
    });

    const { paintOrderKnown } = observeTree(root, { frame: 1 });

    expect(paintOrderKnown).toBe(false);
  });
});

describe('bounds on the walk', () => {
  it('truncates rather than following a runaway tree', () => {
    const deep = (depth: number): ObservableNode =>
      node('BoxRenderable', depth, {
        getChildren: () => (depth > 50 ? [] : [deep(depth + 1)]),
      });

    const { frame, truncated } = observeTree(deep(1), { frame: 1, maxObjects: 10 });

    expect(truncated).toBe(true);
    expect(frame.objects).toHaveLength(10);
  });
});

describe('the protocol accepts what this produces', () => {
  it('validates a frame built from a realistic tree', () => {
    const root = node('RootRenderable', 1, {
      _childrenInZIndexOrder: [
        node('BoxRenderable', 2, {
          _childrenInZIndexOrder: [node('TextRenderable', 3, { chunks: [{ text: 'Approve' }] })],
        }),
        node('InputRenderable', 4, { focused: true, value: '' }),
      ],
    });

    const { frame } = observeTree(root, { frame: 7 });
    const result = validateProbeFrame(frame, DEFAULT_LIMITS);

    expect(result.ok ? null : result.detail).toBeNull();
  });
});
