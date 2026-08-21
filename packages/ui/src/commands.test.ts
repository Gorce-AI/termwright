import { describe, expect, it } from 'vitest';
import { buildCommandLog, currentCommand, parseRef, stepCommand } from './commands.js';

const log = buildCommandLog([
  { kind: 'step-start', t: 100, castOffset: 90, stepId: 's1', title: 'approve' },
  { kind: 'action', t: 150, castOffset: 140, api: 'locator.click', selector: 'button', ref: 'n8@42', ok: true, stepId: 's1' },
  { kind: 'assert', t: 200, castOffset: 190, api: 'toBeVisible', selector: 'dialog', ok: false, error: 'still hidden', stepId: 's1' },
  { kind: 'step-end', t: 250, castOffset: 240, stepId: 's1', status: 'failed' },
  { kind: 'input', t: 300, castOffset: 290, dataB64: 'DQ==', inputKind: 'key' },
]);

describe('buildCommandLog', () => {
  it('reads steps, actions, assertions and inputs in order', () => {
    expect(log.map((row) => [row.kind, row.label])).toEqual([
      ['step', 'approve'],
      ['action', 'locator.click'],
      ['assert', 'toBeVisible'],
      ['input', 'input (key)'],
    ]);
  });

  it('projects the exact trace receipt into Runner action diagnostics', () => {
    const stamp = { sessionId: 's1', contractId: 's1:0', epoch: 0, sequence: 7, screenRevision: 3, semanticRevision: 7, pairedScreenRevision: 3 };
    const evidence = { source: 'application', method: 'native', strength: 'authoritative', providerId: 'app.router' } as const;
    const rows = buildCommandLog([{
      kind: 'action', t: 20, castOffset: 20, api: 'click', ok: true,
      receipt: {
        intent: { kind: 'click' },
        plan: {
          actionId: 'a1', contractId: 's1:0', intent: { kind: 'click' }, checkpoint: stamp,
          requirements: [{ condition: { kind: 'receives-pointer', target: 'b1@7' }, checkpoint: stamp, observation: { status: 'known', value: true, evidence }, verdict: 'satisfied' }],
          strategy: 'authoritative-pointer-region',
          physicalRegion: { checkpoint: stamp, coordinateSpace: 'viewport-cells', intendedRect: { row: 1, column: 1, width: 2, height: 1 }, spans: [{ row: 1, from: 1, to: 3 }], evidence },
          operations: [],
        },
        before: stamp,
        after: { ...stamp, sequence: 8 },
        executed: [
          { device: 'mouse', kind: 'down', modifiers: ['shift', 'control'] },
          { device: 'mouse', kind: 'up', modifiers: ['shift', 'control'] },
        ],
        outcome: 'completed',
      },
    }]);
    expect(rows[0]?.actionPlan).toEqual({
      actionId: 'a1', kind: 'click', strategy: 'authoritative-pointer-region', contractId: 's1:0',
      beforeSequence: 7, afterSequence: 8,
      operations: [
        { device: 'mouse', kind: 'down', modifiers: ['shift', 'control'] },
        { device: 'mouse', kind: 'up', modifiers: ['shift', 'control'] },
      ],
      requirements: [{ kind: 'receives-pointer', target: 'b1@7', verdict: 'satisfied', observation: 'known', evidence }],
      physicalEvidence: evidence,
    });
  });

  it('does not display a malformed receipt as authoritative replay evidence', () => {
    const rows = buildCommandLog([{
      kind: 'action', t: 20, castOffset: 20, api: 'click', ok: true,
      receipt: { intent: { kind: 'click' }, plan: { actionId: 'a1', contractId: 's:0', strategy: 'pointer', requirements: 'forged' }, before: { sequence: 1 }, after: { sequence: 2 }, executed: [] },
    }]);
    expect(rows[0]?.actionPlan).toBeUndefined();
  });

  it('projects the exact rejected planner explanation into replay diagnostics', () => {
    const stamp = { sessionId: 's1', contractId: 's1:0', epoch: 0, sequence: 7, screenRevision: 3, semanticRevision: 7, pairedScreenRevision: 3 };
    const evidence = { source: 'application', method: 'native', strength: 'authoritative', providerId: 'app.router' } as const;
    const rows = buildCommandLog([{
      kind: 'action', t: 20, castOffset: 20, api: 'click', ok: false, error: 'not-actionable',
      actionability: {
        actionable: false, intent: { kind: 'click', targetRef: 'save@7' }, checkpoint: stamp,
        requirements: [{ condition: { kind: 'receives-pointer', target: 'save@7' }, checkpoint: stamp, observation: { status: 'known', value: false, evidence }, verdict: 'unsatisfied' }],
        reason: { code: 'covered-by', message: 'Target is covered', targetRef: 'overlay@7' },
      },
    }]);
    expect(rows[0]?.actionability).toEqual({
      actionable: false, kind: 'click', contractId: 's1:0', sequence: 7,
      requirements: [{ kind: 'receives-pointer', target: 'save@7', verdict: 'unsatisfied', observation: 'known', evidence }],
      reason: { code: 'covered-by', message: 'Target is covered', targetRef: 'overlay@7' },
    });
  });

  it('does not display malformed replay actionability as planner truth', () => {
    const rows = buildCommandLog([{
      kind: 'action', t: 20, castOffset: 20, api: 'click', ok: false,
      actionability: { actionable: false, intent: { kind: 'click' }, checkpoint: { contractId: 's:0', sequence: 1 }, requirements: 'forged' },
    }]);
    expect(rows[0]?.actionability).toBeUndefined();
  });

  it('positions rows on the cast timeline', () => {
    expect(log.map((row) => row.t)).toEqual([90, 140, 190, 290]);
  });

  it('nests what happened inside a step', () => {
    expect(log[0]?.depth).toBe(0);
    expect(log[1]?.depth).toBe(1);
    expect(log[1]?.stepId).toBe('s1');
  });

  it('shows one logical interaction instead of raw PTY input followed by its driver action', () => {
    const rows = buildCommandLog([
      { kind: 'step-start', t: 0, castOffset: 0, stepId: 'focus', title: 'move the focus' },
      { kind: 'input', t: 10, castOffset: 10, dataB64: 'CQ==', inputKind: 'key' },
      { kind: 'action', t: 11, castOffset: 11, api: 'press', ok: true, stepId: 'focus' },
      { kind: 'assert', t: 12, castOffset: 12, api: 'toBeFocused', ok: true, stepId: 'focus' },
      { kind: 'step-end', t: 13, castOffset: 13, stepId: 'focus', status: 'passed' },
    ]);

    expect(rows.map((row) => [row.kind, row.label, row.depth, row.t])).toEqual([
      ['step', 'move the focus', 0, 0],
      ['action', 'press Tab', 1, 10],
      ['assert', 'toBeFocused', 1, 12],
    ]);
  });

  it('keeps genuinely raw input when no high-level driver action follows it', () => {
    const rows = buildCommandLog([
      { kind: 'input', t: 10, castOffset: 10, dataB64: 'Aw==', inputKind: 'raw' },
      { kind: 'assert', t: 11, castOffset: 11, api: 'toHaveText', ok: true },
    ]);
    expect(rows.map((row) => row.label)).toEqual(['input (raw)', 'toHaveText']);
  });

  it('keeps a command inside its step when legacy producer clocks overlap', () => {
    const rows = buildCommandLog([
      { kind: 'step-start', t: 20, castOffset: 20, stepId: 's1', title: 'move the focus' },
      { kind: 'input', t: 10, castOffset: 10, dataB64: 'CQ==', inputKind: 'key' },
      { kind: 'action', t: 11, castOffset: 11, api: 'press', ok: true, stepId: 's1' },
      { kind: 'assert', t: 21, castOffset: 21, api: 'toBeFocused', ok: true, stepId: 's1' },
    ]);
    expect(rows.map((row) => [row.label, row.t, row.depth])).toEqual([
      ['move the focus', 20, 0],
      ['press Tab', 20, 1],
      ['toBeFocused', 21, 1],
    ]);
  });

  it('closes a step with its outcome and end time', () => {
    expect(log[0]?.endT).toBe(240);
    expect(log[0]?.ok).toBe(false);
  });

  it('keeps the selector, ref and failure of each row', () => {
    expect(log[1]?.selector).toBe('button');
    expect(log[1]?.ref).toBe('n8@42');
    expect(log[2]?.ok).toBe(false);
    expect(log[2]?.error).toBe('still hidden');
  });

  it('skips events it cannot read, and keeps the rest', () => {
    const rows = buildCommandLog([
      'not an event',
      { kind: 'action', t: 1 }, // no castOffset to place it on, no api
      { kind: 'action', t: 5, castOffset: 5, api: 'locator.press', ok: true },
      null,
    ]);
    expect(rows.map((row) => row.label)).toEqual(['locator.press']);
  });

  it('survives a step that never closed', () => {
    const rows = buildCommandLog([
      { kind: 'step-start', t: 0, castOffset: 0, stepId: 's1', title: 'open' },
      { kind: 'action', t: 10, castOffset: 10, api: 'locator.click', ok: true },
    ]);
    expect(rows[0]?.endT).toBeUndefined();
    expect(rows[0]?.ok).toBeUndefined();
    expect(rows[1]?.depth).toBe(1);
  });

  it('closes the innermost step when the end names none', () => {
    const rows = buildCommandLog([
      { kind: 'step-start', t: 0, castOffset: 0, stepId: 'outer', title: 'outer' },
      { kind: 'step-start', t: 10, castOffset: 10, stepId: 'inner', title: 'inner' },
      { kind: 'step-end', t: 20, castOffset: 20, status: 'passed' },
      { kind: 'action', t: 30, castOffset: 30, api: 'locator.click', ok: true },
    ]);
    expect(rows[1]?.endT).toBe(20);
    // step-end closes a row rather than adding one, so the action is rows[2] —
    // and it is still one level in, inside the outer step.
    expect(rows[2]?.label).toBe('locator.click');
    expect(rows[2]?.depth).toBe(1);
  });

  it('bounds a hostile event log', () => {
    const many = Array.from({ length: 10_000 }, (_, index) => ({
      kind: 'action',
      t: index,
      castOffset: index,
      api: 'x'.repeat(10_000),
      ok: true,
    }));
    const rows = buildCommandLog(many);
    expect(rows).toHaveLength(5_000);
    expect(rows[0]?.label.length).toBe(2_048);
  });
});

