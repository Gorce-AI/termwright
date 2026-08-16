import { useRef } from 'react';
import { Box, Text, type DOMElement, type Instance } from 'ink';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyTreeDelta,
  DEFAULT_LIMITS,
  type SemanticSnapshot,
  type TreeDelta,
} from '@termwright/protocol';
import { semanticRender, useSemantic } from './index.js';
import { computeTreeDelta, deltaIsWorthSending } from './delta.js';
import { startFakeDriver, type FakeDriver } from './testing/fake-driver.js';
import { createFakeStdout } from './testing/fake-stdout.js';

function Item({ name, label }: { readonly name: string; readonly label: string }) {
  const ref = useRef<DOMElement>(null);
  useSemantic(ref, { role: 'button', name });
  return (
    <Box ref={ref}>
      <Text>{label}</Text>
    </Box>
  );
}

function List({ items }: { readonly items: readonly string[] }) {
  return (
    <Box flexDirection="column">
      {items.map((item) => (
        <Item key={item} name={item} label={item} />
      ))}
    </Box>
  );
}

/**
 * The protocol's own composer, used as an oracle: whatever the adapter sends,
 * base + delta must reproduce the snapshot the adapter itself built.
 */
function compose(base: SemanticSnapshot, delta: TreeDelta): SemanticSnapshot {
  const result = applyTreeDelta(base, delta, DEFAULT_LIMITS);
  if (!result.ok) throw new Error(`delta did not compose: ${result.code} ${result.detail}`);
  return result.snapshot;
}

/** Compare ignoring node order, which the wire does not constrain. */
function sameTree(a: SemanticSnapshot, b: SemanticSnapshot): void {
  const key = (snapshot: SemanticSnapshot) =>
    JSON.stringify({
      ...snapshot,
      nodes: [...snapshot.nodes].sort((left, right) => left.id.localeCompare(right.id)),
    });
  expect(key(a)).toBe(key(b));
}

