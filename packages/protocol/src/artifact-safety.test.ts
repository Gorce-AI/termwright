import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ARTIFACT_VALUE_POLICY,
  publicValue,
  recordActionPlan,
  projectActionReceiptForArtifact,
  sensitive,
} from './index.js';

const stamp = Object.freeze({
  sessionId: 's',
  contractId: 'c',
  epoch: 0,
  sequence: 1,
  screenRevision: 1,
  semanticRevision: 1,
  pairedScreenRevision: 1,
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
});