describe('currentCommand', () => {
  it('is the last row that had started', () => {
    expect(currentCommand(log, 0)).toBe(-1);
    expect(currentCommand(log, 90)).toBe(0);
    expect(currentCommand(log, 189)).toBe(1);
    expect(currentCommand(log, 10_000)).toBe(3);
  });
});

describe('stepCommand', () => {
  it('walks actions and assertions, skipping steps and inputs', () => {
    expect(stepCommand(log, 0, 1)?.label).toBe('locator.click');
    expect(stepCommand(log, 140, 1)?.label).toBe('toBeVisible');
    expect(stepCommand(log, 190, -1)?.label).toBe('locator.click');
  });

  it('returns nothing past the ends', () => {
    expect(stepCommand(log, 10_000, 1)).toBeUndefined();
    expect(stepCommand(log, 0, -1)).toBeUndefined();
  });
});

describe('parseRef', () => {
  it('splits a ref into node and revision', () => {
    expect(parseRef('n8@42')).toEqual({ nodeId: 'n8', revision: 42 });
  });

  it('rejects anything else', () => {
    expect(parseRef('n8')).toBeNull();
    expect(parseRef('cells(1,2)')).toBeNull();
    expect(parseRef('n8@rev')).toBeNull();
  });
});

describe('a row the user picked', () => {
  it('wins the highlight over another row sharing its millisecond', () => {
    const rows = buildCommandLog([
      { kind: 'assert', t: 718, castOffset: 718, api: 'toHaveState', ok: true },
      { kind: 'step-start', t: 718, castOffset: 718, stepId: 's1', title: 'open the dialog' },
    ]);
    const assertion = rows.find((row) => row.kind === 'assert');
    expect(currentCommand(rows, 718)).toBe(1); // the step sorted last
    expect(currentCommand(rows, 718, assertion?.id)).toBe(0);
  });

  it('is ignored when the replay has moved past it', () => {
    const rows = buildCommandLog([
      { kind: 'action', t: 100, castOffset: 100, api: 'locator.click', ok: true },
      { kind: 'action', t: 200, castOffset: 200, api: 'locator.press', ok: true },
    ]);
    expect(currentCommand(rows, 200, rows[0]?.id)).toBe(1);
  });
});
