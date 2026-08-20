import type { SemanticSnapshot } from '@termwright/protocol';
import { describe, expect, it } from 'vitest';
import type { ExecutionNode } from './model.js';
import { highlightExecutionTarget, highlightSemanticNode } from './terminal-highlight.js';

const snapshot: SemanticSnapshot = {
  v: 1,
  sessionId: 's1',
  revision: 7,
  columns: 80,
  rows: 24,
  rootIds: ['approve'],
  nodes: [{ id: 'approve', role: 'button', name: 'Approve', bounds: { row: 3, column: 4, width: 9, height: 1 } }],
};
const command: ExecutionNode = { nodeId: 'a1', kind: 'action', label: 'click', status: 'passed', startMs: 10, targetRef: 'approve@7' };

describe('terminal highlights', () => {
  it('uses only the node from the exact referenced semantic revision', () => {
    expect(highlightExecutionTarget(command, snapshot, false)).toMatchObject({
      targetRef: 'approve@7',
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
    expect(highlightExecutionTarget(withoutTarget, snapshot, false)?.reason).toContain('did not retain');
    const boundsFree = highlightExecutionTarget(command, { ...snapshot, nodes: [{ id: 'approve', role: 'button', name: 'Approve' }] }, true);
    expect(boundsFree).toMatchObject({
      pinned: true,
      reason: 'This node has no reliable terminal bounds.',
    });
    expect(boundsFree).not.toHaveProperty('bounds');
  });

  it('uses only qualified v2 geometry and never its legacy projection', () => {
    const qualified: SemanticSnapshot = {
      ...snapshot,
      v: 2,
      nodes: [{
        id: 'approve',
        role: 'button',
        name: 'Approve',
        bounds: { row: 20, column: 20, width: 1, height: 1 },
        geometry: {
          displayed: { status: 'known', value: true, evidence: 'probe' },
          intendedRect: { status: 'known', value: { row: 2, column: 3, width: 12, height: 2 }, evidence: 'probe' },
          visibleRect: { status: 'known', value: { row: 3, column: 4, width: 8, height: 1 }, evidence: 'viewport-clip' },
        },
      }],
    };
    expect(highlightSemanticNode(qualified.nodes[0]!, qualified, false)).toMatchObject({
      bounds: { row: 3, column: 4, width: 8, height: 1 },
      reason: null,
    });

    const withoutVisible = {
      ...qualified.nodes[0]!,
      geometry: {
        ...qualified.nodes[0]!.geometry!,
        visibleRect: { status: 'unsupported', capability: 'visible-rect', reason: 'framework-unobservable' } as const,
      },
    };
    expect(highlightSemanticNode(withoutVisible, { ...qualified, nodes: [withoutVisible] }, false)).toMatchObject({
      bounds: { row: 2, column: 3, width: 12, height: 2 },
      reason: null,
    });

    const unqualifiedV2 = {
      ...qualified.nodes[0]!,
      geometry: {
        displayed: { status: 'known', value: true, evidence: 'probe' } as const,
        intendedRect: { status: 'known', value: { row: 1, column: 1, width: 5, height: 1 }, evidence: 'probe' } as const,
        visibleRect: { status: 'unknown', reason: 'not-reported' } as const,
      },
    };
    const result = highlightSemanticNode(unqualifiedV2, { ...qualified, nodes: [unqualifiedV2] }, false);
    expect(result).toMatchObject({ reason: 'This node has no reliable terminal bounds.' });
    expect(result).not.toHaveProperty('bounds');
  });
});
