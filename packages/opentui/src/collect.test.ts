import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, validateSnapshot, type ProtocolLimits } from '@termwright/protocol';
import { canPublishAbsoluteBounds, SnapshotCollector } from './collect.js';
import { SemanticRegistry } from './registry.js';
import { FakeRenderable } from './testing/fake-renderer.js';

const options = { sessionId: 's1', revision: 1, columns: 80, rows: 24, includeBounds: true };

function collect(
  root: FakeRenderable,
  registry = new SemanticRegistry(),
  limits: ProtocolLimits = DEFAULT_LIMITS,
  overrides: Partial<typeof options> = {},
): ReturnType<SnapshotCollector['collect']> {
  return new SnapshotCollector(registry, limits).collect(root, { ...options, ...overrides });
}

describe('SnapshotCollector', () => {
  it('publishes the root as the sole application node', () => {
    const snapshot = collect(new FakeRenderable({ id: 'root' }));

    expect(snapshot.rootIds).toHaveLength(1);
    expect(snapshot.nodes[0]).toMatchObject({ role: 'application', name: '' });
    expect(snapshot.nodes[0]?.parentId).toBeUndefined();
    expect(validateSnapshot(snapshot, DEFAULT_LIMITS).ok).toBe(true);
  });

  it('publishes annotated renderables with bounds from screenX/screenY', () => {
    const root = new FakeRenderable({ id: 'root' });
    const button = root.add(
      new FakeRenderable({ id: 'approve', screenX: 14, screenY: 23, width: 11, height: 1 }),
    );
    const registry = new SemanticRegistry();
    registry.register(button, { role: 'button', name: 'Approve' });

    const snapshot = collect(root, registry);
    const node = snapshot.nodes.find((entry) => entry.name === 'Approve');

    expect(node).toMatchObject({
      role: 'button',
      bounds: { row: 23, column: 14, width: 11, height: 1 },
      testId: 'approve',
      actions: ['activate', 'focus'],
    });
    expect(validateSnapshot(snapshot, DEFAULT_LIMITS).ok).toBe(true);
  });

  it('resolves roles annotation → convention property → class map → generic', () => {
    const root = new FakeRenderable({ id: 'root' });
    const annotated = root.add(new FakeRenderable({ role: 'checkbox' }));
    const conventional = root.add(new FakeRenderable({ role: 'dialog' }));
    const byClass = root.add(new FakeRenderable({ className: 'InputRenderable', plainText: 'x' }));
    const focusableBox = root.add(new FakeRenderable({ focusable: true }));

    const registry = new SemanticRegistry();
    registry.register(annotated, { role: 'button' });

    const nodes = collect(root, registry).nodes;
    const roleOf = (renderable: FakeRenderable): string | undefined =>
      nodes.find((node) => node.id === `n${String(renderable.num)}`)?.role;

    expect(roleOf(annotated)).toBe('button');
    expect(roleOf(conventional)).toBe('dialog');
    expect(roleOf(byClass)).toBe('textbox');
    expect(roleOf(focusableBox)).toBe('generic');
  });

  it('ignores a convention role the protocol does not define', () => {
    const root = new FakeRenderable({ id: 'root' });
    root.add(new FakeRenderable({ role: 'wizard', plainText: 'Next' }));

    const nodes = collect(root).nodes;
    expect(nodes.find((node) => node.name === 'Next')?.role).toBe('generic');
  });

  it('skips layout boxes but keeps their children reachable', () => {
    const root = new FakeRenderable({ id: 'root' });
    const layout = root.add(new FakeRenderable());
    const inner = layout.add(new FakeRenderable());
    const label = inner.add(new FakeRenderable({ className: 'TextRenderable', plainText: 'Ready' }));

    const snapshot = collect(root);
    const labelNode = snapshot.nodes.find((node) => node.name === 'Ready');

    expect(snapshot.nodes).toHaveLength(2);
    expect(labelNode?.id).toBe(`n${String(label.num)}`);
    expect(labelNode?.parentId).toBe(snapshot.nodes[0]?.id);
    expect(validateSnapshot(snapshot, DEFAULT_LIMITS).ok).toBe(true);
  });

  it('drops invisible subtrees entirely', () => {
    const root = new FakeRenderable({ id: 'root' });
    const hidden = root.add(new FakeRenderable({ visible: false }));
    hidden.add(new FakeRenderable({ className: 'TextRenderable', plainText: 'secret' }));

    expect(collect(root).nodes).toHaveLength(1);
  });

  it('derives focused and disabled states, and lets an annotation override them', () => {
    const root = new FakeRenderable({ id: 'root' });
    const focused = root.add(new FakeRenderable({ role: 'button', focused: true, disabled: true }));
    const overridden = root.add(new FakeRenderable({ role: 'button', focused: true }));

    const registry = new SemanticRegistry();
    registry.register(overridden, { state: { focused: false, selected: true } });

    const nodes = collect(root, registry).nodes;
    expect(nodes.find((node) => node.id === `n${String(focused.num)}`)?.state).toEqual({
      focused: true,
      disabled: true,
    });
    expect(nodes.find((node) => node.id === `n${String(overridden.num)}`)?.state).toEqual({
      focused: false,
      selected: true,
    });
  });

  it('reads values and names from the widget facets', () => {
    const root = new FakeRenderable({ id: 'root' });
    root.add(new FakeRenderable({ className: 'InputRenderable', value: 'ada', plainText: 'ada' }));
    root.add(new FakeRenderable({ role: 'dialog', title: 'Permission' }));

    const nodes = collect(root).nodes;
    expect(nodes.find((node) => node.role === 'textbox')?.value).toBe('ada');
    expect(nodes.find((node) => node.role === 'dialog')?.name).toBe('Permission');
  });

  it('never publishes a generated id as a test id', () => {
    const root = new FakeRenderable({ id: 'root' });
    const generated = root.add(new FakeRenderable({ role: 'button' }));
    const named = root.add(new FakeRenderable({ id: 'save', role: 'button' }));

    const nodes = collect(root).nodes;
    expect(generated.id).toMatch(/^renderable-\d+$/u);
    expect(nodes.find((node) => node.id === `n${String(generated.num)}`)?.testId).toBeUndefined();
    expect(nodes.find((node) => node.id === `n${String(named.num)}`)?.testId).toBe('save');
  });

  it('omits bounds when the renderer does not own the viewport', () => {
    const root = new FakeRenderable({ id: 'root' });
    root.add(new FakeRenderable({ role: 'button', screenX: 3, screenY: 4 }));

    const snapshot = collect(root, new SemanticRegistry(), DEFAULT_LIMITS, { includeBounds: false });
    for (const node of snapshot.nodes) expect(node.bounds).toBeUndefined();
    expect(validateSnapshot(snapshot, DEFAULT_LIMITS).ok).toBe(true);
  });

  it('keeps a truncated tree structurally valid', () => {
    // `maxDepth` also bounds the DTO projector's object nesting, so it cannot
    // be driven below what a snapshot object itself needs.
    const limits: ProtocolLimits = { ...DEFAULT_LIMITS, maxNodes: 5, maxDepth: 8 };
    const root = new FakeRenderable({ id: 'root' });
    let cursor = root;
    for (let index = 0; index < 40; index += 1) {
      cursor = cursor.add(new FakeRenderable({ role: 'button', plainText: `n${String(index)}` }));
      root.add(new FakeRenderable({ role: 'button', plainText: `sibling${String(index)}` }));
    }

    const snapshot = collect(root, new SemanticRegistry(), limits);
    const ids = new Set(snapshot.nodes.map((node) => node.id));

    expect(snapshot.nodes.length).toBeLessThanOrEqual(limits.maxNodes + 1);
    for (const node of snapshot.nodes.slice(1)) expect(ids.has(node.parentId as string)).toBe(true);
    expect(validateSnapshot(snapshot, limits)).toMatchObject({ ok: true });
  });

  it('gives each node its own actions array, whatever the source', () => {
    // `validateSnapshot` rejects a snapshot in which any value is reachable
    // twice, and there are two ways to alias one: the role table hands out one
    // frozen array per role, and an application author reuses one array across
    // annotations. Both are copied at the node-construction site.
    //
    // This must be validated IN MEMORY. `encodeFrame` is `JSON.stringify`,
    // which has no concept of reference identity, so a test that checks what
    // came off the socket checks a copy in which the aliasing is already gone.
    const root = new FakeRenderable({ id: 'root' });
    const first = root.add(new FakeRenderable({ role: 'button', plainText: 'Approve' }));
    const second = root.add(new FakeRenderable({ role: 'button', plainText: 'Reject' }));
    const shared = root.add(new FakeRenderable({ plainText: 'Later' }));
    const alsoShared = root.add(new FakeRenderable({ plainText: 'Never' }));

    const registry = new SemanticRegistry();
    const authorActions = ['activate', 'focus'] as const;
    registry.register(shared, { role: 'button', actions: authorActions });
    registry.register(alsoShared, { role: 'button', actions: authorActions });

    const snapshot = collect(root, registry);
    expect(validateSnapshot(snapshot, DEFAULT_LIMITS)).toMatchObject({ ok: true });

    const actionsOf = (renderable: FakeRenderable): readonly string[] | undefined =>
      snapshot.nodes.find((node) => node.id === `n${String(renderable.num)}`)?.actions;

    for (const [left, right] of [
      [first, second],
      [shared, alsoShared],
    ] as const) {
      expect(actionsOf(left)).toEqual(actionsOf(right));
      expect(actionsOf(left)).not.toBe(actionsOf(right));
    }
    expect(actionsOf(shared)).not.toBe(authorActions);
  });

  it('clamps strings on a code-point boundary', () => {
    const limits: ProtocolLimits = { ...DEFAULT_LIMITS, maxStringBytes: 8 };
    const root = new FakeRenderable({ id: 'root' });
    root.add(new FakeRenderable({ role: 'text', plainText: '🙂🙂🙂🙂🙂' }));

    const name = collect(root, new SemanticRegistry(), limits).nodes[1]?.name as string;
    expect(Buffer.byteLength(name, 'utf8')).toBeLessThanOrEqual(8);
    expect([...name].every((char) => char === '🙂')).toBe(true);
  });
});

describe('canPublishAbsoluteBounds', () => {
  it('trusts only the alternate screen', () => {
    expect(canPublishAbsoluteBounds('alternate-screen')).toBe(true);
    expect(canPublishAbsoluteBounds('main-screen')).toBe(false);
    expect(canPublishAbsoluteBounds('split-footer')).toBe(false);
  });
});
