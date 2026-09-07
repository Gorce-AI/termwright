import type {
  NodeGeometryObservations,
  Rect,
  SemanticNode,
  SemanticSnapshot,
} from '@termwright/protocol';
import { describe, expect, it } from 'vitest';
import type { ExecutionNode } from './model.js';
import { pickTerminalNode } from './terminal-picking.js';
import { highlightExecutionTarget, highlightSemanticNode } from './terminal-highlight.js';

const evidence = () => ({
  source: 'framework' as const,
  method: 'native' as const,
  strength: 'authoritative' as const,
  providerId: 'ui-test',
});
const visible = (rect: Rect): NodeGeometryObservations => ({
  displayed: { status: 'known', value: true, evidence: evidence() },
  intendedRect: { status: 'known', value: { ...rect }, evidence: evidence() },
  visibleRect: { status: 'known', value: { ...rect }, evidence: evidence() },
});
const unknown = (): NodeGeometryObservations => ({
  displayed: { status: 'unknown', reason: 'awaiting-revision-pair' },
  intendedRect: { status: 'unknown', reason: 'awaiting-revision-pair' },
  visibleRect: { status: 'unknown', reason: 'awaiting-revision-pair' },
});

const snapshot: SemanticSnapshot = {
  v: 3,
  sessionId: 's1',
  revision: 7,
  columns: 80,
  rows: 24,
  rootIds: ['approve'],
  nodes: [
    {
      id: 'approve',
      role: 'button',
      name: 'Approve',
      geometry: visible({ row: 3, column: 4, width: 9, height: 1 }),
    },
  ],
  coordinateSpace: { status: 'known', value: 'viewport-cells', evidence: evidence() },
  hitGrid: {
    status: 'unsupported',
    capability: 'pointer-hit-grid',
    reason: 'framework-unobservable',
  },
};
const command: ExecutionNode = {
  nodeId: 'a1',
  kind: 'action',
  label: 'click',
  status: 'passed',
  startMs: 10,
  targetRef: 'semantic:approve@7',
};

describe('terminal highlights', () => {
  it('uses only the node from the exact referenced semantic revision', () => {
    expect(highlightExecutionTarget(command, snapshot, false)).toMatchObject({
      targetRef: 'semantic:approve@7',
      revision: 7,
      role: 'button',
      name: 'Approve',
      bounds: { row: 3, column: 4, width: 9, height: 1 },
      reason: null,
    });
    const stale = highlightExecutionTarget(command, { ...snapshot, revision: 8 }, false);
    expect(stale).toMatchObject({
      reason: 'Target revision 7 is not the displayed revision 8.',
    });
    expect(stale).not.toHaveProperty('bounds');
  });

  it('reports unsupported and bounds-free targets instead of drawing guessed geometry', () => {
    const { targetRef: _targetRef, ...withoutTarget } = command;
    expect(highlightExecutionTarget(withoutTarget, snapshot, false)?.reason).toContain(
      'did not retain',
    );
    const boundsFree = highlightExecutionTarget(
      command,
      {
        ...snapshot,
        nodes: [{ id: 'approve', role: 'button', name: 'Approve', geometry: unknown() }],
      },
      true,
    );
    expect(boundsFree).toMatchObject({
      pinned: true,
      reason: 'This node has no reliable terminal bounds.',
    });
    expect(boundsFree).not.toHaveProperty('bounds');
  });

  it('uses only known visible geometry and never intended geometry as a fallback', () => {
    const qualified: SemanticSnapshot = {
      ...snapshot,
      nodes: [
        {
          id: 'approve',
          role: 'button',
          name: 'Approve',
          geometry: {
            displayed: { status: 'known', value: true, evidence: evidence() },
            intendedRect: {
              status: 'known',
              value: { row: 2, column: 3, width: 12, height: 2 },
              evidence: evidence(),
            },
            visibleRect: {
              status: 'known',
              value: { row: 3, column: 4, width: 8, height: 1 },
              evidence: evidence(),
            },
          },
        },
      ],
    };
    expect(highlightSemanticNode(qualified.nodes[0]!, qualified, false)).toMatchObject({
      bounds: { row: 3, column: 4, width: 8, height: 1 },
      reason: null,
    });

    const withoutVisible = {
      ...qualified.nodes[0]!,
      geometry: {
        ...qualified.nodes[0]!.geometry!,
        visibleRect: {
          status: 'unsupported',
          capability: 'visible-rect',
          reason: 'framework-unobservable',
        } as const,
      },
    };
    const unsupported = highlightSemanticNode(
      withoutVisible,
      { ...qualified, nodes: [withoutVisible] },
      false,
    );
    expect(unsupported).toMatchObject({ reason: 'This node has no reliable terminal bounds.' });
    expect(unsupported).not.toHaveProperty('bounds');

    const unqualifiedV2: SemanticNode = {
      ...qualified.nodes[0]!,
      geometry: {
        displayed: { status: 'known', value: true, evidence: evidence() },
        intendedRect: {
          status: 'known',
          value: { row: 1, column: 1, width: 5, height: 1 },
          evidence: evidence(),
        },
        visibleRect: { status: 'unknown', reason: 'awaiting-revision-pair' } as const,
      },
    };
    const result = highlightSemanticNode(
      unqualifiedV2,
      { ...qualified, nodes: [unqualifiedV2] },
      false,
    );
    expect(result).toMatchObject({ reason: 'This node has no reliable terminal bounds.' });
    expect(result).not.toHaveProperty('bounds');
  });
});

