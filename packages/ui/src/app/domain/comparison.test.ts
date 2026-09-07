import { describe, expect, it } from 'vitest';
import { FIXTURE_TREES } from '../../__fixtures__/build-trace.js';
import { alignedSteps, semanticDifferences } from './comparison.js';

describe('attempt comparison', () => {
  it('aligns named steps by ancestry and occurrence instead of wall time or trace IDs', () => {
    const left = {
      durationMs: 300,
      steps: [
        { stepId: 'a', title: 'type', castOffset: 10, castEndOffset: 20 },
        { stepId: 'b', title: 'type', castOffset: 30, castEndOffset: 40 },
      ],
    };
    const right = {
      durationMs: 500,
      steps: [
        { stepId: 'c', title: 'type', castOffset: 100, castEndOffset: 200 },
        { stepId: 'd', title: 'type', castOffset: 300, castEndOffset: 400 },
      ],
    };
    expect(alignedSteps(left, right).map((step) => [step.left, step.right])).toEqual([
      [20, 200],
      [40, 400],
    ]);
    expect(alignedSteps(left, { ...right, steps: [] })).toEqual([]);
  });
  it('ignores ephemeral refs and compares stable IDs, state and bounds', () => {
    const left = FIXTURE_TREES[0]!;
    const right = {
      ...left,
      revision: 99,
      nodes: left.nodes.map((node) => ({
        ...node,
        id: `new-${node.id}`,
        ...(node.parentId ? { parentId: `new-${node.parentId}` } : {}),
      })),
    };
    expect(semanticDifferences(left, right).differences).toEqual([]);
    const before = { ...left, nodes: left.nodes.map((node) => ({ ...node, testId: node.id })) };
    const after = {
      ...right,
      nodes: right.nodes.map((node) => ({
        ...node,
        testId: node.id.replace('new-', ''),
        ...(node.role === 'button' ? { name: 'Retry', state: { disabled: true } } : {}),
      })),
    };
    expect(semanticDifferences(before, after).differences).toMatchObject([
      { kind: 'changed', label: 'button · Retry' },
    ]);
  });
  it('reports additions/removals and avoids arbitrary matches for duplicate semantic identities', () => {
    const left = FIXTURE_TREES[0]!;
    const removed = { ...left, nodes: left.nodes.filter((node) => node.role !== 'button') };
    expect(semanticDifferences(left, removed).differences).toMatchObject([{ kind: 'removed' }]);
    expect(semanticDifferences(removed, left).differences).toMatchObject([{ kind: 'added' }]);
    const duplicate = { ...left, nodes: [...left.nodes, { ...left.nodes[1]!, id: 'duplicate' }] };
    expect(semanticDifferences(left, duplicate)).toEqual({ differences: [], ambiguous: 1 });
  });
});