describe('tree deltas', () => {
  const openApps: Instance[] = [];
  const openDrivers: FakeDriver[] = [];

  afterEach(async () => {
    for (const app of openApps.splice(0)) app.unmount();
    for (const driver of openDrivers.splice(0)) await driver.close();
  });

  async function launchDiffs(items: readonly string[]): Promise<{
    driver: FakeDriver;
    app: Instance;
  }> {
    const driver = await startFakeDriver({ subscribe: 'diffs' });
    openDrivers.push(driver);
    const app = semanticRender(<List items={items} />, {
      interactive: true,
      patchConsole: false,
      alternateScreen: true,
      stdout: createFakeStdout(),
      semantics: {
        env: { TERMWRIGHT_ENDPOINT: driver.endpoint, TERMWRIGHT_TOKEN: driver.token },
      },
    });
    openApps.push(app);
    await driver.waitForSnapshots(1);
    return { driver, app };
  }

  describe('negotiation', () => {
    it('announces the tree-diffs capability', async () => {
      const { driver } = await launchDiffs(['one']);
      expect((await driver.waitForHandshake()).capabilities).toContain('tree-diffs');
    });

    it('opens with a full snapshot, because a delta needs a base', async () => {
      const { driver } = await launchDiffs(['one', 'two']);
      expect(driver.treeTraffic[0]).toEqual({ kind: 'snapshot' });
      expect(driver.deltas).toHaveLength(0);
    });

    it('keeps sending snapshots when the driver did not ask for diffs', async () => {
      const driver = await startFakeDriver({ subscribe: 'snapshots' });
      openDrivers.push(driver);
      const app = semanticRender(<List items={['one']} />, {
        interactive: true,
        patchConsole: false,
        stdout: createFakeStdout(),
        semantics: {
          env: { TERMWRIGHT_ENDPOINT: driver.endpoint, TERMWRIGHT_TOKEN: driver.token },
        },
      });
      openApps.push(app);
      await driver.waitForSnapshots(1);

      app.rerender(<List items={['one', 'two']} />);
      await driver.waitForSnapshots(2);

      expect(driver.deltas).toHaveLength(0);
    });
  });

  describe('a delta composes back to the snapshot it describes', () => {
    it('survives a sequence of mutations, checked against the oracle', async () => {
      const { driver, app } = await launchDiffs(['a', 'b', 'c']);
      const base = driver.snapshots[0] as SemanticSnapshot;

      const steps: string[][] = [
        ['a', 'b', 'c', 'd'], // append
        ['a', 'c', 'd'], // remove from the middle
        ['d', 'c', 'a'], // reorder
        ['a', 'c', 'd'], // reorder back
      ];

      let held = base;
      // Start from what already arrived: the opening snapshot is traffic too,
      // and counting from zero would satisfy every wait immediately.
      let seen = driver.treeTraffic.length;
      for (const items of steps) {
        app.rerender(<List items={items} />);
        // One tree message per committed revision, delta or snapshot.
        await driver.waitForTreeTraffic(seen + 1);
        seen = driver.treeTraffic.length;

        // Whatever arrived, replay it exactly as the driver would.
        const arrival = driver.treeTraffic.at(-1);
        held =
          arrival?.kind === 'delta'
            ? compose(held, driver.deltas.at(-1) as TreeDelta)
            : (driver.snapshots.at(-1) as SemanticSnapshot);
      }

      // Guard against a green run that never exercised a delta at all.
      expect(driver.deltas.length).toBeGreaterThan(0);

      // The adapter's own view of the last revision, fetched independently.
      const authoritative = await driver.requestTree();
      sameTree(held, authoritative.snapshot as SemanticSnapshot);
    });

    it('binds every delta to the revision it was computed from', async () => {
      const { driver, app } = await launchDiffs(['a', 'b']);
      app.rerender(<List items={['a', 'b', 'c']} />);
      await driver.waitForTreeTraffic(2);

      const delta = driver.deltas.at(-1);
      expect(delta?.baseRevision).toBe(driver.snapshots[0]?.revision);
      expect(delta?.revision).toBeGreaterThan(delta?.baseRevision as number);
    });
  });

  describe('the cascade trap', () => {
    it('re-adds a byte-identical node that sat inside a removed subtree', () => {
      // `leaf` is IDENTICAL in both trees, parent included. What kills it is
      // that its grandparent disappears: the receiver cascades over the base
      // tree, so `leaf` dies with `outer` unless the delta resurrects it.
      // A node whose own parentId changed would be caught by the ordinary
      // "differs" check and would not test this rule at all.
      const base: SemanticSnapshot = {
        v: 1,
        sessionId: 's1',
        revision: 1,
        columns: 80,
        rows: 24,
        rootIds: ['root'],
        nodes: [
          { id: 'root', role: 'application', name: '' },
          { id: 'outer', parentId: 'root', role: 'region', name: 'outer' },
          { id: 'inner', parentId: 'outer', role: 'region', name: 'inner' },
          { id: 'leaf', parentId: 'inner', role: 'text', name: 'leaf' },
        ],
      };
      const next: SemanticSnapshot = {
        ...base,
        revision: 2,
        nodes: [
          { id: 'root', role: 'application', name: '' },
          // `inner` is reparented, so it differs; `leaf` does not change at all.
          { id: 'inner', parentId: 'root', role: 'region', name: 'inner' },
          { id: 'leaf', parentId: 'inner', role: 'text', name: 'leaf' },
        ],
      };

      const delta = computeTreeDelta(base, next);
      expect(delta.removed).toEqual(['outer']);
      expect(delta.changed.map((node) => node.id)).toContain('leaf');
      sameTree(compose(base, delta), next);
    });

    it('replaces the root list only when it actually changed', () => {
      const base: SemanticSnapshot = {
        v: 1,
        sessionId: 's1',
        revision: 1,
        columns: 80,
        rows: 24,
        rootIds: ['root'],
        nodes: [
          { id: 'root', role: 'application', name: '' },
          { id: 'other', role: 'application', name: 'second' },
        ],
      };

      const unchanged = computeTreeDelta(base, { ...base, revision: 2 });
      expect(unchanged.rootIds).toBeUndefined();

      const next: SemanticSnapshot = { ...base, revision: 2, rootIds: ['root', 'other'] };
      const delta = computeTreeDelta(base, next);
      expect(delta.rootIds).toEqual(['root', 'other']);
      sameTree(compose(base, delta), next);
    });

    it('lists only the top of a removed subtree', () => {
      const base: SemanticSnapshot = {
        v: 1,
        sessionId: 's1',
        revision: 1,
        columns: 80,
        rows: 24,
        rootIds: ['root'],
        nodes: [
          { id: 'root', role: 'application', name: '' },
          { id: 'dialog', parentId: 'root', role: 'dialog', name: 'Permission' },
          { id: 'title', parentId: 'dialog', role: 'text', name: 'Allow?' },
          { id: 'ok', parentId: 'dialog', role: 'button', name: 'OK' },
        ],
      };
      const next: SemanticSnapshot = {
        ...base,
        revision: 2,
        nodes: [{ id: 'root', role: 'application', name: '' }],
      };

      const delta = computeTreeDelta(base, next);
      expect(delta.removed).toEqual(['dialog']);
      expect(delta.changed).toHaveLength(0);
      sameTree(compose(base, delta), next);
    });
  });

  describe('the size heuristic', () => {
    it('prefers a snapshot once the delta stops paying for itself', async () => {
      const { driver, app } = await launchDiffs(['a', 'b', 'c']);
      const before = driver.snapshots.length;

      // Every node replaced: a delta would carry the whole tree plus removals.
      app.rerender(<List items={['x', 'y', 'z', 'w', 'v']} />);
      await driver.waitForTreeTraffic(2);

      expect(driver.treeTraffic.at(-1)).toEqual({ kind: 'snapshot' });
      expect(driver.snapshots.length).toBe(before + 1);
    });

    it('prefers a delta for a small change', async () => {
      const { driver, app } = await launchDiffs(['a', 'b', 'c', 'd', 'e', 'f']);
      app.rerender(<List items={['a', 'b', 'c', 'd', 'e', 'f', 'g']} />);
      await driver.waitForTreeTraffic(2);

      expect(driver.treeTraffic.at(-1)).toEqual({ kind: 'delta' });
    });

    it('scores the two encodings, not the node counts', () => {
      const base: SemanticSnapshot = {
        v: 1,
        sessionId: 's1',
        revision: 1,
        columns: 80,
        rows: 24,
        rootIds: ['root'],
        nodes: [{ id: 'root', role: 'application', name: '' }],
      };
      const next: SemanticSnapshot = {
        ...base,
        revision: 2,
        nodes: [
          { id: 'root', role: 'application', name: '' },
          { id: 'n2', parentId: 'root', role: 'text', name: 'x'.repeat(2_000) },
        ],
      };

      const delta = computeTreeDelta(base, next);
      // One node, but it carries nearly the whole tree.
      expect(deltaIsWorthSending(delta, next)).toBe(false);
      sameTree(compose(base, delta), next);
    });
  });

  describe('get-tree', () => {
    it('answers with a full snapshot even in diffs mode', async () => {
      const { driver, app } = await launchDiffs(['a', 'b']);
      app.rerender(<List items={['a', 'b', 'c']} />);
      await driver.waitForTreeTraffic(2);

      const answer = await driver.requestTree();
      expect(answer.snapshot).toBeDefined();
      expect(answer.snapshot?.nodes.length).toBeGreaterThan(0);
      expect(answer.error).toBeUndefined();
    });

    it('refuses a revision it no longer holds', async () => {
      const { driver } = await launchDiffs(['a']);
      const answer = await driver.requestTree(9_999);
      expect(answer.snapshot).toBeUndefined();
      expect(answer.error).toBeDefined();
    });
  });
});
