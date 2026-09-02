import type {
  NodeGeometryObservations,
  Rect,
  SemanticNode,
  SemanticSnapshot,
} from '@termwright/protocol';
import { describe, expect, it } from 'vitest';
import type { ExecutionNode } from './model.js';
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