describe('picking terminal elements', () => {
  it('uses half-open visible bounds and rejects out-of-grid coordinates', () => {
    expect(pickTerminalNode(snapshot, 4, 3).node?.id).toBe('approve');
    expect(pickTerminalNode(snapshot, 12.99, 3.99).node?.id).toBe('approve');
    for (const point of [
      [13, 3],
      [4, 4],
      [-1, 3],
      [80, 3],
      [NaN, 3],
    ])
      expect(pickTerminalNode(snapshot, point[0]!, point[1]!).node).toBeNull();
  });
  it('chooses a nested child rather than its enclosing container', () => {
    const nested = {
      ...snapshot,
      nodes: [
        {
          ...snapshot.nodes[0]!,
          id: 'dialog',
          geometry: visible({ column: 0, row: 0, width: 80, height: 24 }),
        },
        { ...snapshot.nodes[0]!, parentId: 'dialog' },
      ],
    };
    expect(pickTerminalNode(nested, 5, 3).node?.id).toBe('approve');
    expect(pickTerminalNode(nested, 1, 1).node?.id).toBe('dialog');
  });
  it('requires recorded ownership to resolve overlapping siblings', () => {
    const overlapping = {
      ...snapshot,
      nodes: [snapshot.nodes[0]!, { ...snapshot.nodes[0]!, id: 'other' }],
    };
    expect(pickTerminalNode(overlapping, 5, 3)).toMatchObject({
      node: null,
      reason: expect.stringContaining('Overlapping'),
    });
    expect(
      pickTerminalNode(
        {
          ...overlapping,
          hitGrid: {
            status: 'known',
            evidence: evidence(),
            value: {
              regions: [{ rect: { column: 4, row: 3, width: 9, height: 1 }, recipientId: 'other' }],
            },
          },
        },
        5,
        3,
      ).node?.id,
    ).toBe('other');
  });
  it('does not use hidden or unavailable geometry', () => {
    expect(
      pickTerminalNode(
        { ...snapshot, nodes: [{ ...snapshot.nodes[0]!, geometry: unknown() }] },
        5,
        3,
      ).node,
    ).toBeNull();
    expect(
      pickTerminalNode(
        {
          ...snapshot,
          nodes: [
            {
              ...snapshot.nodes[0]!,
              geometry: {
                ...snapshot.nodes[0]!.geometry,
                displayed: { status: 'known', value: false, evidence: evidence() },
              },
            },
          ],
        },
        5,
        3,
      ).node,
    ).toBeNull();
  });
});
