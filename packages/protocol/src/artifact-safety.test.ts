import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ARTIFACT_VALUE_POLICY,
  projectSemanticSnapshotForArtifact,
  publicValue,
  recordActionPlan,
  projectActionReceiptForArtifact,
  sensitive,
} from './index.js';
import type { SemanticSnapshot } from './tree.js';

const stamp = Object.freeze({
  sessionId: 's',
  contractId: 'c',
  epoch: 0,
  sequence: 1,
  screenRevision: 1,
  semanticRevision: 1,
  pairedScreenRevision: 1,
});

const evidence = () =>
  ({
    source: 'framework',
    method: 'native',
    strength: 'authoritative',
    providerId: 'test',
  }) as const;

const unknownGeometry = () => ({
  displayed: { status: 'unknown', reason: 'awaiting-revision-pair' } as const,
  intendedRect: { status: 'unknown', reason: 'awaiting-revision-pair' } as const,
  visibleRect: { status: 'unknown', reason: 'awaiting-revision-pair' } as const,
});

describe('artifact-safe device operations', () => {
  it('uses a redacted secure default', () => {
    expect(DEFAULT_ARTIFACT_VALUE_POLICY).toBe('redacted');
  });

  it('never copies an unclassified or sensitive input into a redacted plan', () => {
    const secret = 'TW_SENTINEL_do-not-publish_7f84';
    const plan = recordActionPlan(
      {
        actionId: 'a1',
        contractId: 'c',
        intent: { kind: 'fill' },
        checkpoint: stamp,
        requirements: [],
        strategy: 'keyboard',
        operations: [
          { device: 'keyboard', kind: 'type', value: secret },
          { device: 'keyboard', kind: 'paste', value: sensitive(secret) },
          { device: 'keyboard', kind: 'press', value: sensitive(secret) },
        ],
      },
      'redacted',
    );
    expect(JSON.stringify(plan)).not.toContain(secret);
    expect(plan.operations).toEqual([
      {
        device: 'keyboard',
        kind: 'type',
        value: { status: 'withheld', reason: 'artifact-policy', sensitivity: 'sensitive' },
      },
      {
        device: 'keyboard',
        kind: 'paste',
        value: { status: 'withheld', reason: 'artifact-policy', sensitivity: 'sensitive' },
      },
      {
        device: 'keyboard',
        kind: 'press',
        value: { status: 'withheld', reason: 'artifact-policy', sensitivity: 'sensitive' },
      },
    ]);
  });

  it('records declared public values and requires raw policy for sensitive values', () => {
    const secret = 'TW_SENTINEL_raw-only_2d19';
    const base = {
      actionId: 'a1',
      contractId: 'c',
      intent: { kind: 'type' as const },
      checkpoint: stamp,
      requirements: [],
      strategy: 'keyboard',
      operations: [
        { device: 'keyboard' as const, kind: 'type' as const, value: publicValue('hello') },
        { device: 'keyboard' as const, kind: 'type' as const, value: sensitive(secret) },
      ],
    };
    expect(JSON.stringify(recordActionPlan(base, 'redacted'))).toContain('hello');
    expect(JSON.stringify(recordActionPlan(base, 'redacted'))).not.toContain(secret);
    expect(JSON.stringify(recordActionPlan(base, 'raw'))).toContain(secret);
  });

  it('preserves non-value mouse operations and public key presses across artifacts', () => {
    const executable = {
      actionId: 'a1',
      contractId: 'c',
      intent: { kind: 'activate' as const },
      checkpoint: stamp,
      requirements: [],
      strategy: 'pointer-or-keyboard',
      operations: [
        {
          device: 'mouse' as const,
          kind: 'down' as const,
          row: 2,
          column: 3,
          button: 'left' as const,
        },
        { device: 'keyboard' as const, kind: 'press' as const, value: 'Enter' },
      ],
    };
    const plan = recordActionPlan(executable, 'none');
    expect(plan.operations).toEqual([
      executable.operations[0],
      {
        device: 'keyboard',
        kind: 'press',
        value: { status: 'known', value: 'Enter', sensitivity: 'public' },
      },
    ]);

    const receipt = {
      intent: executable.intent,
      plan,
      before: stamp,
      after: stamp,
      executed: plan.operations,
      outcome: 'completed' as const,
    };
    expect(projectActionReceiptForArtifact(receipt, 'none').executed).toEqual(plan.operations);
  });

  it('can only make an already-recorded receipt stricter at a later boundary', () => {
    const secret = 'TW_SENTINEL_receipt_projection_d81a';
    const executable = {
      actionId: 'a1',
      contractId: 'c',
      intent: { kind: 'type' as const },
      checkpoint: stamp,
      requirements: [],
      strategy: 'keyboard',
      operations: [
        { device: 'keyboard' as const, kind: 'type' as const, value: sensitive(secret) },
      ],
    };
    const rawPlan = recordActionPlan(executable, 'raw');
    const rawReceipt = {
      intent: executable.intent,
      plan: rawPlan,
      before: stamp,
      after: stamp,
      executed: rawPlan.operations,
      outcome: 'completed' as const,
    };
    const projected = projectActionReceiptForArtifact(rawReceipt, 'redacted');
    expect(JSON.stringify(projected)).not.toContain(secret);
    expect(projected.executed[0]).toMatchObject({ value: { status: 'withheld' } });
  });

  it('projects semantic values without weakening already-safe observations', () => {
    const snapshot: SemanticSnapshot = {
      v: 3,
      sessionId: 's',
      revision: 1,
      columns: 80,
      rows: 24,
      rootIds: ['root'],
      nodes: [
        {
          id: 'root',
          role: 'application',
          name: 'fixture',
          geometry: unknownGeometry(),
          value: {
            status: 'known',
            value: 'secret',
            sensitivity: 'sensitive',
            evidence: evidence(),
          },
        },
        {
          id: 'public',
          parentId: 'root',
          role: 'text',
          name: 'public',
          geometry: unknownGeometry(),
          value: {
            status: 'known',
            value: 'visible',
            sensitivity: 'public',
            evidence: evidence(),
          },
        },
        {
          id: 'unknown',
          parentId: 'root',
          role: 'text',
          name: 'unknown',
          geometry: unknownGeometry(),
        },
      ],
      coordinateSpace: {
        status: 'unsupported',
        capability: 'geometry',
        reason: 'framework-unobservable',
      },
      hitGrid: {
        status: 'unsupported',
        capability: 'pointer-hit-grid',
        reason: 'framework-unobservable',
      },
    };

    const redacted = projectSemanticSnapshotForArtifact(snapshot);
    expect(redacted.nodes[0]?.value).toEqual({
      status: 'withheld',
      reason: 'artifact-policy',
      sensitivity: 'sensitive',
    });
    expect(redacted.nodes[1]?.value).toEqual(snapshot.nodes[1]?.value);
    expect(redacted.nodes[2]).toEqual(snapshot.nodes[2]);
    expect(projectSemanticSnapshotForArtifact(snapshot, 'raw').nodes[0]?.value).toEqual(
      snapshot.nodes[0]?.value,
    );
  });
});
